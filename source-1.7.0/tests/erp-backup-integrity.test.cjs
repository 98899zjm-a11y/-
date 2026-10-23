'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const id='46b24d66-14a8-4ec0-9f89-2b9e10673c1b',root=path.resolve(__dirname,'..','runtime','pure-integrity-fixture');
function fixture({attachments,documents,legacy=false,missing=false,corrupt=false,hardlink=false,alias=false}={}){
 const bytes=Buffer.from('synthetic PNG placeholder, actual format validation belongs to upload');
 const row={id,name:'虚构凭证.png',mime:'image/png',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 attachments=attachments??[row];documents=documents??[{id:'doc',payload:JSON.stringify({attachments:[id]})}];
 const opened=[],checked=[],closed=[];
 class DatabaseSync{
  constructor(file,options){assert.equal(file,path.join(root,'ledger.sqlite'));assert.deepEqual(options,{readOnly:true});opened.push(file);}
  prepare(sql){return{get:()=>sql.includes('sqlite_master')?legacy?undefined:{name:'erp_attachments'}:undefined,all:()=>sql.includes('FROM erp_attachments')?attachments:sql.includes('FROM erp_documents')?documents:[]};}
  close(){closed.push('db');}
 }
 const stat=()=>({size:bytes.length,nlink:hardlink?2:1,dev:1,ino:1,mtimeMs:1,ctimeMs:1,isFile:()=>true,isSymbolicLink:()=>alias,isDirectory:()=>false});
 let position=0;
 const io={lstatSync:file=>{if(missing)throw new Error('ENOENT');return stat();},openSync:()=>{position=0;opened.push('blob');return 7;},fstatSync:stat,readSync:(fd,buffer,offset,length)=>{const source=corrupt?Buffer.from('damaged bytes'):bytes,count=Math.min(length,source.length-position);if(count>0){source.copy(buffer,offset,position,position+count);position+=count;}return count;},closeSync:()=>closed.push('blob')};
 const check=file=>{assert.ok(file===root||file.startsWith(root+path.sep));checked.push(file);return file;};
 return{input:{DatabaseSync,database:path.join(root,'ledger.sqlite'),attachmentsDirectory:path.join(root,'erp-attachments'),check,io},row,opened,closed,checked};
}
test('ERP attachment metadata and linked refs agree with guarded stream-hashed blob',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs'),f=fixture();
 assert.deepEqual(validateErpAttachments(f.input),{checkedAttachments:1,linkedReferences:1,legacy:false});
 assert.ok(f.checked.some(file=>file.endsWith(id+'.bin')));assert.deepEqual(f.closed,['blob','db']);
});
test('pre-ERP databases are compatible without opening attachment files',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs'),f=fixture({legacy:true});
 assert.deepEqual(validateErpAttachments(f.input),{checkedAttachments:0,linkedReferences:0,legacy:true});
 assert.equal(f.opened.length,1);assert.deepEqual(f.closed,['db']);
});
test('missing, changed, linked or renamed attachment content cannot pass integrity',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs');
 for(const input of [{missing:true},{corrupt:true},{hardlink:true},{alias:true}]){
  const f=fixture(input);assert.throws(()=>validateErpAttachments(f.input),/ERP attachment integrity/);assert.equal(f.closed.at(-1),'db');
 }
 for(const edit of [{id:id.toUpperCase()},{name:'../unsafe.png'},{name:'CON.png'},{name:'secret.pdf'},{size:0},{size:2*1024*1024+1},{sha256:'BAD'},{mime:'text/html'}]){
  const f=fixture();f.input.DatabaseSync=fixture({attachments:[{...f.row,...edit}]}).input.DatabaseSync;
  assert.throws(()=>validateErpAttachments(f.input),/ERP attachment integrity/);
 }
});
test('document payload attachment refs must exist, remain unique and be canonical ids',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs');
 for(const attachments of [[id,id],['missing-id'],[null],{},id]){
  const f=fixture({documents:[{payload:JSON.stringify({attachments})}]});assert.throws(()=>validateErpAttachments(f.input),/ERP attachment integrity/);
 }
 for(const payload of ['not-json','null','[]']){
  const f=fixture({documents:[{payload}]});assert.throws(()=>validateErpAttachments(f.input),/ERP attachment integrity/);
 }
});
test('row and reference caps reject oversized dependency graphs without truncation',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs');
 const tooMany=Array.from({length:100001},()=>({payload:'{}'}));assert.throws(()=>validateErpAttachments(fixture({documents:tooMany}).input),/ERP attachment integrity/);
 const base=fixture().row;assert.throws(()=>validateErpAttachments(fixture({attachments:Array(100001).fill(base)}).input),/ERP attachment integrity/);
 const refs=Array.from({length:100001},()=>id);assert.throws(()=>validateErpAttachments(fixture({documents:[{payload:JSON.stringify({attachments:refs})}]}).input),/ERP attachment integrity/);
 const other='56b24d66-14a8-4ec0-9f89-2b9e10673c1b';
 const cumulative=fixture({attachments:[base,{...base,id:other}],documents:Array(50001).fill({payload:JSON.stringify({attachments:[id,other]})})});assert.throws(()=>validateErpAttachments(cumulative.input),/linked references exceed safety limit/);
});
test('file identity swaps and rejected physical paths fail before accepting content',()=>{
 const {validateErpAttachments}=require('../stage1/erp-backup-integrity.cjs'),f=fixture(),stat=f.input.io.fstatSync;
 f.input.io.fstatSync=()=>({...stat(),ino:2});assert.throws(()=>validateErpAttachments(f.input),/attachment identity changed/);assert.deepEqual(f.closed,['blob','db']);
 const denied=fixture();denied.input.check=()=>{throw new Error('Guard rejects foreign target');};assert.throws(()=>validateErpAttachments(denied.input),/ERP attachment integrity/);assert.equal(denied.opened.length,0);
});
