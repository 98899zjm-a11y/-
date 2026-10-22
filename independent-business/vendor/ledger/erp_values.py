"""Exact values for new ERP records; never recalculates legacy financial fields."""
import datetime as dt
import hashlib
import json
import re
import unicodedata
import uuid
from decimal import Decimal

class ErpError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status=status

def money(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,12}(?:\.\d{1,2})?',value.strip()):
        raise ErpError('金额须为不超过两位小数的非负十进制文本。')
    cents=int(Decimal(value.strip())*100)
    if cents>9_000_000_000_000:raise ErpError('金额超过允许范围。')
    return cents

def weight(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,9}(?:\.\d{1,4})?',value.strip()):
        raise ErpError('克重须为不超过四位小数的非负十进制文本。')
    d=Decimal(value.strip())
    if d>100_000_000:raise ErpError('克重超过允许范围。')
    return format(d.quantize(Decimal('.0001')),'f')

def quantity(value):
    if isinstance(value,bool) or not isinstance(value,int) or not 1<=value<=1_000_000:
        raise ErpError('件数须为1至1000000的整数。')
    return value

def text(value, maximum=500, required=False):
    if not isinstance(value,str):raise ErpError('文字字段格式无效。')
    result=unicodedata.normalize('NFKC',value).strip()
    if len(result)>maximum or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]',result) or required and not result:
        raise ErpError('文字字段为空、过长或含非法字符。')
    return result

def identifier(value):
    if not isinstance(value,str):raise ErpError('单据标识格式无效。')
    try:valid=str(uuid.UUID(value))==value
    except ValueError:valid=False
    if not valid:raise ErpError('单据标识格式无效。')
    return value

def date(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):raise ErpError('日期须为年月日格式。')
    try:dt.date.fromisoformat(value)
    except ValueError:raise ErpError('日期无效。')
    return value

def encoded(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(value):return hashlib.sha256(encoded(value).encode()).hexdigest()

def object_value(value,allowed,required=()):
    if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value):raise ErpError('字段缺失或包含不允许的字段。')
    return value

CAPS=('erp.read','erp.parties.manage','erp.purchase.prepare','erp.purchase.review','erp.receipt.prepare','erp.receipt.review','erp.bill.prepare','erp.bill.review','erp.settlement.prepare','erp.settlement.review','erp.reversal.prepare','erp.reversal.review','erp.reports.view','erp.reports.sensitive','erp.attachments.write')

def permitted(actor,cap):
    return isinstance(actor,dict) and actor.get('protocolVersion')==2 and actor.get('access') in ('view','operate','manage') and isinstance(actor.get('capabilities'),list) and cap in actor['capabilities'] and bool(actor.get('staffId'))

def require(actor,cap,write=False,review=False):
    if not permitted(actor,'erp.read') or not permitted(actor,cap) or write and actor.get('access') not in ('operate','manage') or review and actor.get('access')!='manage':
        raise ErpError('此ERP操作未获授权，请联系管理员。',403)
    return actor

def positive_money(value):
    result=money(value)
    if result<=0:raise ErpError('金额必须大于零。')
    return result

def revision(value):
    if isinstance(value,bool) or not isinstance(value,int) or value<1:raise ErpError('版本号无效。')
    return value

def today():return (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=8)).date().isoformat()
