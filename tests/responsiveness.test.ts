import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture'
import { CompletionCache } from '../src/completion/cache'
import {
  describeContext,
  cursorContext,
  pathInstructions,
} from '../src/completion/context'
import { EditorState, EditorSelection, StateEffect } from '@codemirror/state'
import { buildRequest, readCompletionStream } from '../src/completion/request'
import { loadSettings } from '../src/settings/schema/setting.types'
const tick = () => new Promise((resolve) => setImmediate(resolve))
const response = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ text }] })}\n\ndata: [DONE]\n\n`,
  )

test('cooldown queues the latest trailing edit instead of dropping it', async () => {
  const set = globalThis.setTimeout,
    clear = globalThis.clearTimeout,
    now = Date.now
  let clock = 10000,
    id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  globalThis.setTimeout = ((fn: () => void, delay: number) => {
    timers.set(++id, { at: clock + delay, fn })
    return id
  }) as any
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any
  Date.now = () => clock
  try {
    const f = fixture()
    f.settings.continuationOptions.tabCompletionOptions.autoTriggerCooldownMs = 1000
    f.settings.continuationOptions.tabCompletionOptions.autoTriggerDelayMs = 100
    f.settings.continuationOptions.tabCompletionOptions.boundaryDelayMs = 100
    const calls: { at: number; doc: string }[] = []
    f.controller.run = async () => {
      calls.push({ at: clock, doc: f.view.state.doc.toString() })
      ;(f.controller as any).lastRequestAt = clock
    }
    const advance = (ms: number) => {
      clock += ms
      for (const [id, t] of [...timers])
        if (t.at <= clock) {
          timers.delete(id)
          t.fn()
        }
    }
    f.controller.handleEditorChange(f.editor)
    advance(100)
    assert.equal(calls.length, 1)
    advance(100)
    f.view.dispatch({
      changes: { from: 16, insert: 'x' },
      selection: { anchor: 17 },
    })
    f.controller.handleEditorChange(f.editor)
    assert.equal(timers.size, 1)
    advance(100)
    f.view.dispatch({
      changes: { from: 17, insert: 'y' },
      selection: { anchor: 18 },
    })
    f.controller.handleEditorChange(f.editor)
    assert.equal(timers.size, 1)
    advance(800)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].doc, 'Let $a < b$ and xy')
    assert.equal(timers.size, 0)
  } finally {
    globalThis.setTimeout = set
    globalThis.clearTimeout = clear
    Date.now = now
  }
})
test('completed suggestion advances on exact typing without a new request', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return response('small changes')
  }
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.view.dispatch({
      changes: { from: 16, insert: 'small ' },
      selection: { anchor: 22 },
    })
    f.controller.handleEditorChange(f.editor)
    assert.equal(f.text(), 'changes')
    assert.equal(calls, 1)
    assert.equal(f.controller.stats.reusedCharacters, 6)
    assert.equal(f.controller.tryAcceptFromView(f.view), true)
    assert.equal(f.view.state.doc.toString(), 'Let $a < b$ and small changes')
  } finally {
    globalThis.fetch = fetch
  }
})
test('typing along a live stream keeps its request and offsets later deltas', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  let writer!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  globalThis.fetch = async () => {
    calls++
    return new Response(
      new ReadableStream({
        start(c) {
          writer = c
        },
      }),
    )
  }
  try {
    const f = fixture()
    const pending = f.controller.run(f.editor, 16)
    await tick()
    writer.enqueue(
      encoder.encode('data: {"choices":[{"text":"small changes"}]}\n\n'),
    )
    await tick()
    assert.equal(f.text(), 'small changes')
    f.view.dispatch({
      changes: { from: 16, insert: 'small ' },
      selection: { anchor: 22 },
    })
    f.controller.handleEditorChange(f.editor)
    writer.enqueue(
      encoder.encode('data: {"choices":[{"text":" in values."}]}\n\n'),
    )
    await pending
    assert.equal(calls, 1)
    assert.equal(f.text(), 'changes in values.')
    assert.equal(f.controller.lastError, null)
  } finally {
    globalThis.fetch = fetch
  }
})
test('reuse never accepts changed suffix or different letter case', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () => response('Value changes')
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.view.dispatch({
      changes: { from: 16, insert: 'value' },
      selection: { anchor: 21 },
    })
    f.controller.handleEditorChange(f.editor)
    assert.equal(f.text(), '')
    assert.equal(f.controller.stats.reusedCharacters, 0)
    f.controller.stop()
  } finally {
    globalThis.fetch = fetch
  }
})
test('cache is exact, model/context sensitive, and rejection removes a cached answer', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return response('a result')
  }
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.controller.stop()
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 1)
    assert.equal(f.controller.stats.cacheHits, 1)
    f.controller.tryRejectFromView(f.view)
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 2)
    f.settings.continuationOptions.tabCompletionSystemPrompt =
      'A different instruction'
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 3)
    f.settings.chatModels[0].model = 'mercury-2.5'
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 4)
  } finally {
    globalThis.fetch = fetch
  }
})
test('cache bound, expiry, and eviction', () => {
  const now = Date.now
  let clock = 10
  Date.now = () => clock
  try {
    const c = new CompletionCache(2, 20)
    c.set('a', ['A'])
    c.set('b', ['B'])
    c.get('a')
    c.set('c', ['C'])
    assert.equal(c.get('b'), undefined)
    assert.deepEqual(c.get('a'), ['A'])
    clock = 100
    assert.equal(c.get('a'), undefined)
    assert.equal(c.size, 1)
  } finally {
    Date.now = now
  }
})
test('early consumer stop cancels the stream without consuming later output', async () => {
  let cancelled = false
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        encoder.encode(
          'data: {"choices":[{"text":"one."}]}\n\ndata: {"choices":[{"text":"unwanted"}]}\n\n',
        ),
      )
    },
    cancel() {
      cancelled = true
    },
  })
  let text = ''
  await readCompletionStream(
    new Response(stream),
    (chunk) => {
      text += chunk
      return false
    },
    new AbortController().signal,
  )
  assert.equal(text, 'one.')
  assert.equal(cancelled, true)
})
test('context carries file, section, statement and relevant nested-brace macro outside the cursor window', () => {
  const preamble =
    '\\newcommand{\\RR}{\\mathbb{R}}\n\\section{Compactness}\n\\begin{theorem}\nEvery continuous real function on a compact set is bounded.\n\\end{theorem}\n\\begin{proof}\n'
  const text =
    preamble + 'A preliminary step. '.repeat(250) + 'Let $x\\in\\RR$. Then '
  const doc = EditorState.create({ doc: text }).doc
  const c = describeContext(doc, text.length, 'notes/analysis.tex', 1600)
  assert.equal(c.kind, 'proof')
  assert.match(c.metadata, /Compactness/)
  assert.match(c.metadata, /compact set is bounded/)
  assert.match(c.metadata, /\\newcommand\{\\RR\}\{\\mathbb\{R\}\}/)
  const local = cursorContext(doc, text.length, 3200, 800)
  assert.ok(!local.prefix.includes('newcommand'))
  const built = buildRequest({
    provider: {
      id: 'p',
      baseUrl: 'https://api.inceptionlabs.ai/v1',
      apiKey: 'test',
    },
    model: {
      id: 'm',
      providerId: 'p',
      model: 'mercury-edit-2',
      name: 'FIM',
      enable: true,
    },
    ...local,
    context: c,
    system: 'Continue.',
    temperature: 0.1,
    signal: new AbortController().signal,
    onDelta: () => {},
  })
  assert.match(built.body.prompt as string, /analysis.tex/)
  assert.ok((built.body.prompt as string).endsWith(local.prefix))
  assert.equal(built.body.suffix, local.suffix)
})
test('context ignores commented TeX commands and future headings', () => {
  const text =
    '% \\section{Wrong}\n\\section{Current}\nA paragraph.\n\\section{Future}\n'
  const cursor = text.indexOf('paragraph.') + 10
  const c = describeContext(
    EditorState.create({ doc: text }).doc,
    cursor,
    'file.tex',
  )
  assert.match(c.metadata, /Current/)
  assert.doesNotMatch(c.metadata, /Wrong|Future/)
})
test('native context identifies Markdown math and code', () => {
  for (const [text, name, kind] of [
    ['# Notes\n$$\nx+y', 'a.md', 'math'],
    ['# Notes\n```python\nx = ', 'a.md', 'code'],
  ]) {
    const c = describeContext(
      EditorState.create({ doc: text }).doc,
      text.length,
      name,
    )
    assert.equal(c.kind, kind)
  }
})
test('local context remains bounded and the cursor-adjacent characters are exact', () => {
  const text =
    'a'.repeat(100000) + '\n' + 'x'.repeat(5000) + 'CURSOR' + 'y'.repeat(5000)
  const cursor = text.indexOf('CURSOR') + 6,
    doc = EditorState.create({ doc: text }).doc,
    c = cursorContext(doc, cursor, 3200, 800)
  assert.ok(c.prefix.length <= 3200 && c.suffix.length <= 800)
  assert.ok(c.prefix.endsWith('CURSOR'))
  assert.equal(c.suffix, 'y'.repeat(800))
  assert.ok(describeContext(doc, cursor, 'large.md').metadata.length <= 1400)
})
test('existing explicitly configured timing survives new defaults', () => {
  const s = loadSettings({
    continuationOptions: {
      tabCompletionOptions: {
        autoTriggerDelayMs: 300,
        autoTriggerCooldownMs: 1000,
      },
    },
  })
  assert.equal(
    s.continuationOptions.tabCompletionOptions.autoTriggerDelayMs,
    300,
  )
  assert.equal(
    s.continuationOptions.tabCompletionOptions.autoTriggerCooldownMs,
    1000,
  )
})

test('Markdown tilde fences and inline code are never clipped as prose', () => {
  for (const text of [
    '# Intro\n~~~js\n// Sentence. More',
    '# Intro\n````js\n```\nlet x = ',
    'Here is `some. code',
  ]) {
    const c = describeContext(
      EditorState.create({ doc: text }).doc,
      text.length,
      'a.md',
    )
    assert.equal(c.kind, 'code')
  }
})
test('changed suffix invalidates a live suggestion even if the prefix insertion matches', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () => response('small changes')
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.view.dispatch({
      changes: [
        { from: 16, insert: 'small ' },
        { from: 16, insert: 'other suffix' },
      ],
      selection: { anchor: 22 },
    })
    f.controller.handleEditorChange(f.editor)
    assert.equal(f.text(), '')
    assert.equal(f.controller.stats.reusedCharacters, 0)
    f.controller.stop()
  } finally {
    globalThis.fetch = fetch
  }
})

test('invalid persisted limits cannot create unbounded work or a NaN timer', () => {
  const s = loadSettings({
    continuationOptions: {
      tabCompletionOptions: {
        autoTriggerDelayMs: 'fast',
        contextRange: Infinity,
        contextBudget: 900000,
        maxSuggestionLength: -5,
        requestTimeoutMs: null,
      },
    },
  })
  const o = s.continuationOptions.tabCompletionOptions
  assert.equal(o.autoTriggerDelayMs, 180)
  assert.equal(o.contextRange, 4000)
  assert.equal(o.contextBudget, 4000)
  assert.equal(o.maxSuggestionLength, 1)
  assert.equal(o.requestTimeoutMs, 12000)
})

test('closing inline math after whitespace stops continuation', () => {
  const { body } = buildRequest({
    provider: {
      id: 'p',
      baseUrl: 'https://api.inceptionlabs.ai/v1',
      apiKey: 'test',
    },
    model: {
      id: 'm',
      providerId: 'p',
      model: 'mercury-edit-2',
      name: 'FIM',
      enable: true,
    },
    prefix: '$ abs(a+b) <= ',
    suffix: '\n$\n',
    system: 'Continue.',
    temperature: 0.1,
    signal: new AbortController().signal,
    onDelta: () => {},
  })
  assert.ok((body.stop as string[]).includes('$'))
})

test('folder instructions use the most specific whole-path match', () => {
  const rules = [
    { path: 'notes', instructions: 'general' },
    { path: 'notes/math', instructions: 'Use local math notation' },
    { path: '/', instructions: 'root' },
  ]
  assert.equal(
    pathInstructions('notes/math/proof.tex', rules),
    'Use local math notation',
  )
  assert.equal(pathInstructions('notes/mathematics/file.md', rules), 'general')
  assert.equal(pathInstructions('diary/file.md', rules), 'root')
})
test('incomplete wikilinks leave the Obsidian file picker in control', () => {
  const f = fixture('note.md')
  const text = 'Please see [[Related note'
  f.view.dispatch({
    changes: { from: 0, to: f.view.state.doc.length, insert: text },
    selection: { anchor: text.length },
  })
  f.controller.handleEditorChange(f.editor)
  assert.equal((f.controller as any).tabCompletionPending, null)
  assert.equal(f.controller.stats.requests, 0)
})

test('multiple cursors invalidate suggestions and never issue a partial-context request', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return response('small changes')
  }
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorState.allowMultipleSelections.of(true),
      ),
    })
    f.view.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.cursor(3), EditorSelection.cursor(16)],
        1,
      ),
    })
    assert.equal(f.view.state.selection.ranges.length, 2)
    f.controller.handleSelectionChange(f.view)
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 1)
    assert.equal(f.text(), '')
    assert.equal(f.controller.tryAcceptFromView(f.view), false)
  } finally {
    globalThis.fetch = fetch
  }
})
test('unknown file extensions use generic text context without prose clipping', () => {
  const text = 'Some custom format content'
  const c = describeContext(
    EditorState.create({ doc: text }).doc,
    text.length,
    'file.custom-format',
  )
  assert.equal(c.format, 'text')
  assert.equal(c.kind, 'unknown')
  assert.match(c.metadata, /file.custom-format/)
})

test('the legacy editor bridge can cancel a queued request before any network call', async () => {
  const fetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return response('unused')
  }
  try {
    const f = fixture()
    f.controller.handleEditorChange(f.editor)
    assert.ok((f.controller as any).tabCompletionSuggestion)
    f.controller.cancelRequest()
    f.controller.clearSuggestion()
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(calls, 0)
    assert.equal((f.controller as any).tabCompletionPending, null)
  } finally {
    globalThis.fetch = fetch
  }
})

test('a suggestion cannot be accepted after the editor becomes read-only', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () => response('small changes')
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    const before = f.view.state.doc.toString()
    f.view.dispatch({
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
    })
    assert.equal(f.view.state.readOnly, true)
    assert.equal(f.controller.tryAcceptFromView(f.view), false)
    assert.equal(f.view.state.doc.toString(), before)
  } finally {
    globalThis.fetch = fetch
  }
})

test('workspace events preserve a focused native editor and clear an unfocused one', async () => {
  const fetch = globalThis.fetch
  globalThis.fetch = async () => response('small changes')
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    f.view.hasFocus = true
    f.controller.handleWorkspaceChange()
    assert.equal(f.text(), 'small changes')
    f.view.hasFocus = false
    f.controller.handleWorkspaceChange()
    assert.equal(f.text(), '')
  } finally {
    globalThis.fetch = fetch
  }
})

test('an old aborted request cannot overwrite the newer request diagnostics', async () => {
  const fetch = globalThis.fetch
  const pending: {
    resolve: (r: Response) => void
    reject: (e: Error) => void
  }[] = []
  globalThis.fetch = () =>
    new Promise((resolve, reject) => pending.push({ resolve, reject }))
  try {
    const f = fixture()
    const old = f.controller.run(f.editor, 16)
    f.view.dispatch({
      changes: { from: 16, insert: 'x' },
      selection: { anchor: 17 },
    })
    const latest = f.controller.run(f.editor, 17)
    pending[0].reject(new Error('old provider error'))
    await old
    assert.equal(f.controller.lastError, null)
    pending[1].resolve(response('new suggestion'))
    await latest
    assert.equal(f.controller.lastError, null)
    assert.equal(f.text(), 'new suggestion')
  } finally {
    globalThis.fetch = fetch
  }
})
