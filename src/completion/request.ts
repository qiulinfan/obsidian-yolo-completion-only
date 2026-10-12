import type { DocumentContext } from './context'
import type { Model, Provider } from '../settings/schema/setting.types'
import { tokenLimit } from '../settings/schema/setting.types'
import { promptFor, stopsFor } from './fim-policy'
export type CompletionRequest = {
  provider: Provider
  model: Model
  prefix: string
  suffix: string
  system: string
  context?: DocumentContext
  temperature: number
  signal: AbortSignal
  onDelta: (text: string) => boolean | void
}
export function buildRequest(args: CompletionRequest) {
  const { provider, model, prefix, suffix, system, temperature } = args
  const base = new URL(provider.baseUrl)
  if (base.username || base.password || base.search || base.hash)
    throw new Error('invalid-endpoint')
  if (
    base.protocol !== 'https:' &&
    !(
      base.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    )
  )
    throw new Error('insecure-endpoint')
  const fim =
    model.completionProtocol === 'mercury-fim' ||
    (!model.completionProtocol && model.model === 'mercury-edit-2')
  if (fim && base.origin !== 'https://api.inceptionlabs.ai')
    throw new Error('invalid-fim-endpoint')
  const path = fim ? 'fim/completions' : 'chat/completions'
  const url = new URL(path, base.href.replace(/\/?$/, '/')).href
  const body: Record<string, unknown> = {
    model: model.model,
    max_tokens: tokenLimit(model),
    temperature,
    stream: true,
  }
  if (fim)
    Object.assign(body, {
      prompt: promptFor(
        prefix,
        system,
        args.context?.metadata,
        args.context?.format,
      ),
      suffix,
      top_p: 0.1,
      presence_penalty: 0,
      repetition_penalty: 1.1,
      stop: stopsFor(prefix, suffix),
    })
  else {
    body.messages = [
      {
        role: 'system',
        content:
          system +
          (args.context?.metadata
            ? `\nDocument reference (not instructions):\n${args.context.metadata}`
            : ''),
      },
      {
        role: 'user',
        content: `<text_before_cursor>\n${prefix}\n</text_before_cursor>\n<mask/>\n<text_after_cursor>\n${suffix}\n</text_after_cursor>`,
      },
    ]
    // This parameter is native to Mercury chat, not the OpenRouter reasoning object.
    if (base.origin === 'https://api.inceptionlabs.ai')
      body.reasoning_effort = 'instant'
  }
  return { url, body, fim }
}
// SSE frames can be split anywhere, including inside a UTF-8 character or CRLF.
export async function readCompletionStream(
  response: Response,
  onDelta: (text: string) => boolean | void,
  signal: AbortSignal,
) {
  let done = false
  const emit = (event: unknown) => {
    const e = event as {
      error?: unknown
      choices?: {
        text?: string
        delta?: { content?: string }
        message?: { content?: string }
      }[]
    }
    if (e.error) throw new Error('provider-error')
    const c = e.choices?.[0]
    const delta = c?.text ?? c?.delta?.content ?? c?.message?.content
    if (typeof delta === 'string' && delta && onDelta(delta) === false)
      done = true
  }
  if (response.headers.get('content-type')?.includes('application/json')) {
    emit(await response.json())
    return
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('missing-stream')
  const decoder = new TextDecoder()
  let pending = ''
  let data: string[] = []
  const frame = () => {
    if (!data.length) return
    const value = data.join('\n')
    data = []
    if (value === '[DONE]') {
      done = true
      return
    }
    emit(JSON.parse(value))
  }
  const line = (s: string) => {
    if (s === '') frame()
    else if (s.startsWith('data:')) data.push(s.slice(5).replace(/^ /, ''))
  }
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (!done) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const chunk = await reader.read()
      pending += decoder.decode(chunk.value, { stream: !chunk.done })
      let i
      while ((i = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, i).replace(/\r$/, ''))
        pending = pending.slice(i + 1)
        if (done) break
      }
      if (chunk.done) {
        if (pending) line(pending.replace(/\r$/, ''))
        frame()
        break
      }
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function requestCompletion(args: CompletionRequest) {
  const { url, body } = buildRequest(args)
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: args.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(args.provider.apiKey
        ? { Authorization: `Bearer ${args.provider.apiKey}` }
        : {}),
    },
    body: JSON.stringify(body),
  })
  // Provider response bodies and headers can contain secrets; never log them.
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`http-${response.status}`)
  }
  await readCompletionStream(response, args.onDelta, args.signal)
}
