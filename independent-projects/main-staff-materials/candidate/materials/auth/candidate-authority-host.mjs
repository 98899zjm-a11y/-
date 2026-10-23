import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createLocalAuthAuthority,checkRequestOrigin,validateOrigin,MaterialAuthError} from './lib/access-adapter.mjs';
const require=createRequire(import.meta.url);
const {createAuth}=require('./vendor/desktop/local-auth.cjs');
const {createAdministration}=require('./vendor/desktop/administration.cjs');
const cookieName='xjy_materials_candidate_session';
const error=(status,code,message)=>{throw new MaterialAuthError(status,code,message);};
const validLevels=['disabled','view','operate','manage'];
const opaque=()=>randomBytes(32).toString('hex');
function respond(res,status,data,cookie){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...(cookie?{'set-cookie':cookie}: {})});res.end(JSON.stringify(data));}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192)error(413,'BODY_TOO_LARGE','账号请求过大');chunks.push(chunk);}try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}catch{error(400,'INVALID_BODY','账号请求格式无效');}}
export function createCandidateAuthorityHost({origin,accounts=[],clock=Date.now}={}){
  validateOrigin(origin);if(!Array.isArray(accounts)||accounts.length>20)throw TypeError('At most 20 synthetic accounts');
  // Intentionally memory-only. No caller-supplied database path can open production.
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`CREATE TABLE staff_users(id TEXT PRIMARY KEY,user_id TEXT UNIQUE,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY REFERENCES staff_users(id),username TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE audit_logs(id TEXT PRIMARY KEY,entity_type TEXT,entity_id TEXT,action TEXT,actor_id TEXT,actor_name TEXT,old_value TEXT,new_value TEXT,created_at TEXT);`);
  sqlite.exec(readFileSync(new URL('./vendor/desktop/migrations/0012_cashier_module_permissions.sql',import.meta.url),'utf8'));
  const runtime={sqlite},administration=createAdministration({runtime,clock}),seed=createAuth(runtime,{administration,clock});
  seed.setup({username:'candidate_seed_admin',password:opaque(),name:'隔离样机初始化'});
  const users=new Map();let closed=false;
  try{for(const account of accounts){if(!validLevels.includes(account.level))throw TypeError('Synthetic account level required');const user=seed.createUser({username:account.username,password:account.password,name:account.name||'虚构员工',role:'employee'});users.set(account.username,user.id);administration.updatePermissions(seed.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>seed.listUsers());}}catch(e){sqlite.close();throw e;}
  const sessions=new Map();
  const cookie=id=>cookieName+'='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200';
  function find(req){const raw=req?.headers?.cookie;if(typeof raw!=='string'||raw.length>8192)return null;const matches=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));if(matches.length!==1)return null;const id=matches[0].slice(cookieName.length+1);if(!/^[a-f0-9]{64}$/.test(id))return null;const session=sessions.get(id);if(!session||!session.live)return null;if(clock()-session.createdAt>12*60*60*1000){session.auth.logout();session.live=false;sessions.delete(id);return null;}return session;}
  function createSession(){for(const [id,s]of sessions){if(clock()-s.createdAt>12*60*60*1000){s.auth.logout();s.live=false;sessions.delete(id);}}if(sessions.size>=100)error(429,'SESSION_LIMIT','候选会话已满，请稍后重试');const s={id:opaque(),csrf:opaque(),live:true,createdAt:clock(),auth:createAuth(runtime,{administration,clock})};s.authority=createLocalAuthAuthority({auth:s.auth,administration,isLive:()=>!closed&&s.live&&sessions.get(s.id)===s});sessions.set(s.id,s);return s;}
  function resolveAuthority(req){if(closed)return null;return find(req)?.authority||null;}
  async function handle(req,res){const pathname=new URL(req.url,origin).pathname;if(!pathname.startsWith('/staff-auth/'))return false;try{if(closed)error(503,'HOST_CLOSED','候选登录服务已关闭');const write=req.method==='POST';checkRequestOrigin(req,origin,{write});if(req.method==='GET'&&pathname==='/staff-auth/status'){let session=find(req);const fresh=!session;if(!session)session=createSession();const status=session.auth.status();respond(res,200,{authenticated:status.authenticated,user:status.user?{name:status.user.name,username:status.user.username,level:status.user.moduleAccess.sales}:null,authCsrfToken:session.csrf,candidate:true},fresh?cookie(session.id):undefined);return true;}
      if(req.method!=='POST'||!['/staff-auth/login','/staff-auth/logout'].includes(pathname))error(404,'AUTH_ROUTE_UNKNOWN','未找到此账号操作');const session=find(req);if(!session)error(401,'LOGIN_CONTEXT_REQUIRED','请先打开登录页面');const token=req.headers['x-auth-csrf-token'];if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(session.csrf)))error(403,'AUTH_CSRF_INVALID','登录页面凭证已失效，请刷新');
      if(pathname==='/staff-auth/logout'){session.auth.logout();session.live=false;sessions.delete(session.id);respond(res,200,{authenticated:false},cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return true;}
      if(req.headers['content-type']?.split(';')[0]!=='application/json')error(415,'JSON_REQUIRED','登录请求需JSON');const input=await body(req);if(Object.keys(input).some(k=>!['username','password'].includes(k)))error(400,'LOGIN_FIELDS_INVALID','登录仅接收账号和密码');const status=session.auth.login(input);sessions.delete(session.id);session.id=opaque();session.csrf=opaque();sessions.set(session.id,session);respond(res,200,{authenticated:true,user:{name:status.user.name,username:status.user.username,level:status.user.moduleAccess.sales},authCsrfToken:session.csrf,candidate:true},cookie(session.id));return true;
    }catch(e){respond(res,[400,401,403,404,409,413,415,429,503].includes(e.status)?e.status:503,{error:e.status?e.message:'候选账号服务暂不可用',code:e.code||'AUTH_FAILED'});return true;}}
  return Object.freeze({handle,resolveAuthority,close(){if(closed)return;for(const s of sessions.values()){s.auth.logout();s.live=false;}sessions.clear();seed.logout();closed=true;sqlite.close();},testControl:Object.freeze({setGrant(username,level){if(!validLevels.includes(level)||!users.has(username))throw TypeError('Unknown synthetic account/grant');return administration.updatePermissions(seed.status().user,{staffId:users.get(username),moduleAccess:{sales:level}},()=>seed.listUsers());},setActive(username,active){return seed.updateUser({id:users.get(username),active});},setPassword(username,password){return seed.updateUser({id:users.get(username),password});}})});
}
