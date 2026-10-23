'use strict';
// Trusted SQLite handles only; no runtime/database/file opening or cross-store writes.
const {createHash}=require('node:crypto');
const LEGACY_OBJECTS=[{"name":"sales_order_sequences","type":"table","table":"sales_order_sequences","sql":"CREATE TABLE IF NOT EXISTS sales_order_sequences (\n business_date TEXT PRIMARY KEY NOT NULL,\n last_value INTEGER NOT NULL CHECK(last_value BETWEEN 1 AND 999999)\n);"},{"name":"sales_orders","type":"table","table":"sales_orders","sql":"CREATE TABLE IF NOT EXISTS sales_orders (\n id TEXT PRIMARY KEY NOT NULL,\n number TEXT NOT NULL UNIQUE,\n owner_id TEXT NOT NULL REFERENCES staff_users(id),\n owner_name TEXT NOT NULL,\n created_by TEXT NOT NULL REFERENCES staff_users(id),\n created_name TEXT NOT NULL,\n source_quote_id TEXT NOT NULL REFERENCES quotes(id),\n source_root_id TEXT NOT NULL,\n source_quote_version INTEGER NOT NULL CHECK(source_quote_version>=1),\n source_hash TEXT NOT NULL,\n customer_id TEXT NOT NULL REFERENCES customers(id),\n customer_name TEXT NOT NULL,\n type TEXT NOT NULL CHECK(type IN('sale','custom','tradein')),\n business_date TEXT NOT NULL,\n snapshot_json TEXT NOT NULL,\n totals_json TEXT NOT NULL,\n amount_cents TEXT NOT NULL,\n weight_micros TEXT NOT NULL,\n item_count INTEGER NOT NULL CHECK(item_count>=1),\n note TEXT NOT NULL DEFAULT '',\n status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','voided')),\n revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),\n content_hash TEXT NOT NULL,\n request_id TEXT NOT NULL,\n request_hash TEXT NOT NULL,\n created_at TEXT NOT NULL,\n submitted_at TEXT NOT NULL,\n reviewed_by TEXT REFERENCES staff_users(id),\n reviewed_name TEXT,\n reviewed_at TEXT,\n review_note TEXT NOT NULL DEFAULT '',\n voided_by TEXT REFERENCES staff_users(id),\n voided_name TEXT,\n voided_at TEXT,\n void_note TEXT NOT NULL DEFAULT '',\n previous_id TEXT REFERENCES sales_orders(id),\n UNIQUE(created_by,request_id)\n);"},{"name":"sales_order_events","type":"table","table":"sales_order_events","sql":"CREATE TABLE IF NOT EXISTS sales_order_events (\n id TEXT PRIMARY KEY NOT NULL,\n order_id TEXT NOT NULL REFERENCES sales_orders(id),\n actor_id TEXT NOT NULL REFERENCES staff_users(id),\n actor_name TEXT NOT NULL,\n action TEXT NOT NULL CHECK(action IN('create','approve','reject','void')),\n from_status TEXT,\n to_status TEXT NOT NULL CHECK(to_status IN('pending','approved','rejected','voided')),\n revision INTEGER NOT NULL CHECK(revision>=1),\n content_hash TEXT NOT NULL,\n request_id TEXT NOT NULL,\n request_hash TEXT NOT NULL,\n note TEXT NOT NULL DEFAULT '',\n created_at TEXT NOT NULL,\n UNIQUE(actor_id,request_id)\n);"},{"name":"sales_orders_effective_root","type":"index","table":"sales_orders","sql":"CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_effective_root ON sales_orders(source_root_id) WHERE status IN('pending','approved');"},{"name":"sales_orders_owner_month","type":"index","table":"sales_orders","sql":"CREATE INDEX IF NOT EXISTS sales_orders_owner_month ON sales_orders(owner_id,business_date,status,submitted_at DESC,id);"},{"name":"sales_orders_review_queue","type":"index","table":"sales_orders","sql":"CREATE INDEX IF NOT EXISTS sales_orders_review_queue ON sales_orders(status,submitted_at DESC,id);"},{"name":"sales_orders_source_history","type":"index","table":"sales_orders","sql":"CREATE INDEX IF NOT EXISTS sales_orders_source_history ON sales_orders(source_root_id,submitted_at DESC,id);"},{"name":"sales_order_events_history","type":"index","table":"sales_order_events","sql":"CREATE INDEX IF NOT EXISTS sales_order_events_history ON sales_order_events(order_id,revision,created_at,id);"},{"name":"sales_order_no_delete","type":"trigger","table":"sales_orders","sql":"CREATE TRIGGER IF NOT EXISTS sales_order_no_delete BEFORE DELETE ON sales_orders BEGIN SELECT RAISE(ABORT,'Sales order history must be retained'); END;"},{"name":"sales_order_source_immutable","type":"trigger","table":"sales_orders","sql":"CREATE TRIGGER IF NOT EXISTS sales_order_source_immutable BEFORE UPDATE OF number,owner_id,owner_name,created_by,created_name,source_quote_id,source_root_id,source_quote_version,source_hash,customer_id,customer_name,type,business_date,snapshot_json,totals_json,amount_cents,weight_micros,item_count,note,content_hash,request_id,request_hash,created_at,submitted_at,previous_id ON sales_orders BEGIN SELECT RAISE(ABORT,'Submitted sales order source is immutable'); END;"},{"name":"sales_order_event_no_delete","type":"trigger","table":"sales_order_events","sql":"CREATE TRIGGER IF NOT EXISTS sales_order_event_no_delete BEFORE DELETE ON sales_order_events BEGIN SELECT RAISE(ABORT,'Sales order events must be retained'); END;"},{"name":"sales_order_event_no_update","type":"trigger","table":"sales_order_events","sql":"CREATE TRIGGER IF NOT EXISTS sales_order_event_no_update BEFORE UPDATE ON sales_order_events BEGIN SELECT RAISE(ABORT,'Sales order events are immutable'); END;"}];
const FACT_OBJECTS=[{"name":"sales_request_metadata","type":"table","table":"sales_request_metadata","sql":"CREATE TABLE IF NOT EXISTS sales_request_metadata (\n version INTEGER PRIMARY KEY NOT NULL CHECK(version=1)\n);"},{"name":"sales_request_facts","type":"table","table":"sales_request_facts","sql":"CREATE TABLE IF NOT EXISTS sales_request_facts (\n creator_id TEXT NOT NULL,\n request_id TEXT NOT NULL,\n state TEXT NOT NULL CHECK(state IN('issued','cancelled')),\n request_hash TEXT,\n order_id TEXT UNIQUE,\n number TEXT UNIQUE,\n source_quote_id TEXT,\n source_hash TEXT,\n business_date TEXT,\n issued_at TEXT,\n cancelled_at TEXT,\n record_hash TEXT NOT NULL CHECK(length(record_hash)=64),\n PRIMARY KEY(creator_id,request_id),\n CHECK((state='issued' AND request_hash IS NOT NULL AND order_id IS NOT NULL AND number IS NOT NULL AND source_quote_id IS NOT NULL AND source_hash IS NOT NULL AND business_date IS NOT NULL AND issued_at IS NOT NULL AND cancelled_at IS NULL)\n    OR (state='cancelled' AND request_hash IS NULL AND order_id IS NULL AND number IS NULL AND source_quote_id IS NULL AND source_hash IS NULL AND business_date IS NULL AND issued_at IS NULL AND cancelled_at IS NOT NULL))\n);"},{"name":"sales_request_issued_date","type":"index","table":"sales_request_facts","sql":"CREATE INDEX IF NOT EXISTS sales_request_issued_date ON sales_request_facts(business_date,number) WHERE state='issued';"},{"name":"sales_request_fact_no_update","type":"trigger","table":"sales_request_facts","sql":"CREATE TRIGGER IF NOT EXISTS sales_request_fact_no_update BEFORE UPDATE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge is immutable'); END;"},{"name":"sales_request_fact_no_delete","type":"trigger","table":"sales_request_facts","sql":"CREATE TRIGGER IF NOT EXISTS sales_request_fact_no_delete BEFORE DELETE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge must be retained'); END;"},{"name":"sales_request_metadata_no_update","type":"trigger","table":"sales_request_metadata","sql":"CREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_update BEFORE UPDATE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity is immutable'); END;"},{"name":"sales_request_metadata_no_delete","type":"trigger","table":"sales_request_metadata","sql":"CREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_delete BEFORE DELETE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity must be retained'); END;"}];
const FACT_DDL="-- Immutable request/number knowledge in the same sales SQLite transaction.\n-- Deliberately no FK to an effective order/quote: restore must retain a receipt\n-- without reviving the business order that the user explicitly restored away.\nCREATE TABLE IF NOT EXISTS sales_request_metadata (\n version INTEGER PRIMARY KEY NOT NULL CHECK(version=1)\n);\nINSERT OR IGNORE INTO sales_request_metadata(version) VALUES(1);\nCREATE TABLE IF NOT EXISTS sales_request_facts (\n creator_id TEXT NOT NULL,\n request_id TEXT NOT NULL,\n state TEXT NOT NULL CHECK(state IN('issued','cancelled')),\n request_hash TEXT,\n order_id TEXT UNIQUE,\n number TEXT UNIQUE,\n source_quote_id TEXT,\n source_hash TEXT,\n business_date TEXT,\n issued_at TEXT,\n cancelled_at TEXT,\n record_hash TEXT NOT NULL CHECK(length(record_hash)=64),\n PRIMARY KEY(creator_id,request_id),\n CHECK((state='issued' AND request_hash IS NOT NULL AND order_id IS NOT NULL AND number IS NOT NULL AND source_quote_id IS NOT NULL AND source_hash IS NOT NULL AND business_date IS NOT NULL AND issued_at IS NOT NULL AND cancelled_at IS NULL)\n    OR (state='cancelled' AND request_hash IS NULL AND order_id IS NULL AND number IS NULL AND source_quote_id IS NULL AND source_hash IS NULL AND business_date IS NULL AND issued_at IS NULL AND cancelled_at IS NOT NULL))\n);\nCREATE INDEX IF NOT EXISTS sales_request_issued_date ON sales_request_facts(business_date,number) WHERE state='issued';\nCREATE TRIGGER IF NOT EXISTS sales_request_fact_no_update BEFORE UPDATE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge is immutable'); END;\nCREATE TRIGGER IF NOT EXISTS sales_request_fact_no_delete BEFORE DELETE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge must be retained'); END;\nCREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_update BEFORE UPDATE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity is immutable'); END;\nCREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_delete BEFORE DELETE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity must be retained'); END;\n";
function normalize(sql){if(typeof sql!=='string')return'';const tokens=[];let i=0;while(i<sql.length){const c=sql[i];if(/\s/.test(c)){i++;continue;}if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i);i=end<0?sql.length:end+1;continue;}if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0)return'INVALID';i=end+2;continue;}if(c==="'"){let token=c;i++;let done=false;while(i<sql.length){token+=sql[i];if(sql[i++]==="'"){if(sql[i]==="'"){token+=sql[i++];continue;}done=true;break;}}if(!done)return'INVALID';tokens.push(token);continue;}if(c.charCodeAt(0)===96||c==='"'||c==='['){const endChar=c==='['?']':c,at=sql.indexOf(endChar,i+1);if(at<0)return'INVALID';const name=sql.slice(i+1,at);if(!/^[a-z_][a-z0-9_]*$/i.test(name))return'INVALID';tokens.push(name.toLowerCase());i=at+1;continue;}if(/[a-z0-9_]/i.test(c)){let j=i+1;while(j<sql.length&&/[a-z0-9_]/i.test(sql[j]))j++;tokens.push(sql.slice(i,j).toLowerCase());i=j;continue;}tokens.push(c);i++;}if(tokens.at(-1)===';')tokens.pop();const at=tokens[0]==='create'&&(tokens[1]==='table'||tokens[1]==='index'||tokens[1]==='trigger')?2:tokens[0]==='create'&&tokens[1]==='unique'&&tokens[2]==='index'?3:-1;if(at>=0&&tokens.slice(at,at+3).join('|')==='if|not|exists')tokens.splice(at,3);return tokens.join('|');}

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const FIELDS=['creator_id','request_id','state','request_hash','order_id','number','source_quote_id','source_hash','business_date','issued_at','cancelled_at'];
const COLUMNS=[...FIELDS,'record_hash'],LIMITS=Object.freeze({rows:100000,bytes:64*1024*1024,merged:200000});
const KNOWN_MIGRATIONS=["0000_productive_gabe_jones.sql","0001_cheerful_starfox.sql","0002_sales_records.sql","0003_quote_image_pages.sql","0004_module_administration.sql","0005_workspace_collaboration.sql","0006_continuous_document_numbers.sql","0007_collaboration_review_versions.sql","0008_customer_responsibility.sql","0009_employee_profiles.sql","0010_sales_orders.sql","0011_employee_posts.sql","0012_cashier_module_permissions.sql","0013_sales_request_facts.sql"];
function fail(code,message){throw Object.assign(Error(message),{status:409,code});}
function validId(value){return typeof value==='string'&&UUID.test(value);}
function validDay(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='2000-01-01'&&value<='2200-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function validTime(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function serial(number,date){const match=typeof number==='string'&&/^SO(\d{8})-(\d{6})$/.exec(number);if(!match||!validDay(date)||match[1]!==date.replaceAll('-','')||Number(match[2])<1)fail('INVALID_SALES_REQUEST_FACT','SO receipt number/date is invalid');return Number(match[2]);}
function factHash(row){return createHash('sha256').update(JSON.stringify(FIELDS.map(key=>row[key]))).digest('hex');}
function validateFact(row){
 if(!row||!validId(row.creator_id)||!validId(row.request_id)||!['issued','cancelled'].includes(row.state)||typeof row.record_hash!=='string'||!HASH.test(row.record_hash)||row.record_hash!==factHash(row))fail('INVALID_SALES_REQUEST_FACT','Request knowledge identity or record hash is invalid');
 if(row.state==='cancelled'){
  if(!validTime(row.cancelled_at)||['request_hash','order_id','number','source_quote_id','source_hash','business_date','issued_at'].some(key=>row[key]!==null))fail('INVALID_SALES_REQUEST_FACT','Cancelled request contains issued fields or an invalid time');
 }else{
  if(!HASH.test(row.request_hash||'')||!validId(row.order_id)||!validId(row.source_quote_id)||!HASH.test(row.source_hash||'')||!validTime(row.issued_at)||row.cancelled_at!==null)fail('INVALID_SALES_REQUEST_FACT','Issued request receipt is incomplete');
  serial(row.number,row.business_date);
 }
 return row;
}
function issuedFromOrder(row){
 const fact={creator_id:row.created_by,request_id:row.request_id,state:'issued',request_hash:row.request_hash,order_id:row.id,number:row.number,source_quote_id:row.source_quote_id,source_hash:row.source_hash,business_date:row.business_date,issued_at:row.created_at,cancelled_at:null};
 fact.record_hash=factHash(fact);return validateFact(fact);
}
function same(a,b){return COLUMNS.every(key=>a[key]===b[key]);}
function schema(db,{allowNoSales=false}={}){
 if(!db?.prepare||!db.exec)throw TypeError('Trusted sales SQLite handle required');
 const objects=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 2049").all();
 if(objects.length>2048)fail('UNKNOWN_SALES_REQUEST_SCHEMA','Schema exceeds the reviewed object bound');
 const expected=new Map([...LEGACY_OBJECTS,...FACT_OBJECTS].map(item=>[item.name,item]));
 for(const item of objects){
  const related=/^sales_(?:order|request)/.test(item.name)||/^sales_(?:order|request)/.test(item.tbl_name)||item.type==='trigger'&&/\bsales_(?:orders|order_events|order_sequences|request_facts|request_metadata)\b/.test(item.sql||'');
  if(!related)continue;
  const known=expected.get(item.name);
  if(!known||item.type!==known.type||item.tbl_name!==known.table||normalize(item.sql)!==normalize(known.sql))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Unsupported sales request schema object: '+item.name);
 }
 const tables=new Set(objects.filter(x=>x.type==='table').map(x=>x.name));
 let applied=[];
 const migrationObject=objects.find(x=>x.name==='desktop_migrations');
 if(migrationObject&&(migrationObject.type!=='table'||normalize(migrationObject.sql)!==normalize('CREATE TABLE desktop_migrations(name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)')))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Unknown archive migration ledger schema');
 if(tables.has('desktop_migrations')){applied=db.prepare('SELECT name FROM desktop_migrations LIMIT 257').all().map(x=>x.name);if(applied.length>256||applied.some(x=>!KNOWN_MIGRATIONS.includes(x)))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Unknown or future archive migration identity');}
 const legacyCount=LEGACY_OBJECTS.filter(x=>x.type==='table'&&tables.has(x.name)).length;
 if(legacyCount!==3&&!(allowNoSales&&legacyCount===0))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Partial or missing known sales-order schema');
 if(legacyCount===0&&applied.includes('0010_sales_orders.sql'))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Archive claims migrated sales orders but its tables are missing');
 if(legacyCount===3)for(const item of LEGACY_OBJECTS)if(!objects.some(x=>x.name===item.name))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Required sales schema object missing: '+item.name);
 const factCount=FACT_OBJECTS.filter(x=>x.type==='table'&&tables.has(x.name)).length;
 if(factCount!==0&&factCount!==2)fail('UNKNOWN_SALES_REQUEST_SCHEMA','Partial request knowledge schema');
 if(factCount===0&&applied.includes('0013_sales_request_facts.sql'))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Archive claims request knowledge migration but its tables are missing');
 if(factCount===2){
  for(const item of FACT_OBJECTS)if(!objects.some(x=>x.name===item.name))fail('UNKNOWN_SALES_REQUEST_SCHEMA','Required request knowledge object missing: '+item.name);
  const versions=db.prepare('SELECT version FROM sales_request_metadata LIMIT 2').all();
  if(versions.length!==1||versions[0].version!==1)fail('UNKNOWN_SALES_REQUEST_SCHEMA','Unknown request knowledge version');
 }
 return{sales:legacyCount===3,facts:factCount===2};
}
function writer(db){if(db.isTransaction!==true)fail('SALES_REQUEST_WRITER_REQUIRED','Request facts must commit in the original SQLite writer transaction');}
function ensure(db){writer(db);const known=schema(db);if(!known.facts){db.exec(FACT_DDL);schema(db);}return true;}
function assertOrigin(db,order){
 const rows=db.prepare("SELECT actor_id,request_id,request_hash FROM sales_order_events WHERE order_id=? AND action='create' LIMIT 2").all(order.id);
 if(rows.length!==1||rows[0].actor_id!==order.created_by||rows[0].request_id!==order.request_id||rows[0].request_hash!==order.request_hash)fail('SALES_REQUEST_IDENTITY_CONFLICT','Order creation evidence is missing or conflicts with its receipt');
}
function insert(db,fact){
 writer(db);validateFact(fact);
 const prior=db.prepare('SELECT * FROM sales_request_facts WHERE creator_id=? AND request_id=?').get(fact.creator_id,fact.request_id);
 if(prior){validateFact(prior);if(!same(prior,fact))fail('SALES_REQUEST_IDENTITY_CONFLICT','Conflicting immutable request outcomes');return prior;}
 if(fact.state==='issued'){
  const collision=db.prepare('SELECT * FROM sales_request_facts WHERE order_id=? OR number=? LIMIT 1').get(fact.order_id,fact.number);
  if(collision)fail('SALES_REQUEST_IDENTITY_CONFLICT','Issued SO number or order belongs to another immutable request');
 }
 db.prepare('INSERT INTO sales_request_facts('+COLUMNS.join(',')+') VALUES('+COLUMNS.map(()=>'?').join(',')+')').run(...COLUMNS.map(key=>fact[key]));return fact;
}
function request(db,creatorId,requestId,{persistLegacy=false}={}){
 if(!validId(creatorId)||!validId(requestId))fail('INVALID_SALES_REQUEST_FACT','Request owner or ID is invalid');
 const known=schema(db);if(persistLegacy)ensure(db);
 let fact=known.facts?db.prepare('SELECT * FROM sales_request_facts WHERE creator_id=? AND request_id=?').get(creatorId,requestId):null;
 const order=db.prepare('SELECT * FROM sales_orders WHERE created_by=? AND request_id=?').get(creatorId,requestId);
 if(order){assertOrigin(db,order);const observed=issuedFromOrder(order);if(fact){validateFact(fact);if(!same(fact,observed))fail('SALES_REQUEST_IDENTITY_CONFLICT','Current order conflicts with immutable request knowledge');}else fact=persistLegacy?insert(db,observed):observed;}
 if(fact)validateFact(fact);
 if(fact?.state==='issued'&&!order){
  const other=db.prepare('SELECT id FROM sales_orders WHERE id=? OR number=? LIMIT 1').get(fact.order_id,fact.number);
  if(other)fail('SALES_REQUEST_IDENTITY_CONFLICT','Current order/number conflicts with a restored receipt');
 }
 return fact?{fact,order:order||null}:null;
}
function recordIssued(db,order){ensure(db);assertOrigin(db,order);return insert(db,issuedFromOrder(order));}
function recordCancelled(db,creatorId,requestId,time){
 ensure(db);const row={creator_id:creatorId,request_id:requestId,state:'cancelled',request_hash:null,order_id:null,number:null,source_quote_id:null,source_hash:null,business_date:null,issued_at:null,cancelled_at:time};
 row.record_hash=factHash(row);return insert(db,row);
}
function allocateNumber(db,date){
 ensure(db);if(!validDay(date))fail('INVALID_SALES_REQUEST_FACT','SO allocation date is invalid');
 const sequence=db.prepare('SELECT last_value FROM sales_order_sequences WHERE business_date=?').get(date);
 if(sequence&&(!Number.isSafeInteger(sequence.last_value)||sequence.last_value<1||sequence.last_value>999999))fail('INVALID_SALES_REQUEST_FACT','SO sequence is invalid');
 const reserved=db.prepare("SELECT * FROM sales_request_facts WHERE state='issued' AND business_date=? ORDER BY number DESC LIMIT 1").get(date);
 if(reserved)validateFact(reserved);
 const next=Math.max(sequence?.last_value||0,reserved?serial(reserved.number,date):0)+1;
 if(next>999999)throw Object.assign(Error('本日开单编号已达到上限'),{status:413});
 db.prepare('INSERT INTO sales_order_sequences(business_date,last_value) VALUES(?,?) ON CONFLICT(business_date) DO UPDATE SET last_value=excluded.last_value').run(date,next);
 return'SO'+date.replaceAll('-','')+'-'+String(next).padStart(6,'0');
}
function boundedRows(db,table,columns){
 const size=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM('+columns.map(k=>'COALESCE(length('+k+'),0)').join('+')+'),0) AS bytes FROM '+table).get();
 if(!Number.isSafeInteger(size.n)||size.n>LIMITS.rows||!Number.isSafeInteger(size.bytes)||size.bytes>LIMITS.bytes)fail('SALES_REQUEST_LIMIT_EXCEEDED','Complete request knowledge exceeds reviewed merge bounds');
 return db.prepare('SELECT '+columns.join(',')+' FROM '+table).all();
}
function knowledge(db){
 const known=schema(db,{allowNoSales:true}),facts=new Map(),orders=new Map(),numbers=new Map(),sequences=new Map();
 function add(row){validateFact(row);const key=row.creator_id+':'+row.request_id,prior=facts.get(key);if(prior&&!same(prior,row))fail('SALES_REQUEST_IDENTITY_CONFLICT','Conflicting request outcomes in one database');
  if(row.state==='issued'){for(const [map,id]of [[orders,row.order_id],[numbers,row.number]]){const existing=map.get(id);if(existing&&existing!==key)fail('SALES_REQUEST_IDENTITY_CONFLICT','Same order or number has different request identity');map.set(id,key);}const n=serial(row.number,row.business_date);sequences.set(row.business_date,Math.max(sequences.get(row.business_date)||0,n));}facts.set(key,row);}
 if(known.facts)for(const row of boundedRows(db,'sales_request_facts',COLUMNS))add(row);
 if(known.sales){
  const cols=['id','number','created_by','request_id','request_hash','source_quote_id','source_hash','business_date','created_at'];
  for(const row of boundedRows(db,'sales_orders',cols)){assertOrigin(db,row);add(issuedFromOrder(row));}
  for(const row of boundedRows(db,'sales_order_sequences',['business_date','last_value'])){if(!validDay(row.business_date)||!Number.isSafeInteger(row.last_value)||row.last_value<1||row.last_value>999999)fail('INVALID_SALES_REQUEST_FACT','Invalid historical SO sequence');sequences.set(row.business_date,Math.max(sequences.get(row.business_date)||0,row.last_value));}
 }
 return{known,facts,sequences};
}
function preserveSalesRequests({current,staged}={}){
 if(!current||!staged||current===staged)throw TypeError('Distinct live and staged handles required');writer(staged);
 const live=knowledge(current),archive=knowledge(staged);
 if(live.facts.size+archive.facts.size>LIMITS.merged)fail('SALES_REQUEST_LIMIT_EXCEEDED','Combined request knowledge exceeds reviewed bounds');
 const merged=new Map(archive.facts),orders=new Map(),numbers=new Map(),sequences=new Map(archive.sequences);
 for(const [key,row]of live.facts){const prior=merged.get(key);if(prior&&!same(prior,row))fail('SALES_REQUEST_IDENTITY_CONFLICT','Archive/current request terminal conflict');merged.set(key,row);}
 for(const [key,row]of merged)if(row.state==='issued'){for(const [map,id]of [[orders,row.order_id],[numbers,row.number]]){const prior=map.get(id);if(prior&&prior!==key)fail('SALES_REQUEST_IDENTITY_CONFLICT','Archive/current SO number or order identity conflict');map.set(id,key);}}
 for(const [date,value]of live.sequences)sequences.set(date,Math.max(sequences.get(date)||0,value));
 if(!archive.known.sales)staged.exec(LEGACY_OBJECTS.find(x=>x.name==='sales_order_sequences').sql);
 if(!archive.known.facts)staged.exec(FACT_DDL);
 for(const row of merged.values())insert(staged,row);
 for(const [date,value]of sequences)staged.prepare('INSERT INTO sales_order_sequences(business_date,last_value) VALUES(?,?) ON CONFLICT(business_date) DO UPDATE SET last_value=max(last_value,excluded.last_value)').run(date,value);
 return{preserved:true,requests:merged.size,days:sequences.size,ordersRestored:false};
}
function receipt(fact){validateFact(fact);return{orderId:fact.order_id,number:fact.number,sourceQuoteId:fact.source_quote_id,sourceHash:fact.source_hash,businessDate:fact.business_date};}
module.exports={request,recordIssued,recordCancelled,allocateNumber,preserveSalesRequests,receipt};
