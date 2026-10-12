# Native CodeMirror editor API

The completion-only plugin exposes `completionApi.version === 1`. It uses the host's `@codemirror/state` and `@codemirror/view`; do not bundle a second CodeMirror instance in an integration.

```ts
const api = (app as any).plugins.plugins.yolo?.completionApi
if (api?.version === 1) {
  const extension = api.createExtension(
    () => file.path,                 // live vault-relative path, including extension
    view => !yourCompletionMenuOpen(view), // optional: let LSP/snippet menus take priority
  )
  // Include extension when constructing your EditorState, or use a Compartment.
}
```

The API accepts any filename or extension. The host editor owns file loading and rendering; this plugin does not register editors for unknown or binary formats. LaTeX has dedicated structural context; other text editors use their existing content and file name.

The returned extension owns ghost text, Tab/Esc/Shift+Tab, optional candidate cycling, automatic triggering, and composition events. Pass a filename getter rather than a captured filename so renames and tab changes update context. Use `shouldSuggest` for completion-menu conflicts; the callback is checked on editor updates and completion keys.

Other operations are:

```ts
await api.trigger(view) // manual request; bypasses debounce, respects enable/selection/read-only rules
api.accept(view)        // true only when it inserted a valid suggestion
api.dismiss(view)       // dismisses this editor's suggestion/request
```

Unloading the plugin detaches its native extensions from registered editors, cancels requests and clears memory caches. When a new plugin instance is loaded, obtain its new API and remount the extension. Destroy your EditorView normally when the tab closes. All widget DOM is created in the editor's owner document for popouts.

Only exact text inserted at the current suggestion's anchor can reuse it. A changed suffix, other edit, selection or cursor drift invalidates the response. The API neither executes model output nor writes any other file.

## Existing integrations

LaTeX Live releases that use the historical YOLO bridge continue to find plugin ID `yolo`, the three controller getters, `handleTabCompletionEditorChange`, and the relevant controller fields. New integrations should use `completionApi` instead of those internal fields.

LaTeX Live's source and visual (`live`) modes share the same CodeMirror source document. Completion inserts literal TeX at the source cursor; it does not write into MathJax's rendered DOM. In visual mode, the current formula exposes its source while surrounding formulas remain rendered. The ghost stays plain text until accepted, after which LaTeX Live updates the formula preview. Its existing completion menu takes priority over the AI suggestion.

For integration validation, use a fresh synthetic file for each independent case and verify both modes. Check inline and display math, exact Tab insertion, rendering after leaving the formula, switching modes during a request and with a visible suggestion, Escape with a late response, cursor invalidation, and the LaTeX completion menu's Tab priority. These cases were exercised against LaTeX Live 0.1.7 on desktop Obsidian 1.13.7, including a real Mercury request in visual mode. Keyboard events in the matrix were programmatic. Mobile has not been runtime-tested. LaTeX Live 0.1.7 may print an informational version warning because its historical allowlist predates this fork's 1.0.0 version; keep the actual version rather than spoofing it.

Context includes bounded parts of the current document only. Supported structure cues include Markdown headings/fences/math and TeX sections/environments/macros. This is deliberately not a general syntax parser, an include resolver, or a vault index.
