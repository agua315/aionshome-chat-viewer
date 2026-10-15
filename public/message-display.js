(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MessageDisplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 后台监控触发记录也属于系统内容，按说话人判断，避免误隐藏角色的正常回复。
  const SYSTEM_SPEAKERS = ['system', 'cam_user', 'cam_log', 'cam_trigger'];
  const isSystemMessage = message => SYSTEM_SPEAKERS.includes(message?.speaker);

  // 只识别明确的独白标记，代码块、行内代码和转义示例保留原样。
  function replaceInnerThoughts(value, replace) {
    const text = String(value || '');
    return text.replace(/(`+)[\s\S]*?\1|(~{3,})[\s\S]*?\2|[\[【]心里嘀咕[：:]\s*([^\]】]+?)[\]】]/g,
      (raw, backticks, tildes, thought, offset) => {
        if (backticks || tildes || text[offset - 1] === '\\' || !thought?.trim()) return raw;
        return replace(thought.trim(), raw, offset);
      });
  }

  const isPatMessage = message => Array.isArray(message?.attachments) && message.attachments.some(item => item?.type === 'pat');

  function bandNote(attachment) {
    if (attachment?.type !== 'band_vibration') return null;
    return {
      title: attachment.pattern === 'call' ? '手表呼唤' : '手表轻震',
      text: String(attachment.note || attachment.label || (attachment.pattern === 'call' ? '紧急呼叫！' : '轻轻想了你一下'))
        .replace(/^手环(?:轻震|呼唤|震动)[：:]\s*/, ''),
    };
  }

  function isMonitorScreenshot(raw, attachment = null, speaker = '') {
    if (attachment?.type === 'monitor_camera_snapshot') return true;
    let pathname;
    try { pathname = new URL(String(raw || ''), 'http://localhost').pathname; }
    catch { return false; }
    // 兼容新摄像头附件、旧截图目录以及早期保存到 uploads 的监控画面。
    return /^\/screenshots\//i.test(pathname)
      || /^\/uploads\/(?:monitor_camera_|cam_check_|sentinel_)/i.test(pathname)
      || (SYSTEM_SPEAKERS.includes(speaker) && /^\/uploads\//i.test(pathname));
  }

  return { SYSTEM_SPEAKERS, isSystemMessage, isMonitorScreenshot, replaceInnerThoughts, isPatMessage, bandNote };
});
