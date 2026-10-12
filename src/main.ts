import { EditorView, ViewPlugin } from '@codemirror/view'
import { Compartment, type Extension } from '@codemirror/state'
import {
  MarkdownView,
  Notice,
  Plugin,
  type Editor,
  type FileView,
} from 'obsidian'
import { TabCompletionController } from './features/editor/tab-completion/tabCompletionController'
import { InlineSuggestionController } from './features/editor/inline-suggestion/inlineSuggestionController'
import {
  loadSettings,
  type YoloSettings,
} from './settings/schema/setting.types'
import { AutocompleteSettingsTab } from './settings/tab'
import { t } from './i18n'

export default class AutocompletePlugin extends Plugin {
  settings: YoloSettings = loadSettings(null)
  tabCompletionController!: TabCompletionController
  inlineSuggestionController!: InlineSuggestionController
  connectionChecks = new Set<AbortController>()
  private externalEditors = new WeakMap<
    EditorView,
    {
      editor: Editor
      filename: () => string
      shouldSuggest?: (view: EditorView) => boolean
    }
  >()
  private externalViews = new Set<{
    view: EditorView
    compartment: Compartment
  }>()
  /** Native CodeMirror integration; no runtime source patching or private controller access. */
  readonly completionApi = {
    version: 1 as const,
    createExtension: (
      filename: () => string,
      shouldSuggest?: (view: EditorView) => boolean,
    ): Extension => this.createEditorExtension(filename, shouldSuggest),
    trigger: (view: EditorView) => {
      const row = this.externalEditors.get(view)
      if (row && row.shouldSuggest?.(view) !== false)
        return this.tabCompletionController.run(
          row.editor,
          view.state.selection.main.head,
        )
    },
    accept: (view: EditorView) =>
      this.externalEditors.get(view)?.shouldSuggest?.(view) === false
        ? false
        : this.tabCompletionController.tryAcceptFromView(view),
    dismiss: (view: EditorView) =>
      this.tabCompletionController.tryRejectFromView(view),
  }
  async onload() {
    this.initializeControllers()
    const data = await this.loadData()
    this.settings = loadSettings(data)
    if (!this.settings.chatModels.length) {
      this.settings.providers.push({
        id: 'autocomplete-mercury',
        name: 'Mercury',
        baseUrl: 'https://api.inceptionlabs.ai/v1',
        apiKey: '',
      })
      this.settings.chatModels.push({
        id: 'autocomplete-mercury-fim',
        providerId: 'autocomplete-mercury',
        name: 'Mercury Edit 2',
        model: 'mercury-edit-2',
        enable: true,
        customParameters: [{ key: 'max_tokens', type: 'number', value: '32' }],
      })
      this.settings.continuationOptions.tabCompletionModelId =
        'autocomplete-mercury-fim'
    }
    const inline = this.inlineSuggestionController
    this.registerEditorExtension([
      inline.createExtension(),
      this.tabCompletionController.createTriggerExtension(),
      this.compositionExtension((view) => {
        const editor =
          this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
        return editor && this.getEditorView(editor) === view ? editor : null
      }),
    ])
    this.addSettingTab(new AutocompleteSettingsTab(this))
    this.addCommand({
      id: 'trigger-tab-completion',
      name: t('trigger'),
      editorCallback: (editor) => {
        const view = this.getEditorView(editor)
        if (view)
          void this.tabCompletionController.run(
            editor,
            view.state.selection.main.head,
          )
      },
    })
    this.addCommand({
      id: 'accept-inline-suggestion',
      name: t('accept'),
      editorCallback: (editor) => {
        const view = this.getEditorView(editor)
        if (view) inline.tryAcceptInlineSuggestionFromView(view)
      },
    })
    this.addCommand({
      id: 'cancel-tab-completion',
      name: t('cancel'),
      callback: () => this.cancel(),
    })
    this.addCommand({
      id: 'toggle-tab-completion',
      name: t('toggle'),
      callback: () => {
        void this.toggle()
      },
    })
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () =>
        this.tabCompletionController.handleWorkspaceChange(),
      ),
    )
  }
  private initializeControllers() {
    if (this.inlineSuggestionController) return
    const inline = (this.inlineSuggestionController =
      new InlineSuggestionController({
        getEditorView: (editor) => this.getEditorView(editor),
        getTabCompletionController: () => this.tabCompletionController,
      }))
    this.tabCompletionController = new TabCompletionController({
      getSettings: () => this.settings,
      getFilePath: (editor) => this.getEditorFilePath(editor),
      getEditorView: (editor) => this.getEditorView(editor),
      getActiveMarkdownView: () =>
        this.app.workspace.getActiveViewOfType(MarkdownView),
      getActiveFileTitle: (editor) => {
        const view = editor && this.getEditorView(editor)
        return (
          (view && this.externalEditors.get(view)?.filename()) ||
          this.app.workspace.getActiveFile()?.path ||
          ''
        )
      },
      setTabCompletionDisplay: (view, payload) =>
        inline.setTabCompletionDisplay(view, payload),
      setInlineSuggestionGhost: (view, payload) =>
        inline.setInlineSuggestionGhost(view, payload),
      showTabLoadingDots: (view, from) => inline.showTabLoadingDots(view, from),
      hideTabLoadingDots: (view) => inline.hideTabLoadingDots(view),
      getSwitchSuggestionHint: () => t('switchHint'),
      clearInlineSuggestion: () => inline.clearInlineSuggestion(),
      setActiveInlineSuggestion: (suggestion) =>
        inline.setActiveInlineSuggestion(suggestion),
    })
  }
  private compositionExtension(
    resolve: (view: EditorView) => Editor | null,
  ): Extension {
    return EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        queueMicrotask(() => this.tabCompletionController.handleFocusLost(view))
        return false
      },
      compositionend: (_event, view) => {
        view.dom.ownerDocument.defaultView?.setTimeout(() => {
          const editor = resolve(view)
          if (
            editor &&
            !view.composing &&
            this.settings.continuationOptions.enableTabCompletion
          )
            this.handleTabCompletionEditorChange(editor)
        }, 0)
        return false
      },
    })
  }
  createEditorExtension(
    filename: () => string,
    shouldSuggest?: (view: EditorView) => boolean,
  ): Extension {
    this.initializeControllers()
    const compartment = new Compartment()
    const resolve = (view: EditorView) => {
      let row = this.externalEditors.get(view)
      if (!row) {
        row = {
          editor: { cm: view } as unknown as Editor,
          filename,
          shouldSuggest,
        }
        this.externalEditors.set(view, row)
      }
      return row.shouldSuggest?.(view) === false ? null : row.editor
    }
    return compartment.of([
      this.inlineSuggestionController.createExtension(
        (view) => shouldSuggest?.(view) !== false,
      ),
      this.tabCompletionController.createTriggerExtension(resolve),
      this.compositionExtension(resolve),
      ViewPlugin.define((view) => {
        resolve(view)
        const entry = { view, compartment }
        this.externalViews.add(entry)
        return {
          update: () => {
            if (shouldSuggest?.(view) === false)
              queueMicrotask(() =>
                this.tabCompletionController.handleFocusLost(view),
              )
          },
          destroy: () => {
            this.externalViews.delete(entry)
            this.externalEditors.delete(view)
            queueMicrotask(() =>
              this.tabCompletionController.handleFocusLost(view),
            )
          },
        }
      }),
    ])
  }
  private getEditorFilePath(editor: Editor): string {
    const view = this.getEditorView(editor)
    if (!view) return ''
    const external = this.externalEditors.get(view)
    if (external) return external.filename()
    let path = ''
    this.app.workspace.iterateAllLeaves((leaf) => {
      const candidate = (
        leaf.view as unknown as {
          editor?: EditorView | (Editor & { cm?: EditorView })
        }
      ).editor
      if (
        candidate === view ||
        (candidate && 'cm' in candidate && candidate.cm === view)
      )
        path = (leaf.view as FileView).file?.path ?? ''
    })
    return path
  }
  // These methods and the existing controller fields are consumed by LaTeX Live.
  getEditorView(editor: Editor): EditorView | null {
    return (editor as Editor & { cm?: EditorView }).cm ?? null
  }
  getTabCompletionController() {
    this.initializeControllers()
    return this.tabCompletionController
  }
  getInlineSuggestionController() {
    this.initializeControllers()
    return this.inlineSuggestionController
  }
  handleTabCompletionEditorChange(editor: Editor) {
    this.tabCompletionController.handleEditorChange(editor)
  }
  cancel() {
    this.tabCompletionController?.clearTimer()
    this.tabCompletionController?.cancelRequest()
    this.inlineSuggestionController?.clearInlineSuggestion()
  }
  async saveSettings() {
    this.cancel()
    this.tabCompletionController.clearCache()
    await this.saveData(this.settings)
  }
  async toggle() {
    const c = this.settings.continuationOptions
    c.enableTabCompletion = !c.enableTabCompletion
    await this.saveSettings()
    new Notice(t(c.enableTabCompletion ? 'on' : 'off'))
  }
  onunload() {
    this.settings.continuationOptions.enableTabCompletion = false
    this.cancel()
    for (const check of this.connectionChecks) check.abort()
    this.connectionChecks.clear()
    for (const { view, compartment } of [...this.externalViews])
      view.dispatch({ effects: compartment.reconfigure([]) })
    this.externalViews.clear()
    this.tabCompletionController?.clearCache()
    this.inlineSuggestionController?.destroy()
  }
}
