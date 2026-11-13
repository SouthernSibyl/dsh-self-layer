#!/usr/bin/env node
/**
 * Assert what actually ships.
 *
 * `npm pack --dry-run` prints a human table, which is fine to eyeball and
 * useless in CI: a file that silently stops shipping (a template, the client
 * bundle, the Cordis patch) still produces a green build. This script asks npm
 * for the JSON manifest instead and checks both directions — every required
 * file is present, and nothing that only makes sense in the repository (tests
 * are intentional, see REQUIRED) leaks into the tarball by accident.
 *
 * Usage: node scripts/check-pack.mjs
 */
import { spawnSync } from 'node:child_process'

const REQUIRED = [
  'package.json',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'LICENSE',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/soul-text.mjs',
  'templates/SELF.md',
  'templates/MEMORY.md',
  'templates/CHANGELOG.md',
]

const FORBIDDEN = [
  'node_modules/',
  'assets/', // screenshots and the icon live in the repo; the tarball does not need them
  'screenshots.json',
  '.tmp/',
  'tsconfig.json',
  'package-lock.json',
]

// npm is a .cmd shim on Windows, so it needs a shell there; shell: true also keeps the
// command identical on POSIX, where the shim is a symlink and works either way.
const packed = spawnSync('npm pack --dry-run --json', { encoding: 'utf8', shell: true })
if (packed.status !== 0) {
  console.error(packed.stderr || packed.stdout)
  process.exit(packed.status ?? 1)
}
const [manifest] = JSON.parse(packed.stdout)
const files = manifest.files.map((file) => file.path)
const missing = REQUIRED.filter((path) => !files.includes(path))
const leaked = FORBIDDEN.filter((prefix) => files.some((path) => path === prefix || path.startsWith(prefix)))

const kb = (manifest.size / 1024).toFixed(1)
console.log(`pack: ${files.length} files, ${kb} kB (unpacked ${(manifest.unpackedSize / 1024).toFixed(1)} kB)`)
for (const path of files) console.log(`  ${path}`)

let failed = false
if (missing.length) {
  failed = true
  console.error(`\nmissing from the tarball:\n  ${missing.join('\n  ')}`)
}
if (leaked.length) {
  failed = true
  console.error(`\nshould not ship:\n  ${leaked.join('\n  ')}`)
}
if (failed) process.exit(1)
console.log('\npack contents look right')