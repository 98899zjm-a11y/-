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
  开口:['开口','开口式'], 闭口:['闭口','闭合'], T形:['T形','T型','双T'],
  天鹅:['天鹅'], 钥匙:['钥匙形','钥匙型','钥匙'], 四叶草:['四叶草','四瓣'],
  星形:['星形','星型','星星'], 六角星:['六角星'], 五角星:['五角星'], 花生:['花生'], 蛇形:['蛇形','蛇型'],
  镂空:['镂空'], 光面:['光面','光滑面'], 链节:['链节明显','扁平链节','长链节','链节'],
  吊饰:['多吊饰','多吊坠','吊饰','吊坠','挂坠','坠子','小吊件','垂挂小件','悬挂配件','垂坠配件'], 无吊饰:['无吊饰','没有吊饰'],
  无吊坠:['无吊坠','素链','没有吊坠'], 圆环:['圆环','圆圈','环形','环状'],
  耳钉:['耳钉'], 耳坠:['耳坠'], 耳圈:['耳圈','圈形耳环','圆圈耳环'], 金色:['金色','金黄色'], 银色:['银色','银白色'],
  镶嵌:['镶嵌'], 链条:['链条'], 多层:['多层'], 垂坠:['垂坠'], 宽版:['宽版'],
  编织:['编织'], 圆形:['圆形'], 玫瑰金色:['玫瑰金色'], 白色:['白色'], 黑色:['黑色'],
  彩色:['彩色'], 红色:['红色'], 绿色:['绿色'], 蓝色:['蓝色'], 成套:['成套'],
  佩戴图:['佩戴图'], 产品图:['产品图'],
};
const MATERIAL_FULL_WORDS='红宝石|蓝宝石|绿宝石|彩宝|宝石|莫桑石|莫桑钻|莫桑|钛钢|不锈钢|钨钢|合金|电镀|镀层|镀金|镀银|镀白金|镀铑|贝母|水晶|玛瑙|琥珀|珊瑚|琉璃|锆石|皓石|绿松石|孔雀石|青金石|石榴石|玉石|和田玉|翡翠|钻石|黄金|足金|纯金|铂金|白金|纯银|足银|925银|银饰|天然|真金|真银|(?<![a-z0-9])(?:pt|pd|au|ag)\\s*\\d{2,3}(?![a-z0-9])';
const MATERIAL_CATEGORY='戒指|指环|戒圈|项链|颈链|锁骨链|吊坠|挂坠|坠子|耳饰|耳环|耳钉|耳坠|耳圈|手链|手串|手绳|手镯|镯子|手环|胸针|胸花|首饰';
const MATERIAL_SINGLE='(?:(?<![一-龥])|(?<=无|有|要|带|含|是))(?:铜|铁|铝|锡|铑|铱|铂|钢|镍|铬|钛|玉|石)(?=\\s*(?:的|(?:'+MATERIAL_CATEGORY+')|$|[，。；,;！？!?、\\s]|和|与|及|且|并))';
const MATERIAL_COMPOUND='(?:(?<![一-龥])|(?<=无|有|要|带|含|是))(?:铜|铁|铝|锡|铑|铱|铂|钢|镍|铬|钛)(?:合金|镀金|镀银|镀白金|镀铑|包金|包银|电镀|镀层)(?=\\s*(?:的|(?:'+MATERIAL_CATEGORY+')|$|[，。；,;！？!?、\\s]|和|与|及|且|并))';
const MATERIAL_WORDS=new RegExp('(?:'+MATERIAL_FULL_WORDS+'|'+MATERIAL_COMPOUND+'|'+MATERIAL_SINGLE+')');
const BASE_MATERIAL_SOURCE='(?:(?<![a-z0-9])(?:\\d{1,2}\\s*k|k)(?:金)?(?![a-z0-9])|黄金|足金|纯金|铂金|白金|纯银|足银|925银|银饰|翡翠|和田玉|钻石|天然|真金|真银|金(?!色|黄色|属)|银(?!色|白色))';
const MATERIAL_ANY_SOURCE='(?:'+BASE_MATERIAL_SOURCE+'|'+MATERIAL_WORDS.source+')';
const MATERIAL_AT=new RegExp(MATERIAL_ANY_SOURCE,'iy');
const supply = {现货:'in_stock',需订货:'order_only',仅供参考:'reference_only'};
const availabilityValues = new Set(['unknown','in_stock','order_only','reference_only']);
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
const categoryOf=value=>Object.keys(categories).find(key=>categories[key].includes(normalize(value)))||'';
const lexicon = [
  ...Object.entries(categories).flatMap(([key,aliases])=>aliases.map(word=>({word:normalize(word),key,type:'category'}))),
  ...Object.entries(features).flatMap(([key,aliases])=>aliases.map(word=>({word:normalize(word),key,type:'feature'}))),
  ...Object.entries(supply).map(([word,key])=>({word,key,type:'availability'})),
].sort((a,b)=>b.word.length-a.word.length);
const negatives=['不想要','不喜欢','不要','不想','不带','不含','排除','避开','别带','别要','没有','无'];
const fillers=/帮我推荐|给我推荐|推荐|帮我|给我|客户想要|客户要看|客户想看|给客户看看|给客户看|给客户|发给客户看|发给|麻烦找|麻烦|想找|想选|样子|请帮我找|帮我找|给我看|我想看|我想要|想要|想看|要看|看看|找一下|找一些|来几张|有没有|上面有|表面有|带有|造型|形状|上面|一些|一点|一下|几款|几张|一款|一条|一对|一个|适合|风格|款式|首饰|图片|照片|那种|这种|同时|而且|以及|但是|最好|需要|佩戴|或许|或是|客户|我|请|找|看|要|带|戴|有|的|款|和|与|及|且/g;

function hasUnsupportedAlternative(query){
  const text=normalize(query).replace(/或许/g,' ');
  if(/或者|还是|二选一|任选/.test(text))return true;
  const hasCondition=part=>part.replace(fillers,' ').replace(/[\s，。；,;！？!?、]/g,'').length>0;
  return [...text.matchAll(/或(?:是)?/g)].some(match=>hasCondition(text.slice(0,match.index))&&hasCondition(text.slice(match.index+match[0].length)));
}

// Inspect before removing unverified material words so their negator cannot
// accidentally move onto a following product category.
function hasNegatedMaterial(text){
  let negative=false;
  for(let i=0;i<text.length;){
    const tail=text.slice(i),neg=[...negatives,'不是'].find(n=>tail.startsWith(n));
    if(neg){negative=true;i+=neg.length;continue;}
    if(/^[，。；,;！？!?、\n的]|^(?:想看|想要|要看|需要|但是|但|要)/.test(tail))negative=false;
    if(negative){MATERIAL_AT.lastIndex=i;if(MATERIAL_AT.test(text))return true;}
    i++;
  }
  return false;
}

function parse(query,categoryFilter){
  const warnings=[];
  let text=normalize(query).replace(/不一定(?:要|是)?现货|不要求现货|不限现货/g,' ').replace(/有没有/g,' ');
  // Absence is a recorded visible feature, not a negated product category.
  text=text.replace(/圆圈耳环|圈形耳环/g,'耳圈');
  if(/日常/.test(text)){warnings.push('日常佩戴适配未验证，仅作为软偏好，不作为筛选硬条件');text=text.replace(/日常(?:佩戴|戴)?/g,' ');}
  if(/珍珠/.test(text))warnings.push('珍珠请求仅按珠饰外观检索，真实珍珠材质未核实');
  const material=new RegExp(MATERIAL_ANY_SOURCE,'gi');
  if(hasNegatedMaterial(text))return{terms:[],warnings:['材质无法核实，先按款式查找或人工确认'],blocked:true};
  if(material.test(text)){warnings.push('材质要求未核实，结果不能证明真实材质');text=text.replace(material,' ');}
  const amount='\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:\\s*[-~到至]\\s*\\d+(?:,\\d{3})*(?:\\.\\d+)?)?';
  const price=new RegExp('(?:预算|价格|价位|售价)\\s*'+amount+'\\s*(?:元|块|rmb)?(?:以内|以下|以上|左右)?|'+amount+'\\s*(?:元|块|rmb)(?:以内|以下|以上|左右)?|便宜|实惠|昂贵|低价|高价|价格|预算','g');
  if(price.test(text)){warnings.push('价格要求未核实，未按价格筛选');text=text.replace(price,' ');}
  const terms=[],residual=[];let negative=false,negativeFeature=false,requiresAbsence=false,literalTail='';
  for(let i=0;i<text.length;){
    const tail=text.slice(i),neg=negatives.find(n=>tail.startsWith(n));
    if(neg){negative=true;negativeFeature=false;literalTail='';requiresAbsence=['无','没有','不带','不含'].includes(neg);i+=neg.length;continue;}
    if(/^[，。；,;！？!?、\n]/.test(tail)){negative=false;negativeFeature=false;literalTail='';requiresAbsence=false;residual.push({text:' ',negative,requiresAbsence});i++;continue;}
    if(tail.startsWith('的')||/^(?:想看|想要|要看|需要|但是|但|要)/.test(tail)){negative=false;negativeFeature=false;literalTail='';requiresAbsence=false;}
    const term=lexicon.find(t=>tail.startsWith(t.word));
    if(term){
      // An unrecognized visible feature is still the object of its negator.
      // It must not turn the following product category into an exclusion.
      if(negative&&literalTail.replace(fillers,' ').trim())negativeFeature=true;
      literalTail='';
      const negated=negative&&!(term.type==='category'&&negativeFeature);
      const subtype=term.type==='category'&&['耳钉','耳坠','耳圈'].includes(term.word);
      if(!(subtype&&negated))terms.push({...term,negative:negated,requiresAbsence:negated&&requiresAbsence});
      // Earring subtypes also constrain visible labels; generic 耳环 stays broad.
      if(subtype)terms.push({type:'feature',key:term.word,word:term.word,negative:negated,requiresAbsence:negated&&requiresAbsence});
      if(term.type!=='category'&&negative)negativeFeature=true;
      i+=term.word.length;residual.push({text:' ',negative,requiresAbsence});continue;
    }
    literalTail+=text[i];residual.push({text:text[i++],negative,requiresAbsence});
  }
  const runs=[];
  for(const part of residual){const last=runs.at(-1);if(last&&last.negative===part.negative&&last.requiresAbsence===part.requiresAbsence)last.text+=part.text;else runs.push({...part});}
  for(const run of runs){
    const unknown=run.text.replace(fillers,' ').split(/[\s，。；,;！？!?、/]+/).filter(Boolean);
    for(const word of unknown)terms.push({word,key:word,type:'literal',negative:run.negative,requiresAbsence:run.negative&&run.requiresAbsence});
  }
  const hasCarrier=['项链','手链'].includes(categoryFilter)||terms.some(t=>t.type==='category'&&!t.negative&&['项链','手链'].includes(t.key));
  for(const term of terms){
    if(term.type==='feature'&&['无吊坠','无吊饰'].includes(term.key)){term.key='吊饰';term.negative=true;term.requiresAbsence=true;}
    if((hasCarrier||(term.negative&&term.requiresAbsence))&&term.type==='category'&&term.key==='吊坠'){term.type='feature';term.key='吊饰';}
  }
  return{terms,warnings};
}
const vocabulary=lexicon.filter(x=>x.type==='feature');
const evidenceSafe=value=>typeof value==='string'&&value.length>0&&value.length<=40&&!/[\x00-\x1f\\/]|[a-z]:|\.(?:avif|bmp|gif|heic|jpe?g|png|svg|tiff?|webp)(?:\b|$)/i.test(normalize(value));
function tagFacts(asset){
  const facts=[];
  for(const rawValue of Array.isArray(asset.tags)?asset.tags:[]){
    const value=typeof rawValue==='string'?rawValue.replace(/\t/g,' '):rawValue;
    if(!evidenceSafe(value))continue;
    const tag=normalize(value);
    if(/不确定|待确认|待核实|开闭口|或者|是否/.test(tag))continue;
    let polarity='present',unknown='',pendingNegation=false;
    const add=(type,key,state=polarity)=>{facts.push({type,key,polarity:state,value});pendingNegation=false;};
    const flush=()=>{for(const part of unknown.replace(/造型|形状|设计/g,' ').split(/[\s，,、]+/).filter(Boolean))if(!['带','有','的','和','与','及','且','并'].includes(part))add('literal',part);unknown='';};
    for(let i=0;i<tag.length;){
      // Whitespace may separate a negator from its target; it ends the scope
      // only after a feature has actually been recorded.
      if(/\s/.test(tag[i])){flush();if(!pendingNegation)polarity='present';i++;continue;}
      if(/[，。；,;！？!?、]/.test(tag[i])){flush();if(pendingNegation)break;polarity='present';i++;continue;}
      const neg=['没有','不带','不含','无'].find(n=>tag.startsWith(n,i));
      if(neg){flush();if(pendingNegation)break;polarity='absent';pendingNegation=true;i+=neg.length;continue;}
      MATERIAL_AT.lastIndex=i;
      const materialPart=MATERIAL_AT.exec(tag);
      if(materialPart){flush();i+=materialPart[0].length;continue;}
      const found=vocabulary.find(x=>tag.startsWith(x.word,i));
      if(found){flush();if(['无吊坠','无吊饰'].includes(found.key))add('feature','吊饰','absent');else add('feature',found.key);i+=found.word.length;}
      else unknown+=tag[i++];
    }
    flush();
  }
  return facts;
}
function factMatches(asset,fact,term){
  return fact.type===term.type&&(fact.key===term.key||(term.type==='feature'&&term.key==='星形'&&['五角星','六角星'].includes(fact.key))||(term.type==='feature'&&term.key==='耳圈'&&categoryOf(asset.category)==='耳饰'&&fact.key==='圆环'));
}
export function searchAssets(assets,{query='',category='',availability='',limit=100,offset=0}={}){
  if(!Array.isArray(assets))throw new TypeError('素材列表无效');
  if(typeof query!=='string'||query.length>300)throw new TypeError('查询须为不超过300字的文字');
  if(typeof category!=='string'||(category&&!categoryOf(category)))throw new TypeError('分类无效');
  if(typeof availability!=='string'||(availability&&!availabilityValues.has(availability)))throw new TypeError('供货状态无效');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw new TypeError('分页参数无效：limit须为1至100，offset须为非负整数');
  if(hasUnsupportedAlternative(query))return{items:[],total:0,interpretation:'暂不支持或选条件，请分别查询各类款式。',diagnostics:[{code:'unsupported_alternative',message:'请将或选条件拆成分别查询。'}]};
  const {terms,warnings,blocked}=parse(query,categoryOf(category));
  if(blocked)return{items:[],total:0,interpretation:warnings.join('。'),diagnostics:[{code:'unverified_material',message:warnings.join('。')}]};
  if(category)terms.push({type:'category',key:categoryOf(category),word:categoryOf(category),negative:false});
  if(availability)terms.push({type:'availability',key:availability,word:availability,negative:false});
  const labels=[...new Set(terms.map(t=>(t.negative?'排除：':'')+(t.word==='珍珠'?'珠饰外观（材质未核实）':t.word)))];
  let interpretation=[labels.length?'标签条件：'+labels.join('、'):(query.trim()?'没有可核实的款式条件':'浏览全部已确认首饰素材'),...warnings,'按已登记的款式标签找图，供货以核实记录为准；未找到时可换种描述或补充标签。'].join('。');
  if(query.trim()&&!terms.length)return{items:[],total:0,interpretation,diagnostics:[]};
  const counts=new Map(),note=code=>counts.set(code,(counts.get(code)||0)+1);
  const filtered=[];
  for(const asset of assets){
    if(!asset||asset.status!=='imported')continue;
    const matchedEvidence=[];
    const metadata=terms.filter(t=>['category','availability'].includes(t.type));
    if(!metadata.every(term=>{
      const value=term.type==='category'?categoryOf(asset.category):(availabilityValues.has(asset.availability)?asset.availability:null);
      if(term.type==='availability'&&term.negative&&(value===null||value==='unknown')){note('missing_availability_evidence');return false;}
      const equal=value===term.key,ok=term.negative?!equal:equal;
      if(ok){
        matchedEvidence.push({field:term.type,value:value||null,queryTerm:term.word,match:term.negative?'excluded_other':'present'});
        // Confirmed order/reference states describe supply, never a stock count.
        if(term.type==='availability'&&term.negative&&term.key==='in_stock')note('supply_not_inventory');
      }
      return ok;
    }))continue;
    const facts=tagFacts(asset);let accepted=true;
    for(const term of terms.filter(t=>!['category','availability'].includes(t.type))){
      const relevant=facts.filter(f=>factMatches(asset,f,term)),present=relevant.filter(f=>f.polarity==='present'),absent=relevant.filter(f=>f.polarity==='absent');
      if(present.length&&absent.length){note('conflicting_feature_evidence');accepted=false;continue;}
      let evidence=[],match;
      if(term.requiresAbsence){
        if(!absent.length||present.length){note('missing_absence_evidence');accepted=false;continue;}
        evidence=absent;match='explicit_absence';
      }else if(term.negative){
        if(present.length){accepted=false;continue;}
        evidence=absent;match=absent.length?'explicit_absence':'not_recorded';if(!absent.length)note('unrecorded_exclusion');
      }else{
        if(!present.length){note('missing_feature_evidence');accepted=false;continue;}
        evidence=present;match='present';
      }
      if(evidence.length)for(const f of evidence)matchedEvidence.push({field:'tags',value:f.value,queryTerm:term.word,match});
      else matchedEvidence.push({field:'tags',value:null,queryTerm:term.word,match});
    }
    if(accepted)filtered.push({...asset,matchedTerms:labels,matchedEvidence});
  }
  const messages={unrecorded_exclusion:'普通排除只排除已记录的正特征，未记录不等于保证不存在。',missing_absence_evidence:'显式无特征条件缺少明确缺失标签，未知未视为满足。',conflicting_feature_evidence:'同一特征同时记录有与无，不能作为确定匹配。',missing_feature_evidence:'部分素材缺少要求的已登记特征，未自动放宽条件。',missing_availability_evidence:'供货状态未核实，未知状态不能证明有或没有现货。',supply_not_inventory:'非现货结果仅依据已确认供货分类，不代表实物库存数量。'};
  const diagnostics=[...counts].map(([code,count])=>({code,count,message:messages[code]}));
  interpretation+=[...counts.keys()].map(code=>messages[code]).join('');
  return{items:filtered.slice(offset,offset+limit),total:filtered.length,interpretation,diagnostics};
}
