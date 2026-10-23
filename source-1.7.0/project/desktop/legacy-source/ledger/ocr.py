"""Pure protected OCR candidates/imports. No Flask, process, path, or DB opener.

The trusted ERP adapter supplies owned attachment bytes, transactions and the
existing purchase creator. Recognition never submits/reviews a document.
"""
import datetime as dt
from decimal import Decimal
import hashlib
import json
import math
import os
import re
import base64
import hmac
import secrets
import threading
import time
import urllib.request
import urllib.error
import unicodedata
import uuid

ENGINE='windows.media.ocr/zh-Hans-CN/parser-v1'
CAPS={'erp.read','erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive'}
class OcrError(ValueError):
    def __init__(self,message,status=400):super().__init__(message);self.status=status
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(value):return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()
def call_broker(value):
    """Fixed authenticated loopback transport; never honors system proxies."""
    port=os.environ.get('XJY_MODULE_OCR_PORT','');token=os.environ.get('XJY_MODULE_OCR_TOKEN','')
    if not re.fullmatch(r'\d{4,5}',port)or not 1024<=int(port)<=65535 or int(port)==31831 or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}',token):raise OcrError('主机中文识别服务尚未配置，本次不会安装系统语言包',503)
    shape(value,{'version','op','mime','sha256','bodyBase64'},{'version','op'})
    if value['version']!=1 or value['op']not in ('probe','recognize'):raise OcrError('内部识别操作无效')
    raw=canonical(value).encode('utf-8')
    if len(raw)>3*1024*1024:raise OcrError('识别图像超出范围',413)
    stamp=str(int(time.time()*1000));nonce=secrets.token_urlsafe(24);request_id=str(uuid.uuid4())
    def mac(body,prefix):return hmac.new(token.encode(),prefix+stamp.encode()+b'\n'+nonce.encode()+b'\n'+request_id.encode()+b'\n'+hashlib.sha256(body).hexdigest().encode(),hashlib.sha256).hexdigest()
    request=urllib.request.Request('http://127.0.0.1:'+port+'/recognize',data=raw,headers={'Content-Type':'application/json','X-XJY-OCR-Time':stamp,'X-XJY-OCR-Nonce':nonce,'X-XJY-OCR-Request':request_id,'X-XJY-OCR-Signature':mac(raw,b'xjy-local-ocr-v1\0')},method='POST')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:response=opener.open(request,timeout=28)
    except urllib.error.HTTPError as error:response=error
    except Exception as error:raise OcrError('本机识别连接中断，未自动重试',503)from error
    with response:
        body=response.read(1048577);signature=response.headers.get('X-XJY-OCR-Response','')
    if len(body)>1048576 or not re.fullmatch(r'[a-f0-9]{64}',signature)or not hmac.compare_digest(mac(body,b'xjy-local-ocr-result-v1\0'),signature):raise OcrError('本机识别结果未通过签名或大小校验',503)
    try:data=json.loads(body)
    except ValueError as error:raise OcrError('本机识别结果格式无效',503)from error
    if not isinstance(data,dict)or data.get('ok')is not True:raise OcrError(str(data.get('error','主机未能识别此图片'))[:800]if isinstance(data,dict)else'本机识别失败',503)
    return data['result']
def identifier(value):
    try:valid=isinstance(value,str)and str(uuid.UUID(value))==value
    except (ValueError,TypeError,AttributeError):valid=False
    if not valid:raise OcrError('识别来源或请求编号无效')
    return value
def shape(value,keys,required=()):
    if not isinstance(value,dict)or set(value)-set(keys)or set(required)-set(value):raise OcrError('识别或核对字段不完整，不能使用任意路径、网址或授权标志')
    return value
def permitted(actor):
    if not isinstance(actor,dict)or actor.get('protocolVersion')!=2 or actor.get('access')not in ('operate','manage')or not actor.get('staffId')or not CAPS.issubset(set(actor.get('capabilities',[]))):raise OcrError('供货单图片含采购成本，须获采购制单、凭证上传和敏感财务权限',403)
    return actor
def text(value,maximum=500,required=False):
    if not isinstance(value,str):raise OcrError('核对文字格式无效')
    result=unicodedata.normalize('NFKC',value).strip()
    if len(result)>maximum or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]',result)or required and not result:raise OcrError('核对文字为空或过长')
    return result
def number(value,decimals,maximum):
    if not isinstance(value,str):return None
    raw=re.sub(r'\s+','',unicodedata.normalize('NFKC',value)).strip()
    raw=re.sub(r'^[￥¥]','',raw);raw=re.sub(r'(?:元|克|g|件)$','',raw)
    if ','in raw:
        if not re.fullmatch(r'\d{1,3}(?:,\d{3})+(?:\.\d{1,'+str(decimals)+r'})?',raw):return None
        raw=raw.replace(',','')
    pattern=r'\d{1,12}'+(r'(?:\.\d{1,'+str(decimals)+r'})?'if decimals else '')
    if not re.fullmatch(pattern,raw):return None
    try:d=Decimal(raw)
    except Exception:return None
    return raw if 0<=d<=maximum else None
def money(value):
    raw=number(value,2,Decimal('90000000000'))
    if raw is None:raise OcrError('金额须为已核对、不超过两位小数的非负十进制文本')
    return format(Decimal(raw),'.2f')
def weight(value):
    raw=number(value,4,Decimal('100000000'))
    if raw is None:raise OcrError('克重须为已核对、不超过四位小数的非负十进制文本')
    return format(Decimal(raw),'.4f')
def date(value):
    try:valid=isinstance(value,str)and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}',value))and dt.date.fromisoformat(value)
    except ValueError:valid=False
    if not valid:raise OcrError('日期须人工核对为有效年月日，不能猜测模糊字符')
    return value
def validate_result(value):
    shape(value,{'version','engine','language','osBuild','width','height','text','angle','lines','confidence'},{'version','engine','language','width','height','text','lines'})
    if value['version']!=1 or value['engine']!='windows.media.ocr'or value['language']!='zh-Hans-CN'or value.get('confidence')is not None:raise OcrError('识别引擎或置信度字段异常，Windows OCR不能伪造分数')
    w,h=value['width'],value['height']
    if type(w)is not int or type(h)is not int or not 1<=w<=10000 or not 1<=h<=10000 or w*h>16000000 or not isinstance(value['text'],str)or len(value['text'])>200000 or not isinstance(value['lines'],list)or len(value['lines'])>1000 or len(canonical(value).encode())>1048576:raise OcrError('识别结果超出安全范围')
    words=[]
    for line in value['lines']:
        shape(line,{'text','words'},{'text','words'})
        if not isinstance(line['text'],str)or not isinstance(line['words'],list):raise OcrError('识别行格式异常')
        for word in line['words']:
            shape(word,{'text','x','y','width','height'},{'text','x','y','width','height'})
            if not isinstance(word['text'],str)or len(word['text'])>10000 or any(type(word[k])not in (int,float)or not math.isfinite(word[k])or word[k]<0 for k in ('x','y','width','height'))or word['x']+word['width']>w+1 or word['y']+word['height']>h+1:raise OcrError('识别文字框越过原图边界')
            words.append(word)
            if len(words)>2000:raise OcrError('识别文字过多，请裁切单据')
    return words
def clusters(words):
    groups=[]
    for word in sorted(words,key=lambda x:(x['y']+x['height']/2,x['x'])):
        center=word['y']+word['height']/2;group=next((g for g in reversed(groups)if abs(g['y']-center)<=max(10,word['height']*.55)),None)
        if group is None:group={'y':center,'words':[]};groups.append(group)
        group['words'].append(word)
    for group in groups:group['words'].sort(key=lambda x:x['x'])
    return groups
def compact(value):return re.sub(r'\s+','',unicodedata.normalize('NFKC',value))
def readable(words):
    value=' '.join(unicodedata.normalize('NFKC',w['text'])for w in words)
    value=re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])','',value)
    return value.strip()
def extract_candidates(raw):
    groups=clusters(validate_result(raw));supplier=None;day=None;totals=[];header=None;anchors={};issues=[]
    labels={'description':['品名','商品名称','货品名称','产品名称'],'quantity':['件数','数量'],'estimatedWeight':['克重','重量','金重'],'unitPrice':['单价','每克价'],'amount':['金额','行合计']}
    for group in groups:
        joined='';positions=[]
        for word in group['words']:
            part=compact(word['text']);joined+=part;positions.extend([word['x']+word['width']/2]*len(part))
        match=re.match(r'^(?:供应商|供货商|供货单位|销货单位)[:：](.+)$',joined)
        if match:supplier=match[1]
        match=re.match(r'^(?:日期|开单日期|业务日期)[:：](.+)$',joined)
        if match:
            try:day=date(match[1])
            except OcrError:issues.append('日期字符不明确，请对照原图填写')
        match=re.match(r'^(?:合计(?:金额)?|总计|价税合计)[:：]?(.*)$',joined)
        if match:
            candidate=number(match[1],2,Decimal('90000000000'))
            if candidate is not None:totals.append(format(Decimal(candidate),'.2f'))
        found={}
        for key,aliases in labels.items():
            for label in aliases:
                index=joined.find(label)
                if index>=0:found[key]=positions[index];break
        if header is None and {'description','amount'}.issubset(found)and len(found)>=3:header=group;anchors=found
    total=totals[0]if totals and len(set(totals))==1 else None
    if len(set(totals))>1:issues.append('原图有多个不同合计，须人工确认')
    rows=[]
    if header:
        ordered=sorted(anchors,key=anchors.get);header_cells={key:[]for key in ordered}
        for word in header['words']:
            key=min(ordered,key=lambda k:abs(anchors[k]-(word['x']+word['width']/2)));header_cells[key].append(word)
        weight_header=compact(readable(header_cells.get('estimatedWeight',[])));price_header=compact(readable(header_cells.get('unitPrice',[])))
        grams=not re.search(r'kg|公斤|千克',weight_header,re.I)and('克重'in weight_header or'金重'in weight_header or bool(re.search(r'\(g\)|/g|\(克\)|/克',weight_header,re.I)))
        price_basis='per_gram'if bool(re.search(r'元/g|元/克',price_header,re.I))else'per_piece'if'元/件'in price_header else None
        for group in groups:
            if group['y']<=header['y']+10:continue
            joined=compact(' '.join(x['text']for x in group['words']))
            if re.match(r'^(?:合计|总计|价税合计)',joined):continue
            cells={key:[]for key in ordered}
            for word in group['words']:
                center=word['x']+word['width']/2;key=min(ordered,key=lambda k:abs(anchors[k]-center));cells[key].append(word)
            if not cells.get('description')or not any(cells.get(k)for k in ['amount','quantity','estimatedWeight']):continue
            strings={key:readable(value)for key,value in cells.items()};description=text(strings.get('description',''),300)
            q=number(strings.get('quantity',''),0,1000000);mass=number(strings.get('estimatedWeight',''),4,Decimal('100000000'))if grams else None;amount=number(strings.get('amount',''),2,Decimal('90000000000'));price=number(strings.get('unitPrice',''),4,Decimal('90000000000'))
            row={'id':'r'+str(len(rows)+1),'description':description or None,'material':'铂金'if'铂金'in description else '黄金'if'黄金'in description else None,'purity':None,'quantity':int(q)if q is not None and int(q)>0 else None,'estimatedWeight':format(Decimal(mass),'.4f')if mass is not None else None,'amount':format(Decimal(amount),'.2f')if amount is not None else None,'unitPrice':price,'priceBasis':price_basis,'sourceCells':strings,'confidence':None,'reviewRequired':True}
            purity=re.search(r'(?<![A-Za-z0-9])(?:Pt(?:900|950|999)|Au(?:750|999)|S925)(?![A-Za-z0-9])',description,re.I)
            if purity:row['purity']=purity[0]
            row['uncertain']=[k for k in ['description','material','purity','quantity','estimatedWeight','amount','unitPrice','priceBasis']if row.get(k)is None];rows.append(row)
            if len(rows)>100:raise OcrError('检测明细超过100行，请分张或裁切图片',413)
    else:issues.append('表格列未明确识别，请对照原图手工填写明细')
    return {'supplierName':supplier,'date':day,'invoiceTotal':total,'rows':rows,'issues':issues,'confidence':None,'reviewRequired':True}

def initialize(connection):
    connection.execute('''CREATE TABLE IF NOT EXISTS erp_ocr_imports(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,attachment_id TEXT NOT NULL,image_hash TEXT NOT NULL,engine TEXT NOT NULL,status TEXT NOT NULL,raw_json TEXT,result_hash TEXT,candidates_json TEXT,accepted_json TEXT,document_id TEXT,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(owner_id,request_id))''')
    connection.execute("UPDATE erp_ocr_imports SET status='failed',error='主机识别中断，未自动重试' WHERE status='processing'")

def evidence_for_document(connection,did):
    """Caller already passed exact document read plus sensitive-cost authority."""
    rows=connection.execute("SELECT * FROM erp_ocr_imports WHERE document_id=? AND status='draft' ORDER BY created_at DESC LIMIT 10",(did,)).fetchall();result=[]
    for item in rows:
        row=dict(item)
        try:
            raw=json.loads(row['raw_json']);accepted=json.loads(row['accepted_json']);validate_result(raw)
            metadata=connection.execute('SELECT sha256 FROM erp_attachments WHERE id=?',(row['attachment_id'],)).fetchone()
            valid=digest(raw)==row['result_hash']and metadata is not None and metadata['sha256']==row['image_hash']
            if not valid:raise ValueError('Changed evidence')
            result.append({'jobId':row['id'],'attachmentId':row['attachment_id'],'imageHash':row['image_hash'],'resultHash':row['result_hash'],'engine':row['engine'],'rawText':raw['text'],'accepted':accepted,'confidence':None,'valid':True})
        except (ValueError,TypeError,KeyError):result.append({'jobId':row['id'],'valid':False,'error':'原识别或原图摘要异常，须核对完整凭证，不能据此确认'})
    return result

class OcrImports:
    def __init__(self,*,transaction,load_attachment,recognize,create_purchase):
        self.transaction=transaction;self.load_attachment=load_attachment;self.recognize=recognize;self.create_purchase=create_purchase;self.lock=threading.Lock()
    def source(self,actor,aid,expected=None,connection=None):
        identifier(aid);source=self.load_attachment(actor,aid,connection=connection)if connection is not None else self.load_attachment(actor,aid)
        if not isinstance(source,dict)or source.get('id')!=aid or source.get('mime')not in ('image/png','image/jpeg')or not isinstance(source.get('body'),bytes)or not 1<=len(source['body'])<=2097152 or not re.fullmatch(r'[a-f0-9]{64}',source.get('sha256',''))or hashlib.sha256(source['body']).hexdigest()!=source['sha256']:raise OcrError('原图必须是现有、完整且与摘要相符的PNG/JPEG凭证')
        if expected is not None and source['sha256']!=expected:raise OcrError('原图已改变，不能沿用旧识别或核对结果',409)
        return source
    def record(self,actor,jid):
        permitted(actor);identifier(jid)
        with self.transaction()as c:
            row=c.execute('SELECT * FROM erp_ocr_imports WHERE id=?',(jid,)).fetchone()
            if row is None:raise OcrError('识别记录不存在',404)
            row=dict(row)
        if row['owner_id']!=actor['staffId']:raise OcrError('只能核对本人上传的供货单识别',403)
        self.source(actor,row['attachment_id'],row['image_hash'])
        if row['status']in ('ready','draft'):
            try:
                raw=json.loads(row['raw_json']);candidates=json.loads(row['candidates_json']);validate_result(raw)
                if digest(raw)!=row['result_hash']or row['engine']!=ENGINE or canonical(extract_candidates(raw))!=canonical(candidates):raise OcrError('原识别结果或候选字段完整性已改变，须重新核对来源',409)
            except (ValueError,TypeError,KeyError)as error:
                if isinstance(error,OcrError):raise
                raise OcrError('原识别记录损坏，不能生成采购草稿',409)from error
        return row
    def start(self,actor,value):
        permitted(actor);shape(value,{'requestId','attachmentId'},{'requestId','attachmentId'});identifier(value['requestId']);source=self.source(actor,value['attachmentId']);request_hash=digest({'attachmentId':source['id'],'imageHash':source['sha256'],'engine':ENGINE})
        with self.transaction()as c:
            prior=c.execute('SELECT * FROM erp_ocr_imports WHERE owner_id=? AND request_id=?',(actor['staffId'],value['requestId'])).fetchone()
            if prior:
                prior=dict(prior)
                if prior['request_hash']!=request_hash:raise OcrError('同一识别请求不能改换图片或内容',409)
                return {'jobId':prior['id'],'status':prior['status'],'reused':True}
            same=c.execute("SELECT id,status FROM erp_ocr_imports WHERE owner_id=? AND image_hash=? AND engine=? AND status IN ('processing','ready','draft') ORDER BY created_at DESC LIMIT 1",(actor['staffId'],source['sha256'],ENGINE)).fetchone()
            if same:return {'jobId':same['id'],'status':same['status'],'reused':True}
        if not self.lock.acquire(blocking=False):raise OcrError('主机正在识别另一张供货单，请稍后重试',429)
        jid=str(uuid.uuid4());now=dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            with self.transaction()as c:c.execute("INSERT INTO erp_ocr_imports(id,owner_id,request_id,request_hash,attachment_id,image_hash,engine,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'processing',?,?)",(jid,actor['staffId'],value['requestId'],request_hash,source['id'],source['sha256'],ENGINE,now,now))
            raw=self.recognize(source);validate_result(raw);candidates=extract_candidates(raw)
            with self.transaction()as c:c.execute("UPDATE erp_ocr_imports SET status='ready',raw_json=?,result_hash=?,candidates_json=?,updated_at=? WHERE id=? AND status='processing'",(canonical(raw),digest(raw),canonical(candidates),dt.datetime.now(dt.timezone.utc).isoformat(),jid))
            # Only this identifier is returned. A fresh authenticated GET must
            # pass current sensitive grants before any raw OCR/cost is exposed.
            return {'jobId':jid,'status':'ready','reused':False}
        except Exception as error:
            with self.transaction()as c:c.execute("UPDATE erp_ocr_imports SET status='failed',error=?,updated_at=? WHERE id=? AND status='processing'",(str(error)[:800],dt.datetime.now(dt.timezone.utc).isoformat(),jid))
            if isinstance(error,OcrError):raise
            raise OcrError('本机识别未完成；原凭证保留，未生成采购单',503)from error
        finally:self.lock.release()
    def get(self,actor,jid):
        row=self.record(actor,jid);return {'jobId':row['id'],'status':row['status'],'attachmentId':row['attachment_id'],'imageHash':row['image_hash'],'resultHash':row['result_hash'],'engine':row['engine'],'raw':json.loads(row['raw_json'])if row['raw_json']else None,'candidates':json.loads(row['candidates_json'])if row['candidates_json']else None,'documentId':row['document_id'],'error':row['error']}
    def reviewed_document(self,c,row,value):
        shape(value,{'requestId','imageHash','resultHash','document','review'},{'requestId','imageHash','resultHash','document','review'});identifier(value['requestId'])
        if value['imageHash']!=row['image_hash']or value['resultHash']!=row['result_hash']:raise OcrError('核对所依据的原图或识别版本已改变',409)
        doc=shape(value['document'],{'partyId','businessType','date','dueDate','note','lines'},{'partyId','businessType','date','dueDate','lines'})
        if not isinstance(doc['partyId'],str)or not re.fullmatch(r'SUP:[1-9][0-9]{0,18}',doc['partyId']):raise OcrError('采购识别草稿须选择原ERP供应商编号')
        supplier=c.execute('SELECT id,name,kind,active FROM erp_parties WHERE id=?',(doc['partyId'],)).fetchone()
        if supplier is None or supplier['kind']!='supplier'or not supplier['active']:raise OcrError('须人工选择当前有效供应商')
        if doc['businessType']not in ('own','consignment'):raise OcrError('须人工确认自有采购或寄售类型')
        day=date(doc['date']);due=date(doc['dueDate'])
        if due<day:raise OcrError('预计到货日不能早于采购日期')
        if not isinstance(doc['lines'],list)or not 1<=len(doc['lines'])<=100:raise OcrError('须核对1至100条采购明细')
        review=shape(value['review'],{'decisions','confirmedTotal','totalDifferenceReason','omittedRows'},{'decisions','confirmedTotal'})
        if not isinstance(review['decisions'],list)or len(review['decisions'])>804:raise OcrError('须提交完整逐字段核对记录，不能仅使用reviewed标志')
        decisions={}
        for decision in review['decisions']:
            shape(decision,{'path','action','reason'},{'path','action'});key=decision['path']
            if not isinstance(key,str)or key in decisions or decision['action']not in ('accept','manual','omit'):raise OcrError('核对字段重复或决定无效')
            reason=text(decision.get('reason',''),500)
            if decision['action']=='manual'and len(reason)<3:raise OcrError('人工修正或模糊字段须记录对照原图的核对说明')
            decisions[key]={'action':decision['action'],'reason':reason}
        candidates=json.loads(row['candidates_json']);original={x['id']:x for x in candidates['rows']};expected=set();used=set();lines=[];price_review=[]
        def checked(key,actual,candidate,optional=False):
            expected.add(key);decision=decisions.get(key)
            if not decision:raise OcrError('字段尚未核对：'+key)
            if decision['action']=='accept'and (candidate is None or actual!=candidate):raise OcrError('字段有改动或原识别不明确，须按人工修正记录：'+key)
            if decision['action']=='omit'and (not optional or actual not in ('',None)):raise OcrError('必要数量、克重、金额不能省略')
        checked('supplier',supplier['name'],candidates.get('supplierName'));checked('date',day,candidates.get('date'));checked('businessType',doc['businessType'],None)
        for index,raw_line in enumerate(doc['lines']):
            shape(raw_line,{'rowId','description','material','purity','quantity','estimatedWeight','amount','unitPrice','priceBasis'},{'rowId','description','quantity','estimatedWeight','amount'});ref=raw_line['rowId']
            if not isinstance(ref,str)or ref in used or ref not in original and not re.fullmatch(r'manual-[A-Za-z0-9-]{1,60}',ref):raise OcrError('核对明细不是当前识别来源，不能越界引用')
            used.add(ref);old=original.get(ref,{})
            if type(raw_line['quantity'])is not int or not 1<=raw_line['quantity']<=1000000:raise OcrError('件数须人工核对为正整数')
            line={'description':text(raw_line['description'],300,True),'material':text(raw_line.get('material',''),80),'purity':text(raw_line.get('purity',''),80),'quantity':raw_line['quantity'],'estimatedWeight':weight(raw_line['estimatedWeight']),'amount':money(raw_line['amount'])}
            for key,actual in line.items():checked('rows.'+ref+'.'+key,actual,old.get(key),key in ('material','purity'))
            if 'unitPrice'in raw_line or 'priceBasis'in raw_line:
                price=None if raw_line.get('unitPrice')in (None,'')else number(raw_line['unitPrice'],4,Decimal('90000000000'))
                if raw_line.get('unitPrice')not in (None,'')and price is None:raise OcrError('单价须人工核对为有效非负十进制文本')
                basis=raw_line.get('priceBasis')
                if basis not in (None,'per_gram','per_piece'):raise OcrError('须明确单价单位为元/克、元/件或保留未知')
                checked('rows.'+ref+'.unitPrice',price,old.get('unitPrice'),True);checked('rows.'+ref+'.priceBasis',basis,old.get('priceBasis'),True)
                price_review.append({'rowId':ref,'unitPrice':price,'priceBasis':basis})
            lines.append(line)
        omitted=review.get('omittedRows',[])
        if not isinstance(omitted,list)or len(omitted)>100:raise OcrError('省略明细记录无效')
        skipped=set()
        for entry in omitted:
            shape(entry,{'rowId','reason'},{'rowId','reason'})
            if entry['rowId']not in original or entry['rowId']in used or entry['rowId']in skipped or len(text(entry['reason'],500))<3:raise OcrError('省略明细须逐行说明')
            skipped.add(entry['rowId'])
        if set(original)-used!=skipped:raise OcrError('识别明细有未核对的省略行')
        total=money(review['confirmedTotal']);summed=sum(Decimal(x['amount'])for x in lines)
        if Decimal(total)!=summed:raise OcrError('人工确认合计与逐行金额不一致，不能生成草稿')
        checked('total',total,candidates.get('invoiceTotal'))
        if candidates.get('invoiceTotal')is not None and total!=candidates['invoiceTotal']and len(text(review.get('totalDifferenceReason',''),500))<3:raise OcrError('逐行合计与原图合计不同，须明确核对差异原因')
        if set(decisions)!=expected:raise OcrError('核对记录含越界字段或漏项')
        document={'requestId':value['requestId'],'kind':'purchase','partyId':doc['partyId'],'date':day,'dueDate':due,'businessType':doc['businessType'],'note':text(doc.get('note',''),2000),'attachments':[row['attachment_id']],'lines':lines}
        return document,{'imageHash':row['image_hash'],'resultHash':row['result_hash'],'document':document,'review':review,'priceReview':price_review}
    def save_draft(self,actor,jid,value):
        row=self.record(actor,jid)
        if row['status']not in ('ready','draft'):raise OcrError('识别尚未完成，不能生成采购草稿',409)
        with self.transaction()as c:document,accepted=self.reviewed_document(c,row,value)
        accepted_hash=digest(accepted)
        if row['status']=='draft':
            if digest(json.loads(row['accepted_json']))!=accepted_hash:raise OcrError('此识别已关联采购草稿，不能换内容重复录入',409)
            return self.create_purchase(actor,document)
        def provenance(c,did,payload):
            fresh=c.execute('SELECT status,image_hash,result_hash FROM erp_ocr_imports WHERE id=? AND owner_id=?',(jid,actor['staffId'])).fetchone()
            if fresh is None or fresh['status']!='ready'or fresh['image_hash']!=value['imageHash']or fresh['result_hash']!=value['resultHash']:raise OcrError('识别或原图已变化，拒绝重复建草稿',409)
            self.source(actor,row['attachment_id'],row['image_hash'],connection=c)
            c.execute("UPDATE erp_ocr_imports SET status='draft',document_id=?,accepted_json=?,updated_at=? WHERE id=? AND status='ready'",(did,canonical(accepted),dt.datetime.now(dt.timezone.utc).isoformat(),jid))
        return self.create_purchase(actor,document,provenance=provenance)
