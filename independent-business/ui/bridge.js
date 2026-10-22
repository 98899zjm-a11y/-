'use strict';
// Standalone transport adapter only. The domain engines and vendor UI stay unchanged.
(() => {
  const nativeFetch=window.fetch.bind(window);
  let identityPromise;
  const identity=()=>identityPromise||(identityPromise=nativeFetch('/auth/me',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('登录已失效，请重新登录。');return r.json();}).catch(e=>{identityPromise=null;throw e;}));
  window.fetch=async(resource,options={})=>{
    const url=new URL(resource instanceof Request?resource.url:String(resource),location.href);
    const method=String(options.method||(resource instanceof Request?resource.method:'GET')).toUpperCase();
    if(url.origin===location.origin&&!['GET','HEAD','OPTIONS'].includes(method)&&(/^\/(erp|cashier)\//.test(url.pathname)||url.pathname==='/auth/logout')){
      const me=await identity();const headers=new Headers(options.headers||(resource instanceof Request?resource.headers:undefined));
      if(!me.csrfToken)throw Error('会话校验信息缺失，请重新登录。');
      headers.set('X-CSRF-Token',me.csrfToken);
      options={...options,headers,credentials:'same-origin'};
    }
    return nativeFetch(resource,options);
  };
  document.addEventListener('DOMContentLoaded',async()=>{
    if(!/^\/(erp|cashier)(\/|$)/.test(location.pathname))return;
    const nav=document.createElement('nav');nav.className='standalone-bar';nav.setAttribute('aria-label','独立工作台导航');
    for(const [label,href]of [['◇ 鑫金源工作台','/'],['财务 ERP','/erp/'],['出纳系统','/cashier/']]){const a=document.createElement('a');a.textContent=label;a.href=href;if(location.pathname.startsWith(href)&&href!=='/')a.setAttribute('aria-current','page');nav.append(a);}
    const note=document.createElement('span');note.textContent='独立开发账套';nav.append(note);document.body.prepend(nav);
    try{const me=await identity();if(['finance_reviewer','admin'].includes(me.role||me.user?.role)){const handoff=document.createElement('a');handoff.textContent='收付交接';handoff.href='/finance-handoff';nav.insertBefore(handoff,note);}}catch{location.replace('/login');}
  });
})();
