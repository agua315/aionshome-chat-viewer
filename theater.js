'use strict';

// 小剧场只接入小说章节的正文。大纲、讨论、摘要、历史版本和生成中的片段
// 都不进入列表或搜索；旧版数据库没有小说表时，普通聊天仍可照常查看。
function theaterSql(db) {
  const exists = name => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (!exists('theater_studio') || !exists('theater_conversations')) return null;
  return `
    SELECT s.id, s.conv_id AS conversation_id, 'chapter' AS speaker,
      json_extract(s.doc, '$.content') AS content, c.created_at,
      c.updated_at AS activity_at, c.title,
      CAST(json_extract(s.doc, '$.number') AS INTEGER) AS chapter_number,
      COALESCE(json_extract(s.doc, '$.title'), '') AS chapter_title,
      COALESCE(json_extract(s.doc, '$.images'), '[]') AS illustrations,
      '[]' AS attachments, '' AS reasoning_content, 1 AS read_only
    FROM (
      SELECT id, conv_id, CASE WHEN json_valid(data) THEN data ELSE '{}' END AS doc
      FROM theater_studio WHERE kind = 'chapter'
    ) s JOIN theater_conversations c ON c.id = s.conv_id
    WHERE json_type(s.doc, '$.content') = 'text'
      AND length(trim(json_extract(s.doc, '$.content'))) > 0
      AND json_extract(s.doc, '$.status') IN ('ready', 'draft')
  `;
  // draft 表示一轮正文生成已正常结束，ready 表示用户另行确认本章写完。
  // 不要求用户为阅读再确认一次，但 writing/interrupted/planned 不作为成稿。
}

module.exports = { theaterSql };
