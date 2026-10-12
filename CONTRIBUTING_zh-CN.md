# 贡献说明

本分支只维护行内补全。架构与验证要求见 [AGENTS.md](AGENTS.md)，编辑器接入见 [NATIVE-EDITORS.md](NATIVE-EDITORS.md)。

使用 Node.js 20+ 和 `npm ci`。提交前运行：

```sh
npm test
npm run lint:check
npm run build
```

交互测试使用独立 Obsidian vault。构建产物、日志、截图和 API 凭据不进入 Git。保留上游 MIT 许可证及来源说明；说明行为变化和实际验证范围，并如实说明 AI 辅助情况。
