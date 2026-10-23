-- Existing numbers are imported verbatim. Only new saved quotations allocate
-- a counter in the very same SQLite transaction as their quotation/audit.
CREATE TABLE document_sequences(scope TEXT PRIMARY KEY,last_value INTEGER NOT NULL CHECK(last_value>=0));
CREATE TABLE document_number_ledger(
 number TEXT PRIMARY KEY,quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
 scope TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('issued','void')),
 legacy INTEGER NOT NULL DEFAULT 0,issued_at TEXT NOT NULL,voided_at TEXT);
INSERT INTO document_number_ledger(number,quote_id,scope,status,legacy,issued_at,voided_at)
 SELECT number,id,substr(number,1,9),CASE WHEN deleted_at IS NULL THEN 'issued' ELSE 'void' END,1,created_at,deleted_at FROM quotes;
INSERT INTO document_sequences(scope,last_value)
 SELECT substr(number,1,9),max(CAST(substr(number,11) AS INTEGER)) FROM quotes
 WHERE length(number)=16 AND substr(number,10,1)='-' AND substr(number,11) NOT GLOB '*[^0-9]*'
 GROUP BY substr(number,1,9);
CREATE TRIGGER quote_allocate_document_number AFTER INSERT ON quotes
 WHEN length(NEW.number)=18 AND substr(NEW.number,10,1)='-' AND substr(NEW.number,1,1) IN('S','C','T','M','R')
 BEGIN
 INSERT INTO document_sequences(scope,last_value) VALUES(substr(NEW.number,1,9),1)
 ON CONFLICT(scope) DO UPDATE SET last_value=last_value+1;
 UPDATE quotes SET number=substr(NEW.number,1,10)||printf('%06d',(SELECT last_value FROM document_sequences WHERE scope=substr(NEW.number,1,9))) WHERE id=NEW.id;
 INSERT INTO document_number_ledger(number,quote_id,scope,status,legacy,issued_at)
 SELECT number,id,substr(number,1,9),'issued',0,created_at FROM quotes WHERE id=NEW.id;
 END;
CREATE TRIGGER quote_void_document_number AFTER UPDATE OF deleted_at ON quotes
 WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 BEGIN UPDATE document_number_ledger SET status='void',voided_at=NEW.deleted_at WHERE quote_id=NEW.id;END;
CREATE TRIGGER quote_audit_actual_number AFTER INSERT ON audit_logs
 WHEN NEW.entity_type='quote' AND NEW.new_value IS NOT NULL AND json_valid(NEW.new_value)
 AND json_type(NEW.new_value,'$.number') IS NOT NULL AND EXISTS(SELECT 1 FROM document_number_ledger WHERE quote_id=NEW.entity_id)
 BEGIN UPDATE audit_logs SET new_value=json_set(NEW.new_value,'$.number',(SELECT number FROM document_number_ledger WHERE quote_id=NEW.entity_id)) WHERE id=NEW.id;END;
CREATE TRIGGER document_number_no_delete BEFORE DELETE ON document_number_ledger BEGIN SELECT RAISE(ABORT,'Document number history must be retained');END;
CREATE TRIGGER document_number_identity_immutable BEFORE UPDATE OF number,quote_id,scope,legacy,issued_at ON document_number_ledger BEGIN SELECT RAISE(ABORT,'Document number identity is immutable');END;
