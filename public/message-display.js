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

  const GAME_TYPES = ['mini_game_invite', 'billiards_result', 'table_game_result', 'doudizhu_result', 'rps_result'];
  const RPS_HANDS = { 石头: '✊', 剪刀: '✌️', 布: '🖐️' };
  const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

  // 群聊桌游系统消息：只读取附件里的结构化字段；缺关键字段时返回 null，界面回退为原文显示。
  function gameCard(message) {
    const items = Array.isArray(message?.attachments) ? message.attachments : [];
    const find = type => items.find(item => item?.type === type);
    const content = plain(message?.content);
    const invite = find('mini_game_invite');
    if (invite && plain(invite.game)) {
      const game = plain(invite.game);
      return { kind: 'invite', icon: game === '桌球' ? '🎱' : game === '吹牛骰子' ? '🎲' : '🃏', actor: plain(invite.actor_name) || 'AI', game };
    }
    const pool = find('billiards_result');
    if (pool && Array.isArray(pool.players) && pool.players.length === 2) {
      const names = pool.players.map(player => plain(player?.name) || '玩家');
      const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
      const winner = names[pool.winner];
      const outcome = winner ? `${winner} 获胜 · ${names[1 - pool.winner]} 落败` : lines[1] || '';
      if (!outcome) return null;
      const details = [];
      if (Array.isArray(pool.score) && pool.score.length === 2) details.push(`累计胜局：${names[0]} ${plain(pool.score[0])} : ${plain(pool.score[1])} ${names[1]}`);
      const shots = [Number.isFinite(pool.shots) ? `本局共 ${pool.shots} 杆` : '', plain(pool.reason)].filter(Boolean).join(' · ');
      if (shots) details.push(shots);
      const rack = Number.isFinite(pool.rack) ? `第 ${pool.rack} 局` : '本局';
      return { kind: 'result', badge: '🎱', title: '台球战报', scope: pool.match_complete ? rack + ' · 整场结束' : rack, outcome, details, note: pool.match_complete ? lines.find(line => line.includes('整场结束')) || '' : '' };
    }
    const table = find('table_game_result');
    if (table && plain(table.title) && plain(table.outcome)) {
      return { kind: 'result', badge: '♣', title: plain(table.title) + '战报', scope: table.scope === 'table' ? '本场结算' : `第 ${plain(table.round) || '?'} 轮`, outcome: plain(table.outcome), details: (Array.isArray(table.lines) ? table.lines : []).map(plain).filter(Boolean), note: plain(table.note) };
    }
    const landlord = find('doudizhu_result');
    if (landlord && plain(landlord.outcome)) {
      const wallet = (Array.isArray(landlord.walletLines) ? landlord.walletLines : []).map(plain).filter(Boolean);
      const details = [];
      if (plain(landlord.winnerName) || plain(landlord.landlordName)) details.push(`先出完：${plain(landlord.winnerName) || '?'} · 地主：${plain(landlord.landlordName) || '?'}`);
      if (plain(landlord.remaining)) details.push('剩余手牌：' + plain(landlord.remaining));
      return { kind: 'result', badge: '♠', title: '斗地主战报', scope: '本局结算', outcome: plain(landlord.outcome), details, note: wallet.length ? '零钱结算：' + wallet.join(' · ') : '' };
    }
    const rps = find('rps_result');
    if (rps && content) {
      const topic = plain(rps.topic);
      const prefix = `猜拳结果：本局约定「${topic}」。`;
      const text = (topic && content.startsWith(prefix) ? content.slice(prefix.length) : content.replace(/^猜拳结果：/, ''))
        .replace(/出了(石头|剪刀|布)/g, (_, hand) => '出了' + RPS_HANDS[hand]).trim();
      return text ? { kind: 'rps', text, topic } : null;
    }
    return null;
  }

  // 显示过滤：桌游卡片只受“显示桌游邀约和战报”控制，其余系统消息受“隐藏系统消息”控制。
  function isHiddenMessage(message, { hideSystemMessages = false, showGameCards = true } = {}) {
    if (!isSystemMessage(message)) return false;
    return gameCard(message) ? !showGameCards : hideSystemMessages;
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

  return { SYSTEM_SPEAKERS, GAME_TYPES, isSystemMessage, isMonitorScreenshot, replaceInnerThoughts, isPatMessage, bandNote, gameCard, isHiddenMessage };
});
