/* 马赛克草稿与原文分开：只记住默认外观，不把分组字词或选中字串写入本机配置。 */
const QuoteCardMaskUI = (() => {
  'use strict';
  const M = QuoteCardMosaic, $ = id => document.getElementById(id);
  const storageKey = 'aionshome.quote-card.mask-style.v1';
  const names = { text: '正文', title: '标题', signature: '落款' };
  const kindNames = { pixel: '方块', solid: '纯色', frost: '磨砂', stripe: '斜线', text: '文字', pattern: '图案', image: '图片' };
  const fieldIds = { text: 'cardText', title: 'cardTitle', signature: 'cardSignature' };
  const controlIds = { kind: 'cardMaskKind', color: 'cardMaskColor', size: 'cardMaskSize', text: 'cardMaskReplacement', pattern: 'cardMaskPattern', patternCount: 'cardMaskPatternCount', imageSize: 'cardMaskImageSize', ignoreCase: 'cardMaskIgnoreCase' };
  let context, style = M.defaults(), keywords = '', rules = [], activeId = null, serial = 0;
  let ranges = [], previous = {}, uploading = false;
  const activeRule = () => rules.find(rule => rule.id === activeId);
  const currentStyle = () => activeRule()?.style || style;
  function persist() { try { localStorage.setItem(storageKey, JSON.stringify(style)); } catch {} }
  function setCurrentStyle(value) {
    const rule = activeRule();
    if (rule) rule.style = M.normalize(value); else style = M.normalize(value);
  }
  function selectRule(id) { activeId = id; controls(); ruleList(); }
  function controls() {
    const rule = activeRule(), editing = currentStyle();
    $('cardMaskEnabled').checked = style.enabled;
    $('cardMaskEditingLabel').textContent = rule ? `正在编辑第 ${rules.indexOf(rule) + 1} 组` : '正在编辑默认样式';
    $('cardMaskRuleEnabledField').hidden = !rule;
    $('cardMaskRuleEnabled').checked = editing.enabled;
    const value = rule ? rule.keywords : keywords;
    if ($('cardMaskKeywords').value !== value) $('cardMaskKeywords').value = value;
    $('cardMaskKeywordsLabel').textContent = rule ? '这组要遮挡的字词' : '通用字词（使用默认样式）';
    for (const [key, id] of Object.entries(controlIds)) {
      if ($(id).type === 'checkbox') $(id).checked = editing[key]; else if ($(id).value !== String(editing[key])) $(id).value = editing[key];
    }
    $('cardMaskSizeValue').textContent = editing.size;
    $('cardMaskPatternCountValue').textContent = editing.patternCount;
    $('cardMaskImageSizeValue').textContent = editing.imageSize + ' 倍字高';
    $('cardMaskTextField').hidden = editing.kind !== 'text';
    $('cardMaskPatternField').hidden = editing.kind !== 'pattern';
    $('cardMaskImageField').hidden = editing.kind !== 'image';
    $('cardMaskSizeField').hidden = !['pixel', 'stripe'].includes(editing.kind);
    $('cardMaskUploadImageBtn').disabled = uploading;
    $('cardMaskRemoveImageBtn').disabled = !editing.image || uploading;
    $('cardMaskImageNote').textContent = editing.image ? '本组已选择遮挡图片' : '本组还没有选择图片';
  }
  function ruleList() {
    const list = $('cardMaskRuleList'); list.replaceChildren();
    const append = rule => {
      const row = document.createElement('div'); row.className = 'card-mask-rule';
      const choose = document.createElement('button'); choose.className = 'card-mask-rule-choose';
      choose.setAttribute('aria-pressed', String(rule ? activeId === rule.id : activeId === null));
      const heading = document.createElement('strong'), summary = document.createElement('span');
      const itemStyle = rule ? rule.style : style;
      heading.textContent = `${rule ? `第 ${rules.indexOf(rule) + 1} 组` : '默认样式'} · ${kindNames[itemStyle.kind]}${rule && !itemStyle.enabled ? '（已暂停）' : ''}`;
      const words = (rule ? rule.keywords : keywords).trim().split(/\r?\n/).filter(Boolean).join('、');
      summary.textContent = words || (rule ? '点这里填写字词和选择样式' : '通用字词与未单独设置的手动选择');
      choose.append(heading, summary); choose.addEventListener('click', () => selectRule(rule?.id ?? null)); row.append(choose);
      if (rule) {
        const up = document.createElement('button'); up.textContent = '上移'; up.disabled = rules.indexOf(rule) === 0;
        up.setAttribute('aria-label', `上移第 ${rules.indexOf(rule) + 1} 组遮挡规则`);
        up.addEventListener('click', () => { const index = rules.indexOf(rule); [rules[index - 1], rules[index]] = [rules[index], rules[index - 1]]; controls(); ruleList(); context.onChange(); });
        const remove = document.createElement('button'); remove.textContent = '删除'; remove.setAttribute('aria-label', `删除第 ${rules.indexOf(rule) + 1} 组遮挡规则`);
        remove.addEventListener('click', () => { rules = rules.filter(item => item !== rule); if (activeId === rule.id) activeId = null; controls(); ruleList(); context.onChange(); });
        row.append(up, remove);
      }
      list.append(row);
    };
    // 分组按列表顺序优先；默认规则放在最后，但始终保留为简单的一套统一遮挡。
    rules.forEach(append); append(null);
  }
  function manualList() {
    $('cardMaskManualCount').textContent = `${ranges.length} 处手动选择`;
    $('cardMaskManualList').replaceChildren();
    ranges.forEach((range, index) => {
      const row = document.createElement('div'); row.className = 'card-mask-manual-item';
      const text = document.createElement('span'); text.textContent = `${names[range.field]} · ${range.text.slice(0, 24)}${range.text.length > 24 ? '…' : ''} · ${range.style ? kindNames[range.style.kind] : '默认样式'}`;
      const apply = document.createElement('button'); apply.textContent = '套用当前'; apply.setAttribute('aria-label', `为第 ${index + 1} 处手动遮挡套用当前样式`);
      apply.addEventListener('click', () => { if (activeRule()) range.style = { ...currentStyle(), enabled: true }; else delete range.style; manualList(); context.onChange(); });
      const remove = document.createElement('button'); remove.textContent = '取消'; remove.setAttribute('aria-label', `取消第 ${index + 1} 处手动遮挡`);
      remove.addEventListener('click', () => { ranges.splice(index, 1); manualList(); context.onChange(); });
      row.append(text, apply, remove); $('cardMaskManualList').append(row);
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
    // 返回样式快照，异步加载多张图片期间继续编辑不会改变这一帧的规则。
    return { style: { ...style }, keywords: style.enabled ? M.words(keywords) : [], ranges: ranges.map(range => ({ ...range, ...(range.style ? { style: { ...range.style } } : {}) })),
      rules: rules.map(rule => ({ style: { ...rule.style }, keywords: style.enabled && rule.style.enabled ? M.words(rule.keywords) : [] })) };
  }
  function resetDraft() { ranges = []; previous = {}; manualList(); }
  function addSelection(field) {
    sync();
    const input = $(fieldIds[field]), start = input.selectionStart, end = input.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) { context.status(`先在${names[field]}输入框里选中想遮挡的字，再点“遮挡所选”。`); input.focus(); return; }
    let range = ranges.find(range => range.field === field && range.start === start && range.end === end);
    if (!range) { range = { field, start, end, text: input.value.slice(start, end) }; ranges.push(range); }
    if (activeRule()) range.style = { ...currentStyle(), enabled: true }; else delete range.style;
    style.enabled = true; persist(); controls(); ruleList(); manualList(); context.onChange(); context.status('已用当前样式遮挡这一次选择；相同字词的其他位置不会自动遮挡。');
  }
  function receiveResult(result) {
    const detail = Object.entries(result.maskCounts || {}).filter(([, count]) => count).map(([field, count]) => `${names[field]} ${count} 处`).join('、');
    $('cardMaskStats').textContent = !style.enabled ? '分享遮挡已暂停' : result.maskCount ? `已遮挡 ${result.maskCount} 处${detail ? '（' + detail + '）' : ''}` : '还没有命中遮挡：可以手动选字，或输入批量字词。';
  }
  async function upload(file) {
    if (!file || uploading) return;
    if (file.size > 20 * 1024 * 1024) { context.status('遮挡图片请选择 20 MB 以内的文件。', true); $('cardMaskImageFile').value = ''; return; }
    const targetId = activeId;
    uploading = true; controls(); context.status('正在读取遮挡图片…');
    try {
      const response = await fetch('/api/appearance/background', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Viewer-Token': context.getToken() }, body: file, signal: AbortSignal.timeout(120000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '图片上传失败');
      // 上传过程中可以切换规则；图片仍归属于发起上传的那组，不串到新选中的组。
      const target = targetId === null ? null : rules.find(rule => rule.id === targetId);
      if (targetId !== null && !target) { context.status('原来的遮挡组已删除，这张图片未应用。'); return; }
      if (target) target.style = M.normalize({ ...target.style, image: result.image });
      else { style = M.normalize({ ...style, image: result.image }); persist(); }
      controls(); ruleList(); context.onChange(); context.status('遮挡图片已更新到原来的组，不会更改卡片配图或聊天背景。');
    } catch (error) { context.status(error.message, true); }
    finally { uploading = false; $('cardMaskImageFile').value = ''; controls(); }
  }
  function init(value) {
    context = value;
    try { style = M.normalize(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { style = M.defaults(); }
    for (const [key, id] of Object.entries(controlIds)) $(id).addEventListener('input', () => {
      setCurrentStyle({ ...currentStyle(), [key]: $(id).type === 'checkbox' ? $(id).checked : $(id).value });
      controls(); ruleList(); persist(); context.onChange();
    });
    $('cardMaskEnabled').addEventListener('input', () => { style.enabled = $('cardMaskEnabled').checked; persist(); context.onChange(); });
    $('cardMaskRuleEnabled').addEventListener('input', () => { const rule = activeRule(); if (rule) rule.style.enabled = $('cardMaskRuleEnabled').checked; ruleList(); context.onChange(); });
    $('cardMaskAddRuleBtn').addEventListener('click', () => {
      const rule = { id: ++serial, keywords: '', style: { ...currentStyle(), enabled: true } };
      rules.push(rule); selectRule(rule.id); $('cardMaskKeywords').focus(); context.onChange();
    });
    for (const button of document.querySelectorAll('.card-mask-add')) {
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => addSelection(button.dataset.field));
    }
    $('cardMaskKeywords').addEventListener('input', () => { const rule = activeRule(); if (rule) rule.keywords = $('cardMaskKeywords').value; else keywords = $('cardMaskKeywords').value; ruleList(); context.onChange(); });
    $('cardMaskGoContentBtn').addEventListener('click', () => { context.showContent(); $('cardText').focus(); context.status('在输入框中选字，点“遮挡所选”会使用当前正在编辑的遮挡样式。'); });
    $('cardMaskClearManualBtn').addEventListener('click', () => { resetDraft(); context.onChange(); });
    $('cardMaskClearAllBtn').addEventListener('click', () => { resetDraft(); keywords = ''; rules = []; activeId = null; controls(); ruleList(); context.onChange(); context.status('已清空手动遮挡、批量字词和分组规则。'); });
    $('cardMaskUploadImageBtn').addEventListener('click', () => $('cardMaskImageFile').click());
    $('cardMaskImageFile').addEventListener('change', () => upload($('cardMaskImageFile').files[0]));
    $('cardMaskRemoveImageBtn').addEventListener('click', () => { setCurrentStyle({ ...currentStyle(), image: '' }); persist(); controls(); context.onChange(); });
    controls(); ruleList(); manualList();
  }
  return { init, configuration, resetDraft, receiveResult };
})();
