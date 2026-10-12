import { copyFile } from 'node:fs/promises'
await copyFile('src/styles/editor/tab-completion.css', 'styles.css')
