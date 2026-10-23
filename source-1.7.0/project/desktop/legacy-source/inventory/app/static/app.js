/* 库存核对台 —— 少量原生 JS。刻意不引入任何框架/构建工具。 */
(function () {
  'use strict';

  // 1) 危险操作二次确认：<form data-confirm="..."> 或 <button data-confirm="...">
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var msg = f.getAttribute && f.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
    }
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-confirm-click]');
    if (el && !window.confirm(el.getAttribute('data-confirm-click'))) {
      e.preventDefault();
    }
  });

  // 2) 全选（差异表批量审核）
  document.querySelectorAll('[data-checkall]').forEach(function (box) {
    box.addEventListener('change', function () {
      var scope = document.querySelector(box.getAttribute('data-checkall'));
      if (!scope) return;
      scope.querySelectorAll('input[type=checkbox][name]').forEach(function (c) {
        c.checked = box.checked;
      });
    });
  });

  // 3) 数量输入框：聚焦时全选，方便直接覆盖输入
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t.tagName === 'INPUT' && (t.type === 'number' || t.classList.contains('qty-input'))) {
      setTimeout(function () { try { t.select(); } catch (err) {} }, 0);
    }
  });

  // 4) 速录框：商品编号 → 回车跳到数量；数量 → 回车提交
  var fastKey = document.querySelector('input[name=key].big');
  var fastQty = document.querySelector('input[name=qty].big');
  if (fastKey && fastQty) {
    fastKey.focus();
    fastKey.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        fastQty.focus();
      }
    });
    fastQty.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (fastQty.value.trim() !== '' && fastQty.form) fastQty.form.submit();
      }
      if (e.key === 'Escape') { fastKey.focus(); }
    });
  } else if (fastKey) {
    fastKey.focus();
  }

  // 5) 表格回录：Enter 跳到下一个数量框，而不是提交整个表单
  document.querySelectorAll('form[data-grid] input.qty-input').forEach(function (inp, i, all) {
    inp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var nxt = all[i + 1];
      if (nxt) { nxt.focus(); } else { inp.blur(); }
    });
  });

  // 6) 离开页面时提醒未保存的表格回录
  var grid = document.querySelector('form[data-grid]');
  if (grid) {
    var dirty = false;
    grid.addEventListener('input', function () { dirty = true; });
    grid.addEventListener('submit', function () { dirty = false; });
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // 7) 批量粘贴：实时统计行数
  var bulk = document.querySelector('textarea[name=bulk]');
  if (bulk) {
    var counter = document.getElementById('bulk-count');
    var upd = function () {
      var n = bulk.value.split('\n').filter(function (l) { return l.trim() !== ''; }).length;
      if (counter) counter.textContent = n + ' 行';
    };
    bulk.addEventListener('input', upd);
    upd();
  }

  // 8) 商品主数据：批量设分类。勾了几个实时显示，一个没勾就把按钮禁掉——
  //    让人先看到「点了会改几条」，比点完再弹一句「一个都没勾」友好得多。
  var catForm = document.getElementById('catmulti');
  if (catForm) {
    var catN = document.getElementById('cat-n');
    var catApply = document.getElementById('cat-apply');
    var catBoxes = document.querySelectorAll('input[form="catmulti"][name="ids"]');
    var catUpd = function () {
      var n = 0;
      catBoxes.forEach(function (b) { if (b.checked) { n++; } });
      if (catN) { catN.textContent = n; }
      document.querySelectorAll('.catbar').forEach(function (bar) {
        bar.classList.toggle('has', n > 0);
      });
      if (catApply) { catApply.disabled = (n === 0); }
    };
    catBoxes.forEach(function (b) { b.addEventListener('change', catUpd); });
    catUpd();
  }
})();
