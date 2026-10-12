# YOLO Completion Only

[English](README.md)

基于 [YOLO](https://github.com/Lapis0x0/obsidian-yolo) 的轻量纯补全分支：写作停顿后显示灰色建议，按 **Tab** 接受。

保留行内补全与必要设置，移除了聊天、Agent、MCP、终端工具、RAG、数据库、学习模块、白板和插件自动更新。

## 功能

- 原生 Mercury Edit 2 FIM 流式补全，以及 OpenAI 兼容的聊天式补全；Mercury 聊天请求使用 instant reasoning。
- 合并最新输入，在最小请求间隔结束后处理，不再因冷却期而丢掉最后一次停顿。
- 当输入与灰字逐字相符时沿用剩余建议，包括仍在流式生成的建议。
- 有容量和过期限制的内存缓存，区分编辑器、模型、提示词与精确上下文，不合并大小写或空白。
- 可选的本文件结构上下文：文件名、章节、附近命题、证明开头和本地宏／记号。不扫描整库，不建立向量索引。
- 目录级写作约定，使用匹配最具体的一条；不为此读取其他文件。
- LaTeX、代码按原样插入，尊重右侧已经存在的数学闭合符号。
- 原生 CodeMirror 接口，同时保留 LaTeX Live 使用的既有 YOLO 接口。
- 组合输入期间不触发请求，支持独立窗口及其他补全菜单的避让。

## 安装

插件 ID 仍为 **`yolo`**，以保留已有编辑器接入。同一 vault 中，它会替代原版 YOLO，两者不能并行启用。

1. 先在测试 vault 使用，或备份原来的 `.obsidian/plugins/yolo/` 文件夹。
2. 从成功的 [CI 构建附件](https://github.com/qiulinfan/obsidian-yolo-completion-only/actions) 获取 `main.js`、`styles.css`、`manifest.json`，也可以自行构建。
3. 将三个文件放入 `<vault>/.obsidian/plugins/yolo/`，在社区插件中启用 **YOLO Completion Only**。
4. 在设置页填写 API 信息，点击“测试连接”。这个按钮只发送一句合成测试文本。

原有 YOLO 的供应商、模型和补全设置会被读取；其他设置与 vault 内 `YOLO/` 数据保留供回退，但相应服务不会启动。已有自定义延迟不会被新默认值覆盖，可按下面的参数自行调整。

## 配置

Mercury Edit 2 使用：

| 设置 | 值 |
| --- | --- |
| 接口类型 | Mercury Edit 2（FIM） |
| API 基础地址 | `https://api.inceptionlabs.ai/v1` |
| 模型 ID | `mercury-edit-2` |
| API 密钥 | 你的 Inception API key |

Mercury 2.5 选择聊天式接口，模型填 `mercury-2.5`，基础地址相同。其他模型需要支持 OpenAI 兼容的 Chat Completions 接口。基础地址不包含 `/chat/completions` 或 `/fim/completions`。

新配置默认使用 **180ms** 停顿等待、词尾／标点边界 **120ms**、请求最小间隔 **150ms**、最多 **32 个输出 token**。这些是可调整的默认值，不是网络延迟保证。

请求发送光标附近的有限文本。开启结构上下文后，还会附加本文件标题、附近命题和记号的有限片段；短笔记可能整个落在这个范围内。API key 保存在本地插件设置，安装包不含凭据。

## 操作

| 操作 | 按键或命令 |
| --- | --- |
| 接受灰字 | Tab |
| 取消建议及其请求 | Esc / Shift+Tab |
| 切换多个聊天候选 | 上下方向键 |
| 手动请求 | 命令面板 → 触发补全 |
| 开关自动请求 | 命令面板 → 切换自动补全 |

没有可用建议时，Tab 保留编辑器原有行为。移动光标、建立选区或修改其他文本会使旧回复失效。沿着建议继续输入时，只扣除已输入部分。Mercury FIM 始终生成一个候选。

## LaTeX 与其他编辑器

LaTeX Live 的源码和可视编辑模式均可使用已有的 YOLO 补全接入，需要在其设置中开启。较旧的编辑器版本可能显示其原版 YOLO 版本白名单提示；本分支保留了桥接接口，并有单独的实际编辑器验证。

任何已有 CodeMirror 6 文本编辑器都可以使用原生 `completionApi`，不限制文件扩展名；插件不会替未知格式创建编辑器，见 [原生编辑器接口](NATIVE-EDITORS.md)。

上下文提取是有边界的结构分析，不是完整的 TeX 解析器，也不是数学证明检查器；不会追踪外部 `\input` 文件或遍历整个库。建议仍需自己检查。目前有桌面 Obsidian、LaTeX Live、独立窗口和输入事件验证，尚未验证手机端运行。

## 构建与来源

Node.js 20+：

```sh
npm ci
npm test
npm run lint:check
npm run build
```

Obsidian 和 CodeMirror 由宿主提供，产物不打包模型 SDK 等 runtime npm 依赖。开发说明在 [AGENTS.md](AGENTS.md)。

本分支源于 `Lapis0x0/obsidian-yolo` 的 `4d1e2d8e2318e065c063ff70a2e6b7ed00523f55`，保留上游编辑器实现与 MIT 署名。它是 [qiulinfan/obsidian-yolo-completion-only](https://github.com/qiulinfan/obsidian-yolo-completion-only) 的独立精简分支，不是上游 YOLO 发布版。许可证见 [LICENSE](LICENSE)。
