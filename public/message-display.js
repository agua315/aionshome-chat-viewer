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

  const GAME_TYPES = ['mini_game_invite', 'billiards_result', 'table_game_result', 'doudizhu_result', 'rps_result', 'rps_invite', 'composition'];
  const RPS_HANDS = { 石头: '✊', 剪刀: '✌️', 布: '🖐️' };
  const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

  function legacyRows(card, ddz) {
    const rows = [], extra = [];
    const lines = Array.isArray(card?.lines) ? card.lines : (ddz && Array.isArray(card?.walletLines) ? card.walletLines : []);
    for (const raw of lines) {
      const line = plain(raw);
      const match = line.match(/^(.*)：本场 ([+−-]?\d+(?:\.\d+)?) (元|分|筹码)(?: · (?:收桌余额|剩余) (.*))?$/)
        || line.match(/^(.*) ([+−-]?\d+(?:\.\d+)?) (元)$/);
      if (!match) { if (line) extra.push(line); continue; }
      const delta = Number(match[2].replace('−', '-'));
      rows.push({ name: match[1], net: `${match[2]} ${match[3]}`, balance: match[4] || '—', delta, won: undefined });
    }
    return { rows, extra };
  }

  function scoreboard(card) {
    const ddz = card.type === 'doudizhu_result';
    const hasRows = Array.isArray(card.rows) && card.rows.length > 0;
    const legacy = hasRows ? { rows: [], extra: [] } : legacyRows(card, ddz);
    const sourceRows = hasRows ? card.rows : legacy.rows;
    const rows = sourceRows.map(row => {
      const delta = finiteNumber(row?.delta);
      return {
        name: plain(row?.name) || plain(row?.actor) || '玩家',
        net: plain(row?.net) || (delta === null ? '' : String(delta)),
        balance: row?.balance == null ? null : (plain(row.balance) || '—'),
        delta,
        won: typeof row?.won === 'boolean' ? row.won : undefined,
      };
    });
    const deltas = rows.filter(row => row.delta !== null).map(row => row.delta);
    const best = deltas.length ? Math.max(...deltas) : 0;
    for (const row of rows) if (typeof row.won !== 'boolean') row.won = row.delta !== null && row.delta > 0 && (ddz || row.delta === best);
    rows.sort((a, b) => Number(b.won) - Number(a.won));
    const extra = hasRows ? [] : [...legacy.extra];
    if (ddz && !hasRows) {
      if (plain(card.winnerName) || plain(card.landlordName)) extra.push(`先出完：${plain(card.winnerName) || '—'} · 地主：${plain(card.landlordName) || '—'}`);
      if (plain(card.remaining)) extra.push(`剩余手牌：${plain(card.remaining)}`);
    }
    const outcome = plain(card.outcome);
    if (!rows.length && !extra.length && !outcome) return null;
    const title = ddz ? '斗地主战报' : `${plain(card.title) || '游戏'}战报`;
    return {
      kind: 'scoreboard',
      badge: ddz ? '♠' : plain(card.title) === '吹牛骰子' ? '⚄' : '♣',
      title,
      scope: ddz ? '本局结算' : card.scope === 'table' ? '本场结算' : `第 ${plain(card.round) || '?'} 轮`,
      outcome,
      netLabel: plain(card.netLabel) || '本场盈亏',
      balanceLabel: plain(card.balanceLabel) || (ddz ? '剩余手牌' : '收桌余额'),
      rows,
      extra,
      note: plain(card.note) || (ddz ? '按本局阵营结算 · 用户金额仅记本桌' : ''),
    };
  }

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
    const rpsInvite = find('rps_invite');
    if (rpsInvite && (plain(rpsInvite.topic) || content)) {
      const match = content.match(/^(.+?)邀请你猜拳/);
      return { kind: 'invite', icon: '✊', actor: plain(rpsInvite.actor_name) || match?.[1]?.trim() || 'AI', game: '猜拳', topic: plain(rpsInvite.topic) };
    }
    const composition = find('composition');
    if (composition && plain(composition.title)) return { kind: 'composition', actor: plain(composition.actor_name) || 'AI', title: plain(composition.title), bpm: finiteNumber(composition.bpm) };
    const pool = find('billiards_result');
    if (pool && Array.isArray(pool.players) && pool.players.length === 2 && [0, 1].includes(pool.winner)) {
      const names = pool.players.map(player => plain(player?.name) || '玩家');
      const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
      const winner = pool.winner, loser = 1 - winner;
      const score = Array.isArray(pool.score) && pool.score.length === 2 && pool.score.every(value => typeof value === 'number' && Number.isFinite(value))
        ? `${pool.score[winner]} : ${pool.score[loser]}` : '';
      const rack = finiteNumber(pool.rack);
      return { kind: 'duel', badge: '🎱', title: '台球战报', scope: rack === null ? '对局结束' : `第 ${rack} 局${pool.match_complete ? ' · 整场结束' : ''}`, winner: { name: names[winner] }, loser: { name: names[loser] }, score, shots: finiteNumber(pool.shots), reason: plain(pool.reason), legal: plain(pool.reason).startsWith('合法'), note: pool.match_complete ? lines.find(line => line.includes('整场结束')) || '' : '' };
    }
    const table = find('table_game_result');
    if (table && plain(table.title)) return scoreboard(table);
    const landlord = find('doudizhu_result');
    if (landlord) return scoreboard(landlord);
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
