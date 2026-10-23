import {randomBytes} from 'node:crypto';
export function fixtureAccounts(){return ['view','operate','manage','disabled'].map(level=>({username:'fixture_'+level,name:'虚构'+level+'员工',level,password:randomBytes(20).toString('hex')}));}
export async function login(app,account){
 let cookie='',token='',authCsrf='';
 const fetchAs=async(path,options={})=>{const headers={cookie,...options.headers};if(options.method&&options.method!=='GET'){headers.Origin=app.origin;headers['X-CSRF-Token']=token;}const r=await fetch(app.origin+path,{...options,headers});const setCookie=r.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return r;};
 let response=await fetchAs('/staff-auth/status'),status=await response.json();authCsrf=status.authCsrfToken;
 response=await fetchAs('/staff-auth/login',{method:'POST',headers:{'content-type':'application/json','X-Auth-CSRF-Token':authCsrf},body:JSON.stringify({username:account.username,password:account.password})});
 if(!response.ok)throw Error('Fixture login failed '+response.status);status=await response.json();authCsrf=status.authCsrfToken;
 const bootstrap=await fetchAs('/api/bootstrap');const boot=await bootstrap.json();if(bootstrap.ok)token=boot.csrfToken;
 return {fetch:fetchAs,boot,get cookie(){return cookie;},async logout(){return fetchAs('/staff-auth/logout',{method:'POST',headers:{'X-Auth-CSRF-Token':authCsrf}});}};
}
