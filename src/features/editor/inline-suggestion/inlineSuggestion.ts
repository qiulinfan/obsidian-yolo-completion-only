import { StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'

export type InlineSuggestionGhostPayload = { from: number; text: string } | null

export const inlineSuggestionGhostEffect =
  StateEffect.define<InlineSuggestionGhostPayload>()

export type TabLoadingDotsPayload = { from: number } | null

export const tabLoadingDotsEffect = StateEffect.define<TabLoadingDotsPayload>()

class TabLoadingDotsWidget extends WidgetType {
  eq(_other: TabLoadingDotsWidget) {
    return true
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument
    const container = document.createElement('span')
    container.className = 'yolo-tab-loading-dots'
    container.setAttribute('aria-hidden', 'true')
    for (let index = 0; index < 3; index++) {
      const dot = document.createElement('span')
      dot.className = 'yolo-tab-loading-dots__dot'
      container.appendChild(dot)
    }
    return container
  }
}

export const tabLoadingDotsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let decorations = value.map(tr.changes)

    for (const effect of tr.effects) {
      if (effect.is(tabLoadingDotsEffect)) {
        const payload = effect.value
        if (!payload) {
          decorations = Decoration.none
          continue
        }
        const widget = Decoration.widget({
          widget: new TabLoadingDotsWidget(),
          side: 1,
        }).range(payload.from)
        decorations = Decoration.set([widget])
      }
    }

    if (tr.docChanged) {
      decorations = Decoration.none
    }

    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

export type TabCompletionCandidateStatus =
  | 'pending'
  | 'generating'
  | 'complete'
  | 'interrupted'

export type TabCompletionDisplayPayload = {
  from: number
  text: string
  candidateStatuses: TabCompletionCandidateStatus[]
  selectedIndex: number
  showSelectionIndicator: boolean
  availableCount: number
  switchHint: string
} | null

export const tabCompletionDisplayEffect =
  StateEffect.define<TabCompletionDisplayPayload>()

class TabCompletionDisplayWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly candidateStatuses: TabCompletionCandidateStatus[],
    private readonly selectedIndex: number,
    private readonly showSelectionIndicator: boolean,
    private readonly availableCount: number,
    private readonly switchHint: string,
  ) {
    super()
  }

  eq(other: TabCompletionDisplayWidget) {
    return (
      this.text === other.text &&
      this.selectedIndex === other.selectedIndex &&
      this.showSelectionIndicator === other.showSelectionIndicator &&
      this.availableCount === other.availableCount &&
      this.switchHint === other.switchHint &&
      this.candidateStatuses.length === other.candidateStatuses.length &&
      this.candidateStatuses.every(
        (status, index) => status === other.candidateStatuses[index],
      )
    )
  }

  updateDOM(dom: HTMLElement): boolean {
    const document = dom.ownerDocument
    if (!dom.classList.contains('yolo-tab-completion-display')) return false

    const statusRail = dom.querySelector<HTMLElement>(
      '.yolo-tab-completion-status',
    )
    if (
      !statusRail ||
      statusRail.children.length !== this.candidateStatuses.length
    ) {
      return false
    }

    this.candidateStatuses.forEach((status, index) => {
      const dot = statusRail.children.item(index)
      if (!(dot instanceof dom.ownerDocument.defaultView!.HTMLElement)) return
      const className = `yolo-tab-completion-status__dot is-${status}${
        this.showSelectionIndicator && index === this.selectedIndex
          ? ' is-selected'
          : ''
      }`
      if (dot.className !== className) {
        dot.className = className
      }
    })

    let ghost = dom.querySelector<HTMLElement>('.yolo-ghost-text')
    if (this.text) {
      if (!ghost) {
        ghost = document.createElement('span')
        ghost.className = 'yolo-ghost-text'
        const hint = dom.querySelector('.yolo-tab-completion-switch-hint')
        dom.insertBefore(ghost, hint)
      }
      if (ghost.textContent !== this.text) {
        ghost.textContent = this.text
      }
    } else {
      ghost?.remove()
    }

    let hint = dom.querySelector<HTMLElement>(
      '.yolo-tab-completion-switch-hint',
    )
    if (this.availableCount >= 2) {
      if (!hint) {
        hint = document.createElement('span')
        hint.className = 'yolo-tab-completion-switch-hint'
        dom.appendChild(hint)
      }
      const hintText = `${this.switchHint} · ${this.selectedIndex + 1}/${this.availableCount}`
      if (hint.textContent !== hintText) {
        hint.textContent = hintText
      }
    } else {
      hint?.remove()
    }

    return true
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument
    const container = document.createElement('span')
    container.className = 'yolo-tab-completion-display'

    const statusRail = document.createElement('span')
    statusRail.className = 'yolo-tab-completion-status'
    statusRail.setAttribute('aria-hidden', 'true')
    this.candidateStatuses.forEach((status, index) => {
      const dot = document.createElement('span')
      dot.className = `yolo-tab-completion-status__dot is-${status}`
      if (this.showSelectionIndicator && index === this.selectedIndex) {
        dot.classList.add('is-selected')
      }
      statusRail.appendChild(dot)
    })
    container.appendChild(statusRail)

    if (this.text) {
      const ghost = document.createElement('span')
      ghost.className = 'yolo-ghost-text'
      ghost.textContent = this.text
      container.appendChild(ghost)
    }

    if (this.availableCount >= 2) {
      const hint = document.createElement('span')
      hint.className = 'yolo-tab-completion-switch-hint'
      hint.textContent = `${this.switchHint} · ${this.selectedIndex + 1}/${this.availableCount}`
      container.appendChild(hint)
    }

    return container
  }
}

export const tabCompletionDisplayField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let decorations = value.map(tr.changes)

    for (const effect of tr.effects) {
      if (effect.is(tabCompletionDisplayEffect)) {
        const payload = effect.value
        if (!payload) {
          decorations = Decoration.none
          continue
        }
        const widget = Decoration.widget({
          widget: new TabCompletionDisplayWidget(
            payload.text,
            payload.candidateStatuses,
            payload.selectedIndex,
            payload.showSelectionIndicator,
            payload.availableCount,
            payload.switchHint,
          ),
          side: 1,
        }).range(payload.from)
        decorations = Decoration.set([widget])
      }
    }

    if (tr.docChanged) {
      decorations = Decoration.none
    }

    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

class InlineSuggestionGhostWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  eq(other: InlineSuggestionGhostWidget) {
    return this.text === other.text
  }

  ignoreEvent(): boolean {
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const document = view.dom.ownerDocument
    const span = document.createElement('span')
    span.className = 'yolo-ghost-text'
    span.textContent = this.text
    return span
  }
}

export const inlineSuggestionGhostField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let decorations = value.map(tr.changes)

    for (const effect of tr.effects) {
      if (effect.is(inlineSuggestionGhostEffect)) {
        const payload = effect.value
        if (!payload) {
          decorations = Decoration.none
          continue
        }
        const widget = Decoration.widget({
          widget: new InlineSuggestionGhostWidget(payload.text),
          side: 1,
        }).range(payload.from)
        decorations = Decoration.set([widget])
      }
    }

    if (tr.docChanged) {
      decorations = Decoration.none
    }

    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})
