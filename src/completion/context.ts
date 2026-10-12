import type { ContextRule } from '../settings/schema/setting.types'
import type { Text } from '@codemirror/state'

export type DocumentContext = {
  format: 'markdown' | 'latex' | 'text'
  kind: 'prose' | 'heading' | 'list' | 'math' | 'code' | 'proof' | 'unknown'
  metadata: string
}
const SCAN_LIMIT = 64000
const PREAMBLE_LIMIT = 12000

function markdownVisible(text: string) {
  let fence: { char: string; length: number } | null = null
  const visible: string[] = []
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null
      visible.push('')
      continue
    }
    visible.push(fence ? '' : line)
  }
  return { text: visible.join('\n'), inCode: !!fence }
}
function texVisible(text: string) {
  return text
    .replace(
      /\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g,
      '',
    )
    .replace(/(?<!\\)%[^\n]*/g, '')
}
function braceGroup(text: string, start: number, max = 500) {
  let depth = 0
  if (text[start] !== '{') return null
  for (let i = start; i < Math.min(text.length, start + max); i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0)
      return { text: text.slice(start + 1, i), end: i + 1 }
  }
  return null
}
function macros(text: string) {
  const result = new Map<string, string>()
  const regex =
    /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))\s*(?:\[[^\]\n]*\]\s*){0,2}/g
  for (const match of text.matchAll(regex)) {
    const body = braceGroup(text, match.index! + match[0].length, 360)
    if (body)
      result.set(match[1] || match[2], text.slice(match.index, body.end))
  }
  return result
}
export function describeContext(
  doc: Text,
  cursor: number,
  filename: string,
  budget = 1400,
): DocumentContext {
  const name = filename.replace(/[\r\n]/g, ' ').slice(-200)
  const format: DocumentContext['format'] = /\.(?:tex|bib|sty|cls)$/i.test(name)
    ? 'latex'
    : /\.md$/i.test(name)
      ? 'markdown'
      : 'text'
  const before = doc.sliceString(Math.max(0, cursor - SCAN_LIMIT), cursor)
  const head = doc.sliceString(0, Math.min(cursor, PREAMBLE_LIMIT))
  const visible = format === 'latex' ? texVisible(before) : before
  const line = visible.slice(visible.lastIndexOf('\n') + 1)
  let kind: DocumentContext['kind'] =
    format === 'text' && !/\.(txt|text|rst|org)$/i.test(name)
      ? 'unknown'
      : 'prose'
  const sections: string[] = []
  let environment = ''
  let goal = ''
  let proofOpening = ''
  const definitions: string[] = []
  if (format === 'latex') {
    const hierarchy = new Map<number, string>()
    const titles = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{/g
    const source = texVisible(head) + '\n' + visible
    for (const match of source.matchAll(titles)) {
      const level = [
        'part',
        'chapter',
        'section',
        'subsection',
        'subsubsection',
      ].indexOf(match[1])
      const title = braceGroup(source, match.index! + match[0].length - 1, 260)
      if (!title) continue
      for (const key of hierarchy.keys())
        if (key >= level) hierarchy.delete(key)
      hierarchy.set(level, title.text)
    }
    sections.push(...hierarchy.values())
    const stack: { name: string; start: number }[] = []
    for (const m of visible.matchAll(/\\(begin|end)\{([A-Za-z*]+)\}/g)) {
      if (m[1] === 'begin') stack.push({ name: m[2], start: m.index! })
      else {
        const index = stack.map((x) => x.name).lastIndexOf(m[2])
        if (index >= 0) stack.splice(index)
      }
    }
    environment = stack.map((x) => x.name).join(' > ')
    const proof = [...stack].reverse().find((x) => x.name === 'proof')
    if (proof) proofOpening = visible.slice(proof.start, proof.start + 240)
    if (
      stack.some((x) =>
        /^(proof|theorem|lemma|proposition|corollary)$/.test(x.name),
      )
    )
      kind = 'proof'
    if (
      stack.some((x) =>
        /^(equation|align|gather|multline|math|displaymath)\*?$/.test(x.name),
      )
    )
      kind = 'math'
    if (
      stack.some((x) =>
        /^(verbatim|lstlisting|minted|tikzpicture|tabular|qldrawing)/.test(
          x.name,
        ),
      )
    )
      kind = 'code'
    const claims = [
      ...visible.matchAll(
        /\\begin\{(theorem|lemma|proposition|definition|corollary)\}(?:\[[^\]]*\])?/g,
      ),
    ]
    const claim = claims.at(-1)
    if (claim) {
      const start = claim.index!
      const end = visible.indexOf(`\\end{${claim[1]}}`, start)
      goal = visible.slice(
        start,
        end < 0
          ? start + 600
          : Math.min(end + claim[1].length + 6, start + 600),
      )
    }
    const local = doc.sliceString(
      Math.max(0, cursor - 4000),
      Math.min(doc.length, cursor + 800),
    )
    const items = [...macros(texVisible(head) + '\n' + visible)]
    items.sort(
      (a, b) =>
        Number(local.includes('\\' + b[0])) -
        Number(local.includes('\\' + a[0])),
    )
    for (const [, definition] of items) definitions.push(definition)
  } else {
    const hierarchy = new Map<number, string>()
    const outsideFences =
      (cursor > SCAN_LIMIT ? markdownVisible(head).text + '\n' : '') +
      markdownVisible(visible).text
    for (const m of outsideFences.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
      const level = m[1].length
      for (const key of hierarchy.keys())
        if (key >= level) hierarchy.delete(key)
      hierarchy.set(level, m[2].slice(0, 200))
    }
    sections.push(...hierarchy.values())
    if (/^\s*(?:#{1,6})\s/.test(line)) kind = 'heading'
    if (/^\s*(?:[-*+] |\d+[.)] )/.test(line)) kind = 'list'
    if (markdownVisible(before).inCode) kind = 'code'
    let inlineTicks = 0
    for (const token of line.matchAll(/`+/g)) {
      if (!inlineTicks) inlineTicks = token[0].length
      else if (inlineTicks === token[0].length) inlineTicks = 0
    }
    if (inlineTicks) kind = 'code'
  }
  if (
    kind !== 'code' &&
    ((visible.match(/(?<!\\)\$\$/g)?.length ?? 0) % 2 === 1 ||
      (visible.match(/(?<![\\$])\$(?!\$)/g)?.length ?? 0) % 2 === 1 ||
      visible.lastIndexOf('\\[') > visible.lastIndexOf('\\]') ||
      visible.lastIndexOf('\\(') > visible.lastIndexOf('\\)'))
  )
    kind = 'math'
  if (
    /\.(?:bib|sty|cls|py|[cm]?[jt]sx?|c|cc|cpp|h|rs|go|java|json|ya?ml|toml|sh|fish)$/i.test(
      name,
    )
  )
    kind = 'code'
  const lines = [
    `File: ${name || '(untitled)'}`,
    `Format: ${format}; location: ${kind}`,
  ]
  if (sections.length)
    lines.push(`Section: ${sections.join(' > ').slice(0, 240)}`)
  if (environment) lines.push(`Environment: ${environment.slice(0, 120)}`)
  let notation = ''
  for (const def of [...new Set(definitions)]) {
    if (notation.length + def.length > 450) continue
    notation += (notation ? '\n' : '') + def
    if (notation.length > 360) break
  }
  if (notation) lines.push(`Local notation:\n${notation}`)
  if (goal) lines.push(`Nearby statement (excerpt):\n${goal.slice(0, 450)}`)
  if (proofOpening) lines.push(`Proof opening (excerpt):\n${proofOpening}`)
  return {
    format,
    kind,
    metadata: lines.join('\n').slice(0, Math.max(0, budget)),
  }
}

/** Preserve the cursor-adjacent bytes; only the distant edge may move to a line boundary. */
export function cursorContext(
  doc: Text,
  cursor: number,
  beforeLimit: number,
  afterLimit: number,
) {
  let start = Math.max(0, cursor - beforeLimit),
    end = Math.min(doc.length, cursor + afterLimit)
  if (start > 0) {
    const line = doc.lineAt(start)
    if (
      line.to + 1 < cursor &&
      line.to - start < Math.min(160, beforeLimit / 4)
    )
      start = line.to + 1
  }
  if (end < doc.length) {
    const line = doc.lineAt(end)
    if (line.from > cursor && end - line.from < Math.min(160, afterLimit / 4))
      end = line.from
  }
  return {
    prefix: doc.sliceString(start, cursor),
    suffix: doc.sliceString(cursor, end),
  }
}

export function pathInstructions(path: string, rules: ContextRule[]): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  let match: ContextRule | undefined,
    length = -1
  for (const rule of rules) {
    if (
      typeof rule.path !== 'string' ||
      typeof rule.instructions !== 'string' ||
      !rule.path.trim()
    )
      continue
    const prefix = rule.path
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '')
    if (
      (!prefix ||
        normalized === prefix ||
        normalized.startsWith(prefix + '/')) &&
      prefix.length > length
    ) {
      match = rule
      length = prefix.length
    }
  }
  return match?.instructions.trim().slice(0, 1000) ?? ''
}
