import { build } from 'esbuild'
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const files = (await readdir('tests')).filter((f) => f.endsWith('.test.ts'))
await build({
  entryPoints: files.map((f) => 'tests/' + f),
  outdir: 'build/tests',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
})
const result = spawnSync(
  process.execPath,
  ['--test', ...files.map((f) => 'build/tests/' + f.replace(/\.ts$/, '.cjs'))],
  { stdio: 'inherit' },
)
process.exitCode = result.status ?? 1
