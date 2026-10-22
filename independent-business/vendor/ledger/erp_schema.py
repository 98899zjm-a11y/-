"""Additive ERP tables in the existing ledger; each DDL is transactional."""
STATEMENTS=[
'''CREATE TABLE IF NOT EXISTS erp_metadata(version INTEGER NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS erp_parties(
 id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('supplier','customer')),
 supplier_id INTEGER UNIQUE REFERENCES suppliers(id),name TEXT NOT NULL,norm_name TEXT NOT NULL,
 contact TEXT NOT NULL,phone TEXT NOT NULL,terms_days INTEGER NOT NULL CHECK(terms_days BETWEEN 0 AND 3650),
 note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),revision INTEGER NOT NULL CHECK(revision>0),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL, UNIQUE(kind,norm_name))''',
'''CREATE TABLE IF NOT EXISTS erp_documents(
 id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,
 party_id TEXT NOT NULL REFERENCES erp_parties(id),party_name TEXT NOT NULL,
 date TEXT NOT NULL,due_date TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
 payload TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,
 author_id TEXT NOT NULL,author_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','pending','confirmed','rejected')),
 revision INTEGER NOT NULL CHECK(revision>0),frozen_hash TEXT,
 reviewer_id TEXT,reviewer_name TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(author_id,request_id))''',
'''CREATE TABLE IF NOT EXISTS erp_lines(
 id TEXT PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES erp_documents(id),
 source_line_id TEXT REFERENCES erp_lines(id),description TEXT NOT NULL,material TEXT NOT NULL,purity TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),estimated_weight TEXT NOT NULL,actual_weight TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),UNIQUE(doc_id,source_line_id))''',
'''CREATE TABLE IF NOT EXISTS erp_bills(
 id TEXT PRIMARY KEY REFERENCES erp_documents(id),kind TEXT NOT NULL CHECK(kind IN ('receivable','payable')),
 party_id TEXT NOT NULL REFERENCES erp_parties(id),party_name TEXT NOT NULL,date TEXT NOT NULL,due_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),source_type TEXT NOT NULL,source_id TEXT NOT NULL,
 UNIQUE(source_type,source_id))''',
'''CREATE TABLE IF NOT EXISTS erp_allocations(
 id TEXT PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES erp_documents(id),bill_id TEXT NOT NULL REFERENCES erp_bills(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),UNIQUE(doc_id,bill_id))''',
'''CREATE TABLE IF NOT EXISTS erp_postings(
 id INTEGER PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES erp_documents(id),
 bill_id TEXT NOT NULL REFERENCES erp_bills(id),date TEXT NOT NULL,
 face_cents INTEGER NOT NULL DEFAULT 0,settled_cents INTEGER NOT NULL DEFAULT 0,
 UNIQUE(doc_id,bill_id))''',
'''CREATE TABLE IF NOT EXISTS erp_receipt_quantities(
 doc_id TEXT NOT NULL REFERENCES erp_documents(id),source_line_id TEXT NOT NULL REFERENCES erp_lines(id),
 quantity INTEGER NOT NULL,date TEXT NOT NULL,PRIMARY KEY(doc_id,source_line_id))''',
'''CREATE TABLE IF NOT EXISTS erp_reversals(
 target_id TEXT PRIMARY KEY REFERENCES erp_documents(id),reversal_id TEXT UNIQUE NOT NULL REFERENCES erp_documents(id))''',
'''CREATE TABLE IF NOT EXISTS erp_sale_sources(
 sale_id INTEGER PRIMARY KEY REFERENCES sales(id),doc_id TEXT UNIQUE NOT NULL REFERENCES erp_documents(id),fingerprint TEXT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS erp_events(
 id INTEGER PRIMARY KEY,doc_id TEXT,action TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,
 before_json TEXT,after_json TEXT,at TEXT NOT NULL)''',
'''CREATE TABLE IF NOT EXISTS erp_attachments(
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,owner_id TEXT NOT NULL,
 name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(owner_id,request_id))''',
'''CREATE TABLE IF NOT EXISTS erp_party_requests(
 actor_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,party_id TEXT NOT NULL REFERENCES erp_parties(id),
 PRIMARY KEY(actor_id,request_id))''',
'''CREATE TRIGGER IF NOT EXISTS erp_documents_confirmed_immutable BEFORE UPDATE ON erp_documents WHEN OLD.status='confirmed'
 BEGIN SELECT RAISE(ABORT,'confirmed ERP document immutable'); END''',
'''CREATE TRIGGER IF NOT EXISTS erp_documents_no_delete BEFORE DELETE ON erp_documents
 BEGIN SELECT RAISE(ABORT,'ERP document history retained'); END''',
'''CREATE TRIGGER IF NOT EXISTS erp_events_no_update BEFORE UPDATE ON erp_events BEGIN SELECT RAISE(ABORT,'immutable ERP audit');END''',
'''CREATE TRIGGER IF NOT EXISTS erp_events_no_delete BEFORE DELETE ON erp_events BEGIN SELECT RAISE(ABORT,'retain ERP audit');END''',
]

def initialize(c):
    for sql in STATEMENTS:c.execute(sql)
    versions=c.execute('SELECT version FROM erp_metadata').fetchall()
    if not versions:c.execute('INSERT INTO erp_metadata(version) VALUES(1)')
    elif len(versions)!=1 or versions[0][0]!=1:raise RuntimeError('Unsupported ERP schema version')
    for table in ('erp_bills','erp_postings','erp_allocations','erp_receipt_quantities','erp_reversals','erp_sale_sources'):
        for action in ('UPDATE','DELETE'):
            c.execute(f"CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable ERP posting'); END")
    for action in ('UPDATE','DELETE'):
        c.execute(f"CREATE TRIGGER IF NOT EXISTS erp_lines_confirmed_no_{action.lower()} BEFORE {action} ON erp_lines WHEN (SELECT status FROM erp_documents WHERE id=OLD.doc_id)='confirmed' BEGIN SELECT RAISE(ABORT,'immutable ERP lines'); END")
    import ocr
    ocr.initialize(c)
