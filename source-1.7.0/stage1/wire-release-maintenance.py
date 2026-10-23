"""Replace only the candidate's old manual-sales-only maintenance glue."""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
file=root/'project/desktop/release-app.cjs'
text=file.read_text('utf-8')
start=text.index("  nativeHandler('jewelry:backup',")
end=text.index('\n}\nasync function requireA4()',start)
replacement="""  // Do not track these calls as business requests: the maintenance service
  // itself drains that barrier, so waiting inside it would deadlock.
  nativeHandler('jewelry:backup',async()=>{
    network.assertLocal();await requireLogin(true);if(!hostRuntime)throw Error('请在主机创建统一备份');
    return hostRuntime.performMaintenance({method:'POST',path:'/api/local/backups'});
  },{maintenance:true});
  nativeHandler('jewelry:restore',async input=>{
    network.assertLocal();const actor=await requireLogin(true);if(!hostRuntime)throw Error('请在主机恢复统一备份');
    if(!input||Object.keys(input).some(k=>!['name','selection'].includes(k))||typeof input.name!=='string'||input.name!==path.basename(input.name)||/[\\\\/:\\x00-\\x1f]/.test(input.name)||!['sales','ledger','inventory','documents','allBusiness'].includes(input.selection))throw Error('请选择已核验的备份与恢复范围');
    const answer=await dialog.showMessageBox(window,{type:'question',title:'恢复主机业务资料',message:'恢复所选备份中的业务资料？',detail:'当前业务会先另存备份。账号权限、当前打印防重记录和编号预留不会回退；完成后员工需要重新登录。',buttons:['取消','确认恢复'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return{ok:false,canceled:true};
    if((await requireLogin(true)).id!==actor.id)throw Error('管理员账号已切换，恢复未执行');network.assertLocal();
    await moduleViews?.clear();loginReceipt.clear();nativeSessionRevision++;
    return hostRuntime.performMaintenance({method:'POST',path:'/api/local/restore',body:{name:input.name,selection:input.selection,confirmation:'确认恢复所选业务资料'}});
  },{maintenance:true});"""
if 'makeBackup' not in text[start:end] or 'commitRestore' not in text[start:end]:
    raise RuntimeError('Candidate maintenance glue does not match verified old shape')
file.write_text(text[:start]+replacement+text[end:],encoding='utf-8')
