# Distribution

CI checks the completion-only source and uploads `main.js`, `styles.css`, `manifest.json`, and `LICENSE` as a build artifact. No automatic updater, module publisher or scheduled release process is installed.

Before a manually requested release, follow [AGENTS.md](../AGENTS.md), validate the actual editor integrations, and keep the version in `package.json`, `manifest.json`, and `versions.json` aligned. The plugin ID stays `yolo` for existing LaTeX Live consumers.
