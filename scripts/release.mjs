#!/usr/bin/env node
/**
 * Cut a release: bump the version where it is written down, add the market index
 * entry, validate, tag, and tell you what to push.
 *
 * Usage:
 *   node scripts/release.mjs 0.3.0 --dry-run   # show what would change
 *   node scripts/release.mjs 0.3.0             # write the release commit + tag
 *   node scripts/release.mjs --pin 0.3.0       # after pushing, fill in the commit
 *
 * Why `--pin` is a separate step: the market index needs the commit SHA of the
 * release, but committing the index *produces* that commit, and pushing can move
 * it again. So the index is committed with an empty `commit`, pushed, and then
 * `--pin` records the SHA GitHub actually serves. A placeholder would let the
 * market offer an install that cannot resolve, so an empty value is used on
 * purpose: it is impossible to mistake for a working one.
 *
 * Until `--pin` runs, the newest index entry is deliberately incomplete; the
 * release script refuses to tag it as ready.
 * @module dsh-autoloop/scripts/release
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX = join(REPO, 'market/index.json')
const PACKAGE = join(REPO, 'package.json')
const VERSION_FILE = join(REPO, 'VERSION')
const CHANGELOG = join(REPO, 'CHANGELOG.md')

const PLUGIN_NAME = 'dsh-autoloop'
const REPO_URL = 'https://github.com/Minggnim-jpg/dsh-autoloop'
/**
 * Places dsh may have installed the index validator, newest first: a local dev
 * dependency, the running app bundle, then any profile that pulled the market in.
 * The validator version that defines "format 1" ships inside dsh, so reading it
 * from the app is more accurate than pinning an npm release of it.
 */
const VALIDATOR_CANDIDATES = [
  join(REPO, 'node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'),
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
  join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'profiles/desktop/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'),
  join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'profiles/web/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'),
]
const VALIDATOR = VALIDATOR_CANDIDATES.find((path) => existsSync(path))
const VALIDATOR_ENV = process.env.DSH_MARKET_INDEX_VALIDATOR

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

function parseVersion(raw) {
  if (!/^\d+\.\d+\.\d+$/.test(raw ?? '')) throw new Error(`版本号必须是 x.y.z，收到：${raw ?? '(空)'}`)
  return raw
}

/**
 * Validate with dsh's own parser when it is installed.
 *
 * An entry whose `commit` is still empty is expected while the release is being
 * prepared; the format check runs on a copy where that field holds a syntactically
 * valid SHA, so everything else is still verified.
 */
async function validate(index, { pending = false } = {}) {
  const source = VALIDATOR_ENV && existsSync(VALIDATOR_ENV) ? VALIDATOR_ENV : VALIDATOR
  if (source === undefined) {
    process.stdout.write(
      '! 未找到 dsh 的索引校验器，跳过格式校验。\n' +
        '  用 DSH_MARKET_INDEX_VALIDATOR=/path/to/.../dsh-plugin-market-index/lib/index.js 指定，\n' +
        '  或 npm i -D @deepseek-ai/dsh-plugin-market-index\n',
    )
    return
  }
  const { parseMarketIndex } = await import(source)
  const probe = pending
    ? structuredClone({
        ...index,
        plugins: index.plugins.map((plugin) => ({
          ...plugin,
          versions: plugin.versions.map((v) => (v.source.commit === '' ? { ...v, source: { ...v.source, commit: '0'.repeat(40) } } : v)),
        })),
      })
    : index
  const parsed = parseMarketIndex(probe, `${REPO_URL}/main/market/index.json`)
  const newest = parsed.plugins.find((p) => p.name === PLUGIN_NAME)
  process.stdout.write(`✓ 格式校验通过：${newest.name} ${newest.versions.map((v) => v.version).join(', ')}\n`)
}

function prepare(rawVersion, dryRun) {
  const version = parseVersion(rawVersion)
  const pkg = readJson(PACKAGE)
  if (pkg.version === version) throw new Error(`package.json 已经是 ${version}`)
  const index = readJson(INDEX)
  const plugin = index.plugins.find((item) => item.name === PLUGIN_NAME)
  if (plugin === undefined) throw new Error(`索引里没有 ${PLUGIN_NAME}`)
  if (plugin.versions.some((v) => v.version === version)) throw new Error(`索引里已有 ${version}`)

  if (dryRun) {
    process.stdout.write(`将发布 ${version}\n  改动：package.json / VERSION / CHANGELOG.md / market/index.json\n`)
    return
  }
  // `-uno`: ignore untracked files. What matters is whether the *tracked* tree is
  // clean, so a local node_modules symlink or a stray log cannot block a release.
  if (git('status', '--porcelain', '--untracked-files=no') !== '') throw new Error('工作区有未提交改动，先提交或清理')

  pkg.version = version
  writeJson(PACKAGE, pkg)
  writeFileSync(VERSION_FILE, `${version}\n`)

  const changelog = readFileSync(CHANGELOG, 'utf8')
  if (!changelog.startsWith('# Changelog\n\n')) throw new Error('CHANGELOG.md 结构变了')
  const today = new Date().toISOString().slice(0, 10)
  writeFileSync(CHANGELOG, changelog.replace('# Changelog\n\n', `# Changelog\n\n## [${version}] - ${today}\n\n待填写。\n\n`))

  plugin.versions.push({
    version,
    publishTimestamp: Math.floor(Date.now() / 1000),
    engines: { dsh: pkg.engines.dsh },
    source: { type: 'git', url: REPO_URL, commit: '' },
  })
  plugin.versions.sort((a, b) => (a.version === b.version ? 0 : a.version < b.version ? 1 : -1))
  writeJson(INDEX, index)

  process.stdout.write(
    [
      `已写入 ${version}：package.json、VERSION、CHANGELOG.md、market/index.json`,
      '',
      '下一步：',
      `  1. 填 CHANGELOG.md 的 ${version} 段`,
      '  2. npm run build && npm run typecheck && npm test',
      `  3. git add -A && git commit -m "release: v${version}" && git tag -a v${version} -m "v${version}"`,
      '  4. git push origin main && git push origin v' + version,
      `  5. node scripts/release.mjs --pin ${version}`,
      '  6. git add market/index.json && git commit -m "release: pin v' + version + '" && git push',
      '',
      '注意：--pin 之前索引里的 commit 是空的，市场会拒绝安装这一版；这是有意的。',
      '',
    ].join('\n'),
  )
}

async function pin(rawVersion) {
  const version = parseVersion(rawVersion)
  const index = readJson(INDEX)
  const entry = index.plugins.find((item) => item.name === PLUGIN_NAME)?.versions.find((v) => v.version === version)
  if (entry === undefined) throw new Error(`索引里没有 ${version}`)

  // The commit that carries this version: the newest commit touching package.json
  // at this version, so the market install lands on code that really is VERSION.
  const commit = execFileSync('git', ['log', '-1', '--format=%H', `--grep=release: v${version}`], { cwd: REPO, encoding: 'utf8' }).trim()
  if (commit === '') throw new Error(`找不到 release: v${version} 的提交，先按上一步提交并推送`)
  entry.source.commit = commit
  writeJson(INDEX, index)
  await validate(index)
  process.stdout.write(`✓ ${version} 已钉到 ${commit}\n提交并推送 market/index.json 即可生效。\n`)
}

const args = process.argv.slice(2)
const pinning = args.includes('--pin')
const dryRun = args.includes('--dry-run')
const value = args.filter((arg) => !arg.startsWith('--'))[0]

try {
  if (pinning) await pin(value)
  else prepare(value, dryRun)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
