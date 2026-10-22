'use strict';
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('button'),notice=document.getElementById('login-notice');
  button.disabled=true;button.textContent='正在验证';notice.hidden=true;
  try{
    const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:form.username.value.trim(),password:form.password.value})});
    const result=await response.json();
    if(!response.ok||result.ok===false)throw Error(result.error||'登录失败，请检查账户信息。');
    location.replace('/');
  }catch(error){notice.textContent=error.message||'服务暂不可用，请稍后重试。';notice.hidden=false;}
  finally{button.disabled=false;button.textContent='进入工作台';}
});
