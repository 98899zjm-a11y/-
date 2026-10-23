'use strict';
const {randomUUID}=require('node:crypto');
const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
function object(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))fail(400,'投票内容格式无效');return body;}
function text(value,max,required=false){if(value===undefined&&!required)return'';if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)||required&&!value.trim())fail(400,'题目或选项内容无效');return value.trim();}
function createWorkplacePolls({runtime,now=()=>Date.now()}){
 const db=runtime.sqlite,limits=new Map();
 db.exec(`CREATE TABLE IF NOT EXISTS workplace_polls(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,options TEXT NOT NULL,multiple INTEGER NOT NULL,status TEXT NOT NULL,ends_at TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(created_by) REFERENCES staff_users(id));
 CREATE TABLE IF NOT EXISTS workplace_poll_votes(poll_id TEXT NOT NULL,staff_id TEXT NOT NULL,option_ids TEXT NOT NULL,voted_at TEXT NOT NULL,PRIMARY KEY(poll_id,staff_id),FOREIGN KEY(poll_id) REFERENCES workplace_polls(id),FOREIGN KEY(staff_id) REFERENCES staff_users(id));
 CREATE INDEX IF NOT EXISTS workplace_polls_date ON workplace_polls(status,created_at);`);
 const iso=()=>new Date(now()).toISOString();
 function admin(user){if(user.role!=='admin')fail(403,'只有管理员可以设置投票或查看名单');}
 function transaction(action){db.exec('BEGIN IMMEDIATE');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function audit(user,id,action,before,after){db.prepare('INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),'workplace-poll',id,action,user.id,user.name||user.username||'员工',before===null?null:JSON.stringify(before),JSON.stringify(after),iso());}
 function row(id){const item=db.prepare('SELECT * FROM workplace_polls WHERE id=? AND status<>?').get(id,'deleted');if(!item)fail(404,'投票不存在或已归档');return item;}
 function expose(item,user){
  const options=JSON.parse(item.options),known=new Set(options.map(option=>option.id));
  const votes=db.prepare('SELECT staff_id,option_ids FROM workplace_poll_votes WHERE poll_id=?').all(item.id),counts=new Map(options.map(option=>[option.id,0]));let myVotes=[],totalVotes=0;
  for(const vote of votes){let ids;try{ids=JSON.parse(vote.option_ids);}catch{ids=[];}for(const id of ids)if(known.has(id)){counts.set(id,counts.get(id)+1);totalVotes++;}if(vote.staff_id===user.id)myVotes=ids.filter(id=>known.has(id));}
  const expired=Boolean(item.ends_at&&Date.parse(item.ends_at)<=now()),status=item.status==='open'&&!expired?'open':'closed';
  return{id:item.id,title:item.title,description:item.description,options:options.map(option=>({...option,votes:counts.get(option.id)})),multiple:Boolean(item.multiple),endsAt:item.ends_at,status,closedReason:expired?'expired':item.status==='closed'?'manual':null,totalVotes,voterCount:votes.length,myVotes,createdAt:item.created_at,createdBy:item.created_by};
 }
 function limited(user){const tick=now(),entry=limits.get(user.id);if(!entry||tick-entry.start>=60000){if(limits.size>2000)limits.delete(limits.keys().next().value);limits.set(user.id,{start:tick,count:1});return;}if(++entry.count>20)fail(429,'投票操作太频繁，请稍后重试');}
 function handle(user,input){
  if(!user?.id||user.active===false)fail(401,'请先登录工作台');
  const url=new URL(input.path,'http://offline.invalid'),method=String(input.method||'GET').toUpperCase();let data,status=200;
  if(url.pathname==='/api/polls'&&method==='GET'){
   const polls=db.prepare("SELECT * FROM workplace_polls WHERE status<>'deleted' ORDER BY created_at DESC LIMIT 100").all();data={polls:polls.map(item=>expose(item,user)),admin:user.role==='admin'};
  }else if(url.pathname==='/api/polls'&&method==='POST'){
   admin(user);limited(user);const body=object(input.body,['title','description','options','multiple','endsAt']),title=text(body.title,160,true),description=text(body.description,2000);
   if(!Array.isArray(body.options)||body.options.length<2||body.options.length>12||typeof body.multiple!=='boolean')fail(400,'请设置2—12个选项，并选择单选或多选');
   const optionTexts=body.options.map(value=>text(value,120,true));if(new Set(optionTexts).size!==optionTexts.length)fail(400,'投票选项不能重复');
   if(body.endsAt!==undefined&&body.endsAt!==null&&typeof body.endsAt!=='string')fail(400,'截止时间格式无效');
   let endsAt=null;if(body.endsAt){if(!/(Z|[+-]\d{2}:\d{2})$/.test(body.endsAt)||!Number.isFinite(Date.parse(body.endsAt))||Date.parse(body.endsAt)<=now())fail(400,'截止时间须晚于当前时间');endsAt=new Date(body.endsAt).toISOString();}
   const id=randomUUID(),options=optionTexts.map(value=>({id:randomUUID(),text:value})),at=iso();
   transaction(()=>{db.prepare('INSERT INTO workplace_polls(id,title,description,options,multiple,status,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,title,description,JSON.stringify(options),body.multiple?1:0,'open',endsAt,user.id,at,at);audit(user,id,'poll-create',null,{title,options:optionTexts,multiple:body.multiple,endsAt});});data={poll:expose(row(id),user)};status=201;
  }else{
   const match=/^\/api\/polls\/([a-f0-9-]{36})\/(vote|results|close|delete)$/.exec(url.pathname);if(!match)fail(404,'投票操作不存在');const id=match[1],action=match[2];
   if(action==='results'&&method==='GET'){
    admin(user);const poll=expose(row(id),user),voters=db.prepare('SELECT v.staff_id AS staffId,s.name,v.option_ids,v.voted_at AS votedAt FROM workplace_poll_votes v JOIN staff_users s ON s.id=v.staff_id WHERE v.poll_id=? ORDER BY v.voted_at').all(id).map(vote=>({staffId:vote.staffId,name:vote.name,optionIds:JSON.parse(vote.option_ids),votedAt:vote.votedAt}));data={poll,voters};
   }else if(action==='vote'&&method==='POST'){
    limited(user);const body=object(input.body,['optionIds']);if(!Array.isArray(body.optionIds)||!body.optionIds.length||body.optionIds.length>12||body.optionIds.some(value=>typeof value!=='string')||new Set(body.optionIds).size!==body.optionIds.length)fail(400,'请选择有效的投票选项');
    let changed=false;transaction(()=>{const poll=row(id);if(poll.status!=='open'||poll.ends_at&&Date.parse(poll.ends_at)<=now())fail(409,'投票已经结束');const options=JSON.parse(poll.options),known=new Set(options.map(option=>option.id));if(body.optionIds.some(value=>!known.has(value))||!poll.multiple&&body.optionIds.length!==1)fail(400,'所选选项不属于本投票');
     const selected=[...body.optionIds].sort(),previous=db.prepare('SELECT option_ids FROM workplace_poll_votes WHERE poll_id=? AND staff_id=?').get(id,user.id);if(previous&&JSON.stringify(JSON.parse(previous.option_ids).sort())===JSON.stringify(selected))return;
     db.prepare('INSERT INTO workplace_poll_votes(poll_id,staff_id,option_ids,voted_at) VALUES(?,?,?,?) ON CONFLICT(poll_id,staff_id) DO UPDATE SET option_ids=excluded.option_ids,voted_at=excluded.voted_at').run(id,user.id,JSON.stringify(selected),iso());changed=true;audit(user,id,'poll-vote',previous?{optionIds:JSON.parse(previous.option_ids)}:null,{title:poll.title,optionIds:selected});});data={poll:expose(row(id),user),changed};
   }else if(['close','delete'].includes(action)&&method==='POST'){
    admin(user);if(input.body!==undefined)object(input.body,[]);transaction(()=>{const poll=row(id);db.prepare('UPDATE workplace_polls SET status=?,updated_at=? WHERE id=?').run(action==='close'?'closed':'deleted',iso(),id);audit(user,id,'poll-'+action,{title:poll.title,status:poll.status},{title:poll.title,status:action==='close'?'closed':'deleted'});});data={id,closed:true};
   }else fail(405,'不支持此投票操作');
  }
  return{ok:true,status,data};
 }
 return{handle};
}
module.exports={createWorkplacePolls};
