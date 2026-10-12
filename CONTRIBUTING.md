# Contributing

This fork is scoped to inline completion. Read [AGENTS.md](AGENTS.md) for architecture and checks, and [NATIVE-EDITORS.md](NATIVE-EDITORS.md) for editor integration.

Use Node.js 20+ and `npm ci`. Before submitting a change, run:

```sh
npm test
npm run lint:check
npm run build
```

Use an isolated Obsidian vault for interactive checks. Keep generated bundles, logs, screenshots and API credentials out of Git. Preserve the upstream MIT license and source attribution. Explain the behavior changed and the validation performed; disclose AI assistance when applicable.
