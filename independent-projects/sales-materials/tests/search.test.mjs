import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAssets } from '../lib/search.mjs';
const asset=(id,category,tags=[],extra={})=>({id,name:id+'.jpg',status:'imported',category,tags,availability:'unknown',...extra});
const all=[
  asset('a','项链',['简约','小巧','珍珠'],{availability:'in_stock'}),
  asset('b','项链',['简约','珍珠','花朵'],{availability:'reference_only',sourceLabel:'供应商参考'}),
  asset('c','项链',['简约','小巧','珍珠'],{availability:'order_only'}),
  asset('d','耳饰',['耳钉','几何','复古']),
  asset('e','戒指',['素圈','简约']),
  asset('f','手链',['珍珠','花朵'],{reason:'也许是简约项链'}),
  asset('pending','项链',['简约','珍珠'],{status:'needs_review'}),
];
test('all positive conditions are required across category and tags',()=>{
  assert.deepEqual(searchAssets(all,{query:'给我看一些简约小巧的珍珠项链'}).items.map(x=>x.id),['a','c']);
});
test('negative features do not become positive or exclude the following category',()=>{
  assert.deepEqual(searchAssets(all,{query:'想看简约项链，不要带花朵的，不带珍珠'}).items,[]);
  assert.deepEqual(searchAssets(all,{query:'不要花朵的简约项链'}).items.map(x=>x.id),['a','c']);
});
test('category synonyms and precise earring subtype remain explainable',()=>{
  const list=[...all,asset('hoop','耳饰',['耳圈','几何','复古'])];
  assert.deepEqual(searchAssets(list,{query:'复古几何耳钉'}).items.map(x=>x.id),['d']);
  assert.equal(searchAssets(list,{query:'耳环'}).total,2);
});
test('non jewelry/unfinished assets never enter search and totals precede pagination',()=>{
  const result=searchAssets(all,{query:'项链',limit:1,offset:1});
  assert.equal(result.total,3);assert.deepEqual(result.items.map(x=>x.id),['b']);
});
test('default selection includes reference/supplier/unknown and only explicit stock narrows it',()=>{
  assert.equal(searchAssets(all,{query:'项链'}).total,3);
  assert.deepEqual(searchAssets(all,{query:'现货项链'}).items.map(x=>x.id),['a']);
  assert.deepEqual(searchAssets(all,{query:'耳环'}).items.map(x=>x.availability),['unknown']);
  assert.deepEqual(searchAssets(all,{availability:'reference_only'}).items.map(x=>x.id),['b']);
});
test('availability never inferred from name or source',()=>{
  const list=[asset('x','项链',[],{name:'现货项链.jpg',sourceLabel:'现货供应商'})];
  assert.equal(searchAssets(list,{query:'现货项链'}).total,0);
  assert.equal(searchAssets(list,{availability:'unknown'}).total,1);
});
test('no match never falls back to unrelated pictures',()=>{
  assert.equal(searchAssets(all,{query:'几何胸针'}).total,0);
  assert.equal(searchAssets(all,{query:'蝴蝶结'}).total,0);
});
test('reason is not a search field',()=>{
  assert.equal(searchAssets([all[5]],{query:'简约项链'}).total,0);
});
test('material and price are unverified requirements, not matched claims',()=>{
  const result=searchAssets(all,{query:'18K金简约项链，预算2000元以内'});
  assert.equal(result.total,3);assert.match(result.interpretation,/材质.*未核实/);assert.match(result.interpretation,/价格.*未核实/);
  assert.ok(result.items.every(x=>!x.matchedTerms.some(term=>/18K|2000/.test(term))));
  assert.equal(searchAssets(all,{query:'黄金'}).total,0);
});
test('unknown customer terms remain constraints rather than being silently dropped',()=>{
  assert.equal(searchAssets(all,{query:'项链 火烈鸟'}).total,0);
  assert.equal(searchAssets([asset('x','项链',['火烈鸟'])],{query:'项链 火烈鸟'}).total,1);
});
test('excluding categories and stock works without mutating inputs',()=>{
  const before=JSON.stringify(all),result=searchAssets(all,{query:'不要戒指，不要现货'});
  assert.ok(result.items.every(x=>x.category!=='戒指'&&x.availability!=='in_stock'));
  assert.equal(JSON.stringify(all),before);
});
test('invalid or oversized input fails closed and pagination is bounded',()=>{
  assert.throws(()=>searchAssets(all,{query:'a'.repeat(301)}),/300/);
  assert.throws(()=>searchAssets(all,{availability:'everything'}),/供货/);
  assert.throws(()=>searchAssets(all,{limit:-1}),/分页/);
  assert.equal(searchAssets(all,{offset:100}).items.length,0);
});
test('excluding an earring subtype does not exclude all earrings',()=>{
  const list=[...all,asset('hoop','耳饰',['耳圈'])];
  assert.deepEqual(searchAssets(list,{query:'耳环，不要耳钉'}).items.map(x=>x.id),['hoop']);
});
test('common daily wear request and nonessential stock phrase',()=>{
  const list=[asset('x','项链',['简约','细款','日常'],{availability:'reference_only'})];
  assert.equal(searchAssets(list,{query:'简约一点适合日常戴的细项链，不一定要现货'}).total,1);
});
test('unknown literal exclusions preserve negation and other category filters work',()=>{
  const list=[asset('bird','项链',['火烈鸟']),asset('plain','项链',['简约']),asset('other','其他首饰',[])];
  assert.deepEqual(searchAssets(list,{query:'项链，不要火烈鸟'}).items.map(x=>x.id),['plain']);
  assert.deepEqual(searchAssets(list,{category:'其他首饰'}).items.map(x=>x.id),['other']);
});
test('daily wear is an unverified preference, not a mandatory unavailable tag',()=>{
  const result=searchAssets([asset('x','项链',['简约','细款'])],{query:'适合日常戴的简约细项链'});
  assert.equal(result.total,1);assert.match(result.interpretation,/日常.*未验证/);
});
test('classifier visible tags support exclusion without excluding category',()=>{
  const list=[asset('plain','戒指',['简约','素圈']),asset('gem','戒指',['简约','镶嵌'])];
  assert.deepEqual(searchAssets(list,{query:'不要镶嵌的简约戒指'}).items.map(x=>x.id),['plain']);
});
test('pearl query can match bead appearance but must not certify pearl material',()=>{
  const result=searchAssets([asset('x','项链',['珠饰'])],{query:'珍珠项链'});
  assert.equal(result.total,1);assert.match(result.interpretation,/珍珠.*外观.*材质.*未核实/);
});
test('review allegation: recognized negated category is not repeated as a positive literal',()=>{
  const list=[asset('ring','戒指',['简约']),asset('necklace','项链',['简约']),asset('vintage','项链',['复古'])];
  const result=searchAssets(list,{query:'不要戒指 简约'});
  assert.ok(result.items.every(x=>x.category!=='戒指'));
  // Without punctuation/的, current negative scope covers both recognized terms.
  assert.deepEqual(result.items.map(x=>x.id),['vintage']);
  assert.match(result.interpretation,/排除：戒指/);assert.match(result.interpretation,/排除：简约/);
});
test('unverifiable negated material never leaks negation into category or returns unrelated kinds',()=>{
  const list=[asset('ring','戒指',['简约']),asset('necklace','项链',['简约']),asset('pendant','吊坠',['珠饰'])];
  for(const query of ['不要黄金戒指','不带钻石的简约项链','不是和田玉吊坠','不想要铂金戒指']){
    const result=searchAssets(list,{query});
    assert.equal(result.total,0,query);assert.deepEqual(result.items,[],query);
    assert.match(result.interpretation,/材质无法核实.*先按款式查找或人工确认/,query);
    assert.equal(searchAssets(list,{query,category:'戒指'}).total,0,'category filter cannot override material uncertainty');
  }
});
test('positive Hetian jade request retains existing style-only behavior and warns',()=>{
  const list=[asset('ring','戒指',['简约']),asset('necklace','项链',['简约'])];
  const result=searchAssets(list,{query:'和田玉简约戒指'});
  assert.deepEqual(result.items.map(x=>x.id),['ring']);assert.match(result.interpretation,/材质.*未核实/);
  assert.deepEqual(searchAssets(list,{query:'不要戒指，想看黄金项链'}).items.map(x=>x.id),['necklace']);
});
