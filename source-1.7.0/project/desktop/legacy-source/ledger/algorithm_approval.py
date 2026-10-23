"""Version-specific, two-person approval around the existing safe rule engine.

No arbitrary code/SQL execution, and no reimplementation of opaque pyc math.
Only approval inserts a new formula_sets version; history retains saved IDs.
"""
import hashlib
import json
import math
import uuid
from flask import Blueprint, request, jsonify, g, render_template, abort
from app import db
import repairs as r
import rule_engine as rules
bp=Blueprint('algorithm_approval',__name__)
SCHEMA='''
CREATE TABLE IF NOT EXISTS algorithm_proposals(
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, domain TEXT NOT NULL,
 base_id INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
 author_id TEXT NOT NULL, author_name TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL, reviewer_id TEXT, reviewer_name TEXT, review_note TEXT, reviewed_at TEXT, new_rule_id INTEGER,
 UNIQUE(author_id,request_id));
CREATE TABLE IF NOT EXISTS algorithm_events(
 id INTEGER PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES algorithm_proposals(id),
 action TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 content_hash TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS algorithm_events_no_update BEFORE UPDATE ON algorithm_events BEGIN SELECT RAISE(ABORT,'immutable algorithm event');END;
CREATE TRIGGER IF NOT EXISTS algorithm_events_no_delete BEFORE DELETE ON algorithm_events BEGIN SELECT RAISE(ABORT,'immutable algorithm event');END;
CREATE TRIGGER IF NOT EXISTS algorithm_final_no_update BEFORE UPDATE ON algorithm_proposals WHEN OLD.status!='pending' BEGIN SELECT RAISE(ABORT,'immutable final proposal');END;
CREATE TRIGGER IF NOT EXISTS algorithm_no_delete BEFORE DELETE ON algorithm_proposals BEGIN SELECT RAISE(ABORT,'retain algorithm history');END;
'''
def initialize(c):
 for sql in SCHEMA.split(';\n'):
  if sql.strip():c.execute(sql.strip().removesuffix(';'))
def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()
def actor_check(actor,manage=False):
 if not isinstance(actor,dict) or actor.get('access') not in (['manage'] if manage else ['operate','manage']) or not actor.get('staffId'):
  raise ValueError('需要财务系统'+('管理审批' if manage else '操作')+'权限。')
def trial(domain,steps,inputs):
 if set(inputs)!=set(rules.INPUTS[domain]):raise ValueError('试算输入字段与算法不一致。')
 for name,value in inputs.items():
  if name=='计薪方式':
   if value not in rules.MODES:raise ValueError('计薪方式无效。')
  elif isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or abs(value)>1e12:raise ValueError('试算输入必须为有限、合理的数字。')
 env=dict(inputs);allowed=set(inputs);result={}
 for name,text in steps:
  value=rules.evaluate(rules.parse(text,allowed),env)
  if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or abs(value)>1e15:raise ValueError('算法输出无效或超出范围。')
  result[name]=value;env[name]=value;allowed.add(name)
 return result
def public(row):
 value=dict(row);value['requestId']=value.pop('request_id');value['hash']=value.pop('content_hash');value['payload']=json.loads(value['payload']);return value
def submit(actor,input):
 actor_check(actor)
 if not isinstance(input,dict) or set(input)!={'requestId','domain','baseId','formulas','samples','reason'}:raise ValueError('算法申请参数无效。')
 try:uuid.UUID(input['requestId'])
 except (ValueError,TypeError):raise ValueError('申请编号无效。')
 domain=input['domain'];reason=input['reason']
 if domain not in rules.DEFAULTS or not isinstance(reason,str) or not reason.strip() or len(reason)>500:raise ValueError('请选择算法并填写修改理由。')
 rules.validate(domain,input['formulas'])
 samples=input['samples']
 if not isinstance(samples,list) or not 1<=len(samples)<=20:raise ValueError('至少提供一个、最多二十个试算样例。')
 with r.transaction() as c:
  initialize(c);base=rules.rule(domain,c=c)
  if base['id']!=input['baseId']:raise ValueError('当前算法版本已变化，请重新试算。')
  comparisons=[{'inputs':x,'before':trial(domain,base['formulas'],x),'after':trial(domain,input['formulas'],x)} for x in samples]
  payload={'domain':domain,'baseId':base['id'],'before':base['formulas'],'after':input['formulas'],'comparisons':comparisons,'reason':reason.strip()}
  checksum=digest(payload)
  previous=c.execute('SELECT * FROM algorithm_proposals WHERE author_id=? AND request_id=?',(actor['staffId'],input['requestId'])).fetchone()
  if previous:
   if previous['content_hash']!=checksum:raise ValueError('申请编号已用于其它内容。')
   return public(previous)
  identifier=str(uuid.uuid4());now=db.now_str()
  c.execute('INSERT INTO algorithm_proposals(id,request_id,domain,base_id,payload,content_hash,author_id,author_name,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(identifier,input['requestId'],domain,base['id'],encoded(payload),checksum,actor['staffId'],actor['name'],'pending',now))
  c.execute('INSERT INTO algorithm_events(proposal_id,action,actor_id,actor_name,content_hash,note,created_at) VALUES(?,?,?,?,?,?,?)',(identifier,'submit',actor['staffId'],actor['name'],checksum,reason,now))
  return public(c.execute('SELECT * FROM algorithm_proposals WHERE id=?',(identifier,)).fetchone())
def review(actor,identifier,input):
 actor_check(actor,manage=True)
 if not isinstance(input,dict) or set(input)!={'decision','hash','note'} or input['decision'] not in ('approve','reject') or not isinstance(input['note'],str) or not input['note'].strip() or len(input['note'])>500:raise ValueError('请填写审批决定和核对说明。')
 with r.transaction() as c:
  initialize(c);row=c.execute('SELECT * FROM algorithm_proposals WHERE id=?',(identifier,)).fetchone()
  if not row:raise ValueError('算法申请不存在。')
  if row['status']!='pending':raise ValueError('此申请已经处理，不能重复审批。')
  if row['author_id']==actor['staffId']:raise ValueError('不能审批自己编制的算法修改。')
  payload=json.loads(row['payload'])
  if input['hash']!=row['content_hash'] or digest(payload)!=row['content_hash']:raise ValueError('审批版本不一致，请重新打开并核对。')
  current=rules.rule(row['domain'],c=c)
  if input['decision']=='approve' and (current['id']!=row['base_id'] or encoded(current['formulas'])!=encoded(payload['before'])):raise ValueError('当前算法版本已更新，请退回后重新编制。')
  now=db.now_str();new_id=None
  if input['decision']=='approve':
   rules.validate(row['domain'],payload['after'])
   for sample in payload['comparisons']:
    if encoded(trial(row['domain'],payload['after'],sample['inputs']))!=encoded(sample['after']):raise ValueError('试算版本不一致。')
   new_id=c.execute('INSERT INTO formula_sets(domain,formulas,actor,created_at,reason) VALUES(?,?,?,?,?)',(row['domain'],encoded(payload['after']),actor['name'],now,'审批通过 '+identifier+'；'+payload['reason'])).lastrowid
  status='approved' if input['decision']=='approve' else 'rejected'
  c.execute('UPDATE algorithm_proposals SET status=?,reviewer_id=?,reviewer_name=?,review_note=?,reviewed_at=?,new_rule_id=? WHERE id=? AND status=?',(status,actor['staffId'],actor['name'],input['note'].strip(),now,new_id,identifier,'pending'))
  c.execute('INSERT INTO algorithm_events(proposal_id,action,actor_id,actor_name,content_hash,note,created_at) VALUES(?,?,?,?,?,?,?)',(identifier,status,actor['staffId'],actor['name'],row['content_hash'],input['note'].strip(),now))
  detail={'actor':actor['name'],'staffId':actor['staffId'],'table':'algorithm_proposals','id':identifier,'before':dict(row),'after':{'version':new_id,'reviewer':actor['name'],'hash':row['content_hash'],'note':input['note']}}
  c.execute('INSERT INTO audit_logs(action,detail,at) VALUES(?,?,?)',('算法审批：'+status,encoded(detail),now))
  return public(c.execute('SELECT * FROM algorithm_proposals WHERE id=?',(identifier,)).fetchone())
def events(identifier):return[dict(x) for x in db.query('SELECT * FROM algorithm_events WHERE proposal_id=? ORDER BY id',(identifier,))]
def catalog():
 return[{'domain':key,'title':rules.TITLES[key],'inputs':rules.INPUTS[key],'current':rules.rule(key)} for key in rules.DEFAULTS]
def get_actor():
 actor=getattr(g,'_xjy_actor',None)
 if not actor:abort(403,description='算法操作需要主程序授权会话。')
 return actor
@bp.get('/algorithms')
def page():
 actor=get_actor()
 return render_template('algorithm-approval.html',catalog=catalog(),proposals=[public(x) for x in db.query('SELECT * FROM algorithm_proposals ORDER BY created_at DESC LIMIT 100')],actor=actor)
@bp.get('/algorithms/api')
def listing():
 get_actor();return jsonify(ok=True,catalog=catalog(),proposals=[public(x) for x in db.query('SELECT * FROM algorithm_proposals ORDER BY created_at DESC LIMIT 100')])
@bp.post('/algorithms/proposals')
def propose_api():
 try:return jsonify(ok=True,proposal=submit(get_actor(),request.get_json()))
 except (ValueError,TypeError,KeyError,ZeroDivisionError,OverflowError) as exc:return jsonify(ok=False,error=str(exc)),400
@bp.post('/algorithms/trial')
def trial_api():
 try:
  actor_check(get_actor());value=request.get_json()
  if not isinstance(value,dict) or set(value)!={'domain','baseId','formulas','samples'} or value['domain'] not in rules.DEFAULTS:raise ValueError('试算参数无效。')
  domain=value['domain'];base=rules.rule(domain)
  if base['id']!=value['baseId']:raise ValueError('算法版本已变化，请重新载入。')
  rules.validate(domain,value['formulas'])
  if not isinstance(value['samples'],list) or not 1<=len(value['samples'])<=20:raise ValueError('试算样例数量无效。')
  comparisons=[{'inputs':x,'before':trial(domain,base['formulas'],x),'after':trial(domain,value['formulas'],x)} for x in value['samples']]
  return jsonify(ok=True,comparisons=comparisons)
 except (ValueError,TypeError,KeyError,ZeroDivisionError,OverflowError) as exc:return jsonify(ok=False,error=str(exc)),400
@bp.post('/algorithms/proposals/<identifier>/review')
def review_api(identifier):
 try:return jsonify(ok=True,proposal=review(get_actor(),identifier,request.get_json()))
 except (ValueError,TypeError,KeyError) as exc:return jsonify(ok=False,error=str(exc)),400
def configure(app):
 with app.app_context(),r.transaction() as c:initialize(c)
 app.register_blueprint(bp)
 @app.context_processor
 def finance_brand():return {'APP_NAME':'鑫金源珠宝财务系统'}
 @app.before_request
 def prevent_direct_rule_changes():
  if request.endpoint=='enhanced.rule_page' and request.method=='POST' and request.form.get('act')=='save':
   return jsonify(ok=False,error='算法修改必须经算法检查窗口提交并由另一位管理人员审批。'),403
