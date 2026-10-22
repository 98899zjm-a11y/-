/* Presentation only: navigation, focus and scroll semantics; no business API. */
document.addEventListener('DOMContentLoaded',function(){
 const nav=document.querySelector('[data-module-nav]'),toggle=document.querySelector('[data-menu-toggle]');
 document.querySelectorAll('.nav-symbol').forEach(n=>n.setAttribute('aria-hidden','true'));
 document.querySelectorAll('nav a.on').forEach(n=>n.setAttribute('aria-current','page'));
 document.querySelectorAll('.table-wrap,.scroll,.overview-table-wrap,.excel-grid,.xl-scroll').forEach(box=>{if(!box.querySelector('table'))return;box.tabIndex=0;box.setAttribute('role','region');if(!box.hasAttribute('aria-label'))box.setAttribute('aria-label','业务明细，可左右滚动查看完整字段');});
 if(!nav||!toggle)return;const mobile=window.matchMedia('(max-width:900px)'),backdrop=document.createElement('div');backdrop.className='xjy-menu-backdrop';backdrop.setAttribute('aria-hidden','true');document.body.append(backdrop);
 toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');
 function setOpen(open,restoreFocus=false){const state=mobile.matches&&open;nav.classList.toggle('open',state);backdrop.classList.toggle('open',state);document.body.classList.toggle('xjy-drawer-open',state);toggle.setAttribute('aria-expanded',String(state));nav.inert=mobile.matches&&!state;nav.setAttribute('aria-hidden',String(mobile.matches&&!state));if(state){const first=nav.querySelector('a');first?.focus();}else if(restoreFocus)toggle.focus();}
 toggle.addEventListener('click',()=>setOpen(!nav.classList.contains('open')));backdrop.addEventListener('click',()=>setOpen(false,true));nav.addEventListener('click',event=>{if(event.target.closest('a')&&mobile.matches)setOpen(false);});
 document.addEventListener('keydown',event=>{if(!mobile.matches||!nav.classList.contains('open'))return;if(event.key==='Escape'){event.preventDefault();setOpen(false,true);}if(event.key==='Tab'){const controls=[...nav.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(n=>!n.hidden),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
 mobile.addEventListener('change',()=>setOpen(false));setOpen(false);
});
