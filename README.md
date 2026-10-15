# AionsHome 聊天记录查看器

独立查看、搜索和整理 AionsHome 聊天记录的 Windows 小工具。直接读取本机数据，AionsHome 后端关闭后也能使用。

## 能做什么

- **阅读与搜索**：搜原话、看完整上下文；小剧场可以选章节。
- **编辑与存档**：修改消息，自选是否保留原文和存档位置。
- **外观美化**：Markdown / 小说阅读、主题、自定义 CSS 和背景图。
- **导出与分享**：常见文档格式、摘句长图、七种马赛克效果。
- **手机浏览**：同一 Wi-Fi 或 Tailscale 下，用浏览器打开。

## 四步启动

1. 准备 **Windows、Node.js 24 或更新版本、Edge 或 Chrome**。
2. [下载程序 ZIP](https://github.com/agua315/aionshome-chat-viewer/archive/refs/heads/main.zip)，解压。
3. 将 `config.example.json` 复制为 `config.json`，把 `dataDirectory` 改成自己的 AionsHome `aion-chat/data` 目录。
4. 双击 **`启动聊天记录查看器.cmd`**。

所需组件已附带，无需 `npm install`。关闭运行面板即可停止。

## 想用哪一项，点开看

| 想做什么 | 图文指南 |
| --- | --- |
| 找原话、读聊天、看小剧场 | [阅读与搜索](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/reading.md) |
| 改消息、选存档位置 | [编辑与存档](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/editing.md) |
| 换主题、写 CSS、换背景 | [外观美化](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/appearance.md) |
| 做摘句长图、给文字打码 | [摘句与马赛克](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/cards.md) |
| 导出 TXT / DOCX / PPTX / EPUB / PDF | [导出聊天与故事](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/export.md) |
| 用手机阅读和编辑 | [Wi-Fi / Tailscale 访问](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/mobile.md) |
| 让 AionsHome 手机 App 显示修改 | [App 同步设置](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/sync.md) |

[环境、数据位置与维护说明](https://github.com/agua315/aionshome-chat-viewer/blob/docs/guides/advanced.md)

<details>
<summary>看界面和马赛克示意图</summary>

![完整聊天阅读界面](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/overview.jpg)

![原文与七种马赛克效果对比](https://raw.githubusercontent.com/agua315/aionshome-chat-viewer/docs/images/mosaic-effects.jpg)

截图均为虚构演示内容。文档图片单独保存在文档分支，下载上面的程序 ZIP 不会带上这些图片。

</details>
