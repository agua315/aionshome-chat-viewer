'use strict';

// 外观编辑使用一份草稿：预览不落盘，取消恢复已保存状态；正文和聊天数据库不参与。
window.ViewerAppearance = (() => {
  const C = AppearanceConfig;
  const get = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  let saved = C.defaults(), draft = null, busy = false, token = null, api, toast;
  let recovery = new URLSearchParams(location.search).get('safeAppearance') === '1';
  const themeStyle = document.createElement('style');
  const backgroundStyle = document.createElement('style');
  const customStyle = document.createElement('style');
  themeStyle.id = 'appearanceThemeStyle';
  backgroundStyle.id = 'appearanceBackgroundStyle';
  customStyle.id = 'appearanceCustomStyle';
  // 自定义 CSS 始终在程序样式之后，作为纯 CSS 文本插入，不解析为 HTML。
  document.head.append(themeStyle, backgroundStyle, customStyle);

  function apply(settings) {
    const theme = C.themes.find(item => item.id === settings.theme) || C.themes[0];
    document.documentElement.dataset.theme = theme.id;
    themeStyle.textContent = ':root{color-scheme:' + theme.scheme + ';' + Object.entries(C.themeVariables(theme.id)).map(([key, value]) => `${key}:${value}`).join(';') + '}';
    const bg = settings.background;
    const image = bg.image ? `url(${JSON.stringify(bg.image)})` : 'none';
    const veil = bg.image ? `color-mix(in srgb,var(--ui-chat-bg) ${100 - bg.opacity}%,transparent)` : 'transparent';
    backgroundStyle.textContent = `:root{--appearance-image:${image};--appearance-veil:${veil};--appearance-fit:${bg.fit === 'tile' ? 'auto' : bg.fit};--appearance-repeat:${bg.fit === 'tile' ? 'repeat' : 'no-repeat'}}`;
    customStyle.textContent = settings.customCssEnabled ? settings.presets.find(item => item.id === settings.activePresetId)?.css || '' : '';
  }

  function safeSettings() {
    return { ...C.defaults(), presets: clone(saved.presets), activePresetId: saved.activePresetId };
  }

  function receive(settings, editToken) {
    token = editToken;
    saved = C.normalize(settings);
    if (!get('appearanceDialog').open) apply(recovery ? safeSettings() : saved);
  }

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function currentPreset() { return draft.presets.find(item => item.id === draft.activePresetId); }

  function error(message = '') {
    get('appearanceError').textContent = message;
    get('appearanceError').hidden = !message;
  }

  function controls() {
    for (const control of get('appearanceForm').querySelectorAll('input,select,textarea,button')) control.disabled = busy;
    get('deleteCssPresetBtn').disabled = busy || !draft || draft.presets.length <= 1;
    get('removeBackgroundBtn').disabled = busy || !draft?.background.image;
  }

  function renderThemeSelection() {
    for (const card of get('themeCards').querySelectorAll('[data-theme]')) card.setAttribute('aria-pressed', String(card.dataset.theme === draft.theme));
  }

  function renderEditor() {
    const options = document.createDocumentFragment();
    for (const preset of draft.presets) {
      const option = element('option', '', preset.name || '未命名预设'); option.value = preset.id; options.append(option);
    }
    get('cssPresetSelect').replaceChildren(options);
    get('cssPresetSelect').value = draft.activePresetId;
    get('cssPresetName').value = currentPreset().name;
    get('customCssEditor').value = currentPreset().css;
    get('customCssEnabled').checked = draft.customCssEnabled;
    controls();
  }

  function renderBackground() {
    const bg = draft.background;
    get('backgroundPreview').style.backgroundImage = bg.image ? `url(${JSON.stringify(bg.image)})` : '';
    get('backgroundPreview').classList.toggle('has-background', !!bg.image);
    get('backgroundName').textContent = bg.image ? bg.name || '已设置聊天背景图片' : '未设置背景图片 · 支持 PNG、JPG、WebP、GIF、AVIF，20 MB 以内';
    get('backgroundFit').value = bg.fit;
    get('backgroundOpacity').value = bg.opacity;
    get('backgroundOpacityLabel').textContent = bg.opacity + '%';
    controls();
  }

  function renderForm() { renderThemeSelection(); renderEditor(); renderBackground(); }

  function preview() {
    if (!draft || busy) return;
    error();
    apply(draft);
    get('appearancePreviewStatus').textContent = '预览中 · 保存后才会记住';
  }

  async function open() {
    try {
      const info = await api('/api/info');
      token = info.editToken;
      saved = C.normalize(info.appearanceSettings);
      draft = clone(recovery ? safeSettings() : saved);
      error(); renderForm();
      get('appearancePreviewStatus').textContent = recovery ? '已临时恢复默认显示' : '保存后会记住你的选择';
      get('appearanceDialog').showModal();
    } catch (cause) { toast('无法打开外观设置：' + cause.message); }
  }

  async function save() {
    if (!draft || busy) return;
    try {
      const value = C.normalize(draft);
      busy = true; error(); controls();
      const result = await api('/api/settings/appearance', {}, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viewer-Token': token }, body: JSON.stringify(value) });
      saved = C.normalize(result.appearanceSettings);
      draft = null; recovery = false;
      // 手机从安全显示入口修好样式后，刷新应使用刚保存的外观。
      const address = new URL(location.href);
      if (address.searchParams.has('safeAppearance')) {
        address.searchParams.delete('safeAppearance');
        history.replaceState(null, '', address.pathname + address.search + address.hash);
      }
      apply(saved); get('appearanceDialog').close();
      toast('外观已保存，刷新和重启后都会保留');
    } catch (cause) { error(cause.message); }
    finally { busy = false; controls(); }
  }

  function newPreset(copy = false) {
    if (draft.presets.length >= 30) { error('最多保存 30 份 CSS 预设'); return; }
    const original = currentPreset();
    const id = 'css_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const name = copy ? original.name.slice(0, 55) + ' 副本' : '自定义样式 ' + draft.presets.length;
    draft.presets.push({ id, name, css: copy ? original.css : C.defaultCss });
    draft.activePresetId = id;
    draft.customCssEnabled = true;
    renderEditor(); preview();
    get('cssPresetName').focus(); get('cssPresetName').select();
  }

  async function uploadBackground(file) {
    if (!file || busy) return;
    if (file.size > 20 * 1024 * 1024) { error('背景图片请选择 20 MB 以内的文件'); get('backgroundFile').value = ''; return; }
    let uploaded = false;
    busy = true; error(); controls(); get('chooseBackgroundBtn').textContent = '正在上传…';
    try {
      const result = await api('/api/appearance/background', {}, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Viewer-Token': token }, body: file, signal: AbortSignal.timeout(120000) });
      draft.background.image = result.image;
      draft.background.name = file.name;
      uploaded = true;
      renderBackground();
    } catch (cause) { error(cause.message); }
    finally {
      busy = false; controls(); get('chooseBackgroundBtn').textContent = '选择背景图片'; get('backgroundFile').value = '';
      if (draft && uploaded) preview();
    }
  }

  function init(actions) {
    api = actions.api; toast = actions.toast;
    for (const theme of C.themes) {
      const button = element('button', 'theme-card'); button.type = 'button'; button.dataset.theme = theme.id; button.setAttribute('aria-pressed', 'false');
      const sample = element('span', 'theme-sample'); sample.style.background = theme.colors.canvas;
      sample.style.setProperty('--sample-bubble', theme.colors.bubble); sample.style.setProperty('--sample-user', theme.colors.user);
      button.append(sample, element('span', 'theme-card-title', theme.name), element('span', 'theme-card-description', theme.description));
      button.addEventListener('click', () => { draft.theme = theme.id; renderThemeSelection(); preview(); });
      get('themeCards').append(button);
    }
    get('appearanceSettingsBtn').addEventListener('click', open);
    get('appearanceForm').addEventListener('submit', event => { event.preventDefault(); save(); });
    for (const id of ['closeAppearanceBtn', 'cancelAppearanceBtn']) get(id).addEventListener('click', () => { if (!busy) get('appearanceDialog').close(); });
    get('appearanceDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    get('appearanceDialog').addEventListener('close', () => { draft = null; apply(recovery ? safeSettings() : saved); });
    get('previewAppearanceBtn').addEventListener('click', preview);
    get('resetAppearanceBtn').addEventListener('click', () => { draft = { ...C.defaults(), presets: draft.presets, activePresetId: draft.activePresetId }; renderForm(); preview(); });
    get('newCssPresetBtn').addEventListener('click', () => newPreset());
    get('copyCssPresetBtn').addEventListener('click', () => newPreset(true));
    get('deleteCssPresetBtn').addEventListener('click', () => {
      if (draft.presets.length <= 1) return;
      const index = draft.presets.findIndex(item => item.id === draft.activePresetId);
      draft.presets.splice(index, 1); draft.activePresetId = draft.presets[Math.min(index, draft.presets.length - 1)].id;
      renderEditor(); preview();
    });
    get('cssPresetSelect').addEventListener('change', event => { draft.activePresetId = event.target.value; draft.customCssEnabled = true; renderEditor(); preview(); });
    get('cssPresetName').addEventListener('input', event => {
      currentPreset().name = event.target.value;
      get('cssPresetSelect').selectedOptions[0].textContent = event.target.value || '未命名预设';
    });
    get('customCssEditor').addEventListener('input', event => { currentPreset().css = event.target.value; draft.customCssEnabled = true; get('customCssEnabled').checked = true; });
    get('customCssEditor').addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        event.preventDefault(); event.target.setRangeText('  ', event.target.selectionStart, event.target.selectionEnd, 'end');
        event.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if ((event.ctrlKey || event.metaKey) && ['s', 'Enter'].includes(event.key)) { event.preventDefault(); save(); }
    });
    get('customCssEnabled').addEventListener('change', event => { draft.customCssEnabled = event.target.checked; preview(); });
    get('restoreCssTemplateBtn').addEventListener('click', () => { currentPreset().css = C.defaultCss; draft.customCssEnabled = true; renderEditor(); preview(); });
    get('chooseBackgroundBtn').addEventListener('click', () => get('backgroundFile').click());
    get('backgroundFile').addEventListener('change', event => uploadBackground(event.target.files[0]));
    get('removeBackgroundBtn').addEventListener('click', () => { draft.background.image = ''; draft.background.name = ''; renderBackground(); preview(); });
    get('backgroundFit').addEventListener('change', event => { draft.background.fit = event.target.value; preview(); });
    get('backgroundOpacity').addEventListener('input', event => { draft.background.opacity = Number(event.target.value); get('backgroundOpacityLabel').textContent = event.target.value + '%'; preview(); });
    document.addEventListener('keydown', event => {
      if (event.ctrlKey && event.shiftKey && (event.code === 'Digit0' || event.code === 'Numpad0')) {
        event.preventDefault(); recovery = true;
        if (draft) {
          // 只停用外观，不丢弃正在编辑的代码，便于修好后重新预览。
          draft = { ...C.defaults(), presets: draft.presets, activePresetId: draft.activePresetId };
          renderForm();
        }
        apply(draft || safeSettings()); toast('已临时恢复默认显示，CSS 预设仍然保留');
      }
    }, true);
  }

  return { init, receive };
})();
