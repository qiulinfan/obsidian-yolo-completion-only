import type { Extension, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Editor, MarkdownView } from 'obsidian'
import {
  DEFAULT_TAB_COMPLETION_OPTIONS,
  type YoloSettings,
  type Model,
  type Provider,
  splitContextRange,
  selectedModel,
  tokenLimit,
} from '../../../settings/schema/setting.types'
import { requestCompletion } from '../../../completion/request'
import {
  cleanCompletion,
  isCompletionFinished,
} from '../../../completion/fim-policy'
import {
  describeContext,
  pathInstructions,
  cursorContext,
  type DocumentContext,
} from '../../../completion/context'
import { CompletionCache } from '../../../completion/cache'
import type {
  InlineSuggestionGhostPayload,
  TabCompletionCandidateStatus,
  TabCompletionDisplayPayload,
} from '../inline-suggestion/inlineSuggestion'

type TabCompletionDeps = {
  getSettings: () => YoloSettings
  getEditorView: (editor: Editor) => EditorView | null
  getActiveMarkdownView: () => MarkdownView | null
  getActiveFileTitle: (editor?: Editor) => string
  getFilePath?: (editor: Editor) => string
  setTabCompletionDisplay: (
    view: EditorView,
    payload: TabCompletionDisplayPayload,
  ) => void
  setInlineSuggestionGhost: (
    view: EditorView,
    payload: InlineSuggestionGhostPayload,
  ) => void
  showTabLoadingDots: (view: EditorView, from: number) => void
  hideTabLoadingDots: (view: EditorView) => void
  getSwitchSuggestionHint: () => string
  clearInlineSuggestion: () => void
  setActiveInlineSuggestion: (
    value: {
      source: 'tab'
      editor: Editor
      view: EditorView
      fromOffset: number
      text: string
    } | null,
  ) => void
}
type Options = typeof DEFAULT_TAB_COMPLETION_OPTIONS & {
  maxBeforeChars: number
  maxAfterChars: number
}
type Prepared = {
  editor: Editor
  view: EditorView
  doc: Text
  cursor: number
  from: number | null
  prefix: string
  suffix: string
  system: string
  context: DocumentContext
  model: Model
  provider: Provider
  options: Options
  key: string
  fim: boolean
  multiple: boolean
}
type Suggestion = {
  editor: Editor
  view: EditorView
  doc: Text
  cursorOffset: number
  replaceFromOffset: number | null
  candidates: { text: string; status: TabCompletionCandidateStatus }[]
  selectedIndex: number
  hasUserNavigated: boolean
  multipleCandidates: boolean
  consumed: string
  rawCandidates: string[]
  key: string
}
const SEPARATOR = '<yolo_next_suggestion/>'
export class TabCompletionController {
  // Kept stable for the existing LaTeX Live consumer.
  private tabCompletionTimer: ReturnType<typeof setTimeout> | null = null
  private tabCompletionPending: {
    editor: Editor
    cursorOffset: number
    replaceFromOffset: number | null
  } | null = null
  private tabCompletionSuggestion: Suggestion | null = null
  private tabCompletionAbortController: AbortController | null = null
  private lastRequestAt = -Infinity
  private loadingView: EditorView | null = null
  private cache = new CompletionCache()
  private viewIds = new WeakMap<EditorView, number>()
  private nextViewId = 0
  private contextCache = new WeakMap<
    EditorView,
    {
      doc: Text
      cursor: number
      file: string
      budget: number
      value: DocumentContext
    }
  >()
  lastError: string | null = null
  readonly stats = {
    requests: 0,
    cacheHits: 0,
    reusedCharacters: 0,
    cancelledRequests: 0,
  }
  constructor(private readonly deps: TabCompletionDeps) {}
  createTriggerExtension(
    resolveEditor?: (view: EditorView) => Editor | null,
  ): Extension {
    return EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const editor = resolveEditor
        ? resolveEditor(update.view)
        : this.deps.getActiveMarkdownView()?.editor
      if (!editor || this.deps.getEditorView(editor) !== update.view) return
      const { doc, selection } = update.state
      const accepted = update.transactions.some((tr) =>
        tr.isUserEvent('input.complete'),
      )
      const history = update.transactions.some(
        (tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'),
      )
      const userEdit = update.transactions.some(
        (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'),
      )
      queueMicrotask(() => {
        if (
          update.view.state.doc !== doc ||
          update.view.state.selection.main.head !== selection.main.head
        )
          return
        if (accepted || history || !userEdit || update.view.composing) {
          this.handleFocusLost(update.view)
          return
        }
        this.handleEditorChange(editor)
      })
    })
  }
  getTabCompletionOptions(): Options {
    const raw = this.deps.getSettings().continuationOptions.tabCompletionOptions
    const options = { ...DEFAULT_TAB_COMPLETION_OPTIONS, ...raw }
    return { ...options, ...splitContextRange(options.contextRange) }
  }
  private getTriggerMatch(
    view: EditorView,
    cursor: number,
  ): { replaceFromOffset: number | null } | null {
    const start = Math.max(
      0,
      cursor - Math.min(this.getTabCompletionOptions().contextRange, 2000),
    )
    const before = view.state.doc.sliceString(start, cursor)
    for (const t of this.deps.getSettings().continuationOptions
      .tabCompletionTriggers) {
      if (!t.enabled || !t.pattern) continue
      if (t.type === 'string' && before.endsWith(t.pattern))
        return {
          replaceFromOffset:
            t.acceptMode === 'replace' ? cursor - t.pattern.length : null,
        }
      if (t.type === 'regex')
        try {
          const m = new RegExp(t.pattern).exec(before)
          if (m && m.index + m[0].length === before.length)
            return {
              replaceFromOffset:
                t.acceptMode === 'replace' ? start + m.index : null,
            }
        } catch {
          /* Invalid user expressions cannot break typing. */
        }
    }
    return null
  }
  private prepare(
    editor: Editor,
    cursor: number,
    replace?: number | null,
  ): Prepared | null {
    const settings = this.deps.getSettings(),
      view = this.deps.getEditorView(editor)
    if (
      !settings.continuationOptions.enableTabCompletion ||
      !view ||
      view.composing ||
      view.state.readOnly ||
      view.state.selection.main.head !== cursor ||
      !view.state.selection.main.empty ||
      view.state.selection.ranges.length !== 1
    )
      return null
    const { model, provider } = selectedModel(settings)
    if (
      !model ||
      !provider ||
      !provider.baseUrl ||
      (!provider.apiKey &&
        provider.baseUrl.startsWith('https://api.inceptionlabs.ai'))
    ) {
      this.lastError = 'model-not-configured'
      return null
    }
    const options = this.getTabCompletionOptions(),
      doc = view.state.doc
    const from =
      replace === undefined
        ? (this.getTriggerMatch(view, cursor)?.replaceFromOffset ?? null)
        : replace
    if (from !== null && (from < 0 || from > cursor)) return null
    const prefix = cursorContext(
      doc,
      from ?? cursor,
      options.maxBeforeChars,
      0,
    ).prefix
    const suffix = cursorContext(doc, cursor, 0, options.maxAfterChars).suffix
    if (prefix.trim().length < options.minContextLength) return null
    const file =
      this.deps.getFilePath?.(editor) || this.deps.getActiveFileTitle(editor)
    let cached = this.contextCache.get(view)
    if (
      !cached ||
      cached.doc !== doc ||
      cached.cursor !== cursor ||
      cached.file !== file ||
      cached.budget !== options.contextBudget
    ) {
      cached = {
        doc,
        cursor,
        file,
        budget: options.contextBudget,
        value: describeContext(doc, cursor, file, options.contextBudget),
      }
      this.contextCache.set(view, cached)
    }
    const context = options.contextEnabled
      ? cached.value
      : { ...cached.value, metadata: '' }
    const c = settings.continuationOptions
    const instructions: Partial<Record<DocumentContext['kind'], string>> = {
      math: 'Complete only the expression at the cursor. Reuse existing notation and assumptions; do not start a new equation or proof step.',
      code: 'Complete the code in its existing language. Preserve indentation and syntax; return no explanation or extra fences.',
      heading: 'Complete this heading only; do not start the body.',
      proof:
        'Continue the immediate proof step using the stated hypotheses and existing notation.',
    }
    const rule = pathInstructions(file, c.contextRules)
    const system =
      c.tabCompletionSystemPrompt +
      (rule ? '\n' + rule : '') +
      (c.tabCompletionConstraints ? '\n' + c.tabCompletionConstraints : '') +
      (instructions[context.kind] ? '\n' + instructions[context.kind] : '')
    const fim =
      model.completionProtocol === 'mercury-fim' ||
      (!model.completionProtocol && model.model === 'mercury-edit-2')
    const multiple = !fim && options.multipleCandidatesEnabled
    if (!this.viewIds.has(view)) this.viewIds.set(view, ++this.nextViewId)
    const key = JSON.stringify([
      this.viewIds.get(view),
      file,
      provider.id,
      provider.baseUrl,
      model.id,
      model.model,
      model.completionProtocol,
      tokenLimit(model),
      options.temperature,
      options.maxSuggestionLength,
      multiple,
      system,
      context.metadata,
      context.kind,
      prefix,
      suffix,
      from !== null,
    ])
    return {
      editor,
      view,
      doc,
      cursor,
      from,
      prefix,
      suffix,
      system,
      context,
      model,
      provider,
      options,
      key,
      fim,
      multiple,
    }
  }
  clearTimer() {
    if (this.tabCompletionTimer !== null) clearTimeout(this.tabCompletionTimer)
    this.tabCompletionTimer = null
    this.tabCompletionPending = null
  }
  cancelRequest() {
    this.clearTimer()
    if (this.loadingView) {
      this.deps.hideTabLoadingDots(this.loadingView)
      this.loadingView = null
    }
    if (this.tabCompletionAbortController) {
      this.tabCompletionAbortController.abort()
      this.stats.cancelledRequests++
      this.tabCompletionAbortController = null
    }
  }
  clearSuggestion() {
    const s = this.tabCompletionSuggestion
    if (s) {
      this.deps.setTabCompletionDisplay(s.view, null)
      this.deps.setInlineSuggestionGhost(s.view, null)
      this.tabCompletionSuggestion = null
    }
    if (this.loadingView) {
      this.deps.hideTabLoadingDots(this.loadingView)
      this.loadingView = null
    }
  }
  stop() {
    this.clearTimer()
    this.cancelRequest()
    this.deps.clearInlineSuggestion()
  }
  clearCache() {
    this.cache.clear()
    this.contextCache = new WeakMap()
  }
  handleEditorChange(editor: Editor) {
    this.clearTimer()
    const view = this.deps.getEditorView(editor)
    if (
      this.deps.getSettings().continuationOptions.enableTabCompletion &&
      view &&
      !view.composing &&
      this.reuseTypedText(view)
    )
      return
    this.cancelRequest()
    this.deps.clearInlineSuggestion()
    if (!view) return
    const cursor = view.state.selection.main.head,
      prepared = this.prepare(editor, cursor)
    if (!prepared) return
    // Obsidian's native file picker owns incomplete wikilinks.
    if (
      prepared.context.format === 'markdown' &&
      prepared.context.kind !== 'code' &&
      /\[\[[^\]\n]*$/.test(prepared.prefix)
    )
      return
    if (this.showCache(prepared)) return
    const trigger = this.getTriggerMatch(view, cursor),
      o = prepared.options
    if (!trigger && !o.idleTriggerEnabled) return
    const boundary = /[\s，。！？：；,.!?;:]$/.test(prepared.prefix)
    const delay = boundary
      ? Math.min(
          trigger ? o.triggerDelayMs : o.autoTriggerDelayMs,
          o.boundaryDelayMs,
        )
      : trigger
        ? o.triggerDelayMs
        : o.autoTriggerDelayMs
    const wait = Math.max(
      0,
      delay,
      o.autoTriggerCooldownMs - (Date.now() - this.lastRequestAt),
    )
    // Expose a queued frame to existing editor bridges so Escape can cancel debounce.
    this.makeSuggestion(prepared, undefined, false)
    this.tabCompletionPending = {
      editor,
      cursorOffset: cursor,
      replaceFromOffset: prepared.from,
    }
    this.tabCompletionTimer = setTimeout(() => {
      this.tabCompletionTimer = null
      if (
        this.tabCompletionPending?.editor !== editor ||
        view.state.doc !== prepared.doc ||
        view.state.selection.main.head !== cursor ||
        !view.state.selection.main.empty ||
        view.state.selection.ranges.length !== 1
      )
        return
      void this.run(editor, cursor, prepared.from)
    }, wait)
  }
  /** Exact insertion at the anchor; never case-fold, trim, or accept unrelated edits. */
  private reuseTypedText(view: EditorView) {
    const s = this.tabCompletionSuggestion
    if (
      !s ||
      s.view !== view ||
      s.replaceFromOffset !== null ||
      !view.state.selection.main.empty ||
      view.state.selection.ranges.length !== 1
    )
      return false
    const old = s.cursorOffset,
      next = view.state.selection.main.head,
      added = next - old
    if (added <= 0 || view.state.doc.length !== s.doc.length + added)
      return false
    if (
      !s.doc.slice(0, old).eq(view.state.doc.slice(0, old)) ||
      !s.doc.slice(old).eq(view.state.doc.slice(next))
    )
      return false
    const inserted = view.state.doc.sliceString(old, next),
      candidate = s.candidates[s.selectedIndex]
    if (!candidate?.text.startsWith(inserted)) return false
    s.consumed += inserted
    s.doc = view.state.doc
    s.cursorOffset = next
    for (let i = 0; i < s.candidates.length; i++)
      s.candidates[i].text = s.rawCandidates[i]?.startsWith(s.consumed)
        ? s.rawCandidates[i].slice(s.consumed.length)
        : ''
    this.stats.reusedCharacters += added
    this.renderSuggestion(s)
    return true
  }
  private showCache(p: Prepared) {
    if (!p.options.cacheEnabled) return false
    const texts = this.cache.get(p.key)
    if (!texts) return false
    this.stats.cacheHits++
    this.lastError = null
    this.makeSuggestion(p, texts)
    return true
  }
  private makeSuggestion(p: Prepared, texts?: string[], render = true) {
    const s: Suggestion = {
      editor: p.editor,
      view: p.view,
      doc: p.doc,
      cursorOffset: p.cursor,
      replaceFromOffset: p.from,
      candidates: (texts ?? Array(p.multiple ? 3 : 1).fill('')).map((text) => ({
        text,
        status: text ? 'complete' : 'generating',
      })),
      selectedIndex: 0,
      hasUserNavigated: false,
      multipleCandidates: p.multiple,
      consumed: '',
      rawCandidates: texts ? [...texts] : [],
      key: p.key,
    }
    this.tabCompletionSuggestion = s
    if (render) this.renderSuggestion(s)
    return s
  }
  private renderSuggestion(s: Suggestion) {
    if (this.tabCompletionSuggestion !== s) return
    const c = s.candidates[s.selectedIndex]
    if (s.multipleCandidates)
      this.deps.setTabCompletionDisplay(s.view, {
        from: s.cursorOffset,
        text: c?.text ?? '',
        candidateStatuses: s.candidates.map((x) => x.status),
        selectedIndex: s.selectedIndex,
        showSelectionIndicator: s.hasUserNavigated,
        availableCount: s.candidates.filter((x) => x.text).length,
        switchHint: this.deps.getSwitchSuggestionHint(),
      })
    else if (c?.text) {
      if (this.loadingView) {
        this.deps.hideTabLoadingDots(this.loadingView)
        this.loadingView = null
      }
      this.deps.setInlineSuggestionGhost(s.view, {
        from: s.cursorOffset,
        text: c.text,
      })
    } else if (c?.status === 'generating') {
      this.loadingView = s.view
      this.deps.showTabLoadingDots(s.view, s.cursorOffset)
    } else {
      this.deps.setInlineSuggestionGhost(s.view, null)
      if (this.loadingView) {
        this.deps.hideTabLoadingDots(this.loadingView)
        this.loadingView = null
      }
    }
    this.deps.setActiveInlineSuggestion(
      c?.text
        ? {
            source: 'tab',
            editor: s.editor,
            view: s.view,
            fromOffset: s.cursorOffset,
            text: c.text,
          }
        : null,
    )
  }
  private updateCandidatesFromRawText(s: Suggestion, raw: string) {
    const chunks = s.multipleCandidates
      ? raw.split(SEPARATOR).slice(0, s.candidates.length)
      : [raw]
    s.rawCandidates = chunks.map((text, index) => {
      if (s.multipleCandidates && index === chunks.length - 1)
        for (let n = Math.min(text.length, SEPARATOR.length - 1); n > 0; n--)
          if (text.endsWith(SEPARATOR.slice(0, n))) {
            text = text.slice(0, -n)
            break
          }
      return text.replace(/\r\n/g, '\n').replace(/\s+$/, '')
    })
    s.candidates.forEach((c, i) => {
      const text = s.rawCandidates[i] ?? ''
      c.text = text.startsWith(s.consumed) ? text.slice(s.consumed.length) : ''
      c.status = i < chunks.length - 1 ? 'complete' : 'generating'
    })
    this.renderSuggestion(s)
  }
  private finishCandidateGeneration(s: Suggestion, interrupted: boolean) {
    if (this.tabCompletionSuggestion !== s) return
    for (const c of s.candidates)
      c.status = interrupted ? 'interrupted' : 'complete'
    this.renderSuggestion(s)
  }
  async run(editor: Editor, cursor: number, replaceFromOffset?: number | null) {
    const p = this.prepare(editor, cursor, replaceFromOffset)
    if (!p) return
    this.clearTimer()
    this.cancelRequest()
    this.deps.clearInlineSuggestion()
    if (this.showCache(p)) return
    const s = this.makeSuggestion(p),
      controller = new AbortController()
    this.tabCompletionAbortController = controller
    this.lastRequestAt = Date.now()
    this.stats.requests++
    this.lastError = null
    const timeout = setTimeout(
      () => controller.abort(),
      p.options.requestTimeoutMs,
    )
    const unchanged = () =>
      this.tabCompletionSuggestion === s &&
      this.deps.getEditorView(editor) === s.view &&
      s.view.state.doc === s.doc &&
      s.view.state.selection.main.head === s.cursorOffset &&
      s.view.state.selection.main.empty &&
      s.view.state.selection.ranges.length === 1
    let raw = ''
    try {
      await requestCompletion({
        provider: p.provider,
        model: p.model,
        prefix: p.prefix,
        suffix: p.suffix,
        context: p.context,
        system:
          p.system +
          (p.multiple
            ? `\nReturn three independent candidates separated by ${SEPARATOR}. No labels.`
            : ''),
        temperature: p.options.temperature,
        signal: controller.signal,
        onDelta: (delta) => {
          if (controller.signal.aborted || !unchanged()) {
            controller.abort()
            return false
          }
          raw += delta
          const text = p.multiple
            ? raw
            : cleanCompletion(raw, p.prefix, p.suffix, p.context.kind)
          this.updateCandidatesFromRawText(
            s,
            text.slice(0, p.options.maxSuggestionLength),
          )
          return (
            p.multiple ||
            !(
              isCompletionFinished(raw, p.prefix, p.suffix, p.context.kind) ||
              text.length >= p.options.maxSuggestionLength
            )
          )
        },
      })
      if (unchanged() && !controller.signal.aborted) {
        this.finishCandidateGeneration(s, !raw.trim())
        if (p.options.cacheEnabled) this.cache.set(p.key, s.rawCandidates)
      }
    } catch (error) {
      if (
        this.tabCompletionSuggestion !== s ||
        this.tabCompletionAbortController !== controller
      )
        return
      const message = error instanceof Error ? error.message : ''
      this.lastError = controller.signal.aborted
        ? 'cancelled-or-timeout'
        : /^(http-\d+|model-not-configured|invalid-endpoint|insecure-endpoint|invalid-fim-endpoint|provider-error|missing-stream)$/.test(
              message,
            )
          ? message
          : 'request-failed'
      if (unchanged()) this.finishCandidateGeneration(s, true)
    } finally {
      clearTimeout(timeout)
      if (this.tabCompletionAbortController === controller)
        this.tabCompletionAbortController = null
    }
  }
  handleSelectionChange(view: EditorView) {
    const pending = this.tabCompletionPending
    if (
      pending &&
      this.deps.getEditorView(pending.editor) === view &&
      (view.state.selection.main.head !== pending.cursorOffset ||
        !view.state.selection.main.empty ||
        view.state.selection.ranges.length !== 1)
    )
      this.clearTimer()
    const s = this.tabCompletionSuggestion
    if (
      s?.view === view &&
      (view.state.selection.main.head !== s.cursorOffset ||
        !view.state.selection.main.empty ||
        view.state.selection.ranges.length !== 1)
    ) {
      this.cancelRequest()
      this.deps.clearInlineSuggestion()
    }
  }
  handleWorkspaceChange() {
    const view =
      this.tabCompletionSuggestion?.view ??
      (this.tabCompletionPending &&
        this.deps.getEditorView(this.tabCompletionPending.editor))
    // A delayed leaf event must not clear a focused native editor or popout.
    if (view && !view.hasFocus) this.stop()
  }
  handleFocusLost(view: EditorView) {
    if (
      this.tabCompletionSuggestion?.view === view ||
      (this.tabCompletionPending &&
        this.deps.getEditorView(this.tabCompletionPending.editor) === view)
    )
      this.stop()
  }
  tryNavigateFromView(view: EditorView, direction: -1 | 1) {
    const s = this.tabCompletionSuggestion
    if (!s || s.view !== view) return false
    const choices = s.candidates.flatMap((c, i) => (c.text ? [i] : []))
    if (choices.length < 2) return false
    s.selectedIndex =
      choices[
        (choices.indexOf(s.selectedIndex) + direction + choices.length) %
          choices.length
      ]
    s.hasUserNavigated = true
    this.renderSuggestion(s)
    return true
  }
  tryRejectFromView(view: EditorView) {
    const s = this.tabCompletionSuggestion
    const pending =
      this.tabCompletionPending &&
      this.deps.getEditorView(this.tabCompletionPending.editor) === view
    if (!pending && s?.view !== view) return false
    if (s) this.cache.delete(s.key)
    this.stop()
    return true
  }
  tryAcceptFromView(view: EditorView) {
    const s = this.tabCompletionSuggestion
    if (!s || s.view !== view) return false
    if (
      view.state.readOnly ||
      view.composing ||
      view.state.doc !== s.doc ||
      view.state.selection.main.head !== s.cursorOffset ||
      !view.state.selection.main.empty ||
      view.state.selection.ranges.length !== 1
    ) {
      this.stop()
      return false
    }
    const text = s.candidates[s.selectedIndex]?.text
    if (!text) return false
    const from = s.replaceFromOffset ?? s.cursorOffset,
      to = s.cursorOffset
    this.stop()
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input.complete.ai',
    })
    return true
  }
}
