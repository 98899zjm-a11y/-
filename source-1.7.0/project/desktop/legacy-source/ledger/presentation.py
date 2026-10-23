"""Two-decimal presentation without changing stored calculation precision."""
from decimal import Decimal,InvalidOperation,ROUND_HALF_UP
def fmt2(value):
    if value in (None,''):return ''
    try:
        n=Decimal(str(value))
        if not n.is_finite():return str(value)
        n=n.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)
        if n==0:n=abs(n)
        return format(n,'f')
    except (InvalidOperation,ValueError,TypeError):return str(value)
def configure(app):
    app.jinja_env.filters.update(fmt2=fmt2,money=fmt2,gram=fmt2)
    @app.after_request
    def csv_display(response):
        if response.mimetype!='text/csv' or response.direct_passthrough:return response
        import csv,io,re
        content=response.get_data(as_text=True);bom=content.startswith('\ufeff');rows=list(csv.reader(io.StringIO(content.lstrip('\ufeff'))))
        if not rows:return response
        numerical=[bool(re.search(r'金额|克重|成本|售价|克价|工费|点差|利润|金价|提成|毛利率|重量|比例|扣款|底薪|应发|实发|支付|报销|板料.*(?:克|g)',name)) and not any(word in name for word in ('单号','日期','事由','状态')) for name in rows[0]]
        for row in rows[1:]:
            for i,value in enumerate(row):
                if i<len(numerical) and numerical[i] and re.fullmatch(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',value):row[i]=fmt2(value)
        output=io.StringIO();csv.writer(output).writerows(rows);response.set_data(('\ufeff' if bom else '')+output.getvalue());return response
