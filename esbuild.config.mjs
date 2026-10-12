import { build, context } from 'esbuild'
const options = {
  entryPoints: ['src/main.ts'], outfile: 'main.js', bundle: true,
  format: 'cjs', target: 'es2022', platform: 'browser', minify: true,
  external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  banner: { js: '/* YOLO Autocomplete; derived from Lapis0x0/obsidian-yolo. MIT; see LICENSE. */' },
}
if (process.argv.includes('--watch')) await (await context(options)).watch()
else await build(options)
