(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AppearanceConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const themes = [
    { id: 'sage', name: '苔绿纸笺', description: '奶白纸面 · 柔和草绿', scheme: 'light', colors: {
      ink: '#25332e', muted: '#7b8982', accent: '#246b56', accentInk: '#ffffff', paper: '#fffefa', canvas: '#f4f5ee', panel: '#f8f9f3', line: '#e5e9e2', bubble: '#f3f5ee', user: '#e6eee0', hover: '#edf2e8', input: '#f9faf5', thought: '#f3eff8', thoughtInk: '#776486', watch: '#eef5ef', watchInk: '#557761', pat: '#fbf4ea', patInk: '#927052', mark: '#fae8a4',
    } },
    { id: 'berry', name: '莓粉奶霜', description: '奶油底色 · 玫瑰粉调', scheme: 'light', colors: {
      ink: '#49343e', muted: '#9a7e89', accent: '#a85d7c', accentInk: '#ffffff', paper: '#fffafd', canvas: '#faf0f4', panel: '#fcf3f6', line: '#efdee6', bubble: '#fff4f7', user: '#f6dfeb', hover: '#f5e5ed', input: '#fff8fb', thought: '#f2eaf8', thoughtInk: '#887095', watch: '#edf3f0', watchInk: '#678577', pat: '#fff1e8', patInk: '#ad8165', mark: '#f5dfac',
    } },
    { id: 'mist', name: '雾蓝书页', description: '清透雾蓝 · 安静阅读', scheme: 'light', colors: {
      ink: '#304452', muted: '#7e93a1', accent: '#4f7f9b', accentInk: '#ffffff', paper: '#fbfdff', canvas: '#edf3f8', panel: '#f2f7fb', line: '#dce6ef', bubble: '#eff5fa', user: '#dceaf6', hover: '#e3edf5', input: '#f7fbfe', thought: '#eeeef9', thoughtInk: '#797ba0', watch: '#eaf4f4', watchInk: '#5d8585', pat: '#fbf3e8', patInk: '#9c805d', mark: '#f5e1a4',
    } },
    { id: 'apricot', name: '暖杏手札', description: '暖杏留白 · 旧书气息', scheme: 'light', colors: {
      ink: '#4c3e32', muted: '#9a8979', accent: '#a7734d', accentInk: '#ffffff', paper: '#fffaf1', canvas: '#f6efe4', panel: '#faf3e8', line: '#e9ddcd', bubble: '#faf1e4', user: '#f1dfc6', hover: '#f1e5d4', input: '#fff9f0', thought: '#f3eaf0', thoughtInk: '#94798b', watch: '#edf2e6', watchInk: '#798766', pat: '#f9e9da', patInk: '#a57855', mark: '#f0d896',
    } },
    { id: 'midnight', name: '墨夜星光', description: '深色夜读 · 冷月微光', scheme: 'dark', colors: {
      ink: '#dce5ee', muted: '#92a3b5', accent: '#9bbfda', accentInk: '#172430', paper: '#19232e', canvas: '#131c26', panel: '#1d2935', line: '#344353', bubble: '#243240', user: '#304759', hover: '#2b3c4c', input: '#202e3b', thought: '#302d43', thoughtInk: '#c3b5da', watch: '#233c3a', watchInk: '#a0c9bc', pat: '#3d342b', patInk: '#d4b38b', mark: '#665638',
    } },
  ];

  // 这是实际预填给用户的模板。默认跟随所选主题；示例配色写在注释里，避免覆盖套装。
  const defaultCss = `/* 聊天记录查看器 · 标准 CSS 美化模板
   修改属性右侧的值即可；不需要添加 <style> 标签。
   这些规则只改变显示，不会修改聊天原文。
   先点“预览效果”，满意后点“保存并应用”。
   按 Ctrl + Shift + 0 可临时恢复默认显示，已保存的预设仍会保留。 */

/* 01｜常用尺寸：字号、行距、气泡圆角、头像大小、按钮圆角 */
:root {
  --custom-message-size: 15px;       /* 聊天气泡里的文字大小 */
  --custom-message-height: 1.9;      /* 聊天文字的行间距离 */
  --custom-bubble-radius: 15px;      /* 气泡圆角，越大越圆润 */
  --custom-avatar-size: 32px;        /* 桌面聊天头像的宽和高 */
  --custom-button-radius: 10px;      /* 所有按钮的圆角 */
}

/* 02｜整体字体：可改成电脑或手机中已有的字体名称 */
body, button, input, select, textarea {
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}

/* 03｜全局配色：去掉下面某行前后的注释符号，便可覆盖套装颜色。
   --green 是主色（主要按钮、链接），--ink 是正文，--paper 是阅读面板。
   --ui-char-bubble 是角色气泡，--ui-user-bubble 是你的气泡。 */
:root {
  /* --green: #9d6e87; */
  /* --ink: #463d43; */
  /* --paper: #fffafc; */
  /* --ui-char-bubble: #faf0f5; */
  /* --ui-user-bubble: #f1dce7; */
}

/* 04｜顶部工具栏：搜索框、外观设置等按钮所在的整条区域 */
.topbar {
  box-shadow: none;                 /* 可改成 0 3px 16px #0000000d 添加阴影 */
}
.searchbar {
  border-radius: 16px;              /* 顶部搜索框的圆角 */
}

/* 05｜左侧会话列表：侧栏、会话卡片、当前选中的会话 */
.sidebar { /* background: #fff5fa; */ }
.conversation, .result {
  border-radius: 12px;              /* 会话列表和搜索结果卡片的圆角 */
}
.conversation.active, .result.active {
  /* background: #f0dce7; */         /* 当前选中项的底色 */
}

/* 06｜按键：普通按钮、搜索/保存等主要按钮、悬停效果 */
button { border-radius: var(--custom-button-radius); }
.primary, .searchbar .primary, .edit-dialog .primary {
  background: var(--green);         /* 主要按钮使用套装的主色 */
  /* color: #ffffff; */              /* 主要按钮上的文字颜色 */
}
button:hover { /* filter: brightness(0.97); */ }

/* 07｜聊天区背景：背景图请在外观设置上方上传。
   这里可以单独改聊天区底色，不影响顶部和侧栏。 */
#messages { /* background-color: #fbf5f8; */ }

/* 08｜通用气泡：字体、行距、内边距（上下、左右） */
.messages[data-mode] .bubble {
  font-size: var(--custom-message-size);
  line-height: var(--custom-message-height);
  padding: 14px 18px;
}

/* 09｜角色气泡：Aion、Connor 的发言。拍一拍不使用聊天气泡。 */
.message:not(.user):not(.pat-event):not(.theater-chapter) .bubble {
  border-radius: 4px var(--custom-bubble-radius) var(--custom-bubble-radius);
  /* background: #fff0f6; */         /* 角色气泡背景 */
  /* color: #57414c; */              /* 角色发言颜色 */
}

/* 10｜你的气泡：只改变 user 发言，不改变它位于左边还是右边 */
.message.user .bubble {
  border-radius: var(--custom-bubble-radius) 4px var(--custom-bubble-radius) var(--custom-bubble-radius);
  /* background: #efdae7; */         /* 你的气泡背景 */
  /* color: #57414c; */              /* 你的发言颜色 */
}

/* 11｜头像：头像框的大小和圆角；50% 是圆形，10px 是圆角方形 */
.messages .avatar {
  width: var(--custom-avatar-size);
  height: var(--custom-avatar-size);
  border-radius: 10px;
}

/* 12｜名字和时间：气泡上方的小字，strong 是说话人的名字 */
.message-meta { font-size: 11px; }
.message-meta strong { /* color: #a36b8c; */ }

/* 13｜心里嘀咕：整张独白卡片、标题、正文分别对应三个选择器 */
.inner-thought { border-radius: 4px 14px 14px 4px; /* background: #f4eef9; */ }
.thought-label { /* color: #a087b7; */ }
.thought-text { /* font-size: 14px; */ }

/* 14｜手表和拍一拍：提示条、图标底座、提示文字 */
.watch-note { border-radius: 14px; /* background: #eaf4ef; */ }
.pat-note { border-radius: 14px; /* background: #fff0e1; */ }
.event-icon-wrap { border-radius: 10px; }
.event-note-text { font-size: 13px; }

/* 15｜Markdown 排版：引用、代码块、搜索命中的高亮文字 */
.bubble blockquote { /* border-left-color: #bc9bb3; */ }
.bubble pre { border-radius: 10px; }
mark { /* background: #f5d9a0; */ }

/* 16｜小剧场：章节标题和顶部的章节选择框 */
.chapter-heading { /* font-size: 23px; */ }
.chapter-navigation select { border-radius: 10px; }

/* 17｜手机排版：仅在屏幕宽度不超过 700px 时应用 */
@media (max-width: 700px) {
  :root { --custom-avatar-size: 28px; }
  .messages[data-mode] .bubble { padding: 12px 14px; }
}
`;

  function themeVariables(id) {
    const theme = themes.find(item => item.id === id) || themes[0];
    const c = theme.colors;
    return {
      '--ink': c.ink, '--muted': c.muted, '--green': c.accent, '--paper': c.paper, '--soft': c.canvas, '--line': c.line,
      '--ui-panel': c.panel, '--ui-chat-bg': c.paper, '--ui-char-bubble': c.bubble, '--ui-user-bubble': c.user,
      '--ui-hover': c.hover, '--ui-input': c.input, '--ui-accent-ink': c.accentInk,
      '--ui-thought-bg': c.thought, '--ui-thought-ink': c.thoughtInk,
      '--ui-watch-bg': c.watch, '--ui-watch-ink': c.watchInk, '--ui-pat-bg': c.pat, '--ui-pat-ink': c.patInk, '--ui-mark': c.mark,
    };
  }

  function defaults() {
    return { theme: 'sage', customCssEnabled: false, activePresetId: 'standard', presets: [{ id: 'standard', name: '标准注释模板', css: defaultCss }], background: { image: '', name: '', fit: 'cover', opacity: 35 } };
  }

  function normalize(value = {}) {
    const initial = defaults();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('外观设置格式不正确');
    const theme = value.theme ?? initial.theme;
    if (!themes.some(item => item.id === theme)) throw new Error('请选择有效的外观套装');
    const customCssEnabled = value.customCssEnabled ?? false;
    if (typeof customCssEnabled !== 'boolean') throw new Error('请选择是否启用自定义 CSS');
    const source = value.presets ?? initial.presets;
    if (!Array.isArray(source) || !source.length || source.length > 30) throw new Error('请保留 1 至 30 份 CSS 预设');
    const ids = new Set();
    const presets = source.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(item.id) || ids.has(item.id)) throw new Error('CSS 预设编号重复或无效');
      ids.add(item.id);
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 60) throw new Error('请为每份 CSS 预设填写 1 至 60 字的名称');
      if (typeof item.css !== 'string' || item.css.length > 65536) throw new Error('每份 CSS 请控制在 65536 字以内');
      return { id: item.id, name: item.name.trim(), css: item.css };
    });
    const background = { ...initial.background, ...value.background };
    if (typeof background.image !== 'string' || (background.image && !/^\/api\/appearance\/background\/[a-f0-9]{64}\.(png|jpg|webp|gif|avif)$/.test(background.image))) throw new Error('请通过“选择背景图片”上传聊天背景');
    if (!['cover', 'contain', 'tile'].includes(background.fit)) throw new Error('请选择有效的背景显示方式');
    if (!Number.isFinite(background.opacity) || background.opacity < 0 || background.opacity > 100) throw new Error('背景清晰度应为 0 至 100');
    const activePresetId = presets.some(item => item.id === value.activePresetId) ? value.activePresetId : presets[0].id;
    return { theme, customCssEnabled, activePresetId, presets, background: { image: background.image, name: String(background.name || '').slice(0, 200), fit: background.fit, opacity: background.opacity } };
  }

  return { themes, defaultCss, defaults, normalize, themeVariables };
});
