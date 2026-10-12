import { Extension, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { Editor } from 'obsidian'

import type { TabCompletionController } from '../tab-completion/tabCompletionController'

import {
  InlineSuggestionGhostPayload,
  TabCompletionDisplayPayload,
  inlineSuggestionGhostEffect,
  inlineSuggestionGhostField,
  tabCompletionDisplayEffect,
  tabCompletionDisplayField,
  tabLoadingDotsEffect,
  tabLoadingDotsField,
} from './inlineSuggestion'

type ActiveInlineSuggestion = {
  source: 'tab'
  editor: Editor
  view: EditorView
  fromOffset: number
  text: string
}

type InlineSuggestionControllerDeps = {
  getEditorView: (editor: Editor) => EditorView | null
  getTabCompletionController: () => TabCompletionController
}

export class InlineSuggestionController {
  private readonly getEditorView: (editor: Editor) => EditorView | null
  private readonly getTabCompletionController: () => TabCompletionController

  private activeInlineSuggestion: ActiveInlineSuggestion | null = null

  constructor(deps: InlineSuggestionControllerDeps) {
    this.getEditorView = deps.getEditorView
    this.getTabCompletionController = deps.getTabCompletionController
  }

  createExtension(available?: (view: EditorView) => boolean): Extension {
    const guarded = (view: EditorView, action: () => boolean) => {
      if (available && !available(view)) {
        queueMicrotask(() =>
          this.getTabCompletionController().handleFocusLost(view),
        )
        return false
      }
      return action()
    }
    return [
      inlineSuggestionGhostField,
      tabCompletionDisplayField,
      tabLoadingDotsField,
      EditorView.updateListener.of((update) => {
        if (update.focusChanged && !update.view.hasFocus) {
          queueMicrotask(() =>
            this.getTabCompletionController().handleFocusLost(update.view),
          )
        } else if (update.selectionSet && !update.docChanged) {
          queueMicrotask(() =>
            this.getTabCompletionController().handleSelectionChange(
              update.view,
            ),
          )
        }
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'ArrowUp',
            run: (v) =>
              guarded(v, () =>
                this.getTabCompletionController().tryNavigateFromView(v, -1),
              ),
          },
          {
            key: 'ArrowDown',
            run: (v) =>
              guarded(v, () =>
                this.getTabCompletionController().tryNavigateFromView(v, 1),
              ),
          },
          {
            key: 'Tab',
            run: (v) =>
              guarded(v, () => this.tryAcceptInlineSuggestionFromView(v)),
          },
          {
            key: 'Shift-Tab',
            run: (v) =>
              guarded(v, () => this.tryRejectInlineSuggestionFromView(v)),
          },
          {
            key: 'Escape',
            run: (v) =>
              guarded(v, () => this.tryRejectInlineSuggestionFromView(v)),
          },
        ]),
      ),
    ]
  }

  destroy() {
    this.activeInlineSuggestion = null
  }

  setInlineSuggestionGhost(
    view: EditorView,
    payload: InlineSuggestionGhostPayload,
  ) {
    view.dispatch({ effects: inlineSuggestionGhostEffect.of(payload) })
  }

  setTabCompletionDisplay(
    view: EditorView,
    payload: TabCompletionDisplayPayload,
  ) {
    view.dispatch({ effects: tabCompletionDisplayEffect.of(payload) })
  }

  showTabLoadingDots(view: EditorView, from: number) {
    view.dispatch({ effects: tabLoadingDotsEffect.of({ from }) })
  }

  hideTabLoadingDots(view: EditorView) {
    view.dispatch({ effects: tabLoadingDotsEffect.of(null) })
  }

  setActiveInlineSuggestion(suggestion: ActiveInlineSuggestion | null) {
    this.activeInlineSuggestion = suggestion
  }

  clearInlineSuggestion() {
    this.getTabCompletionController().clearSuggestion()
    this.activeInlineSuggestion = null
  }
  tryAcceptInlineSuggestionFromView(view: EditorView): boolean {
    return this.getTabCompletionController().tryAcceptFromView(view)
  }
  tryRejectInlineSuggestionFromView(view: EditorView): boolean {
    const tab = this.getTabCompletionController()
    return tab.tryRejectFromView(view)
  }
}
