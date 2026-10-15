'use strict';

// 大文档的分页和压缩放到工作线程，手机阅读、搜索不会被导出任务阻塞。
const { parentPort, workerData } = require('node:worker_threads');
const { ChatStore } = require('./store');
const { collectExport } = require('./export-data');
const { createExport } = require('./export-files');

async function run() {
  const store = new ChatStore(workerData.dataDirectory);
  let document;
  try { document = collectExport(store, workerData.input); }
  finally { store.close(); }
  // 附件路径由主服务统一解析；工作线程只接收已经解析过的本地路径映射。
  const result = await createExport(document, workerData.input.format, {
    root: workerData.root,
    resolveMedia: raw => {
      const filename = workerData.mediaPaths[raw];
      if (!filename) throw new Error('图片不可用');
      return filename;
    },
  });
  parentPort.postMessage(result);
}
run().catch(error => parentPort.postMessage({ error: error.message || '导出失败' }));
