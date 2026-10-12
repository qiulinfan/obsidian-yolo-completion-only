import { fixture } from './fixture'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { TabCompletionController } from '../src/features/editor/tab-completion/tabCompletionController'
import { loadSettings } from '../src/settings/schema/setting.types'
import { buildRequest, readCompletionStream } from '../src/completion/request'
import { cleanCompletion } from '../src/completion/fim-policy'
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
const args = () => ({
  provider,
  model,
  prefix: 'Hello ',
  suffix: ' world',
  system: 'Continue.',
  temperature: 0.1,
  signal: new AbortController().signal,
  onDelta: () => {},
})
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
test('native Mercury FIM and instant chat request contracts', () => {
  const fim = buildRequest(args())
  assert.match(fim.url, /\/v1\/fim\/completions$/)
  assert.equal(fim.body.suffix, ' world')
  assert.equal(fim.body.messages, undefined)
  assert.equal(fim.body.max_tokens, 32)
  const chat = buildRequest({
    ...args(),
    model: { ...model, model: 'mercury-2.5' },
  })
  assert.match(chat.url, /\/chat\/completions$/)
  assert.equal(chat.body.reasoning_effort, 'instant')
  assert.equal(chat.body.prompt, undefined)
  const other = buildRequest({
    ...args(),
    provider: { ...provider, baseUrl: 'http://localhost:11434/v1' },
    model: { ...model, model: 'local' },
  })
  assert.equal(other.body.reasoning_effort, undefined)
  assert.throws(
    () =>
      buildRequest({
        ...args(),
        provider: { ...provider, baseUrl: 'http://remote.example/v1' },
      }),
    /insecure-endpoint/,
  )
  assert.throws(
    () =>
      buildRequest({
        ...args(),
        provider: { ...provider, baseUrl: 'https://other.example/v1' },
      }),
    /invalid-fim-endpoint/,
  )
})
test('SSE decodes split UTF-8, CRLF, multiple data lines, and final unterminated frame', async () => {
  const data =
    ': ping\r\n\r\ndata: {"choices":[\r\ndata: {"text":"中文"}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"完成"}}]}\n\n'
  const bytes = new TextEncoder().encode(data)
  let output = ''
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
      c.close()
    },
  })
  await readCompletionStream(
    new Response(stream),
    (s) => (output += s),
    new AbortController().signal,
  )
  assert.equal(output, '中文完成')
  let last = ''
  await readCompletionStream(
    new Response('data: {"choices":[{"text":"tail"}]}'),
    (s) => (last += s),
    new AbortController().signal,
  )
  assert.equal(last, 'tail')
})
test('SSE stops at DONE and surfaces body-free errors', async () => {
  let text = ''
  await readCompletionStream(
    new Response(
      'data: {"choices":[{"text":"a"}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"text":"b"}]}\n\n',
    ),
    (s) => (text += s),
    new AbortController().signal,
  )
  assert.equal(text, 'a')
  await assert.rejects(
    readCompletionStream(
      new Response('data: {"error":{"message":"fixture-secret"}}\n\n'),
      () => {},
      new AbortController().signal,
    ),
    /^Error: provider-error$/,
  )
})
test('FIM respects suffix delimiters, environment names, and indentation', () => {
  assert.equal(
    cleanCompletion('umerate}\n', '\\begin{en', '}\n\\end{enumerate}'),
    'umerate',
  )
  assert.equal(cleanCompletion('  x + y$', 'Let $', '$ remain.'), '  x + y')
  assert.equal(
    cleanCompletion(
      'small changes in the output.',
      'prefix',
      ' in the output.',
    ),
    'small changes',
  )
  assert.equal(cleanCompletion('____', '\\begin{proof}', ''), '')
})
test('accept preserves literal math and indentation', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('data: {"choices":[{"text":"  x<y"}]}\n\ndata: [DONE]\n\n')
  try {
    const f = fixture()
    await f.controller.run(f.editor, 16)
    assert.equal(f.text(), '  x<y')
    assert.equal(f.controller.tryAcceptFromView(f.view), true)
    assert.equal(f.view.state.doc.toString(), 'Let $a < b$ and   x<y')
  } finally {
    globalThis.fetch = original
  }
})
test('moving or selecting before debounce makes no request', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response('')
  }
  try {
    const f = fixture()
    f.controller.handleEditorChange(f.editor)
    f.view.dispatch({ selection: { anchor: 0, head: 16 } })
    f.controller.handleSelectionChange(f.view)
    await pause(20)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = original
  }
})
test('changed document at same cursor cannot display or accept an old response', async () => {
  const original = globalThis.fetch
  let deliver!: (r: Response) => void
  globalThis.fetch = () =>
    new Promise((r) => {
      deliver = r
    })
  try {
    const f = fixture()
    const pending = f.controller.run(f.editor, 16)
    f.view.dispatch({ changes: { from: 0, to: 1, insert: 'X' } })
    deliver(new Response('data: {"choices":[{"text":"stale"}]}\n\n'))
    await pending
    assert.equal(f.text(), '')
    assert.equal(f.controller.tryAcceptFromView(f.view), false)
  } finally {
    globalThis.fetch = original
  }
})
test('cancel aborts a pending stream and never shows late text', async () => {
  const original = globalThis.fetch
  let signal: AbortSignal
  let deliver!: (r: Response) => void
  globalThis.fetch = async (_, init) => {
    signal = init?.signal as AbortSignal
    return new Promise((r) => {
      deliver = r
    })
  }
  try {
    const f = fixture()
    const pending = f.controller.run(f.editor, 16)
    f.controller.cancelRequest()
    f.controller.clearSuggestion()
    assert.equal(signal!.aborted, true)
    deliver(new Response('data: {"choices":[{"text":"late"}]}\n\n'))
    await pending
    assert.equal(f.text(), '')
  } finally {
    globalThis.fetch = original
  }
})
test('loading and saving autocomplete settings retains inactive upstream data', () => {
  const old = {
    providers: [provider],
    chatModels: [model],
    mcp: { servers: [{ id: 'unused' }] },
    assistants: [{ id: 'a' }],
    continuationOptions: { tabCompletionModelId: 'm', enableQuickAsk: true },
  }
  const settings = loadSettings(old)
  assert.deepEqual(settings.mcp, old.mcp)
  assert.deepEqual(settings.assistants, old.assistants)
  assert.equal(
    settings.continuationOptions.tabCompletionOptions.autoTriggerDelayMs,
    180,
  )
})

test('existing closing display-math delimiter bounds FIM output', () => {
  assert.equal(
    cleanCompletion('x+y\\] extra text', '\\[ x \\le ', '\n\\]\n'),
    'x+y',
  )
  assert.equal(cleanCompletion('x+y$$ extra text', '$$ x \\le ', '\n$$'), 'x+y')
})
test('manual completion is suppressed during IME composition', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Response('')
  }
  try {
    const f = fixture()
    f.view.composing = true
    await f.controller.run(f.editor, 16)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = original
  }
})

test('prose stays within one sentence without clipping display math', () => {
  assert.equal(cleanCompletion('说明概念。再举例。', '先', ''), '说明概念。')
  assert.equal(
    cleanCompletion('finish one thought. Start another.', 'A note should ', ''),
    'finish one thought.',
  )
  assert.equal(cleanCompletion('x. y', '$$\n', ''), 'x. y')
  assert.equal(cleanCompletion('x. y', '\\begin{align}\n', ''), 'x. y')
})
