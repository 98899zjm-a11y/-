// Pure, deterministic tag search. No model, network, database or filesystem access.
const categories = {
  戒指:['戒指','指环','戒圈'], 项链:['项链','颈链','锁骨链'], 吊坠:['吊坠','挂坠','坠子'],
  耳饰:['耳饰','耳环','耳钉','耳坠','耳圈'], 手链:['手链','手串','手绳'],
  手镯:['手镯','镯子','手环'], 胸针:['胸针','胸花'], 其他首饰:['其他首饰'],
};
const features = {
  简约:['简约','简洁','简简单单','极简','简单'], 素圈:['素圈','光圈'],
  小巧:['小巧','迷你','小号'], 花朵:['花朵','花形','花型','花'],
  几何:['几何'], 珠饰:['珠饰','珍珠','圆珠'], 复古:['复古','古典'],
  细款:['细款','细链','细一点','细一些','细'], 粗款:['粗款','粗链'],
  爱心:['爱心','心形','心型'], 蝴蝶:['蝴蝶'], 蝴蝶结:['蝴蝶结'],
  耳钉:['耳钉'], 耳坠:['耳坠'], 耳圈:['耳圈'], 金色:['金色'], 银色:['银色'],
  镶嵌:['镶嵌'], 链条:['链条'], 多层:['多层'], 垂坠:['垂坠'], 宽版:['宽版'],
  编织:['编织'], 圆形:['圆形'], 玫瑰金色:['玫瑰金色'], 白色:['白色'], 黑色:['黑色'],
  彩色:['彩色'], 红色:['红色'], 绿色:['绿色'], 蓝色:['蓝色'], 成套:['成套'],
  佩戴图:['佩戴图'], 产品图:['产品图'],
};
const supply = {现货:'in_stock',需订货:'order_only',仅供参考:'reference_only'};
const availabilityValues = new Set(['unknown','in_stock','order_only','reference_only']);
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
const categoryOf=value=>Object.keys(categories).find(key=>categories[key].includes(normalize(value)))||'';
const lexicon = [
  ...Object.entries(categories).flatMap(([key,aliases])=>aliases.map(word=>({word,key,type:'category'}))),
  ...Object.entries(features).flatMap(([key,aliases])=>aliases.map(word=>({word,key,type:'feature'}))),
  ...Object.entries(supply).map(([word,key])=>({word,key,type:'availability'})),
].sort((a,b)=>b.word.length-a.word.length);
const negatives=['不想要','不喜欢','不要','不想','不带','不含','排除','避开','别带','别要','没有'];
const fillers=/请帮我找|帮我找|给客户看|给我看|客户想看|我想看|我想要|想要|想看|要看|看看|找一下|找一些|来几张|有没有|一些|一点|一下|几款|几张|一款|一条|一对|一个|适合|风格|款式|首饰|图片|照片|那种|这种|同时|而且|以及|但是|最好|需要|佩戴|我|请|找|看|要|带|戴|有|的|款|和|与|及|且/g;

// Inspect before removing unverified material words so their negator cannot
// accidentally move onto a following product category.
function hasNegatedMaterial(text,material){
  const atMaterial=new RegExp('^(?:'+material.source+')','i');
  let negative=false;
  for(let i=0;i<text.length;){
    const tail=text.slice(i),neg=[...negatives,'不是'].find(n=>tail.startsWith(n));
    if(neg){negative=true;i+=neg.length;continue;}
    if(/^[，。；,;！？!?、\n的]|^(?:想看|想要|要看|需要|但是|但)/.test(tail))negative=false;
    if(negative&&atMaterial.test(tail))return true;
    i++;
  }
  return false;
}

function parse(query){
  const warnings=[];
  let text=normalize(query).replace(/不一定(?:要|是)?现货|不要求现货|不限现货/g,' ');
  if(/日常/.test(text)){warnings.push('日常佩戴适配未验证，仅作为软偏好，不作为筛选硬条件');text=text.replace(/日常(?:佩戴|戴)?/g,' ');}
  if(/珍珠/.test(text))warnings.push('珍珠请求仅按珠饰外观检索，真实珍珠材质未核实');
  const material=/(?:(?:\d{1,2}\s*k|k)金|黄金|足金|铂金|白金|纯银|足银|925银|银饰|翡翠|和田玉|钻石|天然|真金|真银)/gi;
  if(hasNegatedMaterial(text,material))return{terms:[],warnings:['材质无法核实，先按款式查找或人工确认'],blocked:true};
  if(material.test(text)){warnings.push('材质要求未核实，结果不能证明真实材质');text=text.replace(material,' ');}
  const price=/(?:预算|价格|价位|售价)?\s*\d+(?:\.\d+)?(?:\s*[-~到至]\s*\d+(?:\.\d+)?)?\s*(?:元|块|rmb)(?:以内|以下|以上|左右)?|便宜|实惠|昂贵|低价|高价|价格|预算/g;
  if(price.test(text)){warnings.push('价格要求未核实，未按价格筛选');text=text.replace(price,' ');}
  const terms=[],residual=[];let negative=false,negativeFeature=false;
  for(let i=0;i<text.length;){
    const tail=text.slice(i),neg=negatives.find(n=>tail.startsWith(n));
    if(neg){negative=true;negativeFeature=false;i+=neg.length;continue;}
    if(/^[，。；,;！？!?、\n]/.test(tail)){negative=false;negativeFeature=false;residual.push({text:' ',negative});i++;continue;}
    if(tail.startsWith('的')||/^(?:想看|想要|要看|需要|但是|但)/.test(tail)){negative=false;negativeFeature=false;}
    const term=lexicon.find(t=>tail.startsWith(t.word));
    if(term){
      const negated=negative&&!(term.type==='category'&&negativeFeature);
      const subtype=term.type==='category'&&['耳钉','耳坠','耳圈'].includes(term.word);
      if(!(subtype&&negated))terms.push({...term,negative:negated});
      // Earring subtypes also constrain visible labels; generic 耳环 stays broad.
      if(subtype)terms.push({type:'feature',key:term.word,word:term.word,negative:negated});
      if(term.type==='feature'&&negative)negativeFeature=true;
      i+=term.word.length;residual.push({text:' ',negative});continue;
    }
    residual.push({text:text[i++],negative});
  }
  const runs=[];
  for(const part of residual){const last=runs.at(-1);if(last&&last.negative===part.negative)last.text+=part.text;else runs.push({...part});}
  for(const run of runs){
    const unknown=run.text.replace(fillers,' ').split(/[\s，。；,;！？!?、/]+/).filter(Boolean);
    for(const word of unknown)terms.push({word,key:word,type:'literal',negative:run.negative});
  }
  return{terms,warnings};
}
function matches(asset,term){
  if(term.type==='availability')return asset.availability===term.key;
  const fieldTexts=[asset.name,asset.category,...(Array.isArray(asset.tags)?asset.tags:[])].filter(v=>typeof v==='string').map(normalize);
  if(term.type==='category'){
    const known=categoryOf(asset.category);
    if(known)return known===term.key;
    return categories[term.key].some(alias=>fieldTexts.some(value=>value.includes(alias)));
  }
  const aliases=term.type==='feature'?features[term.key]:[term.key];
  return aliases.some(alias=>fieldTexts.some(value=>value.includes(alias)));
}
export function searchAssets(assets,{query='',category='',availability='',limit=100,offset=0}={}){
  if(!Array.isArray(assets))throw new TypeError('素材列表无效');
  if(typeof query!=='string'||query.length>300)throw new TypeError('查询须为不超过300字的文字');
  if(typeof category!=='string'||(category&&!categoryOf(category)))throw new TypeError('分类无效');
  if(typeof availability!=='string'||(availability&&!availabilityValues.has(availability)))throw new TypeError('供货状态无效');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw new TypeError('分页参数无效：limit须为1至100，offset须为非负整数');
  const {terms,warnings,blocked}=parse(query);
  if(blocked)return{items:[],total:0,interpretation:warnings.join('。')};
  if(category)terms.push({type:'category',key:categoryOf(category),word:categoryOf(category),negative:false});
  if(availability)terms.push({type:'availability',key:availability,word:availability,negative:false});
  const labels=[...new Set(terms.map(t=>(t.negative?'排除：':'')+(t.word==='珍珠'?'珠饰外观（材质未核实）':t.word)))];
  const interpretation=[labels.length?'标签条件：'+labels.join('、'):(query.trim()?'没有可核实的款式条件':'浏览全部已确认首饰素材'),...warnings,'按已登记的款式标签找图，供货以核实记录为准；未找到时可换种描述或补充标签。'].join('。');
  if(query.trim()&&!terms.length)return{items:[],total:0,interpretation};
  const filtered=assets.filter(asset=>asset&&asset.status==='imported'&&terms.every(term=>term.negative?!matches(asset,term):matches(asset,term)));
  return{items:filtered.slice(offset,offset+limit).map(asset=>({...asset,matchedTerms:labels})),total:filtered.length,interpretation};
}
