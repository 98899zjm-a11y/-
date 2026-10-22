'use strict';
const { _electron }=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),net=require('node:net');
const {clients,approvedReceivable}=require('./http-fixtures.cjs');
const BASE=path.resolve(__dirname,'..'),ART=path.join(BASE,'artifacts');
(async()=>{
  const env={...process.env,TEMP:path.join(BASE,'runtime-temp'),TMP:path.join(BASE,'runtime-temp'),PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'};
  delete env.ELECTRON_RUN_AS_NODE;let application,child;const failures=[],report={started:new Date().toISOString(),checks:[]};
  try{
    application=await _electron.launch({executablePath:'E:/珠宝销售软件/desktop/node_modules/electron/dist/electron.exe',args:[path.join(BASE,'desktop')],cwd:BASE,env,timeout:60000});
    child=application.process();const page=await application.firstWindow({timeout:45000});page.on('pageerror',error=>failures.push(error.message));
    await page.waitForURL(url=>url.origin==='http://127.0.0.1:31841',{timeout:30000});
    if(new URL(page.url()).pathname!=='/login'){await page.locator('#logout').click();}
    await page.waitForURL('**/login',{timeout:15000});await page.screenshot({path:path.join(ART,'login.png')});report.checks.push('真实桌面登录页面');
    const credentials=JSON.parse(fs.readFileSync(path.join(BASE,'runtime/desktop-demo/demo-credentials.json'),'utf8'));
    await page.locator('#username').fill('admin');await page.locator('#password').fill(credentials.admin.password);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
    await page.waitForURL('http://127.0.0.1:31841/',{timeout:15000});await page.locator('#current-user').filter({hasText:'admin'}).waitFor();
    await page.waitForFunction(()=>!document.getElementById('erp-documents').textContent.includes('读取中'));
    await page.screenshot({path:path.join(ART,'home.png')});report.checks.push('真实表单登录与工作台');
    await page.getByRole('link',{name:'进入财务 ERP',exact:true}).click();await page.locator('#erp-actor').filter({hasText:'admin'}).waitFor();
    await page.locator('#tab-parties').click();const party='虚构桌面供应商-'+Date.now();await page.locator('#party-name').fill(party);await page.locator('#party-form button[type=submit]').click();
    await page.locator('#parties-body').getByText(party,{exact:true}).waitFor({timeout:15000});report.checks.push('ERP界面真实保存供应商（CSRF桥接）');
    await page.screenshot({path:path.join(ART,'erp-parties.png')});
    const fixture=await approvedReceivable(await clients('http://127.0.0.1:31841',credentials));
    await page.getByRole('link',{name:'返回工作台',exact:true}).click();await page.getByRole('link',{name:'收付交接',exact:true}).click();
    await page.locator('#bill option[value="'+fixture.document.id+'"]').waitFor({state:'attached'});
    await page.locator('#bill').selectOption(fixture.document.id);await page.locator('#release-note').fill('虚构界面交接核对');
    await page.getByRole('button',{name:'发布给出纳',exact:true}).click();
    const releasedRow=page.locator('#release-rows tr').filter({hasText:fixture.document.number});await releasedRow.getByText('已发布',{exact:true}).waitFor();
    await page.screenshot({path:path.join(ART,'finance-handoff.png')});await releasedRow.getByRole('button',{name:'撤回',exact:true}).click();
    await releasedRow.getByText('已撤回',{exact:true}).waitFor();report.checks.push('ERP收付交接界面真实发布与撤回');
    await page.getByRole('link',{name:'返回 ERP',exact:true}).click();
    await page.getByRole('link',{name:'出纳系统',exact:true}).click();await page.getByRole('heading',{name:'出纳',exact:true}).waitFor();
    await page.waitForFunction(()=>document.getElementById('account').options.length>0||document.getElementById('notice').textContent.trim());
    await page.locator('#notice.error').waitFor({state:'hidden'});
    const accountName='虚构桌面银行账户-'+Date.now();
    await page.locator('[data-panel=accounts]').click();await page.locator('#account-form [name=code]').fill('UI-'+Date.now());await page.locator('#account-form [name=name]').fill(accountName);await page.locator('#account-form [name=kind]').selectOption('bank');await page.locator('#account-form button[type=submit]').click();
    await page.locator('#account-list').getByText(accountName,{exact:true}).waitFor({timeout:15000});report.checks.push('出纳界面真实建立账户');await page.screenshot({path:path.join(ART,'cashier-accounts.png')});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(ART,'cashier-narrow.png')});report.checks.push('390px窄屏检查截图');
    assert.deepEqual(failures,[],'页面脚本应无异常');report.pageErrors=failures;
    await application.close();application=null;
    await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(Error('桌面进程未正常退出')),20000);if(child.exitCode!==null){clearTimeout(deadline);resolve();}else child.once('exit',()=>{clearTimeout(deadline);resolve();});});
    await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(31841,'127.0.0.1',()=>s.close(resolve));});report.checks.push('关闭桌面后子服务正常退出，端口可重绑');report.passed=true;
  }catch(error){report.passed=false;report.error=error.message;report.pageErrors=failures;try{if(application){const pages=application.windows();if(pages[0])await pages[0].screenshot({path:path.join(ART,'desktop-failed.png')});await application.close();}}catch(e){report.cleanupError=e.message;}process.exitCode=1;}
  finally{report.ended=new Date().toISOString();fs.writeFileSync(path.join(ART,'desktop-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
