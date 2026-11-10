#!/usr/bin/env node
/**
 * Builds both halves of the dsh-autoloop plugin package.
 *
 * Writes:
 *   lib/index.js   host Cordis plugin (ESM, Node, types via tsc)
 *   lib/client.js  browser bundle in the DSH loader format
 *
 * The browser bundle is wrapped the way the DSH client module system expects: a
 * classic script calling `window.__ModuleLoader__.load({ id, factory })`, with
 * React required from the shell's frozen module table instead of bundled. Every
 * other bare import would fail at materialization, so the wrapper refuses any
 * specifier outside that table.
 * @module dsh-autoloop/scripts/build
 */

import { build, context } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PKG_DIR = process.cwd()
const WATCH = process.argv.includes('--watch')

/** Modules the web shell seeds into its frozen module table. */
const SHELL_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
])

const pkg = JSON.parse(await readFile(join(PKG_DIR, 'package.json'), 'utf8'))
const ID = pkg.name

/** The bindings of one import statement. */
function localNames(statement) {
  const clause = statement
    .replace(/^import\s+/, '')
    .replace(/\s*from\s*["'][^"']+["'];?$/, '')
    .trim()
  const locals = []
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
  const before = clause.replace(/\{[^}]*\}/, '')
  for (const piece of before.split(',')) {
    const trimmed = piece.trim()
    if (trimmed === '') continue
    const namespace = /^\*\s+as\s+([\w$]+)$/.exec(trimmed)
    if (namespace !== null) locals.push({ local: namespace[1], imported: null })
    else locals.push({ local: trimmed, imported: 'default' })
  }
  for (const piece of named.split(',')) {
    const trimmed = piece.trim()
    if (trimmed === '') continue
    const [imported, alias] = trimmed.split(/\s+as\s+/)
    locals.push({ local: (alias ?? imported).trim(), imported: imported.trim() })
  }
  return locals
}

/** A collision-free variable name for one imported module object. */
function moduleVar(specifier) {
  return `__m${specifier.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/**
 * Wrap an ESM browser bundle into the loader registration format.
 * @param {string} input - bundled code whose imports are all hoisted to the top.
 * @returns {string} the classic script the module system executes.
 */
function wrapClient(input) {
  const body = input.replace(/\r\n/g, '\n')
  const modules = new Map()
  const extra = []
  const importLine = /^import\s+[^;\n]*?from\s*["'][^"']+["'];?|^import\s*["'][^"']+["'];?/
  const HEADER = '/* dsh-autoloop: hoisted imports, rewritten to require() by scripts/build.mjs */'

  const kept = []
  let offset = 0
  for (const line of body.split('\n')) {
    const isImport = line.startsWith('import ') || line.startsWith('import\t')
    const statement = isImport ? importLine.exec(line)?.[0] : undefined
    if (statement === undefined) {
      kept.push(line.endsWith('\r') ? line.slice(0, -1) : line)
      offset += line.length + 1
      continue
    }
    const specifier = /["']([^"']+)["']/.exec(statement)?.[1] ?? ''
    if (specifier !== '' && !SHELL_MODULES.has(specifier)) {
      throw new Error(
        `${ID}: the client bundle imports "${specifier}", which the DSH module table does not provide. ` +
          'Only React, React DOM, cordis and zod may stay external — anything else must be bundled.',
      )
    }
    const bindings = localNames(statement)
    const first = modules.get(specifier)
    if (first === undefined) modules.set(specifier, bindings)
    else for (const binding of bindings) extra.push({ specifier, ...binding })
    kept.push(HEADER)
    offset += line.length + 1
  }
  const truncated = collapseBlocks(kept.join('\n'), /^export\s*\{[^}]*\}\s*;?[ \t]*$/gm)

  const leftover = /^import[ \t].*$/m.exec(truncated)
  if (leftover !== null && !leftover[0].startsWith(HEADER.slice(0, 9))) {
    throw new Error(`${ID}: the client bundle still imports after the hoisted block: ${leftover[0].trim()}`)
  }
  const exported = /^export\s+(?:(?:const|let|var|function|class|async)\s|default\s)/m.exec(truncated)
  if (exported !== null) {
    throw new Error(
      `${ID}: the client bundle carries a top-level export ("${exported[0].trim()}") that a classic script cannot parse`,
    )
  }

  const declared = new Set()
  const lines = []
  for (const [specifier, bindings] of modules) {
    const target = JSON.stringify(specifier)
    const object = moduleVar(specifier)
    if (bindings.length === 0) {
      lines.push(`    require(${target});`)
      continue
    }
    lines.push(`    var ${object} = require(${target});`)
    for (const { local, imported } of bindings) {
      if (declared.has(local)) continue
      declared.add(local)
      lines.push(
        imported === null
          ? `    var ${local} = ${object};`
          : `    var ${local} = ${object}[${JSON.stringify(imported)}];`,
      )
    }
  }
  for (const { specifier, local, imported } of extra) {
    if (declared.has(local)) continue
    declared.add(local)
    const object = moduleVar(specifier)
    lines.push(
      imported === null
        ? `    var ${local} = ${object};`
        : `    var ${local} = ${object}[${JSON.stringify(imported)}];`,
    )
  }

  const rest = collapseBlocks(truncated, /^export\s*\{[^}]*\}\s*;?[ \t]*$/gm).replace(
    /^export\s+default\s+/gm,
    'module.exports.default = ',
  )

  return `/**
 * ${ID} ${pkg.version}
 * ${pkg.description ?? ''}
 * built ${new Date().toISOString()}
 * externals: ${[...modules.keys()].join(', ') || 'none'}
 */

window.__ModuleLoader__.load({
  id: ${JSON.stringify(ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${lines.join('\n')}
${rest}
    return module.exports;
  },
});
`
}

/** Remove every match of `pattern` from `text`, including matches that span lines. */
function collapseBlocks(text, pattern) {
  let previous = text
  for (let pass = 0; pass < 8; pass += 1) {
    const next = previous.replace(pattern, '')
    if (next === previous) return next
    previous = next
  }
  return previous
}

/** The package entry that re-exports the compiled host plugin. */
function hostWrapper() {
  return `// Package entry: the compiled host plugin lives in ./host/index.js.
export { apply, inject, name } from './host/index.js'
`
}

/** Write the browser bundle once esbuild hands back its text. */
async function writeClient(result) {
  const text = result.outputFiles?.[0]?.text
  if (text === undefined) return
  await mkdir(join(PKG_DIR, 'lib'), { recursive: true })
  await writeFile(join(PKG_DIR, 'lib/client.js'), wrapClient(text))
}

const CLIENT_OPTIONS = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  external: [...SHELL_MODULES],
  legalComments: 'none',
  logLevel: 'warning',
  write: false,
}

/** Build both halves once, then emit declarations. */
async function once() {
  const out = join(PKG_DIR, 'lib')
  await mkdir(out, { recursive: true })

  const hostEntry = join(PKG_DIR, 'src/host/index.ts')
  if (existsSync(hostEntry)) {
    const hostSources = (await readdir(join(PKG_DIR, 'src/host'), { recursive: true }))
      .map((p) => join(PKG_DIR, 'src/host', p.toString()))
      .filter((p) => p.endsWith('.ts'))
    await build({
      entryPoints: hostSources.length > 0 ? hostSources : [hostEntry],
      outdir: join(out, 'host'),
      bundle: false,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      sourcemap: true,
      logLevel: 'warning',
    })
  }

  const clientEntry = join(PKG_DIR, 'src/client/index.ts')
  if (existsSync(clientEntry)) {
    await writeClient(await build({ ...CLIENT_OPTIONS, entryPoints: [clientEntry] }))
  }

  if (existsSync(join(out, 'host/index.js'))) {
    await writeFile(join(out, 'index.js'), hostWrapper())
  }

  const tsconfig = join(PKG_DIR, 'tsconfig.json')
  const tsc = join(REPO, 'node_modules/.bin/tsc')
  if (existsSync(tsconfig) && existsSync(tsc)) {
    try {
      execFileSync(tsc, ['-p', tsconfig], { stdio: 'inherit', cwd: PKG_DIR })
    } catch {
      // Declaration emit is best effort: a type error must not block the artifact
      // that `typecheck` reports separately.
    }
  }

  process.stdout.write(`${ID}: built ${existsSync(join(out, 'client.js')) ? 'host + client' : 'host'}\n`)
}

if (WATCH) {
  const clientEntry = join(PKG_DIR, 'src/client/index.ts')
  const hostEntry = join(PKG_DIR, 'src/host/index.ts')
  const watcher = await context({
    ...CLIENT_OPTIONS,
    entryPoints: [clientEntry, hostEntry],
    plugins: [
      {
        name: 'dsh-autoloop-wrap',
        setup(builder) {
          builder.onEnd(async (result) => {
            if (result.errors.length > 0) return
            await writeClient(result)
            await writeFile(join(PKG_DIR, 'lib/.rebuilt'), new Date().toISOString())
            process.stdout.write(`${ID}: client rebuilt ${new Date().toLocaleTimeString()}\n`)
          })
        },
      },
    ],
  })
  await watcher.watch()
  process.stdout.write(`${ID}: watching src/host and src/client\n`)
} else {
  await once()
}
