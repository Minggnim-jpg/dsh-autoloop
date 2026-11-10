// The rule file is shared with the local web console; these lock the parts both rely on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/host/rules.ts'],
  outfile: '.tmp-harness/rules.mjs',
  bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'warning',
})
const { readRules, saveRules, disableRule, restoreRule, validateRules, revisionOf, archiveFile } = await import('../.tmp-harness/rules.mjs')
const { createHash } = await import('node:crypto')

const BASE = {
  timezone: 'Asia/Shanghai',
  sources: { local: { name: '本机' } },
  agents: { codex: { name: 'Codex', worker: 'w', use: 'codex' } },
  channels: { desktop: { name: '桌面通知' } },
  rules: [
    { name: '早报', when: { cron: '0 9 * * *' }, to: 'codex', cwd: '~/notes', prompt: '整理' },
    { name: '收 issue', when: { source: 'local', types: ['issue.opened'] }, to: 'codex', cwd: '~/w', prompt: '看' },
  ],
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-autoloop-rules-'))
  const file = join(dir, 'rules.json')
  writeFileSync(file, `${JSON.stringify(BASE, null, 2)}\n`)
  return { dir, file }
}

test('revision is the console\'s formula over rules and archive', () => {
  const { file } = fixture()
  const snapshot = readRules(file)
  const sha = (value) => createHash('sha256').update(value).digest('hex')
  // A missing archive hashes as the console's '<missing>', not as an empty string.
  const expected = createHash('sha256').update(`${sha(readFileSync(file, 'utf8'))}\n${sha('<missing>')}`).digest('hex')
  assert.equal(snapshot.revision, expected)
  assert.equal(snapshot.rules.rules.length, 2)
  assert.equal(snapshot.archived.rules.length, 0)
})

test('the archive lives at the console\'s dot-file name', () => {
  const { dir, file } = fixture()
  const first = readRules(file)
  disableRule(file, 0, first.revision)
  assert.equal(archiveFile(file), join(dir, '.agent-autoloop-ui-archive.json'))
  const archive = JSON.parse(readFileSync(archiveFile(file), 'utf8'))
  assert.equal(archive.version, 1)
  assert.equal(archive.rules.length, 1)
  assert.equal(archive.rules[0].rule.name, '早报')
})

test('a stale revision is a conflict, not an overwrite', () => {
  const { file } = fixture()
  const snapshot = readRules(file)
  const changed = { ...snapshot.rules, rules: snapshot.rules.rules.slice(0, 1) }
  saveRules(file, changed, snapshot.revision)
  assert.throws(() => saveRules(file, changed, snapshot.revision), /别处改过/)
})

test('a save keeps a timestamped backup beside the file', () => {
  const { dir, file } = fixture()
  const snapshot = readRules(file)
  saveRules(file, { ...snapshot.rules, rules: [] }, snapshot.revision)
  assert.ok(readdirSync(dir).some((name) => name.includes('.backup.')))
})

test('disabling archives the whole rule and restoring brings it back', () => {
  const { dir, file } = fixture()
  const first = readRules(file)
  const disabled = disableRule(file, 0, first.revision)
  assert.equal(disabled.archived.rule.name, '早报')
  assert.ok(existsSync(archiveFile(file)))
  const after = readRules(file)
  assert.equal(after.rules.rules.length, 1)
  assert.equal(after.archived.rules.length, 1)
  restoreRule(file, after.archived.rules[0].id, after.revision)
  const restored = readRules(file)
  assert.equal(restored.rules.rules.length, 2)
  assert.equal(restored.archived.rules.length, 0)
  assert.ok(readdirSync(dir).length > 2)
})

test('validation names the rule and field it rejects', () => {
  const bad = { ...BASE, rules: [{ name: 'x', when: { cron: '0 9 * * *' }, to: 'nobody', cwd: '~/x', prompt: 'p' }] }
  const result = validateRules(bad)
  assert.equal(result.ok, false)
  assert.match(result.issues.join('\n'), /规则「x」的 to 不是已登记的 Agent/)
})

test('an unknown field is rejected instead of silently ignored', () => {
  const result = validateRules({ ...BASE, rules: [{ name: 'y', when: { cron: '0 9 * * *' }, to: 'codex', cwd: '~/y', prompt: 'p', enable: true }] })
  assert.equal(result.ok, false)
  assert.match(result.issues.join('\n'), /不认识的字段 enable/)
})

test('the local console and this plugin agree on revisions in both directions', async () => {
  // The one promise this plugin makes about coexistence: a save from one side is
  // recognised by the other. This needs side-by-side checkouts of the two upstream
  // repositories (agent-autoloop-ui and agent-autoloop as siblings); for anyone who
  // installed this plugin alone the test simply returns without asserting.
  const consoleDir = join(dirname(new URL(import.meta.url).pathname), '../../agent-autoloop-ui')
  if (!existsSync(join(consoleDir, 'server/rules-manager.mjs'))) return
  const { createRuleManager } = await import(
    join(consoleDir, 'server/rules-manager.mjs').replace('file://', '')
  )
  const kernel = join(dirname(new URL(import.meta.url).pathname), '../../agent-autoloop/protocol/rules.ts')
  const { parseRules } = await import(kernel.replace('file://', ''))
  const { file } = fixture()
  const manager = createRuleManager({ rulesFile: file, parseRules })
  manager.initialize()

  assert.equal(manager.read().revision, readRules(file).revision)

  const first = readRules(file)
  disableRule(file, 0, first.revision)
  const seenByConsole = manager.read()
  assert.equal(seenByConsole.archived.length, 1, '网页控制台应看到插件停用的规则')

  manager.restore(seenByConsole.archived[0].id, seenByConsole.revision)
  const seenByPlugin = readRules(file)
  assert.equal(seenByPlugin.rules.rules.length, 2)
  assert.equal(manager.read().revision, seenByPlugin.revision)
})
