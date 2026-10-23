'use strict';
// Execute only the actual composer's pure change/copy callbacks in the Guest.
if(process.platform!=='win32'||process.env.USERNAME?.toLowerCase()!=='wdagutilityaccount')throw Error('Actual Guest required');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require(path.join(process.env.XJY_HISTORY_DEPS,'typescript'));
const file=path.resolve(__dirname,'../project/desktop/renderer/workspace.tsx'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback(name,scope){let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)initializer=node.initializer?.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.ok(initializer,'existing composer callback '+name);const compiled=ts.transpileModule('module.exports='+initializer,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const module={exports:{}};vm.runInNewContext(compiled,{module,...scope},{filename:file});return module.exports;}
function strip(input){const q={...input};for(const k of ['calculation','customer','brand','issuedBy'])delete q[k];return q;}
const saved=type=>({type,customerId:'synthetic-customer',title:'虚构商品',weight:1,goldPrice:500,laborPrice:20,calculation:{total:519.99},customer:{name:'虚构'},brand:{name:'虚构'},issuedBy:{id:'synthetic-employee'},baseQuoteId:'synthetic-original',saleItems:type==='sale'?[{id:'one',goldPrice:500,weight:1,quantity:1}]:[],tradeInItems:[],recyclingItems:type==='recycling'?[{id:'one',goldPrice:500,weight:1,quantity:1}]:[]});
for(const type of ['sale','tradein','recycling','custom','repair'])test('editing saved '+type+' invalidates prior monetary snapshot without changing the original',()=>{
 const original=saved(type),before=JSON.stringify(original),patchDraft=callback('patchDraft',{activeItems:{sale:0,tradein:0,recycling:0},stripSavedQuoteCalculation:strip});
 const changed=patchDraft(original,type,{goldPrice:600});
 assert.equal(Object.hasOwn(changed,'calculation'),false,'a changed draft must calculate again');
 for(const k of ['customer','brand','issuedBy'])assert.equal(Object.hasOwn(changed,k),false,'saved identity must not keep a new draft historical');
 assert.equal(changed.customerId,original.customerId);assert.equal(changed.baseQuoteId,original.baseQuoteId);assert.equal(JSON.stringify(original),before);
 if(type==='sale'||type==='recycling')assert.equal(changed[type==='sale'?'saleItems':'recyclingItems'][0].goldPrice,600);else assert.equal(changed.goldPrice,600);
});
test('replacing a product list also invalidates the previous saved calculation',()=>{
 const original=saved('sale'),patchDraft=callback('patchDraft',{activeItems:{sale:0},stripSavedQuoteCalculation:strip});
 const changed=patchDraft(original,'sale',{saleItems:[]});assert.equal(changed.saleItems.length,0);assert.equal(Object.hasOwn(changed,'calculation'),false);
});
for(const newVersion of [false,true])test('copying a saved quote creates an editable draft; newVersion='+newVersion,()=>{
 const original=saved('sale');let value,navigated;
 const copy=callback('copyQuote',{stripSavedQuoteCalculation:strip,ensureItems:x=>x,restoreSavedProductItems:x=>x,uid:()=> 'synthetic-id',setDrafts:fn=>{value=fn({}).sale;},navigate:p=>{navigated=p;},kindPage:{sale:'sales'}});
 copy({id:'synthetic-quote',type:'sale',snapshot:original},newVersion);
 assert.equal(Object.hasOwn(value,'calculation'),false);assert.equal(Object.hasOwn(value,'customer'),false);assert.equal(value.customerId,original.customerId);assert.equal(value.baseQuoteId,newVersion?'synthetic-quote':undefined);assert.equal(navigated,'sales');assert.equal(original.calculation.total,519.99);
});
for(const type of ['sale','tradein','recycling'])test('actual remove-product result cannot restore saved metadata through a full draft patch: '+type,()=>{
 const file=path.resolve(__dirname,'../project/lib/client-drafts.ts'),module={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports},{filename:file});
 const original=saved(type),key=type==='sale'?'saleItems':type==='tradein'?'tradeInItems':'recyclingItems';
 original[key]=[{id:'one',goldPrice:500,weight:1,quantity:1},{id:'two',goldPrice:600,weight:1,quantity:1}];
 const removed=module.exports.removeProductById(original,'two',1);
 const patchDraft=callback('patchDraft',{activeItems:{sale:0,tradein:0,recycling:0},stripSavedQuoteCalculation:strip});
 const changed=patchDraft(original,type,removed.draft);
 assert.equal(changed[key].length,1);assert.equal(changed[key][0].id,'one');
 for(const k of ['calculation','customer','brand','issuedBy'])assert.equal(Object.hasOwn(changed,k),false,'returned full draft must not reinstate '+k);
 assert.equal(original[key].length,2);assert.equal(original.calculation.total,519.99);
});
for(const action of ['delete-quote','delete-customer'])test('deleting the saved source turns a retained draft into fresh pricing: '+action,async()=>{
 const original=saved('sale');let changed;
 const noop=()=>{};
 const apply=callback('applyRecordAction',{stripSavedQuoteCalculation:strip,run:fn=>fn(),requireSalesWrite:noop,admin:true,recordAction:action==='delete-quote'?{type:action,quote:{id:'synthetic-original'}}:{type:action,customer:{id:'synthetic-customer'}},api:async()=>({quoteIds:['synthetic-original']}),saved:{id:'synthetic-original',customerId:'synthetic-customer'},setCustomerDetail:noop,setCustomerDialog:noop,setQuoteDetail:noop,setRemotePrintQuote:noop,setSaved:noop,setDrafts:fn=>{changed=fn({sale:original}).sale;},setNotice:noop,setRecordAction:noop,refresh:async()=>{}});
 await apply();
 for(const k of ['calculation','customer','brand','issuedBy'])assert.equal(Object.hasOwn(changed,k),false,'orphaned draft must not retain '+k);
 assert.equal(changed.baseQuoteId,undefined);assert.equal(changed.customerId,action==='delete-customer'?'':'synthetic-customer');assert.equal(original.calculation.total,519.99);
});
for(const resumed of [false,true])test('persist uses old record only for an unedited saved-image resume, not an explicit new draft: resumed='+resumed,async()=>{
 const old=saved('sale'),draft=resumed?old:strip(old);let posts=0,gets=0;
 const previous={id:'synthetic-original',snapshot:old},fresh={id:'synthetic-new',snapshot:{...draft,calculation:{total:520}}};
 const persist=callback('persistCurrentQuote',{requireSalesWrite:()=>{},validatePreview:()=>{},draft,saved:null,isCurrentSavedQuote:()=>true,api:async(_path,method)=>{if(method==='POST'){posts++;return{quote:fresh};}gets++;return{quote:previous};},readPhoto:async x=>x,setSaved:()=>{},setDrafts:()=>{},refresh:async()=>{}});
 const result=await persist();
 assert.equal(result.id,resumed?'synthetic-original':'synthetic-new');assert.equal(posts,resumed?0:1);assert.equal(gets,resumed?1:0);assert.equal(old.calculation.total,519.99);
});
