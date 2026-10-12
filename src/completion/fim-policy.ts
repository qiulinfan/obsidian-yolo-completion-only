/** Bound inline FIM suggestions by the existing right-hand text. */
export function stopsFor(prefix: string, suffix: string): string[] {
  const result = ['\n\n']
  // A closing math/environment delimiter already on the right ends the insertion.
  const closing = /^\s*(\\\]|\\\)|\\end\{[^}\n]+\}|\$\$)/.exec(suffix)?.[1]
  if (closing) result.push(closing)
  if (/^[。！？]/.test(suffix)) result.push(suffix[0])
  if (suffix.startsWith('}') && /\\(?:begin|end)\{[^}]*$/.test(prefix))
    result.push('}')
  const denominator = /^\}\{[^}\n]+\}/.exec(suffix)?.[0]
  if (denominator) result.push(denominator)
  const dollars = prefix.match(/(?<!\\)\$/g)?.length ?? 0
  if (suffix.trimStart().startsWith('$') && dollars % 2 === 1) result.push('$')
  return [...new Set(result)]
}
export function promptFor(
  prefix: string,
  instruction: string,
  metadata = '',
  format?: string,
): string {
  const hint = instruction.replace(/\s+/g, ' ').trim()
  if (!hint && !metadata) return prefix
  const tex =
    format === 'latex' ||
    /\\(?:documentclass|begin|section|chapter|newcommand)\b/.test(prefix)
  return (
    [hint, ...metadata.split('\n')]
      .filter(Boolean)
      .map((line) => `// ${line}`)
      .join('\n') +
    '\n' +
    prefix
  )
  return (
    (tex
      ? [hint, ...metadata.split('\n')]
          .filter(Boolean)
          .map((line) => `% ${line}`)
          .join('\n') + '\n'
      : `<!-- ${[hint, metadata].filter(Boolean).join('\n').replaceAll('-->', '')} -->\n`) +
    prefix
  )
}
export function cleanCompletion(
  text: string,
  prefix: string,
  suffix: string,
  kind?: string,
): string {
  if (kind !== 'code' && kind !== 'unknown' && /(?:\\_){3,}|_{3,}/.test(text))
    return ''
  const partialEnvironment = /\\begin\{([A-Za-z*]+)$/.exec(prefix)?.[1]
  if (partialEnvironment && suffix.startsWith('}')) {
    for (const match of suffix.matchAll(/\\end\{([A-Za-z*]+)\}/g)) {
      if (match[1].startsWith(partialEnvironment))
        return match[1].slice(partialEnvironment.length)
    }
  }
  for (const stop of stopsFor(prefix, suffix)) {
    const index = text.indexOf(stop)
    if (index >= 0) text = text.slice(0, index)
  }
  for (let size = Math.min(text.length, suffix.length); size > 1; size--) {
    if (text.endsWith(suffix.slice(0, size))) {
      text = text.slice(0, -size)
      break
    }
  }
  if (isProse(prefix, kind)) {
    const end = /[。！？]|[.!?](?=\s|$)/.exec(text)
    if (end) text = text.slice(0, end.index + 1)
  }
  return text
}

function isProse(prefix: string, kind?: string) {
  const displayMath = (prefix.match(/(?<!\\)\$\$/g)?.length ?? 0) % 2 === 1
  const inlineMath =
    (prefix.match(/(?<![\\$])\$(?!\$)/g)?.length ?? 0) % 2 === 1
  const texMath =
    prefix.lastIndexOf('\\[') > prefix.lastIndexOf('\\]') ||
    prefix.lastIndexOf('\\(') > prefix.lastIndexOf('\\)')
  const mathEnvironment =
    [
      ...prefix.matchAll(
        /\\(begin|end)\{(?:equation|align|gather|multline|math|displaymath)\*?\}/g,
      ),
    ].at(-1)?.[1] === 'begin'
  const code = (prefix.match(/```/g)?.length ?? 0) % 2 === 1
  return (
    kind !== 'math' &&
    kind !== 'code' &&
    kind !== 'unknown' &&
    !displayMath &&
    !inlineMath &&
    !texMath &&
    !mathEnvironment &&
    !code
  )
}

export function isCompletionFinished(
  raw: string,
  prefix: string,
  suffix: string,
  kind?: string,
) {
  return (
    cleanCompletion(raw, prefix, suffix, kind) !== raw ||
    (isProse(prefix, kind) && /[。！？]|[.!?](?=\s|$)/.test(raw))
  )
}
