# YOLO Completion Only

This fork retains inline writing completion only. Its source baseline is
`Lapis0x0/obsidian-yolo` commit `4d1e2d8e2318e065c063ff70a2e6b7ed00523f55`.
Keep the original MIT license and upstream attribution. The owner requested the short README text; preserve it unless asked to change it.

## Scope and structure

- `src/main.ts`: completion-only lifecycle, four completion commands, and native settings.
- `src/features/editor/`: retained YOLO completion controller, CodeMirror ghost rendering,
  acceptance, rejection and optional chat candidate switching.
- `src/completion/`: streaming FIM/chat requests, bounded document context, exact memory cache, formatting and SSE decoding. No model SDK or agent runtime.
- `src/settings/`: completion settings only. Keep unrelated persisted upstream fields
  when saving so a rollback does not discard provider, chat or module preferences.
  Inactive fields are never initialized as services. Existing vault `YOLO/` data is untouched.
- `src/i18n.ts`: resolve English/Chinese native UI strings at use time.
- `tests/`: request contracts, stream boundaries, cancellation, stale results, exact
  acceptance and persistence preservation. Use synthetic data and mocked requests.

The plugin ID remains `yolo` because LaTeX Live binds to it. Do not install this
fork alongside upstream in the same vault. Preserve the existing
`getEditorView`, `getInlineSuggestionController`, `getTabCompletionController`,
`handleTabCompletionEditorChange` and controller field contracts consumed by
LaTeX Live. Validate the actual bridge after changing them. This is an existing
consumer requirement, not a reason to retain chat/agent compatibility code.

## Build and verification

Use Node 20+ and `npm ci`. The host provides `obsidian`, `@codemirror/state` and
`@codemirror/view`; leave them external to avoid duplicate editor runtimes.

- `npm run type:check`
- `npm test`
- `npm run lint:check`
- `npm run build` (type check, completion CSS, production bundle)

The installable artifacts are `main.js`, `styles.css`, and `manifest.json`.
Test them in an isolated vault before replacing any production installation.
Verify automatic and manual completion, Tab acceptance, Escape cancellation,
selection/document/focus invalidation, IME composition, a popout, and the existing
LaTeX Live integration. Direct API success alone is not editor validation.

## Boundaries

Do not reintroduce chat, Quick Ask, agents, shell tools, MCP, indexing, embedding
models, databases, module downloads, background servers, scheduled tasks, or
self-updaters. Only send bounded cursor context and enabled current-document structural excerpts to the configured API. Folder rules add instructions without opening other files.
No API credentials, transcripts, screenshots, performance logs or checksum
inventories in Git; keep them in ignored `build/` or an external test directory.
Keep personal `.obsidian/`, editor settings and `.DS_Store` ignored.

Use owner-document DOM APIs for widgets in popouts. CodeMirror update callbacks
must defer effect dispatch until after the update. Preserve native Tab behavior
when no usable suggestion exists and never accept text for an old document,
cursor or selection. Generated LaTeX is inserted literally, without Markdown
escaping. No retries after user cancellation and no logging raw provider errors.

## Native editors and responsiveness

[NATIVE-EDITORS.md](NATIVE-EDITORS.md) is the public v1 CodeMirror interface. Keep
its unload behavior and suggestion-menu guard verified. Preserve the older LaTeX
Live bridge as an existing consumer contract. Current-file paths must
come from the actual editor, including popouts, rather than whichever pane happens
to be globally active.

Use a single trailing request; never discard the final edit because of cooldown.
Reuse suggestions only for exact anchor insertions with identical surrounding text.
Cache only in memory, with bounded size and expiry, and scope keys to the editor,
model, endpoint, prompt, parameters and precise context. Never case-fold math or
normalize whitespace in cache keys. Keep callbacks from cancelled requests inert.

Context reads at most a bounded lookback and preamble of the current document.
It does not resolve includes, run a parser/compiler, fetch other notes or invoke a
second model. Keep context fixtures for out-of-window notation and proof statements.

Before publishing, run local checks plus the isolated editor matrix and a same-input
latency comparison. Treat synthetic IME events and mocked provider tests as such;
never report them as physical IME or live-provider tests. Only the isolated test
profile may disable background timer throttling for timing measurement.
