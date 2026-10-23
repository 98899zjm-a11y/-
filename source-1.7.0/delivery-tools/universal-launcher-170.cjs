'use strict';
// One-button boundary for the separately pinned native window. It does not
// interpret exit-zero as installation, spawn an old resource helper or retry.
function createUniversalLauncher170({worker,showProgress=()=>{},showResult=()=>{}}={}){
 if(!worker||typeof worker.run!=='function')throw TypeError('A fixed 170 worker is required');
 let pending=null;
 function notify(value){try{showProgress(value);}catch{/* UI must not change a committed transaction. */}}
 async function click(request={mode:'maintenance'}){
  if(pending)throw Object.assign(Error('本次处理仍在继续，请保留窗口。'),{code:'BUSY'});
  pending=Promise.resolve().then(()=>worker.run(request));
  notify({busy:true,message:'正在检查安装位置、版本和角色。'});
  try{const result=await pending;try{showResult(result);}catch{/* No rollback/reinstall after UI errors. */}return result;}
  finally{pending=null;notify({busy:false});}
 }
 return Object.freeze({click,get busy(){return pending!==null;}});
}
module.exports={createUniversalLauncher170};
