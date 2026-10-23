(function () {
  'use strict';
  var upload = document.querySelector('[data-transfer-upload]');
  if (upload) {
    var fileInput = upload.querySelector('input[type="file"]');
    var fileLabel = upload.querySelector('[data-transfer-file-name]');
    fileInput.addEventListener('change', function () {
      fileLabel.textContent = fileInput.files.length ? fileInput.files[0].name : '尚未选择文件';
    });
    upload.addEventListener('submit', function () {
      var button = upload.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = '正在读取原表…';
    });
  }
  var exporter = document.querySelector('[data-transfer-export]');
  if (!exporter) return;
  var sheetSelect = exporter.querySelector('[data-transfer-export-sheet]');
  var note = exporter.querySelector('[data-transfer-export-note]');
  function formatChanged() {
    var isCsv = exporter.querySelector('input[name="format"]:checked').value === 'csv';
    sheetSelect.disabled = !isCsv;
    sheetSelect.required = isCsv;
    if (isCsv) {
      sheetSelect.options[0].textContent = '请选择一张原工作表';
      if (!sheetSelect.value) sheetSelect.value = exporter.getAttribute('data-sheet') || '';
      note.textContent = 'CSV 只导出所选工作表的单元格值，不保留列宽、颜色或 Excel 公式。';
    } else {
      sheetSelect.value = '';
      sheetSelect.options[0].textContent = '全部 ' + (sheetSelect.options.length - 1) + ' 张工作表（Excel）';
      note.textContent = 'Excel 导出完整工作簿。原公式在 Excel 中重新计算，结果可能与原缓存金额不同。';
    }
  }
  exporter.querySelectorAll('input[name="format"]').forEach(function (input) {
    input.addEventListener('change', formatChanged);
  });
  exporter.addEventListener('submit', function (event) {
    if (exporter.querySelector('input[name="format"]:checked').value === 'csv' && !sheetSelect.value) {
      event.preventDefault();
      sheetSelect.focus();
      sheetSelect.reportValidity();
    }
  });
  formatChanged();
})();
