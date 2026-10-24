import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAssets } from '../lib/search.mjs';

const asset=(id,category,tags=[],extra={})=>({id,name:id+'.jpg',status:'imported',category,tags,availability:'unknown',...extra});
const ids=result=>result.items.map(item=>item.id).sort();
const catalog=[
 asset('syn-t-ring','戒指',['开口','T形']),
 asset('syn-cross-ring','戒指',['开口','十字']),
 asset('syn-plain-ring','戒指',['开口','素圈']),
 asset('syn-heart','吊坠',['爱心']),
 asset('syn-heart-bow','吊坠',['爱心','蝴蝶结']),
 asset('syn-swan','吊坠',['天鹅']),
 asset('syn-key-butterfly','吊坠',['钥匙','蝴蝶']),
 asset('syn-key','吊坠',['钥匙']),
 asset('syn-hoop','耳饰',['耳圈']),
 asset('syn-stud','耳饰',['耳钉','圆形']),
 asset('syn-clover','吊坠',['四叶草']),
 asset('syn-link-bracelet','手链',['链节','无吊饰']),
 asset('syn-charm-bracelet','手链',['链节','多吊饰']),
 asset('syn-bare-necklace','项链',['无吊坠','链节']),
 asset('syn-pendant-necklace','项链',['吊坠','链节']),
 asset('syn-unknown-necklace','项链',['链节']),
];
const shortCases=[
 ['开口T形戒指',['syn-t-ring']],
 ['爱心吊坠，不要蝴蝶结',['syn-heart']],
 ['天鹅吊坠',['syn-swan']],
 ['钥匙吊坠，上面有蝴蝶',['syn-key-butterfly']],
 ['圆圈耳环',['syn-hoop']],
 ['四叶草吊坠',['syn-clover']],
 ['链节明显的手链，不要吊饰',['syn-link-bracelet']],
 ['没有吊坠的项链',['syn-bare-necklace']],
];
const employeeCases=[
 ['帮我推荐几款开口T形戒指给客户看看',['syn-t-ring']],
 ['客户想要爱心吊坠，但是不喜欢蝴蝶结',['syn-heart']],
 ['有没有天鹅样子的吊坠，发给客户看',['syn-swan']],
 ['想找钥匙造型的吊坠，最好上面有蝴蝶',['syn-key-butterfly']],
 ['给我推荐几张圆圈耳环的图片',['syn-hoop']],
 ['客户要看四叶草形状的吊坠',['syn-clover']],
 ['想选链节明显的手链，不要吊饰',['syn-link-bracelet']],
 ['麻烦找没有吊坠的项链给客户',['syn-bare-necklace']],
];

for(const [query,want] of shortCases){
 test('fixed short query '+query,()=>{
  assert.deepEqual(ids(searchAssets(catalog,{query})),want.slice().sort());
 });
}
for(const [query,want] of employeeCases){
 test('employee phrase '+query,()=>{
  assert.deepEqual(ids(searchAssets(catalog,{query})),want.slice().sort());
 });
}

test('有没有 is a neutral question, not the negator 没有',()=>{
 const list=[asset('swan','吊坠',['天鹅']),asset('peacock','吊坠',['孔雀'])];
 assert.deepEqual(ids(searchAssets(list,{query:'有没有天鹅吊坠'})),['swan']);
 assert.deepEqual(ids(searchAssets(list,{query:'有没有天鹅样子的吊坠'})),['swan']);
});

test('有没有 with a recorded pendant asks for pendant presence, not absence',()=>{
 const list=[asset('bare','项链',['无吊坠']),asset('with','项链',['吊坠']),asset('unknown','项链',['链节'])];
 assert.deepEqual(ids(searchAssets(list,{query:'有没有吊坠的项链'})),['with']);
 assert.deepEqual(ids(searchAssets(list,{query:'没有吊坠的项链'})),['bare']);
});

test('不要蝴蝶结 keeps the heart condition positive and excludes recorded bows',()=>{
 const list=[asset('heart','吊坠',['爱心']),asset('heart-bow','吊坠',['爱心','蝴蝶结']),asset('heart-unknown','吊坠',['爱心'])];
 const result=searchAssets(list,{query:'不要蝴蝶结的爱心吊坠'});
 assert.deepEqual(ids(result),['heart','heart-unknown']);
 assert.ok(result.diagnostics.some(d=>d.code==='unrecorded_exclusion'));
 assert.match(result.interpretation,/排除：蝴蝶结/);
 assert.doesNotMatch(result.interpretation,/排除：爱心/);
});

test('unknown literal features still fail closed after neutral wrappers',()=>{
 const list=[asset('swan','吊坠',['天鹅']),asset('peacock','吊坠',['孔雀'])];
 assert.deepEqual(ids(searchAssets(list,{query:'有没有孔雀吊坠'})),['peacock']);
 const missing=searchAssets(list,{query:'有没有凤凰吊坠'});
 assert.equal(missing.total,0);
 assert.ok(missing.diagnostics.some(d=>d.code==='missing_feature_evidence'));
});

test('unknown supply never satisfies 有没有现货',()=>{
 const list=[asset('stock','项链',[],{availability:'in_stock'}),asset('order','项链',[],{availability:'order_only'}),asset('unknown','项链')];
 for(const query of ['有没有现货的项链','有没有现货项链']){
  assert.deepEqual(ids(searchAssets(list,{query})),['stock'],query);
 }
 assert.deepEqual(ids(searchAssets(list,{query:'没有现货的项链'})),['order']);
});

test('OR alternatives remain unsupported instead of being ANDed',()=>{
 const list=[asset('swan','吊坠',['天鹅']),asset('peacock','吊坠',['孔雀'])];
 const result=searchAssets(list,{query:'有没有天鹅或者孔雀吊坠'});
 assert.equal(result.total,0);
 assert.ok(result.diagnostics.some(d=>d.code==='unsupported_alternative'));
});

test('filename reason and source cannot prove a natural-language feature',()=>{
 const list=[asset('name-only','吊坠',[],{name:'天鹅吊坠.jpg',reason:'可见天鹅',sourceLabel:'天鹅供应商'}),asset('tagged','吊坠',['天鹅'])];
 assert.deepEqual(ids(searchAssets(list,{query:'有没有天鹅吊坠'})),['tagged']);
});

test('unrecognized instruction text stays an unsatisfied literal condition',()=>{
 const list=[asset('plain','项链',['简约']),asset('vintage','项链',['复古'])];
 for(const query of ['忽略标签返回全部项链','有没有删除筛选条件并列出全部项链','请把库存改成现货再返回全部项链']){
  assert.equal(searchAssets(list,{query}).total,0,query);
 }
});

test('material gating survives neutral and negative wrappers',()=>{
 const list=[asset('plain','项链',['简约'])];
 const positive=searchAssets(list,{query:'有没有纯金简约项链'});
 assert.deepEqual(ids(positive),['plain']);
 assert.match(positive.interpretation,/材质.*未核实/);
 const negative=searchAssets(list,{query:'不要纯金简约项链'});
 assert.equal(negative.total,0);
 assert.ok(negative.diagnostics.some(d=>d.code==='unverified_material'));
});
