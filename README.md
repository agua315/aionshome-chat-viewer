# AionsHome 聊天记录查看器

查看、搜索和整理 AionsHome 聊天记录的 Windows 小工具，直接读取本机聊天数据。

**本程序可独立运行，无需同时启动 AionsHome；配置好数据目录后，单独打开查看器即可。**

**完整聊天 · 搜索原话 · 小剧场 · 自定义美化 · 导出 · 摘句长图 · 马赛克 · 手机浏览**

## 目录

- [开始使用](#开始使用) · [阅读与搜索](#阅读与搜索) · [编辑与存档](#编辑与存档)
- [外观与显示](#外观与显示) · [摘句图片](#摘句图片) · [马赛克](#马赛克)
- [导出](#导出) · [手机访问与同步](#手机访问与同步) · [其他说明](#其他说明)

## 开始使用

1. 准备 **Windows、Node.js 24 或更新版本、Edge 或 Chrome**。
2. [下载程序 ZIP](https://github.com/agua315/aionshome-chat-viewer/archive/refs/heads/main.zip)，解压。
3. 将 `config.example.json` 复制为 `config.json`，把 `dataDirectory` 改成自己的 AionsHome `aion-chat/data` 目录。
4. 双击 **`启动聊天记录查看器.cmd`**。无需 `npm install`。

<details>
<summary>看启动示意图</summary>

![四步启动流程](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/getting-started.svg)

</details>

[↑ 回目录](#目录)

## 阅读与搜索

- **聊天**：完整查看私聊、群聊和本地附件；“最早 / 最新”和加载按钮继续翻阅。
- **搜索**：输入关键词，点结果就能看原话和前后对话。可搜全部、当前会话或小剧场。
- **小剧场**：选故事、选章节，保留正文与插图；大纲和未完成片段不显示。

<details>
<summary>看聊天搜索与小剧场示意图</summary>

![搜索原话与上下文](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/reading-search.jpg)

![小剧场选章节阅读](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/theater-chapters.jpg)

</details>

[↑ 回目录](#目录)

## 编辑与存档

- 点消息旁的 **“编辑”** 修改正文，保存后写回原聊天；其他信息保持原样。
- **“存档设置”** 可选是否保留修改前的原文，也能自己选文件夹。默认在文档里的 `AionsHome聊天记录存档`。
- 小剧场在查看器中只读。AionsHome 手机 App 自动显示修改的设置在[下方](#手机访问与同步)。

<details>
<summary>看存档设置示意图</summary>

![存档开关与保存位置](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/archive-settings.jpg)

</details>

[↑ 回目录](#目录)

## 外观与显示

- **阅读样式**：原文气泡、Markdown 气泡、小说阅读，随时切换。
- **显示开关**：你的发言放左 / 右，开关名字和头像，隐藏系统消息，默认收起监控截图。
- **自由美化**：基本实现全自定义美化。五套主题、自定义背景、CSS 多预设，模板自带中文注释。
- 独白、手表消息和拍一拍都有特别样式。

<details>
<summary>看外观设置示意图</summary>

![主题、自定义 CSS 与背景设置](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/appearance.jpg)

</details>

[↑ 回目录](#目录)

## 摘句图片

- 从消息、小剧场中**逐句勾选、划选或合并多条**，也能直接输入和修改文字。
- 五套模板，可换配图、字体、配色和独白颜色；保存 **PNG / JPG，一张完整长图**。
- 手机默认**预览 60% / 编辑 40%**，中间分隔条可拖动，比例会记住；双击恢复默认。

<details>
<summary>看摘句美化与手机预览示意图</summary>

![摘句模板与实时预览](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/quote-cards.jpg)

<img src="https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mobile-quote-panel.jpg" width="340" alt="手机摘句预览可以拖动调整比例">

</details>

[↑ 回目录](#目录)

## 马赛克

- **手动选字**或**按关键词批量遮挡**，正文、标题、落款都支持。
- 可选方块、纯色、磨砂、斜线，也能替换成自定义文字、表情或图片。
- 只作用于分享图片，编辑框保留原文，随时可取消。

<details>
<summary>看七种效果和原尺寸大图</summary>

![原文与七种马赛克效果对比](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-effects.jpg)

大图：[原文对照](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-original.png) · [方块](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-pixel.png) · [纯色](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-solid.png) · [磨砂](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-frost.png) · [斜线](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-stripe.png) · [文字](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-text.png) · [表情](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-pattern.png) · [自选图片](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-image.png)

</details>

[↑ 回目录](#目录)

## 导出

- **范围随选**：整个会话、勾选消息、全部搜索命中，或小剧场整本 / 选章。
- **五种格式**：TXT、DOCX、PPTX、EPUB、PDF；可选图片、时间、系统消息和思考内容。
- 生成后下载到当前设备。PDF 需要电脑已安装 Edge 或 Chrome。

<details>
<summary>看导出示意图</summary>

![导出范围与文件格式](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/export.jpg)

</details>

[↑ 回目录](#目录)

## 手机访问与同步

- **首次设置**：电脑双击 `设置手机访问.cmd`，允许管理员确认，再在查看器“手机访问”中查看地址和访问码。
- **同一 Wi-Fi** 用 Wi-Fi 地址；**不同网络**先连接同一个 Tailscale 网络，再打开其地址、输入访问码。
- 手机可以阅读、编辑、导出和做摘句图；顶部的搜索、更多和详情按需展开。电脑和查看器需要开着。
- 还可让已打开的 **AionsHome 手机 App 自动显示聊天修改**，首次按下方说明安装同步脚本。

<details>
<summary>看手机界面与连接设置</summary>

<img src="https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mobile-reader.jpg" width="340" alt="手机紧凑阅读界面">

示例配置已开启手机访问。若未开启，在 `config.json` 中设置 `"phoneAccess": { "enabled": true }`，再重启查看器。

</details>

<details>
<summary>AionsHome 手机 App 同步：首次设置</summary>

1. 将查看器中的 `integrations/aionshome/external-chat-edits.js` 复制到 AionsHome 的 `aion-chat/static`。
2. 在 `chat.html` 的 `chat.js` 后、`chatroom.html` 的 `chatroom.js` 后各加入这一行，再刷新聊天页：

```html
<script src="/static/external-chat-edits.js?v=20261013-1"></script>
```

支持 `sync_events` 的数据库可在前台约每两秒更新对应消息，保留滚动位置；正在回复或编辑时，结束后再更新。已生成的记忆摘要和导出文件不会自动重写。

![外部编辑同步流程](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/app-sync.svg)

</details>

[↑ 回目录](#目录)

## 其他说明

- 关闭运行面板，或双击 `停止聊天记录查看器.cmd`，即可停止。
- 本机配置、聊天和自选背景不会随源码上传。**示意图在线显示，程序 ZIP 不附带这些图片。**

<details>
<summary>数据位置、恢复和验证</summary>

- 数据目录变了，修改 `config.json` 中的路径即可。
- 自选背景在 `user-data/backgrounds`；图片支持 PNG / JPG / WebP / GIF / AVIF，20 MB 以内。
- CSS 写乱时，电脑按 `Ctrl + Shift + 0` 临时恢复；手机在地址后加 `?safeAppearance=1` 打开。
- 便携 Node 可放进 `runtime/node.exe`。基础检查运行 `node verify.js`，完整轻量验证运行 `npm test`。
- 组件授权见 `vendor/licenses` 和 `public/vendor/markdown-it.LICENSE.txt`。

</details>

[↑ 回目录](#目录)
