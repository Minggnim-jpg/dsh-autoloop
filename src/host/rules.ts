/**
 * `rules.json`, read and written by the plugin.
 *
 * Editing the rule file is the one place where two clients can corrupt each
 * other: the local console (`agent-autoloop-ui`) writes this same file, keeping
 * its own revision hash and an archive of removed rules beside it. This module
 * speaks that exact layout — same revision algorithm, same archive file, same
 * backup-before-write discipline — so a save from dsh and a save from the web
 * console are indistinguishable to each other and the console's revision check
 * keeps working. Writes never happen without an expected revision matching what
 * the browser was looking at.
 * @module dsh-autoloop/src/host/rules
 */

import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArchivedRule, RuleCheck, RulesEnvelope } from '../types.js'

/** A rule-file operation that failed for a stated, user-facing reason. */
export class RulesError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'RulesError'
    this.status = status
    this.code = code
  }
}

/**
 * Where the archive of disabled rules lives.
 *
 * A dot-file beside the rules, exactly the name the local console
 * (`agent-autoloop-ui`) uses. Two archives would mean a rule disabled here is
 * invisible there, and its revision — which covers both files — could never match.
 */
export function archiveFile(rulesFile: string): string {
  return join(dirname(rulesFile), '.agent-autoloop-ui-archive.json')
}

/** The console's stand-in for a file that is not there; not the same as an empty file. */
const MISSING = '<missing>'

/**
 * The revision both clients compare against.
 *
 * Exactly the console's formula: sha256 of the rule text joined to the archive
 * text, each itself hashed first. A missing archive hashes as `<missing>`, which
 * is why an absent archive and an empty one are different revisions there —
 * copying that quirk is what lets a save from one side be recognised by the other.
 */
export function revisionOf(text: string, archiveText: string | null = null): string {
  const sha = (value: string | null) => createHash('sha256').update(value ?? MISSING).digest('hex')
  return createHash('sha256').update(`${sha(text)}\n${sha(archiveText)}`).digest('hex')
}


/** One archived rule, as both clients store it. `version: 1` is what the console writes. */
interface Archive {
  version: 1
  rules: ArchivedRule[]
}

/** Everything one rule-file view needs. */
export interface RulesSnapshot {
  text: string
  revision: string
  rules: Record<string, unknown> & { rules?: unknown[] }
  archived: Archive
}

/**
 * A checked rule change, ready to be committed.
 * @param rules - the whole parsed document after the change.
 * @param archived - the archive after the change.
 * @param issues - problems that make the change invalid; non-empty means refuse.
 */
export interface RulesChange {
  rules: Record<string, unknown>
  archived: Archive
  issues: string[]
}

/** Pure structural checks, mirroring what the kernel's rules parser rejects. */
const ID = /^[a-z][a-z0-9-]*$/
const TYPE = /^(\*|[a-z][a-z0-9_.-]{0,63}(\.\*)?)$/
const CRON = /^\S+( \S+){4}$/
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isWords = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText)
const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) > 0
const TIMEZONE_VALID = (zone: unknown): boolean => {
  if (typeof zone !== 'string' || zone === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}
const ACCESS = ['read', 'edit', 'full']
const TELLS = ['always', 'needed', 'never']

/** Each field present and the right shape, and no unknown field: a misspelt field would be silently ignored. */
function fields(
  issues: string[],
  where: string,
  value: Record<string, unknown>,
  spec: [string, (v: unknown) => boolean, string, boolean?][],
): void {
  for (const [name, check, problem, optional] of spec) {
    if (!(name in value)) {
      if (optional !== true) issues.push(`${where}缺少 ${name}`)
    } else if (!check(value[name])) issues.push(`${where}的 ${name} ${problem}`)
  }
  for (const name of Object.keys(value)) {
    if (!spec.some(([known]) => known === name)) issues.push(`${where}有不认识的字段 ${name}`)
  }
}

/**
 * Check a whole rule document the way the hub will when it reloads it.
 *
 * Not every rejection can be reproduced here (the kernel also refuses crons
 * whose next run never arrives). A document that passes this still goes through
 * the hub, and a message the hub then reports as broken is what the owner sees.
 * @returns the problems found, each naming the rule and field.
 */
export function inspectRules(doc: unknown): string[] {
  const issues: string[] = []
  if (!isObject(doc)) return ['rules.json 要是一个对象']
  fields(issues, 'rules.json ', doc, [
    ['timezone', (v) => TIMEZONE_VALID(v), '不是有效的时区', true],
    ['askFirst', isWords, '要是文字的列表', true],
    ['sources', isObject, '要是一个对象'],
    ['agents', isObject, '要是一个对象'],
    ['channels', isObject, '要是一个对象', true],
    ['rules', Array.isArray, '要是一个列表'],
    ['elsewhere', Array.isArray, '要是一个列表', true],
  ])
  if (issues.length > 0) return issues

  const sources = doc.sources as Record<string, unknown>
  const agents = doc.agents as Record<string, unknown>
  const channels = (doc.channels ?? {}) as Record<string, unknown>
  if ('schedule' in sources) issues.push('来源 schedule 是保留的，定时用规则的 cron')

  for (const [id, source] of Object.entries(sources)) {
    if (!ID.test(id)) issues.push(`来源的编号只能用小写字母、数字和 -：${id}`)
    if (!isObject(source)) {
      issues.push(`来源 ${id} 要是一个对象`)
      continue
    }
    fields(issues, `来源 ${id} `, source, [
      ['name', isText, '不能为空'],
      ['adapter', (v) => isText(v), '不能为空', true],
    ])
  }
  for (const [id, channel] of Object.entries(channels)) {
    if (!ID.test(id)) issues.push(`通道的编号只能用小写字母、数字和 -：${id}`)
    if (!isObject(channel)) {
      issues.push(`通道 ${id} 要是一个对象`)
      continue
    }
    fields(issues, `通道 ${id} `, channel, [
      ['name', isText, '不能为空'],
      ['answerers', isWords, '要是文字的列表', true],
      ['links', (v) => typeof v === 'boolean', '要是 true 或 false', true],
    ])
  }
  for (const [id, agent] of Object.entries(agents)) {
    if (!ID.test(id)) issues.push(`Agent 的编号只能用小写字母、数字和 -：${id}`)
    if (!isObject(agent)) {
      issues.push(`Agent ${id} 要是一个对象`)
      continue
    }
    fields(issues, `Agent ${id} `, agent, [
      ['name', isText, '不能为空'],
      ['worker', (v) => typeof v === 'string' && ID.test(v), '只能用小写字母、数字和 -'],
      ['use', (v) => typeof v === 'string' && ID.test(v), '只能用小写字母、数字和 -'],
      ['model', (v) => isText(v), '不能为空', true],
      ['effort', (v) => isText(v), '不能为空', true],
      ['access', (v) => typeof v === 'string' && ACCESS.includes(v), `只能是 ${ACCESS.join('、')}`, true],
      ['command', isWords, '要是命令行的列表', agent.use !== 'command'],
      ['timeout', isCount, '要是正整数（分钟）', true],
    ])
  }

  const names = new Set<string>()
  for (const rule of doc.rules as unknown[]) {
    if (!isObject(rule)) {
      issues.push('规则列表里有不是对象的一项')
      continue
    }
    const name = isText(rule.name) ? rule.name : ''
    if (names.has(name)) issues.push(`规则名「${name}」重复了`)
    names.add(name)
    const where = `规则「${name}」`
    fields(issues, where, rule, [
      ['name', isText, '不能为空'],
      ['when', isObject, '要是一个对象'],
      ['to', (v) => typeof v === 'string' && v in agents, `不是已登记的 Agent：${String(rule.to)}`],
      ['cwd', (v) => typeof v === 'string' && /^(~\/|\/)/.test(v), '要是以 ~/ 或 / 开头的目录'],
      ['skill', (v) => isText(v), '不能为空', true],
      ['prompt', (v) => isText(v), '不能为空', true],
      ['group', (v) => isText(v), '不能为空', true],
      ['parallel', isCount, '要是正整数', true],
      ['tell', (v) => typeof v === 'string' && TELLS.includes(v), `只能是 ${TELLS.join('、')}`, true],
      ['emits', isObject, '要是一个对象', true],
    ])
    if (!isObject(rule.when)) continue
    if ('source' in rule.when) {
      fields(issues, `${where}的 when `, rule.when, [
        ['source', (v) => typeof v === 'string' && v in sources, `不是已登记的来源：${String(rule.when.source)}`],
        ['types', (v) => isWords(v) && v.length > 0 && v.every((t) => TYPE.test(t)), '要是事件类型的列表，可以用 x.* 或 *'],
      ])
    } else {
      fields(issues, `${where}的 when `, rule.when, [['cron', (v) => typeof v === 'string' && CRON.test(v), '不是有效的 cron']])
    }
    const agent = typeof rule.to === 'string' ? agents[rule.to] : undefined
    if (!rule.skill && !rule.prompt && !(isObject(agent) && agent.use === 'command')) {
      issues.push(`${where}的 skill 和 prompt 至少写一个`)
    }
  }

  for (const task of (doc.elsewhere ?? []) as unknown[]) {
    if (!isObject(task)) {
      issues.push('定时任务列表里有不是对象的一项')
      continue
    }
    const name = isText(task.name) ? task.name : ''
    if (names.has(name)) issues.push(`定时任务「${name}」和别的规则或定时任务重名`)
    names.add(name)
    fields(issues, `定时任务「${name}」`, task, [
      ['name', isText, '不能为空'],
      ['source', (v) => typeof v === 'string' && v in sources, '不是已登记的来源'],
      ['to', (v) => typeof v === 'string' && v in agents, '不是已登记的 Agent'],
      ['cron', (v) => typeof v === 'string' && CRON.test(v), '不是有效的 cron'],
      ['where', isText, '不能为空'],
    ])
  }
  return issues
}

/** The archive text as it is on disk, so the revision can cover it verbatim. */
function readArchiveText(file: string): string | null {
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Read the archive; a missing or unreadable one starts empty rather than blocking edits. */
function readArchive(text: string | null): Archive {
  if (text === null) return { version: 1, rules: [] }
  try {
    const parsed = JSON.parse(text) as unknown
    if (isObject(parsed) && Array.isArray(parsed.rules)) {
      return {
        version: 1,
        rules: parsed.rules.filter(
          (entry): entry is ArchivedRule =>
            isObject(entry) && typeof entry.id === 'string' && isObject(entry.rule) && typeof entry.archivedAt === 'string',
        ),
      }
    }
  } catch {
    // Fall through: an unreadable archive must not stop the active rules from being edited.
  }
  return { version: 1, rules: [] }
}

/**
 * Read the rule file and its archive.
 * @throws RulesError 404 when the file does not exist, 500 when it is not JSON.
 */
export function readRules(rulesFile: string): RulesSnapshot {
  if (!existsSync(rulesFile)) {
    throw new RulesError(404, 'rules_missing', `找不到规则文件：${rulesFile}`)
  }
  const text = readFileSync(rulesFile, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new RulesError(500, 'rules_invalid_json', `规则文件不是 JSON：${(error as Error).message}`)
  }
  if (!isObject(parsed)) throw new RulesError(500, 'rules_invalid_json', '规则文件不是一个对象')
  const archiveText = readArchiveText(archiveFile(rulesFile))
  return {
    text,
    // The revision covers both files exactly as the console computes it, so a
    // change made on either side invalidates the other's pending edit.
    revision: revisionOf(text, archiveText),
    rules: parsed as RulesEnvelope['rules'],
    // Read verbatim: expiring entries here would make this client's revision
    // disagree with the console's, which is the one thing they must share.
    archived: readArchive(archiveText),
  }
}

/** Serialise a document exactly as both clients write it: two-space JSON, one trailing newline. */
function textOf(doc: Record<string, unknown>): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/**
 * Replace the rule file atomically, keeping one timestamped backup first.
 *
 * `rename` within the directory is atomic, so a reader (the hub's file watcher,
 * the web console) sees either the old file or the new one, never a half-written
 * document. The backup name carries a short revision prefix, the same shape the
 * console leaves behind, so its restore tooling keeps recognising them.
 */
function commit(rulesFile: string, snapshot: RulesSnapshot, change: RulesChange): { revision: string } {
  const nextText = textOf(change.rules)
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const backup = join(dirname(rulesFile), `rules.json.backup.${stamp}.${snapshot.revision.slice(0, 8)}.rules.json`)
  copyFileSync(rulesFile, backup)
  const temp = `${rulesFile}.${process.pid}.dsh-autoloop.tmp`
  writeFileSync(temp, nextText, { mode: statSync(rulesFile).mode })
  renameSync(temp, rulesFile)
  const archiveName = archiveFile(rulesFile)
  let nextArchiveText: string | null = null
  // Only touch the archive when the change actually altered it; an untouched file
  // keeps its bytes (and so the revision the console is holding stays meaningful).
  if (JSON.stringify(change.archived) === JSON.stringify(snapshot.archived)) {
    nextArchiveText = readArchiveText(archiveName)
  } else if (change.archived.rules.length > 0) {
    nextArchiveText = `${JSON.stringify(change.archived, null, 2)}\n`
    const archiveTemp = `${archiveName}.${process.pid}.dsh-autoloop.tmp`
    writeFileSync(archiveTemp, nextArchiveText, { mode: 0o600 })
    renameSync(archiveTemp, archiveName)
  } else {
    // Every entry came back: remove the file, as a missing archive is the
    // console's "nothing archived" state and its revision covers that as empty.
    rmSync(archiveName, { force: true })
  }
  // A change that emptied the archive removes the file, the way the console does.
  return { revision: revisionOf(nextText, nextArchiveText) }
}

/**
 * Refuse a change made against a document the user is no longer looking at.
 *
 * Two browser tabs, or dsh beside the web console, can each hold a stale copy.
 * Comparing revisions turns the second save into a visible conflict instead of
 * a silent overwrite of the other one's edit.
 */
function expect(snapshot: RulesSnapshot, expected: unknown): void {
  if (expected === undefined || expected === null) {
    throw new RulesError(428, 'revision_required', '保存前需要带上 expectedRevision')
  }
  if (expected !== snapshot.revision) {
    throw new RulesError(409, 'revision_conflict', '规则文件已被别处改过（可能是网页控制台），请刷新后再改')
  }
}

/** Validate a whole document without saving it. */
export function validateRules(doc: unknown): RuleCheck {
  const issues = inspectRules(doc)
  return { ok: issues.length === 0, issues }
}

/** Validate one draft rule inside a copy of the document, so cross-references are checked too. */
export function validateRule(doc: Record<string, unknown>, rule: unknown, index: number | null): RuleCheck {
  const next = structuredClone(doc) as Record<string, unknown>
  const list = Array.isArray(next.rules) ? [...(next.rules as unknown[])] : []
  if (index === null) list.push(rule)
  else if (Number.isInteger(index) && index >= 0 && index < list.length) list[index] = rule
  else return { ok: false, issues: ['找不到要改的规则'] }
  next.rules = list
  return validateRules(next)
}

/**
 * Put the whole document back.
 * @param expected - the revision the browser loaded; a mismatch is a conflict.
 */
export function saveRules(rulesFile: string, doc: unknown, expected: unknown): { revision: string } {
  const snapshot = readRules(rulesFile)
  expect(snapshot, expected)
  const issues = inspectRules(doc)
  if (issues.length > 0) throw new RulesError(422, 'invalid_rules', issues.join('\n'))
  return commit(rulesFile, snapshot, { rules: doc as Record<string, unknown>, archived: snapshot.archived, issues: [] })
}

/**
 * Remove one rule from the active file and keep it whole in the archive.
 *
 * The removed rule is not deleted anywhere: restoring it later is a plain push
 * back onto the list. A round already claimed keeps running under the rules it
 * was claimed with — the hub records that per round.
 */
export function disableRule(
  rulesFile: string,
  index: number,
  expected: unknown,
): { revision: string; archived: ArchivedRule } {
  const snapshot = readRules(rulesFile)
  expect(snapshot, expected)
  const list = Array.isArray(snapshot.rules.rules) ? [...snapshot.rules.rules] : []
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new RulesError(404, 'rule_missing', '找不到要停用的规则')
  }
  const [rule] = list.splice(index, 1)
  const entry: ArchivedRule = { id: randomUUID(), rule: rule as Record<string, unknown>, archivedAt: new Date().toISOString() }
  const nextRules = { ...snapshot.rules, rules: list }
  const archived: Archive = { version: 1, rules: [...snapshot.archived.rules, entry] }
  const result = commit(rulesFile, snapshot, { rules: nextRules, archived, issues: [] })
  return { ...result, archived: entry }
}

/** Put an archived rule back on the active list. */
export function restoreRule(rulesFile: string, id: string, expected: unknown): { revision: string } {
  const snapshot = readRules(rulesFile)
  expect(snapshot, expected)
  const index = snapshot.archived.rules.findIndex((entry) => entry.id === id)
  if (index < 0) throw new RulesError(404, 'archived_rule_missing', '找不到要恢复的规则')
  const archived = [...snapshot.archived.rules]
  const [entry] = archived.splice(index, 1)
  const nextRules = {
    ...snapshot.rules,
    rules: [...(Array.isArray(snapshot.rules.rules) ? snapshot.rules.rules : []), entry!.rule],
  }
  const issues = inspectRules(nextRules)
  if (issues.length > 0) throw new RulesError(422, 'invalid_rules', issues.join('\n'))
  return commit(rulesFile, snapshot, { rules: nextRules, archived: { version: 1, rules: archived }, issues: [] })
}
