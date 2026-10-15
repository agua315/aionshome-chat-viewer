/* 导出与阅读状态分开：切换会话或加载分页时保留选择，只记录 ID、不缓存旧正文。 */
const ViewerExport = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const selections = new Map();
  let context, selecting = false, busy = false, previewEpoch = 0, chapterEpoch = 0, previewTimer;
  const messageKey = item => `${item.source}:${item.conversationId}:${item.messageId}`;
  const selectedChapters = new Set();
  const help = {
    txt: '纯文本保留 Markdown 原文与图片说明，不把图片打包进 TXT。',
    docx: '适合长聊天，可在 Word / WPS 中继续编辑。使用现代 .docx 格式。',
    pptx: '每条消息按内容分页，长文会生成较多幻灯片。使用现代 .pptx 格式。',
    epub: '适合像小说一样阅读，内置会话 / 章节目录，可导入电子书阅读器。',
    pdf: '固定排版，保留 Markdown 样式和本地图片，长记录生成可能需要稍等。',
  };
  function rerender() {
    const top = $('messages').scrollTop;
    context.renderMessages();
    $('messages').scrollTop = top;
  }
  function updateSelection() {
    $('exportSelectionBar').hidden = !selecting;
    $('exportSelectionCount').textContent = `已选 ${selections.size} 条消息 / 章节`;
    $('exportSelectedNote').textContent = `已勾选 ${selections.size} 条消息 / 章节`;
    $('selectMessagesBtn').textContent = selecting ? '结束选择' : '选择消息';
    $('selectMessagesBtn').setAttribute('aria-pressed', String(selecting));
    $('exportSelectedBtn').disabled = !selections.size;
  }
  function setSelecting(value) { selecting = value; updateSelection(); rerender(); }
  function decorate(row, message, conversation) {
    if (!selecting || !conversation) return;
    const item = { source: conversation.source, conversationId: conversation.id, messageId: message.id };
    const key = messageKey(item);
    const label = document.createElement('label'); label.className = 'message-export-check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selections.has(key);
    checkbox.setAttribute('aria-label', message.speaker === 'chapter' ? `选择第 ${message.chapter_number} 章导出` : '选择这条消息导出');
    label.append(checkbox, document.createTextNode('选择'));
    row.classList.toggle('is-export-selected', checkbox.checked);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selections.set(key, item); else selections.delete(key);
      row.classList.toggle('is-export-selected', checkbox.checked); updateSelection();
    });
    (row.querySelector('.message-meta') || row.querySelector('.chapter-heading')).prepend(label);
  }
  function fillConversations() {
    const state = context.getState();
    function fill(id, items) {
      const select = $(id), previous = select.value;
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option'); option.value = `${item.source}:${item.id}`;
        option.textContent = `${item.title || '历史会话'} · ${item.count} ${item.source === 'theater' ? '章' : '条'}`;
        select.append(option);
      }
      const current = state.selected ? `${state.selected.source}:${state.selected.id}` : '';
      if ([...select.options].some(option => option.value === current)) select.value = current;
      else if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
    fill('exportConversation', state.conversations.filter(item => item.source !== 'theater'));
    fill('exportTheater', state.conversations.filter(item => item.source === 'theater'));
  }
  function conversation(id) {
    return context.getState().conversations.find(item => `${item.source}:${item.id}` === $(id).value);
  }
  function specification() {
    const state = context.getState();
    const scope = $('exportScope').value;
    const selected = conversation(scope === 'theater' ? 'exportTheater' : 'exportConversation');
    return {
      scope, format: $('exportFormat').value,
      conversation: selected ? { source: selected.source, id: selected.id } : null,
      selections: scope === 'selected' ? [...selections.values()] : [],
      search: { query: state.searchMode ? state.query : '', source: state.searchSource, id: state.searchId, kind: state.searchKind },
      selectedChapters: scope === 'theater' && $('exportSelectedChapters').checked,
      chapterIds: [...selectedChapters],
      includeSystem: $('exportIncludeSystem').checked,
      includeImages: $('exportIncludeImages').checked,
      includeMonitor: $('exportIncludeMonitor').checked && $('exportIncludeImages').checked,
      includeReasoning: $('exportIncludeReasoning').checked,
      includeTime: $('exportIncludeTime').checked,
    };
  }
  async function loadChapters() {
    const epoch = ++chapterEpoch;
    selectedChapters.clear(); $('exportChapterList').replaceChildren();
    const item = conversation('exportTheater');
    if (!item) return;
    $('exportChapterList').textContent = '正在读取章节目录…';
    try {
      const result = await context.api('/api/messages', { source: 'theater', id: item.id, position: 'first' });
      if (epoch !== chapterEpoch) return;
      $('exportChapterList').replaceChildren();
      for (const chapter of result.metadata.chapters || []) {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = chapter.id;
        label.append(input, document.createTextNode(`第 ${chapter.chapter_number} 章${chapter.chapter_title ? ' · ' + chapter.chapter_title : ''}`));
        input.addEventListener('change', () => { if (input.checked) selectedChapters.add(chapter.id); else selectedChapters.delete(chapter.id); schedulePreview(); });
        $('exportChapterList').append(label);
      }
      schedulePreview();
    } catch (error) { if (epoch === chapterEpoch) { $('exportChapterList').textContent = error.message; schedulePreview(); } }
  }
  function updateFields() {
    const scope = $('exportScope').value, state = context.getState();
    $('exportConversationField').hidden = scope !== 'conversation';
    $('exportTheaterField').hidden = scope !== 'theater';
    $('exportSelectedField').hidden = scope !== 'selected';
    $('exportSearchNote').hidden = !scope.startsWith('search');
    $('exportSearchNote').textContent = state.searchMode && state.query ? `关键词：${state.query}\n范围：${state.searchSource ? state.conversations.find(item => item.source === state.searchSource && item.id === state.searchId)?.title || '当前会话' : state.searchKind === 'theater' ? '小剧场正文' : '全部记录'}。导出全部匹配结果，包含尚未加载的分页。${scope === 'searchConversations' ? '会包含命中消息前后的完整会话内容。' : ''}` : '请先在顶部搜索关键词，再选择搜索结果导出。';
    $('exportChapterList').hidden = !$('exportSelectedChapters').checked;
    $('exportSystemNote').hidden = scope !== 'selected';
    $('exportIncludeSystem').disabled = scope === 'selected';
    $('exportIncludeMonitor').disabled = !$('exportIncludeImages').checked;
    $('exportFormatHelp').textContent = help[$('exportFormat').value];
    updateSelection(); schedulePreview();
  }
  function schedulePreview() {
    clearTimeout(previewTimer); previewEpoch++;
    if (busy || !$('exportDialog').open) return;
    $('downloadExportBtn').disabled = true; $('exportPreview').textContent = '正在统计完整记录…';
    previewTimer = setTimeout(preview, 180);
  }
  async function preview() {
    const epoch = ++previewEpoch;
    try {
      const result = await context.api('/api/export/preview', {}, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': context.getState().editToken }, body: JSON.stringify(specification()) });
      if (epoch !== previewEpoch || busy) return;
      const messages = result.count - result.chapters;
      $('exportPreview').textContent = `${result.title}\n${result.conversations} 个会话 / 故事 · ${[messages ? `${messages.toLocaleString()} 条消息` : '', result.chapters ? `${result.chapters} 章正文` : ''].filter(Boolean).join(' + ')} · 约 ${result.characters.toLocaleString()} 字${$('exportFormat').value === 'pptx' && result.characters > 20000 ? '\n内容较多，幻灯片页数会较多；长篇阅读更适合 Word / EPUB。' : ''}`;
      $('downloadExportBtn').disabled = false;
    } catch (error) {
      if (epoch !== previewEpoch || busy) return;
      $('exportPreview').textContent = error.message; $('downloadExportBtn').disabled = true;
    }
  }
  function open(scope) {
    if (busy) { $('exportDialog').showModal(); return; }
    fillConversations();
    const state = context.getState();
    $('exportScope').value = scope || (state.selected?.source === 'theater' ? 'theater' : 'conversation');
    $('exportIncludeSystem').checked = !state.displaySettings.hideSystemMessages;
    $('exportError').hidden = true;
    $('exportDialog').showModal();
    updateFields(); loadChapters();
  }
  function close() { if (!busy) { previewEpoch++; clearTimeout(previewTimer); $('exportDialog').close(); } }
  async function download(event) {
    event.preventDefault(); if (busy) return;
    const input = specification();
    busy = true; previewEpoch++; clearTimeout(previewTimer);
    $('exportError').hidden = true;
    for (const control of $('exportForm').querySelectorAll('input,select,button')) control.disabled = true;
    $('downloadExportBtn').textContent = '正在生成文件…';
    $('exportPreview').textContent = input.format === 'pdf' ? '正在排版 PDF，长记录需要稍等。完成后会自动下载。' : '正在生成完整文件，完成后会自动下载。';
    try {
      const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': context.getState().editToken }, body: JSON.stringify(input), signal: AbortSignal.timeout(240000) });
      if (!response.ok) {
        const error = await response.json();
        if (response.status === 401) location.replace('/');
        throw new Error(error.error || '导出失败，请重试');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : `聊天记录.${input.format}`;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      const warning = decodeURIComponent(response.headers.get('X-Export-Warnings') || '');
      $('exportPreview').textContent = `已生成：${filename}\n文件已交给浏览器下载，请在当前设备的下载列表中查看。${warning ? '\n' + warning : ''}`;
      context.toast(warning || '导出完成，已开始下载');
    } catch (error) {
      $('exportError').textContent = error.name === 'TimeoutError' ? '生成时间较长，请稍后重试或缩小范围。' : error.message;
      $('exportError').hidden = false; $('exportPreview').textContent = '没有完成下载，可以重新选择后再试。';
    } finally {
      busy = false;
      for (const control of $('exportForm').querySelectorAll('input,select,button')) control.disabled = false;
      $('exportIncludeSystem').disabled = $('exportScope').value === 'selected';
      $('exportIncludeMonitor').disabled = !$('exportIncludeImages').checked;
      $('downloadExportBtn').textContent = '再次生成并下载';
    }
  }
  function init(value) {
    context = value;
    $('exportBtn').addEventListener('click', () => open());
    $('selectMessagesBtn').addEventListener('click', () => setSelecting(!selecting));
    $('endExportSelectionBtn').addEventListener('click', () => setSelecting(false));
    $('selectVisibleBtn').addEventListener('click', () => {
      const state = context.getState(); if (!state.selected) return;
      for (const message of state.items) {
        if (state.displaySettings.hideSystemMessages && MessageDisplay.isSystemMessage(message)) continue;
        const item = { source: state.selected.source, conversationId: state.selected.id, messageId: message.id };
        selections.set(messageKey(item), item);
      }
      updateSelection(); rerender();
    });
    $('clearExportSelectionBtn').addEventListener('click', () => { selections.clear(); updateSelection(); rerender(); });
    $('exportSelectedBtn').addEventListener('click', () => open('selected'));
    $('pickExportMessagesBtn').addEventListener('click', () => { close(); setSelecting(true); });
    $('closeExportBtn').addEventListener('click', close); $('cancelExportBtn').addEventListener('click', close);
    $('exportDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('exportForm').addEventListener('submit', download);
    $('exportForm').addEventListener('change', updateFields);
    $('exportTheater').addEventListener('change', loadChapters);
  }
  return { init, decorate, getSelections: () => [...selections.values()], beginSelection: () => setSelecting(true) };
})();
