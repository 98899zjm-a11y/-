"""Versioned, bounded expression evaluator. Never executes Python code."""
import ast,math,operator,json,datetime,sqlite3
from app import db

DEFAULTS={
 'sales': [('销售金额','克重 * 销售克价 + 工费'),('成本金价','销售克价 - 点差'),('公司利润','实际到账 - 成本'),
           ('毛利率','safe_div(公司利润, 实际到账)'),('提成成本','成本金价 * 克重'),('提成','提成成本 - 成本'),('提成利润','公司利润 - 提成')],
 'stock':[('毛利','售价 - 成本')],
 'material':[('金额','克数 * 单价 + 工费')],
 'expense':[('报销金额','票据金额 + 补贴 - 个人承担')],
 'payroll':[('底薪实发',"日薪 * 出勤天数 if 计薪方式 == '按天计薪' else 底薪"),
            ('工资提成',"原提成 if 计薪方式 == '底薪+原提成' else (销售金额 * 提成比例 / 100 if 计薪方式 == '底薪+销售比例' else (销售利润 * 提成比例 / 100 if 计薪方式 == '底薪+利润比例' else (销售克重 * 每克提成 if 计薪方式 == '底薪+克重提成' else 0)))"),
            ('加班工资','加班小时 * 加班单价'),('应发工资','底薪实发 + 工资提成 + 加班工资 + 奖金 + 补贴'),
            ('工资扣款','扣款 + 社保 + 个税'),('实发工资','应发工资 - 工资扣款'),('本次支付','实发工资 + 工资报销')],
 'overview':[('经营结余','销售利润 - 工资成本 - 报销费用')]
}
INPUTS={
 'sales':['克重','销售克价','工费','成本','实际到账','点差'],
 'stock':['售价','成本','克重'], 'material':['克数','单价','工费'],
 'expense':['票据金额','补贴','个人承担'],
 'payroll':['计薪方式','底薪','日薪','出勤天数','提成比例','每克提成','销售金额','销售利润','销售克重','原提成','加班小时','加班单价','奖金','补贴','扣款','社保','个税','工资报销'],
 'overview':['销售利润','工资成本','报销费用']
}
TITLES={'sales':'销售计算','stock':'库存毛利','material':'存料费计算','payroll':'人员工资','expense':'报销金额','overview':'经营概览'}
MODES=['固定月薪','按天计薪','底薪+原提成','底薪+销售比例','底薪+利润比例','底薪+克重提成','自定义规则']
FUNCTIONS={'round':round,'min':min,'max':max,'abs':abs,'safe_div':lambda a,b: a/b if b else 0,
           '四舍五入':round,'最小值':min,'最大值':max,'绝对值':abs,'安全除法':lambda a,b:a/b if b else 0,'如果':None}
DEFAULTS['sales'][3]=('毛利率','安全除法(公司利润, 实际到账)')
DEFAULTS['payroll'][0]=('底薪实发',"如果(计薪方式 == '按天计薪', 日薪 * 出勤天数, 底薪)")
DEFAULTS['payroll'][1]=('工资提成',"如果(计薪方式 == '底薪+原提成', 原提成, 如果(计薪方式 == '底薪+销售比例', 销售金额 * 提成比例 / 100, 如果(计薪方式 == '底薪+利润比例', 销售利润 * 提成比例 / 100, 如果(计薪方式 == '底薪+克重提成', 销售克重 * 每克提成, 0))))")
BIN={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.Div:operator.truediv,ast.Mod:operator.mod}
CMP={ast.Eq:operator.eq,ast.NotEq:operator.ne,ast.Lt:operator.lt,ast.LtE:operator.le,ast.Gt:operator.gt,ast.GtE:operator.ge}

def parse(text,allowed):
    if not isinstance(text,str) or not text or len(text)>1000:raise ValueError('公式不能为空，且不能超过 1000 个字符。')
    text=text.strip().removeprefix('=').replace('×','*').replace('÷','/').replace('−','-').replace('（','(').replace('）',')').replace('，',',')
    try:tree=ast.parse(text,mode='eval')
    except SyntaxError as e:raise ValueError('公式格式错误：'+str(e.msg))
    nodes=list(ast.walk(tree))
    if len(nodes)>220:raise ValueError('公式过于复杂，请拆成多个步骤。')
    types=(ast.Expression,ast.BinOp,ast.UnaryOp,ast.Name,ast.Load,ast.Constant,ast.Call,ast.IfExp,ast.Compare,ast.BoolOp,
           ast.Add,ast.Sub,ast.Mult,ast.Div,ast.Mod,ast.USub,ast.UAdd,ast.Not,ast.And,ast.Or,*CMP.keys())
    for n in nodes:
        if not isinstance(n,types):raise ValueError('仅支持算术、条件判断和 round/min/max/abs/safe_div 函数。')
        if isinstance(n,ast.Name) and n.id not in allowed and n.id not in FUNCTIONS:raise ValueError('不认识字段：'+n.id)
        if isinstance(n,ast.Constant) and (not isinstance(n.value,(int,float,str,bool)) or isinstance(n.value,str) and len(n.value)>60):raise ValueError('不支持这个常量。')
        if isinstance(n,ast.Constant) and isinstance(n.value,(int,float)) and abs(n.value)>1e15:raise ValueError('公式中的数字不能超过 1000000000000000。')
        if isinstance(n,ast.Call) and (not isinstance(n.func,ast.Name) or n.func.id not in FUNCTIONS or n.keywords or len(n.args)>8):raise ValueError('不支持这个函数调用。')
    return tree.body

def evaluate(node,env):
    if isinstance(node,ast.Constant):return node.value
    if isinstance(node,ast.Name):return env[node.id]
    if isinstance(node,ast.BinOp):
        left=evaluate(node.left,env);right=evaluate(node.right,env)
        if not isinstance(left,(int,float)) or not isinstance(right,(int,float)):raise ValueError('算术运算只能使用数字。')
        return BIN[type(node.op)](left,right)
    if isinstance(node,ast.UnaryOp):
        v=evaluate(node.operand,env);return -v if isinstance(node.op,ast.USub) else +v if isinstance(node.op,ast.UAdd) else not v
    if isinstance(node,ast.IfExp):return evaluate(node.body if evaluate(node.test,env) else node.orelse,env)
    if isinstance(node,ast.Compare):
        left=evaluate(node.left,env)
        for op,right in zip(node.ops,node.comparators):
            value=evaluate(right,env)
            if not CMP[type(op)](left,value):return False
            left=value
        return True
    if isinstance(node,ast.BoolOp):
        for n in node.values:
            v=evaluate(n,env)
            if isinstance(node.op,ast.And) and not v or isinstance(node.op,ast.Or) and v:return v
        return v
    if isinstance(node,ast.Call):
        if node.func.id=='如果':
            if len(node.args)!=3:raise ValueError('如果 函数需要三个参数：条件、成立结果、不成立结果。')
            return evaluate(node.args[1] if evaluate(node.args[0],env) else node.args[2],env)
        args=[evaluate(x,env) for x in node.args]
        if node.func.id in ['round','四舍五入'] and len(args)>1 and (not isinstance(args[1],int) or not -6<=args[1]<=8):raise ValueError('四舍五入的小数位应为 -6 到 8 的整数。')
        return FUNCTIONS[node.func.id](*args)
    raise ValueError('不支持的公式。')

def validate(domain,formulas):
    expected=[x[0] for x in DEFAULTS[domain]]
    if [x[0] for x in formulas]!=expected:raise ValueError('计算步骤与此类目不一致。')
    allowed=set(INPUTS[domain]);sample={k:1.0 for k in allowed}
    if domain=='payroll':sample['计薪方式']='固定月薪'
    for name,text in formulas:
        tree=parse(text,allowed)
        try:v=evaluate(tree,sample)
        except Exception as e:raise ValueError(name+'：试算失败（'+str(e)+'）')
        if not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>1e15:raise ValueError(name+'：结果超出范围。')
        sample[name]=v;allowed.add(name)

def initialize(c):
    c.execute('CREATE TABLE IF NOT EXISTS formula_sets(id INTEGER PRIMARY KEY,domain TEXT NOT NULL,formulas TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL)')
    for domain,steps in DEFAULTS.items():
        if not c.execute('SELECT id FROM formula_sets WHERE domain=?',(domain,)).fetchone():
            c.execute('INSERT INTO formula_sets(domain,formulas,actor,created_at,reason) VALUES(?,?,?,?,?)',(domain,json.dumps(steps,ensure_ascii=False),'system',db.now_str(),'初始规则'))

def rule(domain,rule_id=None,c=None):
    if rule_id==0:return {'id':0,'domain':domain,'formulas':DEFAULTS[domain],'actor':'v1.0','created_at':'历史规则','reason':'历史单据原规则'}
    if c:
        row=c.execute('SELECT * FROM formula_sets WHERE domain=? '+('AND id=?' if rule_id else 'ORDER BY id DESC LIMIT 1'),(domain,rule_id) if rule_id else (domain,)).fetchone()
    else:row=db.query('SELECT * FROM formula_sets WHERE domain=? '+('AND id=?' if rule_id else 'ORDER BY id DESC LIMIT 1'),(domain,rule_id) if rule_id else (domain,),one=True)
    if not row:raise ValueError('计算规则不存在，请重新载入。')
    value=dict(row);value['formulas']=json.loads(value['formulas']);return value

def compute(domain,values,rule_id=None,c=None):
    selected=rule(domain,rule_id,c);env=dict(values);result={};allowed=set(INPUTS[domain])
    for name,text in selected['formulas']:
        try:v=evaluate(parse(text,allowed),env)
        except Exception as e:raise ValueError(name+' 计算失败：'+str(e))
        if not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>1e15:raise ValueError(name+' 的结果无效。')
        result[name]=v;env[name]=v;allowed.add(name)
    return result,selected['id']
