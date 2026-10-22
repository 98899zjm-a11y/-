'use strict';
const {app,BrowserWindow,dialog,Menu,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const BASE=path.resolve(__dirname,'..'),RUNTIME=path.join(BASE,'runtime');
function directory(name){const target=path.join(RUNTIME,name);for(let p=BASE;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||!s.isDirectory()||path.resolve(fs.realpathSync.native(p)).toLowerCase()!==p.toLowerCase())throw Error('开发目录不能包含链接或别名');if(p===path.dirname(p))break;}if(!fs.existsSync(RUNTIME))fs.mkdirSync(RUNTIME);for(const part of [RUNTIME,target]){if(!fs.existsSync(part))fs.mkdirSync(part);const s=fs.lstatSync(part);if(!s.isDirectory()||s.isSymbolicLink()||path.resolve(fs.realpathSync.native(part)).toLowerCase()!==part.toLowerCase())throw Error('开发运行目录不安全');}return target;}
const PROFILE=directory('desktop-profile'),TEMP=directory('desktop-temp');
app.setPath('userData',PROFILE);app.setPath('sessionData',PROFILE);app.setPath('temp',TEMP);app.setPath('crashDumps',directory('desktop-crashes'));app.setAppLogsPath(directory('desktop-logs'));
app.commandLine.appendSwitch('disk-cache-dir',path.join(PROFILE,'cache'));
const DATA=path.join(RUNTIME,'desktop-demo'),PORT=31841,PYTHON='C:\\Python314\\python.exe';
let server,window,stopping=false,quitAllowed=false;
async function stop(){if(stopping)return;stopping=true;if(server&&server.exitCode===null){await new Promise(resolve=>{const timer=setTimeout(()=>{dialog.showErrorBox('独立服务仍在结束操作','开发服务尚未退出，将继续等待以保留当前事务；不会强制结束进程。');},15000);server.once('exit',()=>{clearTimeout(timer);resolve();});server.stdin.end();});}quitAllowed=true;app.quit();}
function startServer(){return new Promise((resolve,reject)=>{
  if(!fs.existsSync(PYTHON))return reject(Error('当前开发机需要已有 Python314 运行环境；未自动安装。'));
  const initializing=!fs.existsSync(path.join(DATA,'.standalone-demo.json'));
  const args=['-B','-m','host','--root',DATA,'--port',String(PORT),'--parent-watch',...(initializing?['--demo-init']:[])];
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',TEMP,TMP:TEMP};delete env.PYTHONPATH;delete env.PYTHONHOME;delete env.ELECTRON_RUN_AS_NODE;
  server=spawn(PYTHON,args,{cwd:BASE,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const log=fs.createWriteStream(path.join(directory('desktop-logs'),'server-'+Date.now()+'.log'),{flags:'wx'});server.stderr.pipe(log,{end:false});
  let line='',settled=false;const fail=error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}};
  const timer=setTimeout(()=>fail(Error('独立服务启动超时，尚未打开业务窗口；请查看 D 盘开发日志。')),30000);
  server.on('error',fail);server.stdin.on('error',()=>{});
  server.on('exit',code=>{log.end();if(!settled)fail(Error('独立服务未能启动，退出码 '+code));else if(!stopping){dialog.showErrorBox('独立开发服务已停止','请关闭此开发窗口后重新启动。正式软件不受影响。');window?.close();}});
  server.stdout.on('data',chunk=>{line+=chunk.toString('utf8');if(line.length>65536)return fail(Error('独立服务返回异常启动信息'));let i;while((i=line.indexOf('\n'))>=0){const row=line.slice(0,i).trim();line=line.slice(i+1);let ready;try{ready=JSON.parse(row);}catch{continue;}if(ready.type!=='ready')continue;try{const owner=JSON.parse(fs.readFileSync(path.join(DATA,'.standalone-demo.json'),'utf8'));if(ready.port!==PORT||ready.pid!==server.pid||ready.namespace!==owner.namespace)throw Error('独立服务身份与测试账套不匹配');if(!settled){settled=true;clearTimeout(timer);resolve();}}catch(error){fail(error);}}});
});}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{window?.show();window?.focus();});
  app.on('before-quit',event=>{if(!quitAllowed){event.preventDefault();void stop();}});
  app.whenReady().then(async()=>{
    await startServer();
    const origin=`http://127.0.0.1:${PORT}`;
    window=new BrowserWindow({width:1360,height:900,minWidth:780,minHeight:600,title:'鑫金源 · ERP与出纳独立开发版',backgroundColor:'#f4f5f7',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    window.webContents.session.setDownloadPath(directory('exports'));
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
    window.on('closed',()=>{window=null;void stop();});
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'独立工作台',submenu:[{label:'打开测试账号文件',click:()=>{const file=path.join(DATA,'demo-credentials.json');if(fs.existsSync(file))void shell.openPath(file);}},{type:'separator'},{label:'退出开发版',click:()=>window?.close()}]},{label:'查看',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}]));
    await window.loadURL(origin+'/');
  }).catch(error=>{dialog.showErrorBox('独立开发版未启动',String(error.message));void stop();});
}
