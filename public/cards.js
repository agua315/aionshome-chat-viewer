/* 卡片只处理摘句草稿，正文与数据库保持不变；样式独立保存在当前浏览器。 */
const ViewerCards = (() => {
  'use strict';
  const C = QuoteCardLayout, $ = id => document.getElementById(id);
  const storageKey = 'aionshome.quote-card.style.v1';
  let context, settings = C.defaults(), sources = [], sourceParts = [], capturedSelection = null;
  let initialized = false, busy = false, loadingSource = false, renderEpoch = 0, renderFrame = null;
  let renderError = '';
  const imageCache = new Map();
  const fields = { font: 'cardFont', align: 'cardAlign', fontSize: 'cardFontSize', lineHeight: 'cardLineHeight', padding: 'cardPadding', background: 'cardBackground', textColor: 'cardTextColor', thoughtColor: 'cardThoughtColor', accent: 'cardAccent', imageMode: 'cardImageMode', imageOpacity: 'cardImageOpacity', coverHeight: 'cardCoverHeight', width: 'cardWidth', format: 'cardFormat', minRatio: 'cardMinRatio', showSignature: 'cardShowSignature', showDate: 'cardShowDate', showMark: 'cardShowMark' };
  function persist() { try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch {} }
  function status(text, error = false) { $('cardStatus').textContent = text; $('cardStatus').classList.toggle('card-error', error); }
  function initPreviewSplit() {
    const workspace = $('cardWorkspace'), handle = $('cardPreviewResizer');
    const mobile = window.matchMedia('(max-width: 700px)'), splitKey = 'aionshome.quote-card.preview-split.v1';
    let ratio = 60, drag = null;
    const clamp = value => Math.max(20, Math.min(80, Math.round(value)));
    // 比例属于当前浏览器的界面偏好，与卡片内容、模板及导出图片尺寸分开保存。
    try { const saved = Number.parseFloat(localStorage.getItem(splitKey)); if (Number.isFinite(saved)) ratio = clamp(saved); } catch {}
    function apply(value) {
      ratio = clamp(value);
      workspace.style.setProperty('--card-preview-share', `${ratio}fr`);
      workspace.style.setProperty('--card-editor-share', `${100 - ratio}fr`);
      handle.setAttribute('aria-valuenow', String(ratio));
      handle.setAttribute('aria-valuetext', `预览 ${ratio}%，编辑 ${100 - ratio}%`);
      $('cardSplitLabel').textContent = `拖动调节 · ${ratio} / ${100 - ratio}`;
    }
    function persistSplit() { try { localStorage.setItem(splitKey, String(ratio)); } catch {} }
    function finishDrag(event) {
      if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
      const id = drag.id; drag = null;
      workspace.classList.remove('card-resizing');
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      persistSplit();
    }
    apply(ratio);
    handle.addEventListener('pointerdown', event => {
      if (!mobile.matches || event.button !== 0 || event.isPrimary === false || drag) return;
      const height = workspace.getBoundingClientRect().height - handle.getBoundingClientRect().height;
      if (height <= 0) return;
      event.preventDefault();
      drag = { id: event.pointerId, startY: event.clientY, ratio, height };
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
      workspace.classList.add('card-resizing');
    });
    // Pointer Capture 兼容手指和鼠标，拖出细分隔条后仍能连续调节，不会滚动编辑区。
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      apply(drag.ratio + (event.clientY - drag.startY) * 100 / drag.height);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, finishDrag);
    handle.addEventListener('dblclick', event => { event.preventDefault(); apply(60); persistSplit(); });
    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 10 : 2;
      const values = { ArrowUp: ratio - step, ArrowDown: ratio + step, Home: 20, End: 80 };
      if (!mobile.matches || !(event.key in values)) return;
      event.preventDefault(); apply(values[event.key]); persistSplit();
    });
    $('cardDialog').addEventListener('close', () => finishDrag());
    window.addEventListener('resize', () => finishDrag());
  }
  function speaker(speaker) {
    const names = context.getState().names;
    return ({ user: names.user, assistant: names.aion, aion: names.aion, connor: names.connor, system: '系统', cam_user: '监控操作', cam_log: '监控记录', cam_trigger: '监控触发' })[speaker] || speaker || '';
  }
  function plainText(raw) {
    const container = document.createElement('div');
    // 与聊天阅读相同的 Markdown 规则，只取文字，不带截图、按钮或 HTML 样式。
    container.innerHTML = ChatroomMarkdown.render(String(raw || '').replace(/\[\[image:[^\]]+\]\]/g, ''));
    for (const br of container.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
    for (const block of container.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr')) block.append(document.createTextNode('\n'));
    return (container.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function sourceFrom(message, conversation) {
    const chapter = conversation.source === 'theater';
    let text = plainText(message.content);
    if (!text) text = (message.attachments || []).map(attachment => {
      const band = MessageDisplay.bandNote(attachment);
      return band?.text || attachment.transcript || attachment.transcription || attachment.text || attachment.note || '';
    }).filter(Boolean).join('\n');
    return { key: `${conversation.source}:${conversation.id}:${message.id}`, text, title: conversation.title || '', caption: chapter ? `第 ${message.chapter_number} 章${message.chapter_title ? ' · ' + message.chapter_title : ''}` : speaker(message.speaker), signature: chapter ? `${conversation.title || '小剧场'} · 第 ${message.chapter_number} 章` : speaker(message.speaker), chapter, created_at: message.created_at };
  }
  function controls() {
    $('cardDialog').style.setProperty('--card-thought-ink', settings.thoughtColor);
    for (const [key, id] of Object.entries(fields)) {
      if ($(id).type === 'checkbox') $(id).checked = settings[key]; else $(id).value = settings[key];
    }
    for (const key of ['fontSize', 'lineHeight', 'padding', 'coverHeight', 'imageOpacity']) $(`${fields[key]}Value`).textContent = String(settings[key]) + (key === 'imageOpacity' ? '%' : '');
    for (const button of $('cardTemplates').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.template === settings.template));
    $('cardCoverHeightField').hidden = settings.imageMode !== 'top';
    $('cardImageOpacityField').hidden = settings.imageMode !== 'full';
    $('cardRemoveImageBtn').disabled = !settings.image || busy;
    $('cardImageState').textContent = settings.image ? '已选择自己的图片' : '使用模板画面';
  }
  function setTab(name) {
    const content = name === 'content';
    $('cardContentTab').setAttribute('aria-selected', String(content)); $('cardStyleTab').setAttribute('aria-selected', String(name === 'style')); $('cardMaskTab').setAttribute('aria-selected', String(name === 'mask'));
    $('cardContentPanel').hidden = !content; $('cardStylePanel').hidden = name !== 'style'; $('cardMaskPanel').hidden = name !== 'mask';
    // 两个页签共用滚动容器，切换后从顶部开始，避免模板入口被上一个页签的滚动位置遮住。
    document.querySelector('#cardDialog .card-editor-scroll').scrollTop = 0;
  }
  function content() {
    const first = sources.find(source => source.created_at);
    // 保留输入框的原始下标；前后空白也参与手动选择的位置计算。
    return { text: $('cardText').value, title: $('cardTitle').value, signature: $('cardSignature').value, date: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium' }).format(first ? new Date(first.created_at * 1000) : new Date()) };
  }
  function loadImage(raw) {
    if (!raw) return Promise.resolve(null);
    if (!imageCache.has(raw)) imageCache.set(raw, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(raw); reject(new Error('配图暂时无法读取，请刷新登录状态或重新选择图片。')); };
      image.src = raw;
    }));
    return imageCache.get(raw);
  }
  async function render() {
    const epoch = ++renderEpoch;
    const value = content();
    $('cardTextCount').textContent = `${Array.from(value.text).length.toLocaleString()} 字`;
    $('cardSaveBtn').disabled = !value.text.trim() || busy;
    try {
      const masking = QuoteCardMaskUI.configuration();
      const image = await loadImage(settings.image);
      const maskImages = new Map(), maskImageErrors = new Map();
      // 多组规则和手动遮挡可以各自用图；重复路径只加载一次，失效图片继续用色块安全预览。
      const maskStyles = masking.style.enabled ? [masking.style, ...masking.rules.filter(rule => rule.style.enabled).map(rule => rule.style), ...masking.ranges.map(range => range.style).filter(Boolean)] : [];
      const paths = [...new Set(maskStyles.filter(style => style.kind === 'image' && style.image).map(style => style.image))];
      await Promise.all(paths.map(async path => {
        try { maskImages.set(path, await loadImage(path)); } catch (error) { maskImageErrors.set(path, error); }
      }));
      if (document.fonts?.ready) await document.fonts.ready;
      if (epoch !== renderEpoch || !$('cardDialog').open) return false;
      const dimensions = QuoteCardRenderer.paint($('cardCanvas'), settings, { ...value, text: value.text.trim() ? value.text : '先挑几句喜欢的话，\n再把它们留在这里。' }, image, masking, maskImages);
      QuoteCardMaskUI.receiveResult(dimensions);
      $('cardDimensions').textContent = `${dimensions.width} × ${dimensions.height} 像素 · 一张完整${dimensions.height > dimensions.width * 1.9 ? '长' : ''}图${dimensions.reduced ? ' · 已适配超长内容尺寸' : ''}${dimensions.maskCount ? ` · 已遮挡 ${dimensions.maskCount} 处` : ''}`;
      if (dimensions.missingMaskImages.length) {
        const error = dimensions.missingMaskImages.map(path => maskImageErrors.get(path)).find(Boolean);
        renderError = error?.message || '有遮挡组未选图片，已用色块暂代；请为它选择图片或更换样式后再保存。';
        status(renderError, true); $('cardSaveBtn').disabled = true; return false;
      }
      // 修复缺图或字词输入后，清除由上一帧留下的错误；不覆盖上传等其他操作的提示。
      if (renderError && $('cardStatus').textContent === renderError) status('预览已更新，可以保存图片。');
      renderError = '';
      $('cardSaveBtn').disabled = !value.text.trim() || busy;
      return dimensions;
    } catch (error) { if (epoch === renderEpoch) { renderError = error.message; status(renderError, true); $('cardSaveBtn').disabled = true; } return false; }
  }
  function scheduleRender() { if (renderFrame) cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); }); }
  function sourceCount() {
    const checked = [...$('cardSourceList').querySelectorAll('input')].filter(input => input.checked).length;
    $('cardSourceCount').textContent = `（${sources.length} 段原文 · 已选 ${checked} 句）`;
    $('cardAddSentencesBtn').disabled = !checked;
  }
  function renderSources() {
    sourceParts = [];
    $('cardSourceList').replaceChildren(); $('cardSourceDetails').hidden = !sources.length;
    for (const source of sources) {
      const label = document.createElement('div'); label.className = 'card-source-group'; label.textContent = `${source.title}${source.title ? ' · ' : ''}${source.caption}`; $('cardSourceList').append(label);
      for (const text of C.sentences(source.text)) {
        const index = sourceParts.length; sourceParts.push(text);
        const row = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = index;
        const runs = C.thoughtRuns(text);
        if (runs.length && runs.every(run => run.thought)) row.className = 'card-source-thought';
        input.addEventListener('change', sourceCount); row.append(input, document.createTextNode(runs.map(run => run.text).join(''))); $('cardSourceList').append(row);
      }
    }
    sourceCount();
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    try { settings = C.normalize(JSON.parse(localStorage.getItem(storageKey) || '{}')); } catch { settings = C.defaults(); }
    $('cardText').value = '把那些舍不得忘记的话，\n留在一张小小的卡片里。';
    $('cardSignature').value = '某个值得记住的瞬间';
    for (const template of C.templates) {
      const button = document.createElement('button'); button.className = 'card-template'; button.dataset.template = template.id; button.setAttribute('aria-label', template.name); button.setAttribute('aria-pressed', 'false');
      const sample = document.createElement('span'); sample.className = 'card-template-sample'; sample.textContent = '摘句';
      sample.style.background = template.cover === 'top' ? `linear-gradient(145deg,${template.colors[0]} 0%,${template.colors[1]} 52%,${template.bg} 52%)` : template.bg; sample.style.color = template.ink;
      const info = document.createElement('span'); info.className = 'card-template-info'; const name = document.createElement('strong'), note = document.createElement('small'); name.textContent = template.name; note.textContent = template.note; info.append(name, note); button.append(sample, info);
      button.addEventListener('click', () => {
        const old = settings;
        settings = { ...C.defaults(template.id), image: old.image, width: old.width, format: old.format, minRatio: old.minRatio, showSignature: old.showSignature, showDate: old.showDate, showMark: old.showMark };
        controls(); persist(); scheduleRender(); status(`已应用「${template.name}」，摘句内容保持不变。`);
      });
      $('cardTemplates').append(button);
    }
    controls();
  }
  function open(newSources = null, selectedText = null) {
    initialize(); $('cardSelectionFloat').hidden = true;
    if (newSources) {
      QuoteCardMaskUI.resetDraft();
      sources = newSources.filter(source => source.text);
      renderSources();
      const signature = [...new Set(sources.map(source => source.signature).filter(Boolean))].join(' / ');
      $('cardSignature').value = signature.slice(0, 300);
      $('cardTitle').value = sources.length === 1 && sources[0].chapter ? sources[0].title.slice(0, 180) : '';
      const all = sources.map(source => source.text).join('\n\n');
      // 小说章节不会整章塞进卡片；短消息可直接做卡，长文由用户逐句挑选。
      $('cardText').value = selectedText !== null ? selectedText : all.length <= 900 && !sources.some(source => source.chapter) ? all : '';
      $('cardSourceDetails').open = !selectedText && (!all || all.length > 900 || sources.some(source => source.chapter));
      if (!sources.length) status('这些记录没有可摘录的文字，可以直接输入想写的内容。');
      else status(selectedText !== null ? '已放入选中的原文，可继续调整排版。' : $('cardText').value ? '已放入消息正文，可删改或从原文重新挑句。' : '在“从原文挑几句话”中勾选想留下的句子。');
    } else status('可以直接写摘句，也可以加入已勾选的聊天消息。');
    setTab('content'); controls();
    if (!$('cardDialog').open) $('cardDialog').showModal();
    scheduleRender();
  }
  function close() { if (busy) return; renderEpoch++; $('cardDialog').close(); $('cardSelectionFloat').hidden = true; }
  function appendText(text) {
    const current = $('cardText').value.trim();
    const next = current ? current + '\n\n' + text : text;
    if (next.length > 50000) { status('卡片文字请控制在 5 万字以内，当前内容未被截断。', true); return false; }
    $('cardText').value = next; scheduleRender(); return true;
  }
  async function importSelected(append = false) {
    const selections = context.getSelections();
    if (!selections.length) { open(); status('先在聊天页点“选择消息”并勾选内容，也可以直接划选几句话。'); return; }
    if (loadingSource) return;
    loadingSource = true;
    try {
      const response = await context.api('/api/cards/messages', {}, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': context.getState().editToken }, body: JSON.stringify({ selections }) });
      const incoming = response.groups.flatMap(group => group.messages.map(message => sourceFrom(message, group))).filter(source => source.text);
      if (append === true && $('cardDialog').open) {
        // 在编辑器里“加入”时保留已改好的摘句，不覆盖当前草稿。
        const known = new Set(sources.map(source => source.key));
        const additions = incoming.filter(source => !known.has(source.key));
        sources.push(...additions); renderSources();
        const text = additions.map(source => source.text).join('\n\n');
        if (text && text.length <= 900 && !additions.some(source => source.chapter)) appendText(text);
        else if (additions.length) $('cardSourceDetails').open = true;
        status(additions.length ? '已加入新的原文，现有卡片文字保留。' : '勾选的消息已经在原文列表中，可以继续挑句。');
      } else open(incoming);
    } catch (error) { context.toast(error.message); }
    finally { loadingSource = false; }
  }
  function decorate(row, message, conversation) {
    if (!conversation || (!message.content && !message.attachments?.length)) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quote-message-btn'; button.textContent = '摘句'; button.setAttribute('aria-label', message.speaker === 'chapter' ? `从第 ${message.chapter_number} 章摘句` : '从这条消息摘句');
    button.addEventListener('click', () => open([sourceFrom(message, conversation)]));
    (row.querySelector('.message-meta') || row.querySelector('.chapter-heading'))?.append(button);
  }
  function captureSelection() {
    if ($('cardDialog').open) { $('cardSelectionFloat').hidden = true; return; }
    const selection = window.getSelection();
    const selected = selection?.toString().trim();
    const inside = node => node && $('messages').contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!selected || !inside(selection.anchorNode) || !inside(selection.focusNode)) { $('cardSelectionFloat').hidden = true; return; }
    const conversation = context.getState().selected;
    const anchorElement = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    const focusElement = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode.parentElement;
    const row = anchorElement.closest('.message');
    const message = context.getState().items.find(item => item.id === row?.dataset.messageId);
    const source = message && conversation ? sourceFrom(message, conversation) : { title: conversation?.title || '', text: selected, signature: conversation?.title || '', caption: '选中的原文' };
    // 阅读器里的独白已去掉原标记；划选时补回语义，卡片仍能识别为斜体独白。
    const thought = anchorElement.closest('.thought-text');
    let selectedText = selected;
    if (thought && thought === focusElement.closest('.thought-text')) selectedText = `[心里嘀咕：${selected}]`;
    else if (selection.rangeCount) {
      const fragment = selection.getRangeAt(0).cloneContents();
      if (fragment.querySelector('.inner-thought')) {
        for (const node of fragment.querySelectorAll('.inner-thought')) {
          const text = (node.querySelector('.thought-text')?.textContent || '').trim();
          node.replaceWith(document.createTextNode(`[心里嘀咕：${text}]`));
        }
        for (const node of fragment.querySelectorAll('.message-meta,.avatar,button,.thought-label')) node.remove();
        for (const node of fragment.querySelectorAll('p,div,article,h3')) node.append(document.createTextNode('\n'));
        selectedText = fragment.textContent.replace(/\n{3,}/g, '\n\n').trim();
      }
    }
    capturedSelection = { text: selectedText, source };
    $('cardSelectionFloat').hidden = false;
  }
  async function uploadImage(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { status('配图请选择 20 MB 以内的图片。', true); return; }
    $('cardUploadImageBtn').disabled = true; status('正在读取配图…');
    try {
      const response = await fetch('/api/appearance/background', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Viewer-Token': context.getState().editToken }, body: file, signal: AbortSignal.timeout(120000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '图片上传失败');
      settings.image = result.image; controls(); persist(); scheduleRender(); status('配图已更新，聊天背景保持原样。');
    } catch (error) { status(error.message, true); }
    finally { $('cardUploadImageBtn').disabled = false; $('cardImageFile').value = ''; }
  }
  async function save() {
    if (busy || !content().text.trim()) return;
    const rendered = await render();
    if (!rendered) return;
    busy = true; $('cardSaveBtn').disabled = true; $('cardSaveBtn').textContent = '正在保存…'; status('正在生成一张完整图片…');
    try {
      const format = settings.format;
      const blob = await new Promise((resolve, reject) => $('cardCanvas').toBlob(value => value ? resolve(value) : reject(new Error('浏览器无法保存这么大的图片，请调低图片宽度或字号后重试。')), format === 'jpg' ? 'image/jpeg' : 'image/png', .94));
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/\//g, '-');
      // 文件名也使用遮挡后的标题，避免图片藏好名字后从文件名又带出去。
      const filename = (rendered.safeTitle.trim() || '聊天摘句卡').replace(/[<>:"/\\|?*]/g, '_').slice(0, 70) + '-' + day + '.' + format;
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
      status(`已保存一张 ${$('cardCanvas').width} × ${$('cardCanvas').height} 像素的完整图片，请在浏览器下载列表查看。`); context.toast('摘句卡已生成，开始下载');
    } catch (error) { status(error.message, true); }
    finally { busy = false; $('cardSaveBtn').disabled = false; $('cardSaveBtn').textContent = '保存图片'; }
  }
  function init(value) {
    context = value;
    initPreviewSplit();
    QuoteCardMaskUI.init({ onChange: scheduleRender, status, getToken: () => context.getState().editToken, showContent: () => setTab('content') });
    $('quoteCardBtn').addEventListener('click', () => context.getSelections().length ? importSelected() : open());
    $('makeSelectedCardBtn').addEventListener('click', importSelected);
    $('cardImportSelectedBtn').addEventListener('click', () => importSelected(true));
    $('cardGoSelectBtn').addEventListener('click', () => { close(); context.beginSelection(); context.toast('勾选消息后，点“制作摘句卡”'); });
    $('closeCardBtn').addEventListener('click', close);
    $('cardDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('cardContentTab').addEventListener('click', () => setTab('content')); $('cardStyleTab').addEventListener('click', () => setTab('style'));
    $('cardMaskTab').addEventListener('click', () => setTab('mask'));
    for (const id of ['cardText', 'cardTitle', 'cardSignature']) $(id).addEventListener('input', scheduleRender);
    for (const [key, id] of Object.entries(fields)) $(id).addEventListener('input', () => {
      settings = C.normalize({ ...settings, [key]: $(id).type === 'checkbox' ? $(id).checked : $(id).value });
      controls(); persist(); scheduleRender();
    });
    $('cardAddSentencesBtn').addEventListener('click', () => {
      const text = [...$('cardSourceList').querySelectorAll('input')].filter(input => input.checked).map(input => sourceParts[Number(input.value)]).join('\n');
      if (text && appendText(text)) {
        for (const input of $('cardSourceList').querySelectorAll('input')) input.checked = false;
        sourceCount(); status('已把勾选的句子加入卡片，换行和文字都可以继续调整。');
      }
    });
    $('cardAddAllSourceBtn').addEventListener('click', () => { if (appendText(sources.map(source => source.text).join('\n\n'))) status('已加入完整原文，将生成一张长图。'); });
    $('cardPreviewActual').addEventListener('change', () => $('cardPreviewStage').classList.toggle('expanded', $('cardPreviewActual').checked));
    $('cardUploadImageBtn').addEventListener('click', () => $('cardImageFile').click()); $('cardImageFile').addEventListener('change', () => uploadImage($('cardImageFile').files[0]));
    $('cardRemoveImageBtn').addEventListener('click', () => { settings.image = ''; controls(); persist(); scheduleRender(); status('已移除卡片配图。'); });
    $('cardUseChatBackgroundBtn').addEventListener('click', async () => {
      try {
        const info = await context.api('/api/info'); const image = info.appearanceSettings?.background?.image;
        if (!image) { status('还没有设置聊天背景，可以点击“选择图片”添加配图。'); return; }
        settings.image = image; controls(); persist(); scheduleRender(); status('已用聊天背景做配图。');
      } catch (error) { status(error.message, true); }
    });
    $('cardResetStyleBtn').addEventListener('click', () => { const image = settings.image; settings = { ...C.defaults(settings.template), image }; controls(); persist(); scheduleRender(); status('已还原这套模板的配色和排版。'); });
    $('cardSaveBtn').addEventListener('click', save);
    $('cardSelectionFloat').addEventListener('pointerdown', event => event.preventDefault());
    $('cardSelectionFloat').addEventListener('click', () => { if (capturedSelection) open([capturedSelection.source], capturedSelection.text); });
    document.addEventListener('selectionchange', captureSelection);
  }
  return { init, decorate };
})();
