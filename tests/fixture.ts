import { EditorState } from '@codemirror/state'
import { TabCompletionController } from '../src/features/editor/tab-completion/tabCompletionController'
import { loadSettings } from '../src/settings/schema/setting.types'
const provider = {
  id: 'p',
  baseUrl: 'https://api.inceptionlabs.ai/v1',
  apiKey: 'fixture-key',
}
const model = {
  id: 'm',
  providerId: 'p',
  model: 'mercury-edit-2',
  name: 'FIM',
  enable: true,
}
export function fixture(filename = 'fixture.md') {
  const settings = loadSettings({
    providers: [provider],
    chatModels: [model],
    continuationOptions: { tabCompletionModelId: 'm' },
  })
  settings.continuationOptions.tabCompletionOptions.autoTriggerDelayMs = 5
  settings.continuationOptions.tabCompletionOptions.autoTriggerCooldownMs = 0
  let state = EditorState.create({
    doc: 'Let $a < b$ and ',
    selection: { anchor: 16 },
  })
  const view = {
    get state() {
      return state
    },
    composing: false,
    dispatch(spec: any) {
      state = state.update(spec).state
    },
  } as any
  const editor = {
    cm: view,
    getSelection: () =>
      state.sliceDoc(state.selection.main.from, state.selection.main.to),
    getCursor: () => ({ line: 0, ch: state.selection.main.head }),
    offsetToPos: (n: number) => ({ line: 0, ch: n }),
    posToOffset: (p: any) => p.ch,
  } as any
  let text = ''
  let controller: TabCompletionController
  controller = new TabCompletionController({
    getSettings: () => settings,
    getEditorView: () => view,
    getActiveMarkdownView: () => ({ editor }) as any,
    getActiveFileTitle: () => filename,
    setTabCompletionDisplay: (_, p) => {
      text = p?.text ?? ''
    },
    setInlineSuggestionGhost: (_, p) => {
      text = p?.text ?? ''
    },
    showTabLoadingDots: () => {},
    hideTabLoadingDots: () => {},
    getSwitchSuggestionHint: () => '',
    clearInlineSuggestion: () => {
      controller.clearSuggestion()
      text = ''
    },
    setActiveInlineSuggestion: () => {},
  })
  return { settings, view, editor, controller, text: () => text }
}
