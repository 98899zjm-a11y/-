'use strict';
// P0-5 build: employee-update-cache.cjs 的 nlink 放宽 + 缓存自愈，以及错误码直达界面。
// 只读源树：本脚本只把原始文件复制到 05-cache-selfheal/before/，再从副本派生 after/。
// 用法：  E:/node/node.exe tools/build.cjs
//
// 注意：下面 String.raw`...` 块里的内容会逐字节写进目标文件，所以续行不能缩进；
// 这样写的目的是让补丁正文不用做任何转义（目标代码里大量单引号、正则反斜杠）。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const W = path.resolve(__dirname, '..');
const P0 = path.resolve(W, '..');
const A3 = 'E:/codex/2026-10-15/work/xjy-v16-deep-audit/release-work/desktop170-application-source-a3/app';
const SHIPPED = 'D:/Codex/xjy-release-20261022/candidate/build/package/补丁文件/project/desktop';

const SOURCES = [
  { name: 'employee-update-cache.cjs', src: SHIPPED + '/employee-update-cache.cjs', sha: '5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815', ops: 'cache' },
  { name: 'employee-update-cache.app.cjs', src: A3 + '/employee-update-cache.cjs', sha: '4603e609bddb6e0d32cf0f5f8012abf3ba586f9b9666ce4ae026bdad0b991637', ops: 'cache' },
  { name: 'native-employee-update.cjs', src: A3 + '/native-employee-update.cjs', sha: '57a9b16a77bb27aab950f1ce8d90c0f9a5f00cac0a5626ef1adf1b8c751a660f', ops: 'native' },
  { name: 'native-publication-update.cjs', src: A3 + '/native-publication-update.cjs', sha: 'da751ddac6de7cdc7a8c85b0166f35a7e6aa4fbd1192ff0e50565b5600e93174', ops: 'publication' },
];

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function replaceOnce(text, find, replace, label) {
  const parts = text.split(find);
  if (parts.length !== 2) throw new Error(label + ': 锚点期望 1 次，实际 ' + (parts.length - 1) + ' 次 -> ' + JSON.stringify(find.slice(0, 80)));
  return parts[0] + replace + parts[1];
}

// ---------------------------------------------------------------- 修 1：nlink 放宽
// 现场：员工机缓存文件被同步盘/备份工具加了硬链接（nlink=2），assertPath 硬拒，
// 界面只能显示英文 Update object is not an ordinary single-link file，必须人工删目录。
const OP_CACHE = [];

OP_CACHE.push({
  label: 'fail 支持 detail',
  find: String.raw`function fail(code,message){const error=new Error(message);error.code=code;throw error;}`,
  replace: String.raw`function fail(code,message,detail){const error=new Error(message);error.code=code;if(detail!==undefined)error.detail=detail;throw error;}`,
});

OP_CACHE.push({
  label: 'assertPath 记录父目录 stat',
  find: String.raw` safeAbsolute(file);if(root)within(root,file);let target;`,
  replace: String.raw` safeAbsolute(file);if(root)within(root,file);let target,parent;`,
});

OP_CACHE.push({
  label: 'assertPath 循环里抓父目录',
  find: String.raw`  if(s){if(s.isSymbolicLink()||p!==file&&!s.isDirectory())fail('UNSAFE_PATH','Update path contains a link or non-directory');if(p===file)target=s;if(!samePath(await io.realpath(p),p))fail('UNSAFE_PATH','Update path alias rejected');}`,
  replace: String.raw`  if(s){if(s.isSymbolicLink()||p!==file&&!s.isDirectory())fail('UNSAFE_PATH','Update path contains a link or non-directory');if(p===file)target=s;else if(!parent&&p===path.dirname(file))parent=s;if(!samePath(await io.realpath(p),p))fail('UNSAFE_PATH','Update path alias rejected');}`,
});

OP_CACHE.push({
  label: 'nlink>1 改走可独占打开判定',
  find: String.raw` if(target){if(directory?!target.isDirectory():!target.isFile()||target.nlink!==1n)fail('UNSAFE_PATH','Update object is not an ordinary single-link file');}`,
  replace: String.raw` if(target){
  if(directory){if(!target.isDirectory())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-a-directory ino='+String(target.ino));}
  else{
   if(!target.isFile())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-a-file ino='+String(target.ino));
   if(target.nlink<1n)fail('UNSAFE_PATH','Update object is not an ordinary single-link file','nlink='+String(target.nlink)+' dev='+String(target.dev)+' ino='+String(target.ino));
   if(parent&&target.dev!==parent.dev)fail('UNSAFE_PATH','Update object is not an ordinary single-link file','cross-volume dev='+String(target.dev)+' parent-dev='+String(parent.dev));
   if(target.nlink>1n)await assertExclusiveRegularFile(io,target,file);
  }
 }`,
});

OP_CACHE.push({
  label: '新增 assertExclusiveRegularFile',
  find: String.raw`async function openChecked(io,file,flags='r',limits={}){`,
  replace: String.raw`// 单个文件的"可独占打开"判定。旧代码把 nlink!==1n 当硬拒绝，同步盘/备份工具（OneDrive、
// 坚果云、Veeam 等）给合法缓存文件加硬链接后，员工机就卡在 Update object is not an
// ordinary single-link file 上只能人工删缓存。放宽后仍不降安全性：
//  1) lstat 必须还是普通文件、不是符号链接/重解析点（assertPath 已判，这里复核）；
//  2) 必须与父目录同卷（dev 相同），排除目录联接/挂载点把文件换到别的卷上；
//  3) 必须以读写方式独占打开并 fsync 成功：Windows 上 fs.open(path,'r+') 需要 GENERIC_WRITE，
//     被别的进程占用、只读属性、删除挂起(del-pending)的文件都会打不开；打不开即判
//     被占用/被劫持，仍报 UNSAFE_PATH 原错误码，只是多带一个 detail 供日志取证。
// 可信任集合没有变大：打不开的文件照旧进不了后面的 hash 与序号校验。
async function assertExclusiveRegularFile(io,stat,file){
 const detail=()=>'nlink='+String(stat.nlink)+' dev='+String(stat.dev)+' ino='+String(stat.ino);
 if(stat.isSymbolicLink()||!stat.isFile())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-regular '+detail());
 let handle;try{handle=await io.open(file,'r+',0o600);}catch(e){fail('UNSAFE_PATH','Update object is not an ordinary single-link file','exclusive-open '+(e&&e.code||'FAILED')+' '+detail());}
 try{const opened=await handle.stat({bigint:true});if(!opened.isFile()||opened.isSymbolicLink()||statIdentity(opened)!==statIdentity(stat))fail('UNSAFE_PATH','Update object is not an ordinary single-link file','swapped '+detail()+' -> '+statIdentity(opened));if(typeof handle.sync==='function')await handle.sync();}catch(e){await handle.close().catch(()=>{});throw e;}
 await handle.close().catch(()=>{});return stat;
}
async function openChecked(io,file,flags='r',limits={}){`,
});

OP_CACHE.push({
  label: 'openChecked 同步放宽 nlink',
  find: String.raw`if(!opened.isFile()||opened.nlink!==1n||statIdentity(opened)!==statIdentity(after)`,
  replace: String.raw`if(!opened.isFile()||opened.nlink<1n||statIdentity(opened)!==statIdentity(after)`,
});

// ---------------------------------------------------------------- 修 2：缓存自愈
OP_CACHE.push({
  label: 'init 前插入 selfHeal',
  find: String.raw` async function init(){if(ready)return;await assertPath(io,profile,{directory:true});try{await io.mkdir(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await assertPath(io,root,{directory:true,root:profile});await integrityKey(io,profile,{create:true});ready=true;}`,
  replace: String.raw` // ---------------------------------------------------------------- cache self-heal
 // 现场故障：员工机缓存目录里留下异常残留（<root> 本身变成文件、stage 里 archive.zip
 // 变成目录、混进别的文件），旧代码一进来就 UNSAFE_PATH/BAD_METADATA，只能人工删目录。
 // 自愈原则：只隔离、不删除——可疑对象整体搬到 <profile>/employee-update-cache.repair-<ts>/
 // 里（<root> 本身坏了就改名成 <root>.broken-<ts>），留在原卷供取证，然后继续用干净的目录。
 // 为什么搬到 root 之外而不是就地改名：integrityKey() 在 key 缺失时要求 root 必须为空才能建
 // 新 key（否则 BAD_METADATA "Native integrity key missing from retained cache"），就地留
 // 一个隔离目录会让 key 永远建不出来，等于没自愈。
 // 安全边界：过不了原有断言（isFile/isSymbolicLink/realpath/路径前缀）的东西一律不信任、
 // 不复用；本函数不碰 .native-integrity-key、accepted-sequence.json、native-sequence.json，
 // 所以 hash、序号、防回滚这些安全结论完全不变。日志要等 key 建好之后才写进 root，
 // 否则自己那行 self-heal.log 会把"root 必须为空"卡死。
 const healLog=path.join(root,'self-heal.log'),KEEP_ENTRY=new Set(['.native-integrity-key','accepted-sequence.json','native-sequence.json','self-heal.log']);
 let healLines=[],healSafeLog=false,healBox=null;
 function healStamp(){return new Date().toISOString().replace(/[^0-9]/g,'');}
 function healEvent(action,original,target,note){healLines.push(new Date().toISOString()+' '+action+' '+original+' -> '+target+(note?' ('+note+')':''));}
 async function healExists(file){try{await io.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async function healMove(original,kind,note){
  if(!healBox){const base=path.join(profile,'employee-update-cache.repair-'+healStamp());let box=base,n=1;while(await healExists(box))box=base+'-'+n++;await io.mkdir(box,{mode:0o700});healBox=box;}
  const base=path.join(healBox,path.basename(original));let target=base,n=1;while(await healExists(target))target=base+'-'+n++;
  await io.rename(original,target);healEvent(kind,original,target,note);return target;
 }
 async function healFlush(){
  if(!healLines.length)return;const text=healLines.join('\n');healLines=[];
  if(!healSafeLog)return;
  try{const handle=await io.open(healLog,'a',0o600);try{await writeExactly(handle,0,Buffer.from(text+'\n'));await handle.sync();}finally{await handle.close();}}catch{}
 }
 async function selfHeal(reason){
  let s=null;try{s=await io.lstat(root,{bigint:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!s)return;
  if(s.isSymbolicLink()||!s.isDirectory()){
   let target=root+'.broken-'+healStamp();if(await healExists(target))target=target+'-'+Date.now();
   await io.rename(root,target);healEvent('broken',root,target,reason||'cache root is not a directory');
   await io.mkdir(root,{mode:0o700});return;
  }
  try{healSafeLog=(await io.lstat(path.join(root,'.native-integrity-key'),{bigint:true})).isFile();}catch(e){if(e.code!=='ENOENT')throw e;healSafeLog=false;}
  for(const name of await io.readdir(root)){
   if(KEEP_ENTRY.has(name))continue;
   const entry=path.join(root,name);let st;try{st=await io.lstat(entry,{bigint:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
   if(!UUID.test(name)||st.isSymbolicLink()||!st.isDirectory()){await healMove(entry,'entry','unexpected cache entry');continue;}
   let bad=null,items=[];try{items=await io.readdir(entry);}catch{bad='unreadable stage';}
   if(!bad)for(const item of items){if(item!=='archive.zip'&&item!=='sealed.json'){bad='unexpected file '+item;break;}let f;try{f=await io.lstat(path.join(entry,item),{bigint:true});}catch{bad='unreadable '+item;break;}if(f.isSymbolicLink()||!f.isFile()){bad=item+' is not a regular file';break;}}
   if(bad)await healMove(entry,'stage',bad);
  }
  await healFlush();
 }
 async function mkdirFresh(dir,mode,reason){try{await io.mkdir(dir,{mode});}catch(e){if(e.code!=='EEXIST')throw e;await selfHeal(reason);await io.mkdir(dir,{mode});}}
 async function init(){if(ready)return;await assertPath(io,profile,{directory:true});try{await io.mkdir(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;await selfHeal('cache root exists');}await assertPath(io,root,{directory:true,root:profile});await integrityKey(io,profile,{create:true});healSafeLog=true;await healFlush();ready=true;}`,
});

OP_CACHE.push({
  label: 'begin 的 mkdir 失败先自愈再重试一次',
  find: String.raw`await io.mkdir(dir,{mode:0o700});await assertPath(io,dir,{directory:true,root});`,
  replace: String.raw`await mkdirFresh(dir,0o700,'duplicate stage');await assertPath(io,dir,{directory:true,root});`,
});

OP_CACHE.push({
  label: '对外暴露 selfHeal',
  find: String.raw`  getAcceptedSequence:()=>enqueue(accepted),`,
  replace: String.raw`  getAcceptedSequence:()=>enqueue(accepted),
  // 手动自愈入口：上层遇到 UNSAFE_PATH/BAD_METADATA 时先清残留再重试一次，避免人工删目录。
  selfHeal:()=>enqueue(()=>selfHeal('manual')),`,
});

// ---------------------------------------------------------------- 修 3：错误码直达界面
const OP_NATIVE = [];

OP_NATIVE.push({
  label: '缓存类错误码补人话 + RECOVERABLE',
  find: String.raw` function fault(code){const e=new Error(messages[code]||'本机更新暂不可用，原程序保持不变。');e.code=code;lastFault=e;throw e;}`,
  replace: String.raw` // 这些码代表"本机缓存/文件状态坏了"，清掉残留再点一次就能好，上层据此自动重试一次。
 const RECOVERABLE=new Set(['UNSAFE_PATH','BAD_METADATA','BAD_STAGE','FILE_CHANGED']);
 function fault(code,detail){const e=new Error(messages[code]||'本机更新暂不可用，原程序保持不变。');e.code=code;if(detail)e.detail=detail;lastFault=e;throw e;}`,
});

OP_NATIVE.push({
  label: 'messages 增加缓存人话',
  find: String.raw`UPDATE_CLOSED:'本机更新入口已关闭。',`,
  replace: String.raw`UPDATE_CLOSED:'本机更新入口已关闭。',UNSAFE_PATH:'本机升级缓存异常，已自动重置，请再点一次“检查更新”。',BAD_METADATA:'本机升级缓存异常，已自动重置，请再点一次“检查更新”。',BAD_STAGE:'本机升级缓存异常，已自动重置，请再点一次“检查更新”。',FILE_CHANGED:'升级文件在读取期间发生变化，已停止本次升级，请再点一次。',`,
});

OP_NATIVE.push({
  label: 'unavailable 带 detail',
  find: String.raw` function unavailable(code){visible={phase:'unavailable',currentVersion,code,message:messages[code]||'本机更新暂不可用，原程序保持不变。'};return {ok:false,code,error:visible.message,state:{...visible}};}`,
  replace: String.raw` function unavailable(code,detail){visible={phase:'unavailable',currentVersion,code,message:messages[code]||'本机更新暂不可用，原程序保持不变。'};if(detail)visible.detail=detail;return {ok:false,code,detail,error:visible.message,state:{...visible}};}`,
});

OP_NATIVE.push({
  label: 'run 里声明 healed 标记',
  find: String.raw`busy=true;lastFault=null;`,
  replace: String.raw`busy=true;lastFault=null;let healed=false;`,
});

OP_NATIVE.push({
  label: 'run 对可恢复错误清缓存后重试一次',
  find: String.raw`try{await initialize();scope=await actor();const result=await controller.run(input);if(!result.ok)await cancelOwned();if(!result.ok&&lastFault){`,
  replace: String.raw`try{await initialize();scope=await actor();let result=await controller.run(input);if(!result.ok&&lastFault&&!healed&&RECOVERABLE.has(lastFault.code)){await cancelOwned();healed=true;let healError=null;if(typeof storage.selfHeal!=='function')healError=lastFault;else{try{await storage.selfHeal();}catch(error){healError=error;}}lastFault=healError;if(!lastFault){await initialize();scope=await actor();result=await controller.run(input);}}if(!result.ok)await cancelOwned();if(!result.ok&&lastFault){`,
});

OP_NATIVE.push({
  label: 'visible 带 detail',
  find: String.raw`visible={...result.state,phase:'error',code,message:messages[code]||'本机更新未完成，原程序保持不变。'};return {...result,code,error:visible.message,state:{...visible}};`,
  replace: String.raw`visible={...result.state,phase:'error',code,message:messages[code]||'本机更新未完成，原程序保持不变。'};if(lastFault&&lastFault.detail)visible.detail=lastFault.detail;return {...result,code,error:visible.message,state:{...visible}};`,
});

OP_NATIVE.push({
  label: 'catch 里把 detail 带出去',
  find: String.raw`return unavailable(error.code||initialError||'UPDATE_FAILED');`,
  replace: String.raw`return unavailable(error.code||initialError||'UPDATE_FAILED',error.detail);`,
});

const OP_PUBLICATION = [];

OP_PUBLICATION.push({
  label: '1.7.0 发布路径补人话映射',
  find: String.raw` const service={getCapability:async()=>{try{await guard();return{supported:true,canInstall:true,currentVersion:'1.7.0',message:'从主机下载完整更新并安全交给原生助手。'};}catch(e){return{supported:true,canInstall:false,currentVersion:'1.7.0',code:e.code,message:e.message};}}`,
  replace: String.raw` // 界面只认人话 + code；原始英文 message 留在 detail 里供日志取证，不吞掉原始 code。
 const humanMessages={UNSAFE_PATH:'本机升级缓存异常，请再点一次“检查更新”；仍失败请联系管理员。',BAD_METADATA:'本机升级缓存记录异常，请再点一次“检查更新”；仍失败请联系管理员。',BAD_STAGE:'本机升级缓存分块异常，请再点一次“检查更新”。',FILE_CHANGED:'升级文件在读取期间发生变化，已停止本次升级，请再点一次。'};
 const human=error=>({code:error.code||'NATIVE_UPDATE_FAILED',message:humanMessages[error.code]||error.message,detail:error.message});
 const service={getCapability:async()=>{try{await guard();return{supported:true,canInstall:true,currentVersion:'1.7.0',message:'从主机下载完整更新并安全交给原生助手。'};}catch(e){const h=human(e);return{supported:true,canInstall:false,currentVersion:'1.7.0',code:h.code,message:h.message,detail:h.detail};}}`,
});

OP_PUBLICATION.push({
  label: '1.7.0 失败态人话 + code + detail',
  find: String.raw`catch(e){set('error',e.message,{code:e.code||'NATIVE_UPDATE_FAILED'});return{ok:false,code:e.code||'NATIVE_UPDATE_FAILED',error:e.message,state:{...state}};}`,
  replace: String.raw`catch(e){const h=human(e);set('error',h.message,{code:h.code,detail:h.detail});return{ok:false,code:h.code,error:h.message,detail:h.detail,state:{...state}};}`,
});

const OPS = { cache: OP_CACHE, native: OP_NATIVE, publication: OP_PUBLICATION };

// ---------------------------------------------------------------- driver
const report = [];
fs.mkdirSync(path.join(W, 'before'), { recursive: true });
fs.mkdirSync(path.join(W, 'after'), { recursive: true });

for (const source of SOURCES) {
  const beforeFile = path.join(W, 'before', source.name);
  const afterFile = path.join(W, 'after', source.name);
  if (!fs.existsSync(beforeFile)) throw new Error('before/ 里缺少原始副本，先复制：' + source.name);
  const actual = sha256(beforeFile);
  if (actual !== source.sha) throw new Error(source.name + ': before/ 与记录的 sha256 不符 -> ' + actual);
  if (sha256(beforeFile + '.orig-seq22') !== source.sha) throw new Error(source.name + ': orig-seq22 备份与原件不一致');
  const before = fs.readFileSync(beforeFile, 'utf8');
  let after = before;
  for (const op of OPS[source.ops]) after = replaceOnce(after, op.find, op.replace, source.name + ' / ' + op.label);
  fs.writeFileSync(afterFile, after, 'utf8');
  execFileSync(process.execPath, ['--check', afterFile], { stdio: 'pipe' });
  report.push({ name: source.name, ops: OPS[source.ops].length, bytesBefore: before.length, bytesAfter: after.length, shaBefore: actual, shaAfter: sha256(afterFile) });
}

// app 变体与出厂补丁副本只能差 module.exports 那一行（05 不碰那一行）
{
  const a = fs.readFileSync(path.join(W, 'before', 'employee-update-cache.cjs'), 'utf8').split('\n');
  const b = fs.readFileSync(path.join(W, 'before', 'employee-update-cache.app.cjs'), 'utf8').split('\n');
  if (a.length !== b.length) throw new Error('两个 cache 变体行数不同');
  const diffLines = a.map((line, i) => (line === b[i] ? null : i + 1)).filter(Boolean);
  if (String(diffLines) !== '90') throw new Error('两个 cache 变体的差异行不是第 90 行: ' + diffLines);
}

// ---------------------------------------------------------------- diff.patch
let patch = '';
for (const source of SOURCES) {
  const label = `before/${source.name}`;
  const label2 = `after/${source.name}`;
  let out = '';
  try {
    out = execFileSync('diff', ['-u', '--label', label, '--label', label2, path.join(W, 'before', source.name), path.join(W, 'after', source.name)], { encoding: 'utf8' });
  } catch (error) {
    if (error.status !== 1) throw error;
    out = String(error.stdout || '');
  }
  fs.writeFileSync(path.join(W, source.name.replace(/\.cjs$/, '') + '.diff'), out, 'utf8');
  patch += out;
}
fs.writeFileSync(path.join(W, 'diff.patch'), patch, 'utf8');

// ---------------------------------------------------------------- 测试夹具
// 单测与夹具都留在交付目录里（05-cache-selfheal/tests/），整个目录可以单独拷走复跑。
const LIB = path.join(W, 'tests', 'lib');
fs.mkdirSync(LIB, { recursive: true });
fs.copyFileSync(path.join(P0, 'tests', 'lib', 'harness.cjs'), path.join(LIB, 'harness.cjs'));
for (const [variant, dir] of [['before', path.join(W, 'before')], ['after', path.join(W, 'after')]]) {
  const target = path.join(LIB, 'cache05-' + variant);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(dir, 'employee-update-cache.cjs'), path.join(target, 'employee-update-cache.cjs'));
}

// ---------------------------------------------------------------- 报告
for (const row of report) {
  console.log(`${row.name}\n  ops=${row.ops}  ${row.bytesBefore} -> ${row.bytesAfter} bytes\n  sha256 ${row.shaBefore}\n      -> ${row.shaAfter}`);
}
console.log(`\ndiff.patch ${patch.length} bytes, ${patch.split('\n').filter(l => l.startsWith('@@')).length} hunks`);
console.log('fixtures: tests/lib/cache05-before, tests/lib/cache05-after');
