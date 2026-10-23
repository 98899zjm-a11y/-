import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const levels=['disabled','view','operate','manage'];
const authorities=new WeakSet();
export class MaterialAuthError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const reject=(status,code,message)=>{throw new MaterialAuthError(status,code,message);};
export function validateOrigin(origin){const parsed=new URL(origin);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port||parsed.username||parsed.password||parsed.origin!==origin)throw TypeError('Explicit loopback HTTP origin required');return parsed;}
export function checkRequestOrigin(req,origin,{write=false}={}){const target=validateOrigin(origin);const h=req?.headers||{};if(h.host!==target.host||h.origin&&h.origin!==origin||h['sec-fetch-site']==='cross-site'||write&&h.origin!==origin)reject(403,'ORIGIN_REJECTED','仅允许当前主系统候选页面访问');}
export function createLocalAuthAuthority({auth,administration,isLive}={}){
  if(typeof auth?.status!=='function'||typeof administration?.requireAccess!=='function'||typeof isLive!=='function')throw TypeError('Server-owned auth, administration and lifecycle callback required');
  const authority=Object.freeze({read(required='view'){
    if(!['view','operate','manage'].includes(required))throw TypeError('Invalid required level');
    try{
      if(!isLive())reject(401,'SESSION_ENDED','账号会话已结束，请重新登录');
      const status=auth.status(),user=status?.user,sessionRef=auth.sessionId;
      if(status?.authenticated!==true||user?.active!==true||typeof user.id!=='string'||!user.id||typeof sessionRef!=='string'||!sessionRef)reject(401,'LOGIN_REQUIRED','请先登录员工账号');
      const grants=administration.requireAccess(user,'sales',required),level=grants?.moduleAccess?.sales;
      if(!levels.includes(level)||levels.indexOf(level)<levels.indexOf(required))reject(403,'ACCESS_DENIED','当前账号没有此素材操作权限');
      if(!Number.isSafeInteger(grants.grantRevision)||grants.grantRevision<1)reject(403,'GRANT_INVALID','权限资料无效，请联系管理员');
      if(!isLive()||auth.sessionId!==sessionRef)reject(401,'SESSION_CHANGED','账号会话已更换，请刷新页面');
      return Object.freeze({staffId:user.id,userId:user.userId??null,sessionRef,level,grantRevision:grants.grantRevision});
    }catch(error){if(error instanceof MaterialAuthError)throw error;if(error.status===401||error.status===403)reject(error.status,error.status===401?'LOGIN_REQUIRED':'ACCESS_DENIED',error.status===401?'请先登录员工账号':'当前账号没有此素材操作权限');reject(503,'AUTHORITY_UNAVAILABLE','账号权限暂不可核实，操作未授权');}
  }});authorities.add(authority);return authority;
}
const hash=value=>createHash('sha256').update(value).digest();
export function createMaterialAccessAdapter({resolveAuthority=()=>null,origin,ttlMs=30*60*1000,clock=Date.now}={}){
  validateOrigin(origin);if(typeof resolveAuthority!=='function'||typeof clock!=='function'||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>60*60*1000)throw TypeError('Invalid access adapter options');
  const credentials=new WeakMap();
  async function owned(req){let authority;try{authority=await resolveAuthority(req);}catch{reject(503,'AUTHORITY_UNAVAILABLE','账号权限暂不可核实');}if(!authority||!authorities.has(authority))reject(401,'LOGIN_REQUIRED','请先登录员工账号');return authority;}
  function assertCredential(authority,current,token,record){if(!record||credentials.get(authority)!==record||clock()>=record.expiresAt||current.sessionRef!==record.sessionRef||current.staffId!==record.staffId||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(hash(token),record.tokenHash))reject(401,'CREDENTIAL_EXPIRED','页面凭证已失效，请刷新或重新登录');}
  return Object.freeze({
    async bootstrap(req){checkRequestOrigin(req,origin);if(req.method!=='GET')reject(405,'METHOD_REJECTED','不支持此操作');const authority=await owned(req),current=authority.read('view'),csrfToken=randomBytes(32).toString('hex'),expiresAt=clock()+ttlMs;credentials.set(authority,{staffId:current.staffId,sessionRef:current.sessionRef,tokenHash:hash(csrfToken),expiresAt});return {csrfToken,permissions:{level:current.level,canView:true,canOperate:levels.indexOf(current.level)>=2,canManage:current.level==='manage'},expiresAt};},
    async authorize(req,{action,confirmed,evidence}={}){
      const required=new Map([['read','view'],['import','operate'],['edit','operate'],['retry','operate'],['availability','manage'],['review','manage']]).get(action);
      if(!required)reject(403,'ACTION_REJECTED','未知素材操作');const write=action!=='read';checkRequestOrigin(req,origin,{write});if(write?!['POST','PATCH'].includes(req.method):!['GET','HEAD'].includes(req.method))reject(405,'METHOD_REJECTED','不支持此操作');
      if(['availability','review'].includes(action)&&confirmed!==true)reject(400,'CONFIRMATION_REQUIRED','此修改需要明确确认');
      if(action==='availability'&&(typeof evidence!=='string'||!evidence.trim()||evidence.length>500))reject(400,'EVIDENCE_REQUIRED','请填写供货核实依据');
      const authority=await owned(req),initial=authority.read(required),record=credentials.get(authority),token=req.headers['x-csrf-token'];
      if(write||token!==undefined)assertCredential(authority,initial,token,record);
      const actor=current=>Object.freeze({staffId:current.staffId,userId:current.userId,level:current.level,grantRevision:current.grantRevision});
      const check=()=>{checkRequestOrigin(req,origin,{write});const current=authority.read(required);if(current.sessionRef!==initial.sessionRef||current.staffId!==initial.staffId)reject(401,'SESSION_CHANGED','账号会话已更换，请重新操作');if(write||token!==undefined)assertCredential(authority,current,token,record);return actor(current);};
      return Object.freeze({actor:actor(initial),check});
    }
  });
}
