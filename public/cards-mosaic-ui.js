/* 马赛克草稿与原文分开：只记住外观，不把遮挡字词或选中字串写入本机配置。 */
const QuoteCardMaskUI = (() => {
  'use strict';
  const M = QuoteCardMosaic, $ = id => document.getElementById(id);
  const storageKey = 'aionshome.quote-card.mask-style.v1';
  const names = { text: '正文', title: '标题', signature: '落款' };
  const fieldIds = { text: 'cardText', title: 'cardTitle', signature: 'cardSignature' };
  const controlIds = { enabled: 'cardMaskEnabled', kind: 'cardMaskKind', color: 'cardMaskColor', size: 'cardMaskSize', text: 'cardMaskReplacement', pattern: 'cardMaskPattern', patternCount: 'cardMaskPatternCount', imageSize: 'cardMaskImageSize', ignoreCase: 'cardMaskIgnoreCase' };
  let context, style = M.defaults(), ranges = [], previous = {}, uploading = false;
  function persist() { try { localStorage.setItem(storageKey, JSON.stringify(style)); } catch {} }
  function controls() {
    for (const [key, id] of Object.entries(controlIds)) {
      if ($(id).type === 'checkbox') $(id).checked = style[key]; else $(id).value = style[key];
    }
    $('cardMaskSizeValue').textContent = style.size;
    $('cardMaskPatternCountValue').textContent = style.patternCount;
    $('cardMaskImageSizeValue').textContent = style.imageSize + ' 倍字高';
    $('cardMaskTextField').hidden = style.kind !== 'text';
    $('cardMaskPatternField').hidden = style.kind !== 'pattern';
    $('cardMaskImageField').hidden = style.kind !== 'image';
    $('cardMaskSizeField').hidden = !['pixel', 'stripe'].includes(style.kind);
    $('cardMaskRemoveImageBtn').disabled = !style.image || uploading;
    $('cardMaskImageNote').textContent = style.image ? '已选择遮挡图片' : '还没有选择图片';
  }
  function manualList() {
    $('cardMaskManualCount').textContent = `${ranges.length} 处手动选择`;
    $('cardMaskManualList').replaceChildren();
    ranges.forEach((range, index) => {
      const row = document.createElement('div'); row.className = 'card-mask-manual-item';
      const text = document.createElement('span'); text.textContent = `${names[range.field]} · ${range.text.slice(0, 24)}${range.text.length > 24 ? '…' : ''}`;
      const remove = document.createElement('button'); remove.textContent = '取消'; remove.setAttribute('aria-label', `取消第 ${index + 1} 处手动遮挡`);
      remove.addEventListener('click', () => { ranges.splice(index, 1); manualList(); context.onChange(); });
      row.append(text, remove); $('cardMaskManualList').append(row);
    });
    $('cardMaskClearManualBtn').disabled = !ranges.length;
  }
  function sync() {
    let changed = false;
    for (const [field, id] of Object.entries(fieldIds)) {
      const value = $(id).value;
      if (previous[field] !== undefined && previous[field] !== value) { ranges = M.rebaseRanges(previous[field], value, ranges, field); changed = true; }
      previous[field] = value;
    }
    if (changed) manualList();
  }
  function configuration() {
    sync();
    return { style, keywords: style.enabled ? M.words($('cardMaskKeywords').value) : [], ranges };
  }
  function resetDraft() { ranges = []; previous = {}; manualList(); }
  function addSelection(field) {
    sync();
    const input = $(fieldIds[field]), start = input.selectionStart, end = input.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) { context.status(`先在${names[field]}输入框里选中想遮挡的字，再点“遮挡所选”。`); input.focus(); return; }
    if (!ranges.some(range => range.field === field && range.start === start && range.end === end)) ranges.push({ field, start, end, text: input.value.slice(start, end) });
    style.enabled = true; persist(); controls(); manualList(); context.onChange(); context.status('已添加这一次选中的文字；相同字词的其他位置不会自动遮挡。');
  }
  function receiveResult(result) {
    const detail = Object.entries(result.maskCounts || {}).filter(([, count]) => count).map(([field, count]) => `${names[field]} ${count} 处`).join('、');
    $('cardMaskStats').textContent = !style.enabled ? '分享遮挡已暂停' : result.maskCount ? `已遮挡 ${result.maskCount} 处${detail ? '（' + detail + '）' : ''}` : '还没有命中遮挡：可以手动选字，或输入批量字词。';
  }
  async function upload(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { context.status('遮挡图片请选择 20 MB 以内的文件。', true); return; }
    uploading = true; $('cardMaskUploadImageBtn').disabled = true; context.status('正在读取遮挡图片…');
    try {
      const response = await fetch('/api/appearance/background', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Viewer-Token': context.getToken() }, body: file, signal: AbortSignal.timeout(120000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '图片上传失败');
      style.image = result.image; persist(); controls(); context.onChange(); context.status('遮挡图片已更新，不会更改卡片配图或聊天背景。');
    } catch (error) { context.status(error.message, true); }
    finally { uploading = false; $('cardMaskUploadImageBtn').disabled = false; $('cardMaskImageFile').value = ''; controls(); }
  }
  function init(value) {
    context = value;
    try { style = M.normalize(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { style = M.defaults(); }
    for (const [key, id] of Object.entries(controlIds)) $(id).addEventListener('input', () => {
      style = M.normalize({ ...style, [key]: $(id).type === 'checkbox' ? $(id).checked : $(id).value });
      controls(); persist(); context.onChange();
    });
    for (const button of document.querySelectorAll('.card-mask-add')) {
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => addSelection(button.dataset.field));
    }
    $('cardMaskKeywords').addEventListener('input', context.onChange);
    $('cardMaskGoContentBtn').addEventListener('click', () => { context.showContent(); $('cardText').focus(); context.status('在文字输入框中选中内容，再点旁边的“遮挡所选”。'); });
    $('cardMaskClearManualBtn').addEventListener('click', () => { resetDraft(); context.onChange(); });
    $('cardMaskClearAllBtn').addEventListener('click', () => { resetDraft(); $('cardMaskKeywords').value = ''; context.onChange(); context.status('已清空这张卡片的手动遮挡和批量字词。'); });
    $('cardMaskUploadImageBtn').addEventListener('click', () => $('cardMaskImageFile').click());
    $('cardMaskImageFile').addEventListener('change', () => upload($('cardMaskImageFile').files[0]));
    $('cardMaskRemoveImageBtn').addEventListener('click', () => { style.image = ''; persist(); controls(); context.onChange(); });
    controls(); manualList();
  }
  return { init, configuration, resetDraft, receiveResult };
})();
