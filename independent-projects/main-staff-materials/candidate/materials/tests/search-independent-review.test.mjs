import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAssets } from '../lib/search.mjs';

const asset=(id,category,tags=[],extra={})=>({id,name:id+'.jpg',status:'imported',category,tags,availability:'unknown',...extra});
const ids=result=>result.items.map(item=>item.id).sort();

test('R1 bare pendant absence needs explicit absence evidence, not a different category',()=>{
  const list=[
    asset('present','项链',['吊坠']),
    asset('absent','项链',['无吊坠']),
    asset('unknown','项链',['链节']),
    asset('standalone','吊坠',['爱心']),
    asset('ring','戒指',[]),
  ];
  for(const query of ['没有吊坠','无吊坠','不带吊坠','不含吊坠']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['absent'],query);
    assert.ok(result.items.every(item=>item.category!=='吊坠'),query);
    assert.ok(result.diagnostics.some(note=>note.code==='missing_absence_evidence'),query);
  }
});

test('R1 positive pendant product and carrier-filtered contracts stay unchanged',()=>{
  const list=[asset('with','项链',['吊坠']),asset('bare','项链',['无吊坠']),asset('unknown','项链',['细链']),asset('pendant','吊坠',['爱心'])];
  assert.deepEqual(ids(searchAssets(list,{query:'吊坠'})),['pendant']);
  assert.deepEqual(ids(searchAssets(list,{query:'有吊坠的项链'})),['with']);
  assert.deepEqual(ids(searchAssets(list,{query:'没有吊坠',category:'项链'})),['bare']);
  const ordinary=searchAssets(list,{query:'项链，不要吊坠'});
  assert.deepEqual(ids(ordinary),['bare','unknown']);
  assert.ok(ordinary.diagnostics.some(note=>note.code==='unrecorded_exclusion'));
});

test('R4 material tags are not appearance evidence for a material query',()=>{
  const list=[asset('claimed','戒指',['莫桑石']),asset('plain','戒指',[])];
  const positive=searchAssets(list,{query:'莫桑石戒指'});
  assert.deepEqual(ids(positive),['claimed','plain']);
  assert.match(positive.interpretation,/材质.*未核实/);
  assert.ok(positive.items.every(item=>item.matchedEvidence.every(evidence=>!/莫桑/.test(JSON.stringify(evidence)))));
  assert.ok(positive.items.every(item=>!item.matchedTerms.some(label=>/莫桑/.test(label))));
});

test('R4 negated material fails closed instead of filtering by a missing tag',()=>{
  const list=[asset('claimed','戒指',['莫桑石']),asset('plain','戒指',[])];
  for(const query of ['不要莫桑石戒指','不要莫桑石','不带水晶的戒指','不要贝母戒指','不要钛钢手链']){
    const result=searchAssets(list,{query});
    assert.deepEqual(result.items,[],query);
    assert.ok(result.diagnostics.some(note=>note.code==='unverified_material'),query);
  }
});

test('R4 material-only conditions do not fabricate style matches',()=>{
  const list=[asset('claimed','戒指',['莫桑石']),asset('plain','戒指',[])];
  for(const query of ['莫桑石','水晶','贝母']){
    const result=searchAssets(list,{query});
    assert.equal(result.total,0,query);
    assert.match(result.interpretation,/材质.*未核实/,query);
  }
});

test('R4 visible color exceptions and pearl appearance stay usable',()=>{
  const list=[asset('gold','项链',['金色']),asset('silver','项链',['银色']),asset('rose','项链',['玫瑰金色']),asset('bead','项链',['珠饰']),asset('plain','项链',[])];
  assert.deepEqual(ids(searchAssets(list,{query:'金色项链'})),['gold']);
  assert.deepEqual(ids(searchAssets(list,{query:'银色项链'})),['silver']);
  assert.deepEqual(ids(searchAssets(list,{query:'玫瑰金色项链'})),['rose']);
  const pearl=searchAssets(list,{query:'珍珠项链'});
  assert.deepEqual(ids(pearl),['bead']);
  assert.match(pearl.interpretation,/珍珠.*外观.*材质.*未核实/);
});

test('N1 dropping a material word cannot turn an established negation into a positive feature',()=>{
  const list=[asset('neg','吊坠',['无水晶和天鹅']),asset('pos','吊坠',['天鹅'])];
  assert.deepEqual(ids(searchAssets(list,{query:'天鹅吊坠'})),['pos']);
  assert.deepEqual(ids(searchAssets(list,{query:'没有天鹅吊坠'})),['neg']);
  assert.deepEqual(ids(searchAssets(list,{query:'不带天鹅的吊坠'})),['neg']);
  assert.deepEqual(ids(searchAssets(list,{query:'不要天鹅的吊坠'})),['neg']);
});

test('N1 negated material before a different negated feature stays negative',()=>{
  const list=[asset('neg','吊坠',['没有莫桑石与蝴蝶']),asset('pos','吊坠',['蝴蝶'])];
  assert.deepEqual(ids(searchAssets(list,{query:'蝴蝶吊坠'})),['pos']);
  assert.deepEqual(ids(searchAssets(list,{query:'没有蝴蝶吊坠'})),['neg']);
  assert.deepEqual(ids(searchAssets(list,{query:'不带蝴蝶的吊坠'})),['neg']);
});

test('N1 positive material compounds keep safe visible features without proving material',()=>{
  const list=[asset('a','吊坠',['水晶天鹅']),asset('b','吊坠',['莫桑石天鹅']),asset('plain','吊坠',[])];
  const matched=searchAssets(list,{query:'天鹅吊坠'});
  assert.deepEqual(ids(matched),['a','b']);
  const expectedCompound=new Map([['a','水晶天鹅'],['b','莫桑石天鹅']]);
  for(const item of matched.items){
    const originalTag=expectedCompound.get(item.id);
    assert.ok(originalTag,item.id);
    const tagProofs=item.matchedEvidence.filter(proof=>proof.field==='tags'&&proof.queryTerm==='天鹅');
    assert.equal(tagProofs.length,1,item.id);
    assert.equal(tagProofs[0].match,'present',item.id);
    assert.equal(tagProofs[0].value,originalTag,item.id);
    assert.ok(item.matchedEvidence.every(proof=>proof.field!=='material'),item.id);
    assert.ok(item.matchedTerms.every(label=>!/水晶|莫桑/.test(label)),item.id);
  }
  assert.deepEqual(searchAssets(list,{query:'没有天鹅吊坠'}).items,[]);
  const material=searchAssets(list,{query:'水晶吊坠'});
  assert.deepEqual(ids(material),['a','b','plain']);
  assert.match(material.interpretation,/材质.*未核实/);
  assert.ok(material.items.every(item=>item.matchedEvidence.every(proof=>!/水晶|莫桑/.test(JSON.stringify(proof)))));
  assert.ok(material.items.every(item=>!item.matchedTerms.some(label=>/水晶|莫桑/.test(label))));
});

test('N1 material-only negation never manufactures absence evidence',()=>{
  const list=[asset('neg','吊坠',['无水晶']),asset('plain','吊坠',['天鹅']),asset('unknown','吊坠',[])];
  assert.deepEqual(ids(searchAssets(list,{query:'天鹅吊坠'})),['plain']);
  assert.deepEqual(searchAssets(list,{query:'没有天鹅吊坠'}).items,[]);
  assert.deepEqual(searchAssets(list,{query:'没有莫桑石的吊坠'}).items,[]);
});

test('R4 known material compounds and hallmarks fall back to style with an unverified warning',()=>{
  const list=[asset('claimed','戒指',['宝石']),asset('plain','戒指',[])];
  for(const query of ['宝石戒指','红宝石戒指','PT950戒指','pt 950的戒指','ＰＴ９５０戒指','Au750戒指','Ag925戒指','Pd999戒指']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['claimed','plain'],query);
    assert.match(result.interpretation,/材质.*未核实/,query);
    assert.ok(result.items.every(item=>item.matchedTerms.every(label=>!/宝石|PT|Pd|Au|Ag/i.test(label))),query);
    assert.ok(result.items.every(item=>item.matchedEvidence.every(proof=>proof.field!=='material')),query);
    assert.ok(result.items.every(item=>item.matchedEvidence.every(proof=>!/宝石|PT|Pd|Au|Ag/i.test(JSON.stringify(proof)))),query);
  }
});

test('R4 negated known material compounds and hallmarks fail closed',()=>{
  const list=[asset('claimed','戒指',['宝石']),asset('plain','戒指',[])];
  for(const query of ['不要宝石戒指','不要红宝石的戒指','不要PT950戒指','没有Au750的戒指','不带Ag925戒指']){
    const result=searchAssets(list,{query});
    assert.deepEqual(result.items,[],query);
    assert.ok(result.diagnostics.some(note=>note.code==='unverified_material'),query);
  }
});

test('R4 pure material compounds or hallmarks never fabricate style matches',()=>{
  const list=[asset('claimed','戒指',['宝石']),asset('plain','戒指',[])];
  for(const query of ['宝石','红宝石','PT950','pt 950','ＰＴ９５０','Au750','Ag925','莫桑石','水晶']){
    const result=searchAssets(list,{query});
    assert.equal(result.total,0,query);
    assert.match(result.interpretation,/材质.*未核实/,query);
  }
});

test('R4 known material tags never become appearance literal evidence',()=>{
  const list=[asset('gem','戒指',['宝石']),asset('pt','戒指',['PT950']),asset('plain','戒指',[])];
  for(const query of ['宝石戒指','PT950戒指']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['gem','plain','pt'],query);
    assert.match(result.interpretation,/材质.*未核实/,query);
    assert.ok(result.items.every(item=>item.matchedEvidence.every(proof=>proof.field==='category')),query);
  }
});

test('N2 conjunction filler after skipped material keeps pending negation',()=>{
  const list=[asset('neg','吊坠',['无水晶和 天鹅']),asset('pos','吊坠',['天鹅'])];
  assert.deepEqual(ids(searchAssets(list,{query:'天鹅吊坠'})),['pos']);
  const absent=searchAssets(list,{query:'没有天鹅吊坠'});
  assert.deepEqual(ids(absent),['neg']);
  assert.ok(absent.items[0].matchedEvidence.some(p=>p.field==='tags'&&p.queryTerm==='天鹅'&&p.match==='explicit_absence'&&p.value==='无水晶和 天鹅'));
});

test('N2 conjunction fillers work for base materials and unknown literals',()=>{
  for(const [tag,feature,negative] of [
    ['无和田玉和 天鹅','天鹅','没有天鹅吊坠'],
    ['无黄金和 花朵','花朵','没有花朵吊坠'],
    ['无水晶和 火烈鸟','火烈鸟','没有火烈鸟吊坠'],
  ]){
    const list=[asset('neg','吊坠',[tag]),asset('pos','吊坠',[feature])];
    assert.deepEqual(ids(searchAssets(list,{query:feature+'吊坠'})),['pos'],tag);
    assert.deepEqual(ids(searchAssets(list,{query:negative})),['neg'],tag);
  }
});

test('N2 punctuation and repeated negators keep old boundaries',()=>{
  for(const tag of ['无水晶，天鹅','无没有天鹅']){
    const list=[asset('unclear','吊坠',[tag]),asset('clear','吊坠',['天鹅'])];
    assert.deepEqual(ids(searchAssets(list,{query:'天鹅吊坠'})),['clear'],tag);
    assert.equal(searchAssets(list,{query:'没有天鹅吊坠'}).total,0,tag);
  }
});

test('R4 玉石 is unverified material, not a pendant literal',()=>{
  const list=[asset('claimed','吊坠',['玉石']),asset('plain','吊坠',[])];
  const pure=searchAssets(list,{query:'玉石'});
  assert.equal(pure.total,0);
  assert.match(pure.interpretation,/材质.*未核实/);
  const styled=searchAssets(list,{query:'玉石吊坠'});
  assert.deepEqual(ids(styled),['claimed','plain']);
  assert.match(styled.interpretation,/材质.*未核实/);
  assert.ok(styled.items.every(item=>item.matchedEvidence.every(p=>p.field==='category')));
  assert.ok(styled.items.every(item=>item.matchedTerms.every(label=>!/玉石/.test(label))));
  for(const query of ['不要玉石吊坠','不带玉石的吊坠']){
    const blocked=searchAssets(list,{query});
    assert.deepEqual(blocked.items,[],query);
    assert.ok(blocked.diagnostics.some(d=>d.code==='unverified_material'),query);
  }
});

test('R4 single-char metals need material context and do not split shape literals',()=>{
  const list=[asset('iron','吊坠',['马蹄铁']),asset('hoof','吊坠',['马蹄']),asset('tower','吊坠',['铁塔']),asset('magnolia','吊坠',['玉兰']),asset('corn','吊坠',['玉米']),asset('pomegranate','吊坠',['石榴花']),asset('lotus','吊坠',['并蒂莲'])];
  assert.deepEqual(ids(searchAssets(list,{query:'马蹄铁吊坠'})),['iron']);
  const negative=searchAssets(list,{query:'不要马蹄铁吊坠'});
  assert.ok(!negative.diagnostics.some(d=>d.code==='unverified_material'));
  assert.deepEqual(ids(negative),['corn','hoof','lotus','magnolia','pomegranate','tower']);
  for(const [query,id] of [['铁塔吊坠','tower'],['玉兰吊坠','magnolia'],['玉米吊坠','corn'],['石榴花吊坠','pomegranate'],['并蒂莲吊坠','lotus']])assert.deepEqual(ids(searchAssets(list,{query})),[id],query);
});

test('R4 full single-char material tokens still gate by material context',()=>{
  const list=[asset('claimed','戒指',['铜']),asset('plain','戒指',[])];
  const positive=searchAssets(list,{query:'铜戒指'});
  assert.deepEqual(ids(positive),['claimed','plain']);
  assert.match(positive.interpretation,/材质.*未核实/);
  assert.ok(positive.items.every(item=>item.matchedEvidence.every(p=>p.field==='category')));
  for(const query of ['不要铜的戒指','不带铜戒指']){
    const blocked=searchAssets(list,{query});
    assert.deepEqual(blocked.items,[],query);
    assert.ok(blocked.diagnostics.some(d=>d.code==='unverified_material'),query);
  }
  assert.equal(searchAssets(list,{query:'铜'}).total,0);
});

test('R4 玉 and 石 need material context and do not split shape literals',()=>{
  const list=[asset('jade','戒指',['玉']),asset('stone','吊坠',['石']),asset('magnolia','吊坠',['玉兰']),asset('corn','吊坠',['玉米']),asset('pomegranate','吊坠',['石榴花']),asset('plain','戒指',[])];
  const jade=searchAssets(list,{query:'玉戒指'});
  assert.deepEqual(ids(jade),['jade','plain']);
  assert.match(jade.interpretation,/材质.*未核实/);
  assert.ok(jade.items.every(item=>item.matchedEvidence.every(p=>p.field==='category')));
  const stone=searchAssets(list,{query:'石吊坠'});
  assert.deepEqual(ids(stone),['corn','magnolia','pomegranate','stone']);
  assert.match(stone.interpretation,/材质.*未核实/);
  for(const query of ['不要玉戒指','不要石吊坠']){
    const blocked=searchAssets(list,{query});
    assert.deepEqual(blocked.items,[],query);
    assert.ok(blocked.diagnostics.some(d=>d.code==='unverified_material'),query);
  }
  assert.equal(searchAssets(list,{query:'玉'}).total,0);
  for(const [query,id] of [['玉兰吊坠','magnolia'],['玉米吊坠','corn'],['石榴花吊坠','pomegranate']])assert.deepEqual(ids(searchAssets(list,{query})),[id],query);
});

test('R4 alloy and plating compounds with a leading metal are skipped whole',()=>{
  const list=[asset('claim','戒指',['铜镀金']),asset('alloy','戒指',['铜合金']),asset('plain','戒指',[]),asset('horseshoe','吊坠',['马蹄铁']),asset('tower','吊坠',['铁塔']),asset('magnolia','吊坠',['玉兰']),asset('corn','吊坠',['玉米']),asset('pomegranate','吊坠',['石榴花']),asset('lotus','吊坠',['并蒂莲'])];
  for(const query of ['铜镀金戒指','铜合金戒指']){
    const result=searchAssets(list,{query});
    assert.deepEqual(ids(result),['alloy','claim','plain'],query);
    assert.match(result.interpretation,/材质.*未核实/,query);
    assert.ok(result.items.every(item=>item.matchedTerms.every(label=>!/铜|镀|合金/.test(label))),query);
    assert.ok(result.items.every(item=>item.matchedEvidence.every(proof=>proof.field==='category')),query);
  }
  for(const query of ['不要铜镀金戒指','不要铜合金戒指']){
    const blocked=searchAssets(list,{query});
    assert.deepEqual(blocked.items,[],query);
    assert.ok(blocked.diagnostics.some(d=>d.code==='unverified_material'),query);
  }
  for(const [query,id] of [['马蹄铁吊坠','horseshoe'],['铁塔吊坠','tower'],['玉兰吊坠','magnolia'],['玉米吊坠','corn'],['石榴花吊坠','pomegranate'],['并蒂莲吊坠','lotus']])assert.deepEqual(ids(searchAssets(list,{query})),[id],query);
});

test('R4 standalone 合金 is whole-word material, not a visual literal',()=>{
  const list=[asset('claim','戒指',['合金']),asset('plain','戒指',[])];
  const pure=searchAssets(list,{query:'合金'});
  assert.equal(pure.total,0);
  assert.match(pure.interpretation,/材质.*未核实/);
  const styled=searchAssets(list,{query:'合金戒指'});
  assert.deepEqual(ids(styled),['claim','plain']);
  assert.match(styled.interpretation,/材质.*未核实/);
  assert.ok(styled.items.every(item=>item.matchedTerms.every(label=>!/合|合金/.test(label))));
  assert.ok(styled.items.every(item=>item.matchedEvidence.every(proof=>proof.field==='category')));
  assert.doesNotMatch(JSON.stringify(styled.items.map(item=>item.matchedEvidence)),/合/);
  const blocked=searchAssets(list,{query:'不要合金戒指'});
  assert.deepEqual(blocked.items,[]);
  assert.ok(blocked.diagnostics.some(d=>d.code==='unverified_material'));
  const compounds=[asset('plated','戒指',['铜镀金']),asset('copper-alloy','戒指',['铜合金']),asset('base','戒指',[])];
  const compound=searchAssets(compounds,{query:'铜合金戒指'});
  assert.deepEqual(ids(compound),['base','copper-alloy','plated']);
  assert.ok(compound.items.every(item=>item.matchedTerms.every(label=>!/铜|合|镀/.test(label))));
  assert.ok(compound.items.every(item=>item.matchedEvidence.every(proof=>proof.field==='category')));
});
