'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LIMIT=100000,MAX_BYTES=2*1024*1024,CHUNK=64*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MIMES=Object.freeze({'image/png':['.png'],'image/jpeg':['.jpg','.jpeg'],'application/pdf':['.pdf']});
function rejected(reason){const error=new Error('ERP attachment integrity: '+reason);error.code='XJY_ERP_ATTACHMENT_INTEGRITY';return error;}
function validId(value){return typeof value==='string'&&UUID.test(value);}
function metadata(row){
 if(!row||!validId(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name!==row.name.normalize('NFKC').trim()||row.name.length>150||/[\\/:<>"|?*\x00-\x1f\x7f]/.test(row.name)||/[. ]$/.test(row.name)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.name))throw rejected('invalid attachment identity or name');
 if(!Object.hasOwn(MIMES,row.mime)||!MIMES[row.mime].includes(path.extname(row.name).toLowerCase()))throw rejected('invalid attachment MIME or extension');
 if(!Number.isSafeInteger(row.size)||row.size<1||row.size>MAX_BYTES||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))throw rejected('invalid attachment size or hash');
}
function regular(stat){return stat&&stat.isFile()&&!stat.isSymbolicLink()&&Number(stat.nlink)===1;}
function unchanged(a,b){return regular(b)&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
function validateErpAttachments({DatabaseSync,database,attachmentsDirectory,check,io=fs}){
 let db;
 try{
  if(typeof DatabaseSync!=='function'||typeof check!=='function'||typeof database!=='string'||!path.isAbsolute(database)||typeof attachmentsDirectory!=='string'||!path.isAbsolute(attachmentsDirectory))throw rejected('explicit owned database and directory are required');
  const guarded=file=>{const result=check(file);if(result!==undefined&&typeof result!=='string')throw rejected('invalid physical path check');return result||file;};
  db=new DatabaseSync(guarded(database),{readOnly:true});
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erp_attachments'").get())return{checkedAttachments:0,linkedReferences:0,legacy:true};
  const rows=db.prepare('SELECT id,name,mime,size,sha256 FROM erp_attachments ORDER BY id LIMIT ?').all(LIMIT+1);
  if(rows.length>LIMIT)throw rejected('attachment metadata exceeds safety limit');
  const known=new Set();
  for(const row of rows){metadata(row);if(known.has(row.id))throw rejected('duplicate attachment identity');known.add(row.id);}
  if(rows.length)guarded(attachmentsDirectory);
  for(const row of rows){
   const file=guarded(path.join(attachmentsDirectory,row.id+'.bin')),before=io.lstatSync(file);
   if(!regular(before)||Number(before.size)!==row.size)throw rejected('attachment is missing, linked, or has wrong size');
   const fd=io.openSync(guarded(file),'r');
   try{
    if(!unchanged(before,io.fstatSync(fd)))throw rejected('attachment identity changed before read');
    const buffer=Buffer.alloc(CHUNK),hash=crypto.createHash('sha256');let size=0;
    while(true){const count=io.readSync(fd,buffer,0,buffer.length,null);if(!Number.isInteger(count)||count<0||count>buffer.length)throw rejected('invalid attachment stream');if(count===0)break;size+=count;if(size>MAX_BYTES||size>row.size)throw rejected('attachment stream exceeds metadata size');hash.update(buffer.subarray(0,count));}
    const digest=hash.digest('hex');
    if(size!==row.size||!crypto.timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(row.sha256,'hex')))throw rejected('attachment hash or size differs from metadata');
    if(!unchanged(before,io.fstatSync(fd))||!unchanged(before,io.lstatSync(guarded(file))))throw rejected('attachment changed during read');
   }finally{io.closeSync(fd);}
  }
  const documents=db.prepare('SELECT id,payload FROM erp_documents ORDER BY id LIMIT ?').all(LIMIT+1);
  if(documents.length>LIMIT)throw rejected('document count exceeds safety limit');
  let linkedReferences=0;
  for(const row of documents){
   let payload;try{payload=JSON.parse(row.payload);}catch{throw rejected('document payload is not valid JSON');}
   if(!payload||typeof payload!=='object'||Array.isArray(payload))throw rejected('document payload is not an object');
   if(!Object.hasOwn(payload,'attachments'))continue;
   const ids=payload.attachments;
   if(!Array.isArray(ids)||ids.length>LIMIT||new Set(ids).size!==ids.length)throw rejected('document attachment references must be unique arrays');
   linkedReferences+=ids.length;if(linkedReferences>LIMIT)throw rejected('linked references exceed safety limit');
   for(const id of ids)if(!validId(id)||!known.has(id))throw rejected('document references missing attachment metadata');
  }
  return{checkedAttachments:rows.length,linkedReferences,legacy:false};
 }catch(error){if(error?.code==='XJY_ERP_ATTACHMENT_INTEGRITY')throw error;throw rejected('owned metadata or file could not be verified');}
 finally{db?.close();}
}
module.exports={validateErpAttachments};
