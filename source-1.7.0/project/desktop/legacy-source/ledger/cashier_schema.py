"""Additive cashier domain, in the existing ledger transaction and backup.

No historical ERP payment is inferred to be cash. Original bank files are
bounded immutable SQLite BLOBs, so the ledger backup includes their bytes.
"""

STATEMENTS = [
    'CREATE TABLE IF NOT EXISTS cashier_metadata(version INTEGER NOT NULL)',
    '''CREATE TABLE IF NOT EXISTS cashier_accounts(
      id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('cash','bank')),currency TEXT NOT NULL CHECK(currency='CNY'),
      masked_reference TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),
      revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS cashier_account_scopes(
      staff_id TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES cashier_accounts(id),
      level TEXT NOT NULL CHECK(level IN ('disabled','view','operate','manage')),revision INTEGER NOT NULL,
      PRIMARY KEY(staff_id,account_id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_documents(
      id TEXT PRIMARY KEY,number TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES cashier_accounts(id),business_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents)='integer' AND amount_cents BETWEEN 0 AND 9000000000000),
      payload TEXT NOT NULL,author_id TEXT NOT NULL,author_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','pending','confirmed','rejected')),
      revision INTEGER NOT NULL,frozen_hash TEXT,reviewer_id TEXT,reviewer_name TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS cashier_postings(
      id INTEGER PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES cashier_documents(id),
      account_id TEXT NOT NULL REFERENCES cashier_accounts(id),date TEXT NOT NULL,
      signed_amount_cents INTEGER NOT NULL CHECK(typeof(signed_amount_cents)='integer'),
      UNIQUE(doc_id,account_id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_source_releases(
      id TEXT PRIMARY KEY,bill_id TEXT NOT NULL REFERENCES erp_bills(id),erp_revision INTEGER NOT NULL,
      erp_hash TEXT NOT NULL,party_id TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('receive','pay')),
      status TEXT NOT NULL CHECK(status IN ('published','revoked')),revision INTEGER NOT NULL,
      publisher_id TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL)''',
    "CREATE UNIQUE INDEX IF NOT EXISTS cashier_one_active_release ON cashier_source_releases(bill_id) WHERE status='published'",
    '''CREATE TABLE IF NOT EXISTS cashier_allocations(
      id INTEGER PRIMARY KEY,doc_id TEXT NOT NULL REFERENCES cashier_documents(id),
      release_id TEXT NOT NULL REFERENCES cashier_source_releases(id),bill_id TEXT NOT NULL REFERENCES erp_bills(id),
      amount_cents INTEGER NOT NULL CHECK(amount_cents>0),UNIQUE(doc_id,release_id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_erp_links(
      cash_doc_id TEXT PRIMARY KEY REFERENCES cashier_documents(id),erp_doc_id TEXT NOT NULL UNIQUE REFERENCES erp_documents(id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_refund_links(
      refund_doc_id TEXT PRIMARY KEY REFERENCES cashier_documents(id),original_cash_doc_id TEXT NOT NULL REFERENCES cashier_documents(id),
      amount_cents INTEGER NOT NULL CHECK(amount_cents>0))''',
    '''CREATE TABLE IF NOT EXISTS cashier_reversals(
      target_doc_id TEXT PRIMARY KEY REFERENCES cashier_documents(id),reversal_doc_id TEXT NOT NULL UNIQUE REFERENCES cashier_documents(id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_events(
      id INTEGER PRIMARY KEY,entity_id TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,before_json TEXT,after_json TEXT,at TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS cashier_requests(
      actor_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,response_json TEXT NOT NULL,
      method TEXT NOT NULL,path TEXT NOT NULL,
      PRIMARY KEY(actor_id,request_id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_statement_originals(
      sha256 TEXT PRIMARY KEY,size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
      content BLOB NOT NULL CHECK(length(content)=size),created_at TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS cashier_statement_imports(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES cashier_accounts(id),
      original_sha256 TEXT NOT NULL REFERENCES cashier_statement_originals(sha256),
      original_name TEXT NOT NULL,encoding TEXT NOT NULL,mapping_json TEXT NOT NULL,
      preview_hash TEXT NOT NULL,row_count INTEGER NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(account_id,original_sha256))''',
    '''CREATE TABLE IF NOT EXISTS cashier_statement_rows(
      id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES cashier_statement_imports(id),
      account_id TEXT NOT NULL REFERENCES cashier_accounts(id),line_number INTEGER NOT NULL,date TEXT NOT NULL,
      signed_amount_cents INTEGER NOT NULL,external_id TEXT,description TEXT NOT NULL,UNIQUE(import_id,line_number))''',
    "CREATE UNIQUE INDEX IF NOT EXISTS cashier_statement_external_id ON cashier_statement_rows(account_id,external_id) WHERE external_id IS NOT NULL",
    '''CREATE TABLE IF NOT EXISTS cashier_reconciliations(
      id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES cashier_accounts(id),
      payload TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','confirmed','revoked','rejected')),
      revision INTEGER NOT NULL,frozen_hash TEXT NOT NULL,author_id TEXT NOT NULL,
      reviewer_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''',
    '''CREATE TABLE IF NOT EXISTS cashier_reconciliation_matches(
      id INTEGER PRIMARY KEY,reconciliation_id TEXT NOT NULL REFERENCES cashier_reconciliations(id),
      statement_row_id TEXT NOT NULL REFERENCES cashier_statement_rows(id),posting_id INTEGER NOT NULL REFERENCES cashier_postings(id),
      UNIQUE(reconciliation_id,statement_row_id),UNIQUE(reconciliation_id,posting_id))''',
    '''CREATE TABLE IF NOT EXISTS cashier_reconciliation_locks(
      reconciliation_id TEXT NOT NULL REFERENCES cashier_reconciliations(id),
      statement_row_id TEXT PRIMARY KEY REFERENCES cashier_statement_rows(id),
      posting_id INTEGER UNIQUE NOT NULL REFERENCES cashier_postings(id))''',
    'CREATE INDEX IF NOT EXISTS cashier_posting_timeline ON cashier_postings(account_id,date,id)',
    "CREATE TRIGGER IF NOT EXISTS cashier_document_immutable BEFORE UPDATE ON cashier_documents WHEN OLD.status='confirmed' BEGIN SELECT RAISE(ABORT,'confirmed cash document immutable'); END",
    "CREATE TRIGGER IF NOT EXISTS cashier_document_retained BEFORE DELETE ON cashier_documents BEGIN SELECT RAISE(ABORT,'cash history retained'); END",
    "CREATE TRIGGER IF NOT EXISTS cashier_posting_only_pending BEFORE INSERT ON cashier_postings WHEN (SELECT status FROM cashier_documents WHERE id=NEW.doc_id)!='pending' BEGIN SELECT RAISE(ABORT,'cash posting requires pending document'); END",
    "CREATE TRIGGER IF NOT EXISTS cashier_account_retained BEFORE DELETE ON cashier_accounts BEGIN SELECT RAISE(ABORT,'cash account history retained'); END",
    "CREATE TRIGGER IF NOT EXISTS cashier_release_retained BEFORE DELETE ON cashier_source_releases BEGIN SELECT RAISE(ABORT,'cash release history retained'); END",
    '''CREATE TRIGGER IF NOT EXISTS cashier_release_snapshot_immutable BEFORE UPDATE ON cashier_source_releases
      WHEN NEW.id!=OLD.id OR NEW.bill_id!=OLD.bill_id OR NEW.erp_revision!=OLD.erp_revision OR NEW.erp_hash!=OLD.erp_hash
        OR NEW.party_id!=OLD.party_id OR NEW.direction!=OLD.direction OR NEW.publisher_id!=OLD.publisher_id
        OR NEW.created_at!=OLD.created_at OR NEW.note!=OLD.note OR OLD.status!='published' OR NEW.status!='revoked' OR NEW.revision!=OLD.revision+1
      BEGIN SELECT RAISE(ABORT,'release snapshot retained'); END''',
    "CREATE TRIGGER IF NOT EXISTS cashier_reconciliation_retained BEFORE DELETE ON cashier_reconciliations BEGIN SELECT RAISE(ABORT,'cash reconciliation history retained'); END",
    '''CREATE TRIGGER IF NOT EXISTS cashier_reconciliation_snapshot_immutable BEFORE UPDATE ON cashier_reconciliations
      WHEN NEW.id!=OLD.id OR NEW.account_id!=OLD.account_id OR NEW.payload!=OLD.payload OR NEW.frozen_hash!=OLD.frozen_hash
        OR NEW.author_id!=OLD.author_id OR NEW.created_at!=OLD.created_at OR NEW.revision!=OLD.revision+1
        OR NOT ((OLD.status='pending' AND NEW.status IN ('confirmed','rejected')) OR (OLD.status='confirmed' AND NEW.status='revoked'))
      BEGIN SELECT RAISE(ABORT,'reconciliation snapshot retained'); END''',
]

IMMUTABLE = ('cashier_postings','cashier_allocations','cashier_erp_links','cashier_refund_links',
             'cashier_reversals','cashier_events','cashier_requests','cashier_statement_originals',
             'cashier_statement_imports','cashier_statement_rows','cashier_reconciliation_matches')


def initialize(connection):
    # Caller owns commit/rollback; do not implicitly commit an enclosing writer.
    for statement in STATEMENTS:
        connection.execute(statement)
    versions = connection.execute('SELECT version FROM cashier_metadata').fetchall()
    if not versions:
        connection.execute('INSERT INTO cashier_metadata(version) VALUES(1)')
    elif len(versions) != 1 or versions[0][0] != 1:
        raise RuntimeError('Unsupported cashier schema version')
    for table in IMMUTABLE:
        for action in ('UPDATE', 'DELETE'):
            connection.execute(f"CREATE TRIGGER IF NOT EXISTS {table}_no_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'immutable cash evidence'); END")
