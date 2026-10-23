(function (root) {
  'use strict';

  var STORAGE_VERSION = 1;
  var SENSITIVE_NAME = /(?:password|passwd|secret|csrf|token|credential|api[_-]?key)/i;
  var FORBIDDEN_PATH = /(?:^|\/)(?:login|logout|password|users?|delete|remove|toggle|returned|status|apply|execute|activate|deactivate|enable|disable|import|upload|restore|backup|export|download)(?:\/|$)/i;
  var ENTITY_NAME = /^(?:id|sku_id|material_id|session_id|sid|record_id|rid|mid|bid|batch_id|item_id|entity_id)$/;
  var UI_NAME = /^(?:mode|tab)$/;
  var windowObject = root && root.document ? root : null;

  function attribute(element, name) {
    return element && element.getAttribute ? element.getAttribute(name) : null;
  }

  function canonicalURL(value, base) {
    try { return new URL(value || base, base); } catch (_) { return null; }
  }

  function identityPrefix(user, instance) {
    return 'stock-draft:v1:' + encodeURIComponent(String(instance)) + ':' + encodeURIComponent(String(user)) + ':';
  }

  function identityDigest(text) {
    // A synchronous SHA256 keeps success markers small even for large grids.
    // The complete identity remains in the snapshot and is checked on restore.
    var bytes;
    if (typeof TextEncoder!=='undefined') bytes=Array.from(new TextEncoder().encode(text));
    else bytes=Array.from(unescape(encodeURIComponent(text))).map(function (character) { return character.charCodeAt(0); });
    var bitLength=bytes.length*8;
    bytes.push(128);
    while (bytes.length%64!==56) bytes.push(0);
    var high=Math.floor(bitLength/4294967296),low=bitLength>>>0;
    [high,low].forEach(function (word) { bytes.push((word>>>24)&255,(word>>>16)&255,(word>>>8)&255,word&255); });
    var constants=[
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    var hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    function rotate(word,shift) { return (word>>>shift)|(word<<(32-shift)); }
    for (var offset=0;offset<bytes.length;offset+=64) {
      var words=new Array(64);
      for (var i=0;i<16;i++) { var position=offset+i*4;words[i]=(bytes[position]<<24)|(bytes[position+1]<<16)|(bytes[position+2]<<8)|bytes[position+3]; }
      for (i=16;i<64;i++) {
        var first=words[i-15],second=words[i-2];
        var sigma0=rotate(first,7)^rotate(first,18)^(first>>>3),sigma1=rotate(second,17)^rotate(second,19)^(second>>>10);
        words[i]=(words[i-16]+sigma0+words[i-7]+sigma1)|0;
      }
      var a=hash[0],b=hash[1],c=hash[2],d=hash[3],e=hash[4],f=hash[5],g=hash[6],h=hash[7];
      for (i=0;i<64;i++) {
        var sum1=rotate(e,6)^rotate(e,11)^rotate(e,25),choose=(e&f)^(~e&g);
        var temp1=(h+sum1+choose+constants[i]+words[i])|0;
        var sum0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),temp2=(sum0+majority)|0;
        h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0;
      }
      [a,b,c,d,e,f,g,h].forEach(function (word,index) { hash[index]=(hash[index]+word)|0; });
    }
    return hash.map(function (word) { return (word>>>0).toString(16).padStart(8,'0'); }).join('');
  }

  function formURL(form, page) {
    return canonicalURL(attribute(form, 'action') || page.href, page.href);
  }

  function isEditable(control) {
    if (!control || !control.tagName) return false;
    var tag = control.tagName.toLowerCase(), type = String(control.type || '').toLowerCase();
    var name = String(control.name || control.id || '');
    if (!/^(input|select|textarea)$/.test(tag) || !name) return false;
    if (/^(hidden|password|file|submit|reset|button|image)$/.test(type)) return false;
    if (SENSITIVE_NAME.test(name) || /^_stock_/.test(name)) return false;
    if (control.readOnly && attribute(control,'data-stock-draft-readonly')!=='keep') return false;
    // Grid deletion checkboxes must never be replayed when returning to a task.
    if (/^d_\d+$/.test(name)) return false;
    if (attribute(control, 'data-stock-draft') === 'off') return false;
    return true;
  }

  function controlsFor(form) {
    return Array.from(form.elements || []).filter(isEditable);
  }

  function eligibleForm(form, page) {
    if (!form || attribute(form, 'data-stock-draft') === 'off') return false;
    var action = formURL(form, page);
    if (!action || action.origin !== page.origin || FORBIDDEN_PATH.test(action.pathname) || FORBIDDEN_PATH.test(page.pathname)) return false;
    if (Array.from(form.elements || []).some(function (control) {
      return /^(password|file)$/i.test(control.type || '') || SENSITIVE_NAME.test(control.name || '');
    })) {
      // CSRF tokens are present in ordinary business forms; they alone do not exclude a form.
      if (Array.from(form.elements || []).some(function (control) {
        return /^(password|file)$/i.test(control.type || '') || (SENSITIVE_NAME.test(control.name || '') && !/csrf/i.test(control.name || ''));
      })) return false;
    }
    return controlsFor(form).length > 0;
  }

  function modeFor(form, page) {
    var explicit = attribute(form, 'data-stock-draft-mode');
    if (explicit) return explicit;
    var modes = [];
    Array.from(form.elements || []).forEach(function (control) {
      if (UI_NAME.test(control.name || '') && control.value) modes.push(control.name + '=' + control.value);
      if (control.name === 'back' && control.value) {
        var back = new URLSearchParams(control.value);
        ['mode', 'tab'].forEach(function (key) { if (back.get(key)) modes.push(key + '=' + back.get(key)); });
      }
    });
    if (!modes.length) ['mode', 'tab'].forEach(function (key) { if (page.searchParams.get(key)) modes.push(key + '=' + page.searchParams.get(key)); });
    if (!modes.length && form.id === 'move-form') modes.push('mode=in');
    return Array.from(new Set(modes)).sort().join('&');
  }

  function descriptor(control) {
    var type = String(control.type || control.tagName || '').toLowerCase();
    return {
      name: String(control.name || ''), id: String(control.id || ''), type: type,
      choice: /^(checkbox|radio)$/.test(type) ? String(control.value) : ''
    };
  }

  function controlKey(control) {
    return JSON.stringify(descriptor(control));
  }

  function formIdentity(form, page) {
    var action = formURL(form, page), entities = [];
    Array.from(form.elements || []).forEach(function (control) {
      if (String(control.type).toLowerCase() === 'hidden' && ENTITY_NAME.test(control.name || '')) entities.push([control.name, String(control.value)]);
    });
    entities.sort(function (left, right) { return JSON.stringify(left).localeCompare(JSON.stringify(right)); });
    // Named forms have stable identities. Anonymous grid forms use field names,
    // including entity-specific names, so another page of rows cannot inherit them.
    var layout = form.id ? [] : controlsFor(form).map(controlKey).sort();
    return JSON.stringify({
      page: page.pathname, mode: modeFor(form, page),
      method: String(form.method || 'get').toLowerCase(),
      action: action ? action.pathname + action.search : '', id: form.id || '', entities: entities, layout: layout
    });
  }

  function capture(controls) {
    var fields = {};
    controls.forEach(function (control) {
      if (!isEditable(control)) return;
      var data = descriptor(control), type = data.type;
      if (/^(checkbox|radio)$/.test(type)) data.checked = Boolean(control.checked);
      else if (control.tagName.toLowerCase() === 'select' && control.multiple) data.values = Array.from(control.options || []).filter(function (option) { return option.selected; }).map(function (option) { return String(option.value); });
      else data.value = String(control.value == null ? '' : control.value);
      fields[controlKey(control)] = data;
    });
    return fields;
  }

  function restore(controls, fields) {
    var names = [], restored = [];
    controls.forEach(function (control) {
      if (!isEditable(control)) return;
      var key = controlKey(control), data = fields && fields[key];
      if (!data || JSON.stringify(descriptor(control)) !== JSON.stringify({name:data.name, id:data.id, type:data.type, choice:data.choice})) return;
      if (/^(checkbox|radio)$/.test(data.type)) control.checked = data.checked === true;
      else if (control.tagName.toLowerCase() === 'select') {
        if (control.multiple && Array.isArray(data.values)) {
          Array.from(control.options || []).forEach(function (option) { option.selected = data.values.indexOf(String(option.value)) !== -1; });
        } else if (typeof data.value === 'string' && Array.from(control.options || []).some(function (option) { return String(option.value) === data.value; })) control.value = data.value;
        else return;
      } else if (typeof data.value === 'string') control.value = data.value;
      else return;
      if (control.dataset) { control.dataset.stockDraftRestored = '1'; control.dataset.stockDirty = '1'; }
      restored.push(control);
      if (names.indexOf(control.name || control.id) === -1) names.push(control.name || control.id);
    });
    return {fields:names, controls:restored};
  }

  function safeSavedURL(value, target) {
    if (typeof value !== 'string' || value.length > 4000) return null;
    var saved = canonicalURL(value, target.href);
    if (!saved || saved.origin !== target.origin || saved.pathname !== target.pathname || FORBIDDEN_PATH.test(saved.pathname)) return null;
    if (Array.from(saved.searchParams.keys()).some(function (name) { return SENSITIVE_NAME.test(name) || /^_stock_/.test(name); })) return null;
    return saved;
  }

  function markerKeys(marker, prefix) {
    var entries = Array.isArray(marker) ? marker : [marker];
    return entries.map(function (entry) { return entry && entry.key; }).filter(function (key) {
      return typeof key === 'string' && key.indexOf(prefix + 'form:') === 0 && key.length <= 30000;
    });
  }

  var core = {identityPrefix:identityPrefix, identityDigest:identityDigest, eligibleForm:eligibleForm, isEditable:isEditable, formIdentity:formIdentity, controlKey:controlKey, capture:capture, restore:restore, safeSavedURL:safeSavedURL, markerKeys:markerKeys};
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (!windowObject) return;

  function initialize() {
    var document = windowObject.document, body = document.body;
    var user = body && body.getAttribute('data-stock-user'), instance = body && body.getAttribute('data-stock-instance');
    if (!user || !instance || FORBIDDEN_PATH.test(windowObject.location.pathname)) return;
    var page = canonicalURL(windowObject.location.href, windowObject.location.href);
    if (!page) return;
    var prefix = identityPrefix(user, instance), storage, enabled = true, warned = false;
    var records = [], formRecords = new WeakMap(), looseRecords = new WeakMap(), toast, toastTimer, remembered = false, restoredAny = false;
    var scrollTimer, documentMode = ['mode','tab'].map(function (name) { return name + '=' + (page.searchParams.get(name) || ''); }).join('&');
    var scrollKey = prefix + 'scroll:' + page.pathname + page.search;

    function notify(message, warning) {
      if (!toast) {
        toast = document.createElement('div');
        toast.setAttribute('role','status'); toast.setAttribute('aria-live','polite');
        toast.id = 'stock-draft-notice';
        Object.assign(toast.style, {position:'fixed',bottom:'22px',right:'22px',zIndex:'1000',padding:'10px 15px',borderRadius:'8px',boxShadow:'0 3px 14px #142f4820',fontSize:'13px',maxWidth:'min(420px, calc(100vw - 44px))',lineHeight:'1.6'});
        body.appendChild(toast);
      }
      toast.style.background = warning ? '#fff3dc' : '#edf6ff';
      toast.style.color = warning ? '#8a5511' : '#275071';
      toast.textContent = message; toast.hidden = false;
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.hidden = true; }, warning ? 6500 : 3300);
    }

    function unavailable() {
      enabled = false;
      if (!warned) { warned = true; notify('当前窗口暂时无法保留未提交内容，请保存后再切换页面。', true); }
    }

    function read(key) {
      if (!enabled) return null;
      var raw;
      try { raw = storage.getItem(key); }
      catch (_) { unavailable(); return null; }
      if (!raw) return null;
      try { return JSON.parse(raw); }
      catch (_) { remove(key); return null; }
    }

    function write(key, value) {
      if (!enabled) return false;
      try { storage.setItem(key, JSON.stringify(value)); return true; }
      catch (_) { unavailable(); return false; }
    }

    function remove(key) {
      if (!enabled) return false;
      try { storage.removeItem(key); return true; }
      catch (_) { unavailable(); return false; }
    }

    try {
      storage = windowObject.sessionStorage;
      storage.setItem(prefix + 'available','1'); storage.removeItem(prefix + 'available');
    } catch (_) { enabled = false; }

    function savedAt(key) { var value = read(prefix + 'saved:' + key); return value && Number(value.at) || 0; }

    function clearSaved(key) {
      if (!enabled || key.indexOf(prefix + 'form:') !== 0) return;
      var at=Math.max(Date.now(),savedAt(key)+1);
      remove(key); write(prefix + 'saved:' + key, {at:at});
    }

    var markerElement = document.getElementById('stock-draft-saved');
    if (markerElement && enabled) {
      try { markerKeys(JSON.parse(markerElement.textContent || 'null'), prefix).forEach(clearSaved); } catch (_) { /* An invalid marker must not remove a draft. */ }
    }

    function filterNotice(record, pending) {
      if (!record.form || String(record.form.method || 'get').toLowerCase() !== 'get') return;
      if (pending && !record.notice) {
        record.notice = document.createElement('div');
        record.notice.setAttribute('role','status');
        record.notice.textContent = '筛选条件尚未应用，点击筛选后更新结果。';
        Object.assign(record.notice.style,{fontSize:'12px',color:'#9b651f',flexBasis:'100%',marginTop:'5px'});
        record.form.appendChild(record.notice);
      }
      if (record.notice) record.notice.hidden = !pending;
    }

    function currentControls(record) { return record.form ? controlsFor(record.form) : [record.control]; }

    function persist(record, quiet) {
      clearTimeout(record.timer);
      if (!record.dirty) return;
      if (!enabled) { unavailable(); return; }
      var fields = capture(currentControls(record)), changed = JSON.stringify(fields) !== record.baseline;
      record.dirty = changed;
      filterNotice(record, changed);
      if (!changed) { remove(record.key); return; }
      if (write(record.key,{version:STORAGE_VERSION,at:Date.now(),identity:record.identity,fields:fields}) && !quiet && !remembered) {
        remembered = true; notify('未提交内容已保留');
      }
    }

    function makeRecord(form, control) {
      if (form && !eligibleForm(form, page)) return null;
      if (!form && (!isEditable(control) || control.form || !control.id && !control.name)) return null;
      var identity=form ? formIdentity(form,page) : page.pathname+'|'+documentMode+'|'+controlKey(control);
      var key = prefix + (form ? 'form:' : 'field:') + identityDigest(identity);
      var record = {form:form,control:control,key:key,identity:identity,dirty:false,baseline:JSON.stringify(capture(form ? controlsFor(form) : [control])),seenSaved:form ? savedAt(key) : 0};
      records.push(record);
      if (form) {
        formRecords.set(form, record);
        if (String(form.method || 'get').toLowerCase() !== 'get') {
          var hidden = Array.from(form.elements || []).find(function (element) { return element.name === '_stock_draft_key'; });
          if (!hidden) { hidden = document.createElement('input'); hidden.type='hidden'; hidden.name='_stock_draft_key'; form.appendChild(hidden); }
          hidden.value = key;
        }
      } else looseRecords.set(control,record);
      var state = read(key);
      if (state && state.version === STORAGE_VERSION && state.identity===identity && state.fields && typeof state.fields === 'object') {
        var restored = restore(currentControls(record),state.fields);
        if (restored.controls.length) {
          record.dirty = JSON.stringify(capture(currentControls(record))) !== record.baseline;
          filterNotice(record,record.dirty);
          restoredAny = true;
          if (form) form.dispatchEvent(new CustomEvent('stock:draft-restored',{bubbles:true,detail:{form:form,fields:restored.fields}}));
          else {
            control.dispatchEvent(new Event('input',{bubbles:true}));
            control.dispatchEvent(new Event('change',{bubbles:true}));
            control.dispatchEvent(new CustomEvent('stock:draft-restored',{bubbles:true,detail:{control:control,fields:restored.fields}}));
          }
        }
      }
      return record;
    }

    Array.from(document.forms || []).forEach(function (form) { makeRecord(form,null); });
    Array.from(document.querySelectorAll('input,select,textarea')).forEach(function (control) { if (!control.form) makeRecord(null,control); });
    if (restoredAny && enabled) notify('未提交内容已恢复');

    function onEdit(event) {
      var control = event.target;
      if (!isEditable(control)) return;
      var form = control.form, record = form ? formRecords.get(form) : looseRecords.get(control);
      if (!record) record = makeRecord(form || null,form ? null : control);
      if (!record) return;
      if (control.dataset) control.dataset.stockDirty='1';
      record.dirty=true; filterNotice(record,true);
      clearTimeout(record.timer); record.timer=setTimeout(function () { persist(record,false); },180);
    }
    document.addEventListener('input',onEdit);
    document.addEventListener('change',onEdit);

    document.addEventListener('submit',function (event) {
      var form=event.target,record=formRecords.get(form);
      if (!record) return;
      if (String(form.method || 'get').toLowerCase()==='get' && !event.defaultPrevented) {
        // The new URL is the saved, applied filter; it is not an unsaved business action.
        clearTimeout(record.timer); remove(record.key); record.dirty=false;
        record.baseline=JSON.stringify(capture(currentControls(record))); filterNotice(record,false);
      } else persist(record,true);
    });

    function clearForm(form) {
      var record=form && formRecords.get(form);
      if (!record) return;
      clearTimeout(record.timer); clearSaved(record.key);
      record.seenSaved=savedAt(record.key); record.dirty=false;
      record.baseline=JSON.stringify(capture(currentControls(record))); filterNotice(record,false);
    }
    document.addEventListener('stock:draft-saved',function (event) { clearForm(event.detail && event.detail.form || (event.target && event.target.tagName==='FORM' ? event.target : null)); });
    document.addEventListener('reset',function (event) {
      var form=event.target;
      setTimeout(function () { if (!event.defaultPrevented) clearForm(form); },0);
    });

    function rememberURL() {
      if (!enabled) return;
      var saved=safeSavedURL(page.href,page);
      if (saved) write(prefix+'url:'+page.pathname,{url:saved.pathname+saved.search});
    }
    rememberURL();
    Array.from(document.querySelectorAll('.topbar .nav a[href]')).forEach(function (link) {
      var target=canonicalURL(attribute(link,'href'),page.href);
      if (!target || target.origin!==page.origin || target.search || target.hash || FORBIDDEN_PATH.test(target.pathname)) return;
      var rememberedURL=read(prefix+'url:'+target.pathname),saved=rememberedURL && safeSavedURL(rememberedURL.url,target);
      if (saved && saved.search) link.setAttribute('href',saved.pathname+saved.search);
    });

    function fullscreen() {
      return Boolean(document.fullscreenElement || body.classList.contains('fullscreen') || body.classList.contains('dashboard-fullscreen') || attribute(body,'data-stock-scroll')==='off');
    }
    function scrollContainers() { return Array.from(document.querySelectorAll('.scroll,.excel-grid,[data-stock-scroll="keep"]')).slice(0,20); }
    function storeScroll() {
      if (!enabled || fullscreen()) return;
      write(scrollKey,{x:windowObject.scrollX || 0,y:windowObject.scrollY || 0,containers:scrollContainers().map(function (element,index) { return {id:element.id || '',index:index,x:element.scrollLeft || 0,y:element.scrollTop || 0}; })});
    }
    function restoreScroll() {
      if (!enabled || fullscreen()) return;
      var scroll=read(scrollKey);
      if (!scroll || !Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) return;
      windowObject.requestAnimationFrame(function () { windowObject.requestAnimationFrame(function () {
        if (fullscreen()) return;
        windowObject.scrollTo(Math.max(0,scroll.x),Math.max(0,scroll.y));
        var containers=scrollContainers();
        (scroll.containers || []).forEach(function (saved) {
          var element=saved.id ? document.getElementById(saved.id) : containers[saved.index];
          if (element && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { element.scrollLeft=Math.max(0,saved.x); element.scrollTop=Math.max(0,saved.y); }
        });
      }); });
    }
    windowObject.addEventListener('scroll',function () { clearTimeout(scrollTimer);scrollTimer=setTimeout(storeScroll,180); },{passive:true});
    document.addEventListener('scroll',function (event) { if (event.target!==document) { clearTimeout(scrollTimer);scrollTimer=setTimeout(storeScroll,180); } },{passive:true,capture:true});
    function flush() { records.forEach(function (record) { persist(record,true); });storeScroll(); }
    windowObject.addEventListener('pagehide',flush);
    document.addEventListener('visibilitychange',function () { if (document.hidden) flush(); });
    windowObject.addEventListener('pageshow',function (event) {
      // A back/forward cache page from before a successful save must fetch fresh
      // saved values; unrelated row drafts are restored after that ordinary GET.
      if (event.persisted && records.some(function (record) { return record.form && savedAt(record.key)>record.seenSaved; })) windowObject.location.reload();
    });
    restoreScroll();
    windowObject.StockDrafts={clear:clearForm,flush:flush,keyFor:function (form) { var record=formRecords.get(form);return record ? record.key : ''; }};
  }

  if (windowObject.document.readyState==='loading') windowObject.document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})(typeof window!=='undefined' ? window : (typeof globalThis!=='undefined' ? globalThis : null));
