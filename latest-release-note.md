# 1.0.0 — Completion-only fork

- Retain inline completion and native API/model settings; remove chat, agents, tools, indexing and product modules.
- Add native Mercury FIM and OpenAI-compatible streaming completion.
- Queue the latest edit during request spacing, reuse matching typed suggestions and maintain a bounded exact-context cache.
- Add current-document structure and notation, plus optional folder writing instructions.
- Preserve LaTeX Live integration and expose a native CodeMirror API for other text editors.
- Respect composition, selections, popouts, completion menus and existing math delimiters.

This is an independent fork, not an upstream YOLO release. Plugin ID `yolo` and unrelated persisted settings remain available for existing installations and rollback. See [LICENSE](LICENSE) for upstream attribution.
