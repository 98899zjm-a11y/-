import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAssets } from '../lib/search.mjs';

const asset=(id,category,tags=[],extra={})=>({id,name:id+'.jpg',status:'imported',category,tags,availability:'unknown',...extra});
const ids=result=>result.items.map(item=>item.id);

test('R2 ordinary literal exclusion keeps the following product category positive',()=>{
  const list=[asset('plain','项链',['简约']),asset('bird','项链',['火烈鸟']),asset('ring','戒指')];
  const result=searchAssets(list,{query:'不要火烈鸟项链'});
  assert.deepEqual(ids(result),['plain']);
  assert.ok(result.diagnostics.some(note=>note.code==='unrecorded_exclusion'));
});

test('R2 explicit literal absence without 的 requires absence evidence in the requested category',()=>{
  const list=[asset('absent','吊坠',['无火烈鸟']),asset('bird','吊坠',['火烈鸟']),asset('unknown','吊坠'),asset('ring','戒指',['无火烈鸟'])];
  assert.deepEqual(ids(searchAssets(list,{query:'没有火烈鸟吊坠'})),['absent']);
});

test('R3 bare karat and gold or silver requests stay unverified while style filters remain',()=>{
  const list=[asset('necklace','项链',['简约']),asset('ring','戒指',['简约'])];
  for(const query of ['18K的简约项链','纯金简约项链','金简约项链','银简约项链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['necklace'],query);
    assert.match(result.interpretation,/材质.*未核实/,query);
    assert.ok(result.items.every(item=>item.matchedEvidence.every(proof=>proof.field!=='tags'||proof.queryTerm==='简约')),query);
  }
});

test('R3 negated bare karat and gold or silver requests are blocked as unverified material',()=>{
  const list=[asset('necklace','项链',['简约'])];
  for(const query of ['不要18K的项链','不要纯金','不要金项链','不要银项链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(result.items,[],query);
    assert.ok(result.diagnostics.some(note=>note.code==='unverified_material'),query);
  }
});

test('R3 appearance colors still require their recorded color labels',()=>{
  const list=[asset('gold','项链',['金色']),asset('silver','项链',['银色']),asset('rose','项链',['玫瑰金色']),asset('unknown','项链')];
  for(const [query,want] of [['金色项链',['gold']],['金黄色项链',['gold']],['银色项链',['silver']],['银白色项链',['silver']],['玫瑰金色项链',['rose']]]){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),want,query);
    assert.doesNotMatch(result.interpretation,/材质要求未核实/,query);
  }
});

test('R4 slash-bearing tags cannot supply public match evidence',()=>{
  const list=[asset('unsafe','戒指',['开口/demo/secret']),asset('safe','戒指',['开口'])];
  const result=searchAssets(list,{query:'开口戒指'});
  assert.deepEqual(ids(result),['safe']);
  assert.doesNotMatch(JSON.stringify([result.diagnostics,...result.items.map(item=>item.matchedEvidence)]),/demo|secret|[\\/]/);
});

test('R4 single-backslash tags cannot supply public match evidence',()=>{
  const list=[asset('unsafe','戒指',['开口\\demo\\secret']),asset('safe','戒指',['开口'])];
  const result=searchAssets(list,{query:'开口戒指'});
  assert.deepEqual(ids(result),['safe']);
  assert.doesNotMatch(JSON.stringify([result.diagnostics,...result.items.map(item=>item.matchedEvidence)]),/demo|secret|[\\/]/);
});

test('R4 normalized path separators cannot supply public match evidence',()=>{
  const list=[asset('slash','戒指',['开口／demo／secret']),asset('backslash','戒指',['开口＼demo＼secret']),asset('safe','戒指',['开口'])];
  const result=searchAssets(list,{query:'开口戒指'});
  assert.deepEqual(ids(result),['safe']);
  assert.doesNotMatch(JSON.stringify(result.items.map(item=>item.matchedEvidence)),/demo|secret/);
});

test('R4 image filename strings are not accepted as visual tag evidence',()=>{
  const list=[asset('filename','戒指',['开口-demo.jpg']),asset('normalized','戒指',['开口-demo．png']),asset('safe','戒指',['开口'])];
  const result=searchAssets(list,{query:'开口戒指'});
  assert.deepEqual(ids(result),['safe']);
  assert.doesNotMatch(JSON.stringify(result.items.map(item=>item.matchedEvidence)),/demo|jpg|png/);
});

test('R5 price-prefixed bare amounts and grouped amounts never become numeric style constraints',()=>{
  const list=[asset('necklace','项链',['简约'])];
  for(const query of ['预算2000的简约项链','价格2000的简约项链','预算2,000的简约项链','预算2,000元的简约项链','价位2000以内的简约项链','售价2000到3000的简约项链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['necklace'],query);
    assert.match(result.interpretation,/价格.*未核实/,query);
    assert.ok(result.items.every(item=>item.matchedTerms.every(term=>!/\d/.test(term))),query);
  }
});

test('R5 an unrecognized number without price context remains a literal condition',()=>{
  const list=[asset('plain','项链',['简约']),asset('numbered','项链',['2000'])];
  assert.deepEqual(ids(searchAssets(list,{query:'2000项链'})),['numbered']);
});

test('R6 unknown availability cannot prove explicit absence of stock',()=>{
  const list=[asset('unknown','项链'),asset('missing','项链',[],{availability:undefined}),asset('invalid','项链',[],{availability:'not-confirmed'})];
  const result=searchAssets(list,{query:'没有现货'});
  assert.deepEqual(result.items,[]);
  assert.ok(result.diagnostics.some(note=>note.code==='missing_availability_evidence'));
});

test('R6 ordinary stock exclusion also cannot present unknown availability as confirmed absence',()=>{
  const result=searchAssets([asset('unknown','项链')],{query:'不要现货'});
  assert.deepEqual(result.items,[]);
  assert.ok(result.diagnostics.some(note=>note.code==='missing_availability_evidence'));
});

test('R6 confirmed non-stock supply types only prove the supply classification',()=>{
  const list=[asset('stock','项链',[],{availability:'in_stock'}),asset('order','项链',[],{availability:'order_only'}),asset('reference','项链',[],{availability:'reference_only'}),asset('unknown','项链')];
  const result=searchAssets(list,{query:'没有现货'});
  assert.deepEqual(ids(result),['order','reference']);
  assert.match(result.interpretation,/供货分类.*不代表.*库存数量/);
  assert.deepEqual(result.items.map(item=>item.matchedEvidence[0].value),['order_only','reference_only']);
});

test('R6 selecting the unknown availability filter remains a classification filter',()=>{
  const list=[asset('unknown','项链'),asset('stock','项链',[],{availability:'in_stock'})];
  assert.deepEqual(ids(searchAssets(list,{availability:'unknown'})),['unknown']);
});

test('R6 a negated supply modifier cannot exclude its following product category',()=>{
  const list=[asset('order','项链',[],{availability:'order_only'}),asset('reference','项链',[],{availability:'reference_only'}),asset('stock','项链',[],{availability:'in_stock'}),asset('unknown','项链'),asset('ring','戒指',[],{availability:'order_only'})];
  for(const query of ['没有现货项链','不要现货项链'])assert.deepEqual(ids(searchAssets(list,{query})),['order','reference'],query);
});

test('R7 punctuation ends a combined tag negation before its next positive feature',()=>{
  const list=[asset('open','戒指',['无镶嵌，开口'])];
  assert.deepEqual(ids(searchAssets(list,{query:'开口的戒指'})),['open']);
  assert.equal(searchAssets(list,{query:'不带开口的戒指'}).total,0);
  assert.deepEqual(ids(searchAssets(list,{query:'不带镶嵌的戒指'})),['open']);
});

test('R7 spaces end a combined tag negation before its next positive feature',()=>{
  const list=[asset('open','戒指',['无镶嵌 开口'])];
  assert.deepEqual(ids(searchAssets(list,{query:'开口的戒指'})),['open']);
  assert.equal(searchAssets(list,{query:'不带开口的戒指'}).total,0);
  assert.deepEqual(ids(searchAssets(list,{query:'不带镶嵌的戒指'})),['open']);
});

test('R8 speculative 或许 and leading 或是 do not become an alternative list',()=>{
  const list=[asset('necklace','项链',['简约'])];
  for(const query of ['或许简约的项链','或是简约的项链','给我看或许简约的项链','我想看或是简约的项链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['necklace'],query);
    assert.ok(!result.diagnostics.some(note=>note.code==='unsupported_alternative'),query);
  }
});

test('R8 actual alternative lists still produce an explicit unsupported diagnostic',()=>{
  const list=[asset('necklace','项链',['简约']),asset('ring','戒指')];
  for(const query of ['戒指或项链','戒指或是项链','戒指或者项链','戒指还是项链','戒指项链二选一']){
    const result=searchAssets(list,{query});
    assert.deepEqual(result.items,[],query);
    assert.ok(result.diagnostics.some(note=>note.code==='unsupported_alternative'),query);
  }
});

test('R9 bare 要 starts a positive material clause after a product exclusion',()=>{
  const list=[asset('ring','戒指',['简约']),asset('necklace','项链',['简约'])];
  for(const query of ['不要戒指要黄金项链','不要戒指，要黄金项链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['necklace'],query);
    assert.match(result.interpretation,/材质.*未核实/,query);
    assert.ok(!result.diagnostics.some(note=>note.code==='unverified_material'),query);
  }
});

test('R10 a pendant modifier in an explicit necklace context means a recorded attachment',()=>{
  const list=[asset('with','项链',['带吊坠']),asset('bare','项链',['无吊坠']),asset('unknown','项链'),asset('pendant','吊坠',['爱心'])];
  for(const query of ['吊坠的项链','吊坠项链','有吊坠的项链'])assert.deepEqual(ids(searchAssets(list,{query})),['with'],query);
});

test('R10 carrier category filters supply the attachment context without changing standalone pendants',()=>{
  const list=[asset('necklace','项链',['吊坠']),asset('bracelet','手链',['吊坠']),asset('pendant','吊坠',['爱心'])];
  assert.deepEqual(ids(searchAssets(list,{query:'吊坠',category:'项链'})),['necklace']);
  assert.deepEqual(ids(searchAssets(list,{query:'吊坠手链'})),['bracelet']);
  assert.deepEqual(ids(searchAssets(list,{query:'吊坠'})),['pendant']);
});

test('review regressions never search pending assets or equate T shapes with crosses',()=>{
  const list=[asset('T','戒指',['T形']),asset('cross','戒指',['十字']),asset('pending','戒指',['T形'],{status:'needs_review'})];
  assert.deepEqual(ids(searchAssets(list,{query:'T形戒指'})),['T']);
  assert.deepEqual(ids(searchAssets(list,{query:'十字戒指'})),['cross']);
});

test('NF1 spaces between a negator and its feature preserve explicit absence',()=>{
  for(const negator of ['无','没有','不带','不含']){
    const list=[asset('absent','戒指',[negator+' 镶嵌']),asset('set','戒指',['镶嵌']),asset('unknown','戒指')];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['set'],negator);
    const absent=searchAssets(list,{query:'不带镶嵌的戒指'});
    assert.deepEqual(ids(absent),['absent'],negator);
    assert.ok(absent.items[0].matchedEvidence.some(proof=>proof.field==='tags'&&proof.match==='explicit_absence'),negator);
  }
});

test('NF1 a tab between a negator and its feature preserves absence with safe evidence',()=>{
  for(const negator of ['无','没有','不带','不含']){
    const list=[asset('absent','戒指',[negator+'\t镶嵌']),asset('set','戒指',['镶嵌'])];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['set'],negator);
    const absent=searchAssets(list,{query:'不带镶嵌的戒指'});
    assert.deepEqual(ids(absent),['absent'],negator);
    assert.ok(absent.items[0].matchedEvidence.filter(proof=>proof.field==='tags').every(proof=>!/[\x00-\x1f]/.test(proof.value)),negator);
  }
});

test('NF1 a fullwidth space between a negator and its feature preserves absence',()=>{
  for(const negator of ['无','没有','不带','不含']){
    const list=[asset('absent','戒指',[negator+'　镶嵌']),asset('set','戒指',['镶嵌'])];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['set'],negator);
    assert.deepEqual(ids(searchAssets(list,{query:'不带镶嵌的戒指'})),['absent'],negator);
  }
});

test('NF1 multiple mixed spaces after a negator cannot create a positive feature',()=>{
  for(const negator of ['无','没有','不带','不含']){
    const list=[asset('absent','戒指',[negator+'  \t　  镶嵌']),asset('set','戒指',['镶嵌'])];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['set'],negator);
    assert.deepEqual(ids(searchAssets(list,{query:'不带镶嵌的戒指'})),['absent'],negator);
  }
});

test('NF1 completing a spaced absent feature still lets a later separated feature be present',()=>{
  for(const tag of ['无 镶嵌，开口','无 镶嵌 开口','没有\t镶嵌，开口','不含　镶嵌 开口']){
    const list=[asset('open','戒指',[tag])];
    assert.equal(searchAssets(list,{query:'镶嵌戒指'}).total,0,tag);
    assert.deepEqual(ids(searchAssets(list,{query:'不带镶嵌的戒指'})),['open'],tag);
    assert.deepEqual(ids(searchAssets(list,{query:'开口戒指'})),['open'],tag);
    assert.equal(searchAssets(list,{query:'不带开口的戒指'}).total,0,tag);
  }
});

test('NF1 a dangling or repeated negator cannot prove either polarity of a later feature',()=>{
  for(const tag of ['无 ，镶嵌','没有；镶嵌','不带、镶嵌','无没有镶嵌']){
    const list=[asset('unclear','戒指',[tag])];
    const positive=searchAssets(list,{query:'镶嵌戒指'}),absent=searchAssets(list,{query:'不带镶嵌的戒指'});
    assert.equal(positive.total,0,tag);
    assert.equal(absent.total,0,tag);
    assert.ok(positive.diagnostics.some(note=>note.code==='missing_feature_evidence'),tag);
    assert.ok(absent.diagnostics.some(note=>note.code==='missing_absence_evidence'),tag);
  }
});

test('NF1 non-tab control characters remain unusable as tag evidence',()=>{
  for(const tag of ['无\n镶嵌','无\r镶嵌','无\u0000镶嵌']){
    const list=[asset('invalid','戒指',[tag])];
    assert.equal(searchAssets(list,{query:'镶嵌戒指'}).total,0,tag);
    assert.equal(searchAssets(list,{query:'不带镶嵌的戒指'}).total,0,tag);
  }
});

test('NF1 whitespace after a negator also preserves absence of an unknown literal motif',()=>{
  const list=[asset('absent','吊坠',['无 火烈鸟']),asset('present','吊坠',['火烈鸟'])];
  assert.deepEqual(ids(searchAssets(list,{query:'火烈鸟吊坠'})),['present']);
  assert.deepEqual(ids(searchAssets(list,{query:'没有火烈鸟的吊坠'})),['absent']);
});

test('NF1-tail a trailing negator after a space cannot erase a completed positive feature',()=>{
  const list=[asset('trailing','戒指',['镶嵌 无'])];
  assert.equal(searchAssets(list,{query:'不要镶嵌的戒指'}).total,0);
  assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['trailing']);
  assert.equal(searchAssets(list,{query:'不带镶嵌的戒指'}).total,0);
});

test('NF1-tail a trailing negator after a comma cannot erase a completed positive feature',()=>{
  const list=[asset('trailing','戒指',['镶嵌，无'])];
  assert.equal(searchAssets(list,{query:'不要镶嵌的戒指'}).total,0);
  assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['trailing']);
  assert.equal(searchAssets(list,{query:'不带镶嵌的戒指'}).total,0);
});

test('NF1-tail multiple completed positive features survive an unfinished final negation',()=>{
  for(const tag of ['镶嵌 开口 无','镶嵌，开口，无']){
    const list=[asset('known','戒指',[tag])];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌开口的戒指'})),['known'],tag);
    for(const feature of ['镶嵌','开口']){
      assert.equal(searchAssets(list,{query:'不要'+feature+'的戒指'}).total,0,tag+' excludes '+feature);
      assert.equal(searchAssets(list,{query:'不带'+feature+'的戒指'}).total,0,tag+' has no absence of '+feature);
    }
  }
});

test('NF1-tail an ambiguous unfinished suffix stops parsing without clearing earlier facts',()=>{
  for(const tag of ['镶嵌 无，开口','镶嵌 无没有开口']){
    const list=[asset('known','戒指',[tag])];
    assert.deepEqual(ids(searchAssets(list,{query:'镶嵌戒指'})),['known'],tag);
    assert.equal(searchAssets(list,{query:'不要镶嵌的戒指'}).total,0,tag);
    assert.equal(searchAssets(list,{query:'开口戒指'}).total,0,tag);
    assert.equal(searchAssets(list,{query:'不带开口的戒指'}).total,0,tag);
  }
});
