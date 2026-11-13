/**
 * dsh-self-layer · 宿主半
 *
 * 职责：读写 `<数据目录>/SELF.md`、`MEMORY.md` 与审计流水 `CHANGELOG.md`，
 * 维护 `~/.dsh/AGENTS.md` 里的常驻指针块，并把系统「在文件管理器中定位」
 * 暴露给设置页。数据目录、备份保留数、指针开关由 Config 注入。
 *
 * 设计约束（对应审查结论）：
 * - 不静默截断：超限、重名、非法标题一律 422，带 code 与 details；
 * - 版本号用内容哈希，不用 mtime+size（同毫秒同长度会撞）；
 * - 写入原子且 crash-safe：tmp + fsync + rename + 目录 fsync（best effort）；
 * - 读、校验、写在同一段同步代码里，进程内不存在可插队的 await 窗口；
 * - 覆盖别人的修改必须显式 force，普通保存一律 409；
 * - AGENTS.md 先探测编码（UTF-8 / BOM），非 UTF-8 拒绝改写，回写保持原编码；
 * - 备份与数据文件同策略：目录集中、按 backupKeep 清理、可从界面恢复。
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRESETS,
  composeSoulFile,
  memoryEntries,
  memoryStats,
  parseSoulFile,
  readFields,
  validateSections,
} from './soul-text.mjs'

/** 单个数据文件的上限（读与写同一个值，避免「能读不能存」）。 */
export const MAX_FILE_BYTES = 256 * 1024
/** 请求体上限：JSON 转义后约为文件上限的数倍。 */
export const MAX_BODY_BYTES = 1024 * 1024
/** AGENTS.md 上限：全局规则文件，只允许小体量重写。 */
export const MAX_AGENTS_BYTES = 2 * 1024 * 1024
/** 审计流水超过这个大小就滚动保留尾部。 */
const MAX_CHANGELOG_BYTES = 512 * 1024
/** 备份默认保留份数。 */
export const DEFAULT_BACKUP_KEEP = 30

export const FILES = { SELF: 'SELF.md', MEMORY: 'MEMORY.md', CHANGELOG: 'CHANGELOG.md' }

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url))
const PACKAGE = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

/** 带 HTTP 状态与机器可读 code 的错误；路由统一映射成 {ok:false,error,code}。 */
export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = options.code || defaultCode(status)
    this.details = options.details
  }
}

function defaultCode(status) {
  if (status === 400) return 'bad_request'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 405) return 'method_not_allowed'
  if (status === 409) return 'conflict'
  if (status === 413) return 'too_large'
  if (status === 415) return 'unsupported_media_type'
  if (status === 422) return 'invalid_payload'
  return 'internal_error'
}

// ── 配置 ────────────────────────────────────────────────────────────────────

/** 运行期配置快照。apply() 时写入；单测可直接 configure()。 */
let runtime = { dataDir: '', backupKeep: DEFAULT_BACKUP_KEEP, pointer: true }

/** 把任意输入收敛成合法配置（不抛错：坏配置退回默认值）。 */
export function normalizeConfig(value) {
  const input = value !== null && typeof value === 'object' ? value : {}
  const keep = Number(input.backupKeep)
  return {
    dataDir: typeof input.dataDir === 'string' ? input.dataDir.trim() : '',
    backupKeep: Number.isFinite(keep) ? Math.min(365, Math.max(1, Math.round(keep))) : DEFAULT_BACKUP_KEEP,
    pointer: input.pointer !== false && input.pointer !== 'false',
  }
}

/** 应用一份配置并返回快照（宿主 apply 与单测共用）。 */
export function configure(value) {
  runtime = normalizeConfig(value)
  return { ...runtime }
}

/** 当前配置的只读快照。 */
export function configSnapshot() {
  return { ...runtime }
}

// ── 路径 ────────────────────────────────────────────────────────────────────

/** 展开 `~`；其余路径交给 path.resolve（相对路径按宿主 cwd 解析并固定下来）。 */
function expandHome(input) {
  const text = String(input)
  if (text === '~') return os.homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(2))
  return text
}

function resolveDir(input) {
  return path.resolve(expandHome(input))
}

/** 数据目录：Config > `SOUL_HOME` > `~/.agent-self`。 */
export function dataDir() {
  if (runtime.dataDir !== '') return resolveDir(runtime.dataDir)
  const env = String(process.env.SOUL_HOME || '').trim()
  if (env !== '') return resolveDir(env)
  return path.join(os.homedir(), '.agent-self')
}

/** DSH 主目录：`DSH_HOME` > `~/.dsh`。 */
export function dshHome() {
  const env = String(process.env.DSH_HOME || '').trim()
  return env !== '' ? resolveDir(env) : path.join(os.homedir(), '.dsh')
}

/** 数据文件备份目录。 */
export function backupDir() {
  return path.join(dataDir(), '.backups')
}

/** AGENTS.md 备份目录（与数据文件分开，但同样受 backupKeep 约束）。 */
export function agentsBackupDir() {
  return path.join(dshHome(), '.self-layer-backups')
}

/** 旧版默认目录：仅用于「配置改了但没迁移」的提示。 */
export function legacyDataDir() {
  return path.join(os.homedir(), '.agent-self')
}

function ensureDirs() {
  for (const dir of [dataDir(), backupDir()]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

// ── 基础工具 ────────────────────────────────────────────────────────────────

/** 文件名安全的时间戳：可按字典序排序，同毫秒加随机后缀。 */
function stamp() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`
}

/** 内容哈希：版本号只由字节决定，和 mtime 粒度无关。 */
export function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16)
}

/** 版本号；文件不存在时为 'absent'。 */
export function revOf(meta) {
  return meta !== null && typeof meta === 'object' && meta.exists ? meta.rev : 'absent'
}

function syncDirBestEffort(dir) {
  try {
    const fd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch (error) {
    /* Windows 与部分文件系统不支持目录 fsync：尽力而为，不阻断写入 */
  }
}

/** 原子写：tmp（wx + 0600）→ fsync → rename → 目录 fsync。失败清理 tmp。 */
function atomicWrite(abs, buffer, mode = 0o600) {
  const dir = path.dirname(abs)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
  let fd
  try {
    fd = fs.openSync(tmp, 'wx', mode)
    fs.writeSync(fd, buffer)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    try {
      fs.chmodSync(tmp, mode)
    } catch (error) {
      /* Windows 上 chmod 基本无效；不为它报错，文档里写清威胁模型 */
    }
    fs.renameSync(tmp, abs)
    syncDirBestEffort(dir)
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch (closeError) {
        /* ignore */
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch (unlinkError) {
      /* ignore */
    }
    throw error
  }
}

// ── 备份 ────────────────────────────────────────────────────────────────────

function safeBackupName(name, prefix) {
  return typeof name === 'string' && name.startsWith(`${prefix}.`) && !/[/\\]/.test(name) && !name.includes('..')
}

/** 某目录下以某前缀开头的备份（新的在前），带大小与时间。 */
function listBackupsIn(dir, prefix, limit = DEFAULT_BACKUP_KEEP) {
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    return []
  }
  return names
    .filter((name) => name.startsWith(`${prefix}.`) && !name.endsWith('.tmp'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      let bytes = 0
      let at = null
      try {
        const stat = fs.statSync(path.join(dir, name))
        bytes = stat.size
        at = stat.mtimeMs
      } catch (error) {
        /* 列目录后被删：保留条目，界面显示 0 */
      }
      return { name, bytes, at }
    })
}

/** SELF / MEMORY 的备份清单。 */
export function listBackups(key) {
  if (key !== 'SELF' && key !== 'MEMORY') return []
  return listBackupsIn(backupDir(), FILES[key], runtime.backupKeep)
}

/** AGENTS.md 的备份清单。 */
export function listAgentsBackups() {
  return listBackupsIn(agentsBackupDir(), 'AGENTS.md', runtime.backupKeep)
}

function pruneIn(dir, prefix) {
  const keep = runtime.backupKeep
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (error) {
    return
  }
  const sorted = names.filter((name) => name.startsWith(`${prefix}.`)).sort().reverse()
  for (const name of sorted.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, name))
    } catch (error) {
      /* ignore */
    }
  }
}

function backupCurrent(key) {
  const abs = path.join(dataDir(), FILES[key])
  if (!fs.existsSync(abs)) return null
  ensureDirs()
  const name = `${FILES[key]}.${stamp()}`
  fs.copyFileSync(abs, path.join(backupDir(), name))
  pruneIn(backupDir(), FILES[key])
  return name
}

function backupAgents(abs) {
  fs.mkdirSync(agentsBackupDir(), { recursive: true, mode: 0o700 })
  const name = `AGENTS.md.${stamp()}`
  fs.copyFileSync(abs, path.join(agentsBackupDir(), name))
  pruneIn(agentsBackupDir(), 'AGENTS.md')
  return name
}

// ── 模板播种 ────────────────────────────────────────────────────────────────

function templateFor(key) {
  const file = FILES[key]
  if (file === undefined) return null
  try {
    return fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8')
  } catch (error) {
    return null
  }
}

/** 首次使用时按包内模板补文件；已存在的一律不动（返回本次补了哪些）。 */
export function seedIfMissing() {
  ensureDirs()
  const seeded = []
  for (const key of ['SELF', 'MEMORY', 'CHANGELOG']) {
    const abs = path.join(dataDir(), FILES[key])
    if (fs.existsSync(abs)) continue
    const body = templateFor(key)
    if (body === null) continue
    try {
      atomicWrite(abs, Buffer.from(body, 'utf8'))
      seeded.push(key)
    } catch (error) {
      /* 播种失败不该让整个页面读不出来：下次保存时会再补 */
    }
  }
  return seeded
}

// ── 数据文件读写 ────────────────────────────────────────────────────────────

/**
 * 读一个数据文件。返回的 text 只在文件可编辑时给（超限时为空，避免界面
 * 显示一份存不回去的正文）。error 为 errno code，界面按 code 本地化。
 */
export function readSoulFile(key) {
  const file = FILES[key]
  const abs = path.join(dataDir(), file)
  const meta = {
    key,
    file,
    path: abs,
    exists: false,
    bytes: 0,
    mtime: null,
    text: '',
    rev: 'absent',
    tooLarge: false,
    error: null,
  }
  let stat
  try {
    stat = fs.statSync(abs)
  } catch (error) {
    if (error.code !== 'ENOENT') meta.error = error.code || 'read_failed'
    return meta
  }
  if (!stat.isFile()) {
    meta.error = 'not_a_file'
    return meta
  }
  meta.exists = true
  meta.bytes = stat.size
  meta.mtime = stat.mtimeMs
  if (stat.size > MAX_FILE_BYTES) {
    meta.tooLarge = true
    return meta
  }
  try {
    const buffer = fs.readFileSync(abs)
    meta.rev = hashOf(buffer)
    meta.text = stripBom(buffer.toString('utf8'))
    return meta
  } catch (error) {
    meta.error = error.code || 'read_failed'
    return meta
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 原子写一个数据文件，返回 {bytes, rev, backup}。写前自动备份旧版本。 */
export function writeSoulFile(key, text) {
  const file = FILES[key]
  if (file === undefined) throw new HttpError(400, 'unknown file key', { code: 'unknown_file' })
  const abs = path.join(dataDir(), file)
  const buffer = Buffer.from(text, 'utf8')
  const backup = backupCurrent(key)
  atomicWrite(abs, buffer)
  return { bytes: buffer.length, rev: hashOf(buffer), backup }
}

/** 审计流水尾部若干行（界面只显示最近几条，不塞整份文件）。 */
export function changelogTail(limit = 5) {
  const abs = path.join(dataDir(), FILES.CHANGELOG)
  try {
    const stat = fs.statSync(abs)
    const length = Math.min(stat.size, 8192)
    const fd = fs.openSync(abs, 'r')
    const buffer = Buffer.alloc(length)
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length)
    } finally {
      fs.closeSync(fd)
    }
    return buffer
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .slice(-limit)
  } catch (error) {
    return []
  }
}

/** 保存成功后留一行审计痕迹；写失败只忽略，不影响本次保存。 */
function appendChangelog(key, text, note) {
  try {
    ensureDirs()
    const abs = path.join(dataDir(), FILES.CHANGELOG)
    const stampText = new Date().toLocaleString('sv-SE', { hour12: false })
    const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)
    // 模板或外部编辑可能不以换行结尾；不加这个判断，新记录会拼到上一行末尾。
    let lead = ''
    try {
      const size = fs.statSync(abs).size
      if (size > 0) {
        const fd = fs.openSync(abs, 'r')
        const last = Buffer.alloc(1)
        try {
          fs.readSync(fd, last, 0, 1, size - 1)
        } finally {
          fs.closeSync(fd)
        }
        if (last[0] !== 0x0a) lead = '\n'
      }
    } catch {
      lead = ''
    }
    fs.appendFileSync(abs, `${lead}- ${stampText} · ${note || '设置页保存'} ${FILES[key]} · ${kb} KB\n`, 'utf8')
    const size = fs.statSync(abs).size
    if (size > MAX_CHANGELOG_BYTES) {
      const lines = fs
        .readFileSync(abs, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('- '))
        .slice(-200)
      atomicWrite(
        abs,
        Buffer.from(
          `# CHANGELOG · 自我层改动流水\n\n> 只保留最近 200 行。更早的记录已滚动丢弃。\n\n${lines.join('\n')}\n`,
          'utf8',
        ),
      )
    }
  } catch (error) {
    /* 审计失败不阻断保存 */
  }
}

// ── AGENTS.md 常驻指针 ──────────────────────────────────────────────────────

const SOUL_BEGIN = '<!-- SOUL:BEGIN'
const SOUL_END = '<!-- SOUL:END -->'

/** 指针块文本：路径跟随当前数据目录，不再写死 `~/.agent-self`。 */
export function pointerBlockFor(dir) {
  const selfPath = path.join(dir, FILES.SELF)
  return [
    '<!-- SOUL:BEGIN 自我层 · 手改请保留标记 -->',
    '## 自我层（先读再开口）',
    `- 开口或动手前先读 \`${selfPath}\` 与同目录 \`MEMORY.md\`（各 ≤2 KB），以 SELF.md 为准。`,
    '- 优先级：系统与用户当场指令 > SOUL > 其它技能与默认习惯；冲突时按优先级执行，并用一句话说明改了什么。',
    SOUL_END,
  ].join('\n')
}

/** 当前数据目录下的指针块。 */
export function pointerBlock() {
  return pointerBlockFor(dataDir())
}

function agentsPath() {
  return path.join(dshHome(), 'AGENTS.md')
}

/**
 * 解码 AGENTS.md：优先 BOM，其次严格 UTF-8。解不开就抛 422，
 * 绝不用宽松解码把别人的文件写成 U+FFFD。
 */
function decodeAgents(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf16le' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf16be' }
  }
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const body = bom ? buffer.subarray(3) : buffer
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: bom ? 'utf8bom' : 'utf8' }
  } catch (error) {
    throw new HttpError(422, 'AGENTS.md is not valid UTF-8; refusing to rewrite it', {
      code: 'agents_encoding',
      details: { path: agentsPath() },
    })
  }
}

function encodeAgents(text, encoding) {
  if (encoding === 'utf16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  }
  if (encoding === 'utf16be') {
    const body = Buffer.from(text, 'utf16le')
    body.swap16()
    return Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  }
  const body = Buffer.from(text, 'utf8')
  return encoding === 'utf8bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

/** 读 AGENTS.md；不存在返回 exists:false，不抛错。 */
function readAgents() {
  const abs = agentsPath()
  try {
    const buffer = fs.readFileSync(abs)
    const decoded = decodeAgents(buffer)
    return { abs, exists: true, buffer, ...decoded }
  } catch (error) {
    if (error instanceof HttpError) {
      return { abs, exists: true, buffer: null, text: '', encoding: null, undecodable: true }
    }
    if (error.code === 'ENOENT') return { abs, exists: false, buffer: null, text: '', encoding: 'utf8' }
    throw new HttpError(500, `cannot read ${abs}: ${error.code || error}`, { code: 'agents_read_failed' })
  }
}

/** 指针状态：是否存在、是否完整、是否指向当前数据目录。 */
export function pointerStatus() {
  const abs = agentsPath()
  const base = {
    path: abs,
    dir: dataDir(),
    exists: false,
    present: false,
    complete: false,
    stale: false,
    bytes: 0,
    encoding: 'utf8',
    tooLarge: false,
    undecodable: false,
    enabled: runtime.pointer,
    backups: listAgentsBackups(),
  }
  let agents
  try {
    agents = readAgents()
  } catch (error) {
    return { ...base, present: false, stale: true, error: error.code || 'agents_read_failed' }
  }
  if (!agents.exists) return base
  const bytes = agents.buffer === null ? 0 : agents.buffer.length
  if (agents.undecodable) return { ...base, exists: true, bytes, undecodable: true, stale: true }
  if (bytes > MAX_AGENTS_BYTES) return { ...base, exists: true, bytes, tooLarge: true, stale: true }
  const text = agents.text
  const present = text.includes(SOUL_BEGIN)
  const complete = present && text.includes(SOUL_END)
  // 只按「是否指向当前数据目录」判过期：块内用户自己加的话不算过期，
  // 否则每次刷新都会把块内手改抹掉。
  const pointsHere = present && text.includes(path.join(dataDir(), FILES.SELF))
  return {
    ...base,
    exists: true,
    present,
    complete,
    stale: present ? !complete || !pointsHere : false,
    bytes,
    encoding: agents.encoding,
  }
}

/** AGENTS.md 当前版本号（内容哈希），供恢复前校验。 */
export function agentsRev() {
  try {
    return hashOf(fs.readFileSync(agentsPath()))
  } catch (error) {
    return 'absent'
  }
}

/**
 * 写入/刷新常驻指针：
 * - 没有块 → 追加；
 * - 有一个或多个完整块 → 全部替换成一份（旧的重复块一并清掉）；
 * - 只有 BEGIN 没有 END → 视为块延伸到文件末尾，整段替换；
 * - 只有 END 没有 BEGIN → 拒绝（无法确定块从哪里开始，不能瞎猜）。
 * 写前备份到 `<dshHome>/.self-layer-backups/`，保留编码与原文件风格。
 */
export function applyPointer() {
  if (!runtime.pointer) {
    throw new HttpError(403, 'pointer management is disabled by config', { code: 'pointer_disabled' })
  }
  const agents = readAgents()
  if (agents.undecodable) {
    throw new HttpError(422, 'AGENTS.md is not valid UTF-8; refusing to rewrite it', { code: 'agents_encoding' })
  }
  if (agents.exists && agents.buffer !== null && agents.buffer.length > MAX_AGENTS_BYTES) {
    throw new HttpError(413, `AGENTS.md too large to rewrite (limit ${MAX_AGENTS_BYTES} bytes)`, {
      code: 'agents_too_large',
      details: { bytes: agents.buffer.length, limit: MAX_AGENTS_BYTES },
    })
  }
  const block = pointerBlock()
  const current = agents.text
  const endsWithoutStart = !current.includes(SOUL_BEGIN) && current.includes(SOUL_END)
  if (endsWithoutStart) {
    throw new HttpError(422, 'AGENTS.md has SOUL:END without SOUL:BEGIN; fix the file by hand first', {
      code: 'agents_orphan_end',
    })
  }
  let next
  if (current.includes(SOUL_BEGIN)) {
    let first = true
    next = current.replace(/<!-- SOUL:BEGIN[\s\S]*?(?:<!-- SOUL:END -->|$)/g, () => {
      if (first) {
        first = false
        return block
      }
      return ''
    })
    next = next.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  } else {
    const trimmed = current.replace(/\s+$/, '')
    next = `${trimmed}${trimmed === '' ? '' : '\n\n'}${block}`
  }
  if (next === current) {
    return { ok: true, path: agents.abs, changed: false, present: true, encoding: agents.encoding }
  }
  const backup = agents.exists ? backupAgents(agents.abs) : null
  atomicWrite(agents.abs, encodeAgents(next, agents.encoding || 'utf8'))
  return {
    ok: true,
    path: agents.abs,
    changed: true,
    present: true,
    encoding: agents.encoding || 'utf8',
    bytes: fs.statSync(agents.abs).size,
    backup,
  }
}

// ── 恢复 ────────────────────────────────────────────────────────────────────

/**
 * 从备份恢复。SELF/MEMORY 走数据文件写入（会再备份当前版本）；
 * AGENTS 走指针文件写入（保持编码）。expectRev 给了就校验，防止顶掉别处的修改。
 */
export function restoreBackup(key, name, expectRev) {
  if (key === 'SELF' || key === 'MEMORY') {
    if (!safeBackupName(name, FILES[key])) {
      throw new HttpError(400, 'invalid backup name', { code: 'invalid_backup_name' })
    }
    const abs = path.join(backupDir(), name)
    if (!fs.existsSync(abs)) throw new HttpError(404, 'backup not found', { code: 'backup_not_found' })
    const buffer = fs.readFileSync(abs)
    if (buffer.length > MAX_FILE_BYTES) {
      throw new HttpError(413, 'backup too large to restore', { code: 'backup_too_large' })
    }
    if (typeof expectRev === 'string' && expectRev !== revOf(readSoulFile(key))) {
      throw new HttpError(409, `${FILES[key]} changed since it was read`, {
        code: 'conflict',
        details: { file: key, current: revOf(readSoulFile(key)), expected: expectRev },
      })
    }
    const text = stripBom(buffer.toString('utf8'))
    const saved = writeSoulFile(key, text)
    appendChangelog(key, text, `恢复备份 ${name}`)
    return {
      ok: true,
      key,
      path: path.join(dataDir(), FILES[key]),
      rev: saved.rev,
      bytes: saved.bytes,
      backup: saved.backup,
    }
  }
  if (key === 'AGENTS') {
    if (!safeBackupName(name, 'AGENTS.md')) {
      throw new HttpError(400, 'invalid backup name', { code: 'invalid_backup_name' })
    }
    const abs = path.join(agentsBackupDir(), name)
    if (!fs.existsSync(abs)) throw new HttpError(404, 'backup not found', { code: 'backup_not_found' })
    const buffer = fs.readFileSync(abs)
    if (buffer.length > MAX_AGENTS_BYTES) {
      throw new HttpError(413, 'backup too large to restore', { code: 'backup_too_large' })
    }
    if (typeof expectRev === 'string' && expectRev !== agentsRev()) {
      throw new HttpError(409, 'AGENTS.md changed since it was read', {
        code: 'conflict',
        details: { file: 'AGENTS', current: agentsRev(), expected: expectRev },
      })
    }
    const current = readAgents()
    const decoded = decodeAgents(buffer)
    const backup = current.exists ? backupAgents(current.abs) : null
    atomicWrite(current.abs, encodeAgents(decoded.text, decoded.encoding))
    return { ok: true, key: 'AGENTS', path: current.abs, rev: agentsRev(), bytes: buffer.length, backup }
  }
  throw new HttpError(400, 'file must be SELF, MEMORY or AGENTS', { code: 'unknown_file' })
}

// ── 读接口 ──────────────────────────────────────────────────────────────────

/** 读接口的完整响应：文件、版本、备份、指针、结构化人设、限额。 */
export function readPayload() {
  const dir = dataDir()
  const legacy = legacyDataDir()
  const movedFrom =
    dir !== legacy && fs.existsSync(path.join(legacy, FILES.SELF)) && !fs.existsSync(path.join(dir, FILES.SELF))
      ? legacy
      : null
  const seeded = seedIfMissing()
  const files = { SELF: readSoulFile('SELF'), MEMORY: readSoulFile('MEMORY') }
  const self = parseSoulFile(files.SELF.text)
  return {
    ok: true,
    version: PACKAGE.version,
    dir,
    dirs: { data: dir, backups: backupDir(), agents: agentsPath(), agentsBackups: agentsBackupDir() },
    limits: {
      fileBytes: MAX_FILE_BYTES,
      bodyBytes: MAX_BODY_BYTES,
      agentsBytes: MAX_AGENTS_BYTES,
      backupKeep: runtime.backupKeep,
    },
    files,
    seeded,
    movedFrom,
    revs: { SELF: revOf(files.SELF), MEMORY: revOf(files.MEMORY), AGENTS: agentsRev() },
    backups: { SELF: listBackups('SELF'), MEMORY: listBackups('MEMORY'), AGENTS: listAgentsBackups() },
    pointer: pointerStatus(),
    presets: PRESETS,
    memory: { ...memoryStats(files.MEMORY.text), items: memoryEntries(files.MEMORY.text) },
    self: { preamble: self.preamble, sections: self.sections, fields: readFields(self.sections) },
    changelog: changelogTail(5),
  }
}

// ── 写接口 ──────────────────────────────────────────────────────────────────

/**
 * 写接口。SELF 走结构化（preamble + sections），MEMORY 走整份文本。
 * 任何结构问题都以 422 拒绝并指明 code；explicit force 才允许覆盖别处的修改。
 */
export function applyWrite(body) {
  const payload = body !== null && typeof body === 'object' ? body : {}
  const key = typeof payload.file === 'string' ? payload.file.toUpperCase() : ''
  if (key !== 'SELF' && key !== 'MEMORY') {
    throw new HttpError(400, 'file must be SELF or MEMORY', { code: 'unknown_file' })
  }
  let text
  if (key === 'SELF') {
    const sections = payload.sections
    if (!Array.isArray(sections)) {
      throw new HttpError(422, 'sections must be an array', { code: 'sections_not_array' })
    }
    const verdict = validateSections(sections)
    if (!verdict.ok) {
      throw new HttpError(422, verdict.message, { code: verdict.code, details: verdict.details })
    }
    if (payload.preamble !== undefined && payload.preamble !== null && typeof payload.preamble !== 'string') {
      throw new HttpError(422, 'preamble must be a string', { code: 'bad_preamble' })
    }
    text = composeSoulFile({ preamble: typeof payload.preamble === 'string' ? payload.preamble : '', sections })
  } else {
    if (typeof payload.text !== 'string') {
      throw new HttpError(422, 'text must be a string', { code: 'text_required' })
    }
    text = payload.text
  }
  if (text.trim() === '') {
    throw new HttpError(422, 'refusing to write an empty file', { code: 'empty_file' })
  }
  if (!text.endsWith('\n')) text += '\n'
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_FILE_BYTES) {
    throw new HttpError(413, `file too large (limit ${MAX_FILE_BYTES} bytes)`, {
      code: 'file_too_large',
      details: { bytes, limit: MAX_FILE_BYTES },
    })
  }
  const current = readSoulFile(key)
  if (payload.force !== true) {
    if (typeof payload.expectRev !== 'string') {
      throw new HttpError(400, 'expectRev is required (reload the page and retry)', { code: 'expect_rev_required' })
    }
    if (payload.expectRev !== revOf(current)) {
      throw new HttpError(409, `${FILES[key]} changed since it was read`, {
        code: 'conflict',
        details: { file: key, current: revOf(current), expected: payload.expectRev },
      })
    }
  }
  const saved = writeSoulFile(key, text)
  appendChangelog(key, text)
  return {
    ok: true,
    key,
    path: path.join(dataDir(), FILES[key]),
    rev: saved.rev,
    bytes: saved.bytes,
    backup: saved.backup,
  }
}

// ── 系统定位 ────────────────────────────────────────────────────────────────

/**
 * 在系统文件管理器里定位文件（execFile 直传参数，不经 shell）。
 * Windows 传逗号会被 explorer 当参数分隔符，退化为打开所在目录；
 * 文件不存在返回 false；其余「进程能启动」即算成功（explorer 成功也常返回 1）。
 */
export function systemOpen(abs, options = {}) {
  const reveal = options.reveal !== false
  if (!fs.existsSync(abs)) return Promise.resolve(false)
  const native = process.platform === 'win32' ? abs.replace(/\//g, '\\') : abs
  const isDir = reveal === false
  let command
  let args
  if (process.platform === 'win32') {
    command = 'explorer'
    if (isDir) {
      args = [native]
    } else if (native.includes(',')) {
      const parent = path.win32.dirname(native)
      args = [parent]
    } else {
      args = [`/select,${native}`]
    }
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = isDir ? [native] : ['-R', native]
  } else {
    command = 'xdg-open'
    args = [isDir ? native : path.dirname(native)]
  }
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error) => {
      if (error && error.code === 'ENOENT') {
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}

// ── 请求校验 ────────────────────────────────────────────────────────────────

const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i

/**
 * Origin 的端口必须与本次请求的 Host 端口一致；本机互认 127.0.0.1 / localhost。
 * 没有 Origin 的请求只允许安全方法（GET/HEAD）——浏览器发起的跨站写请求一定带
 * Origin，缺少 Origin 的写请求只可能来自本机其他进程，不该被默认信任。
 */
export function isSameOrigin(req, method = 'GET') {
  const headers = (req && req.headers) || {}
  const hostMatch = LOCAL_HOST_PATTERN.exec(String(headers.host || ''))
  if (hostMatch === null) return false
  const origin = headers.origin
  if (origin === undefined || origin === null || origin === '') {
    return method === 'GET' || method === 'HEAD'
  }
  let parsed
  try {
    parsed = new URL(String(origin))
  } catch (error) {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const originMatch = LOCAL_HOST_PATTERN.exec(parsed.host)
  if (originMatch === null) return false
  return (originMatch[2] || '') === (hostMatch[2] || '')
}

/** 只接受 application/json（含 +json）。 */
export function isJsonRequest(req) {
  const raw = String((req && req.headers && req.headers['content-type']) || '').trim()
  return /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(raw)
}

/** 读请求体：超限立即 413 并排空流，不把连接吊死。 */
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let settled = false
    const cleanup = () => {
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.removeListener('aborted', onAborted)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        fail(
          new HttpError(413, `request body too large (limit ${maxBytes} bytes)`, {
            code: 'body_too_large',
            details: { limit: maxBytes },
          }),
        )
        if (typeof req.resume === 'function') req.resume()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(new HttpError(400, 'invalid JSON body', { code: 'invalid_json' }))
      }
    }
    const onError = (error) =>
      fail(error instanceof HttpError ? error : new HttpError(400, 'request aborted', { code: 'request_aborted' }))
    const onAborted = () => fail(new HttpError(400, 'request aborted', { code: 'request_aborted' }))
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
  })
}

function writeJson(res, status, body) {
  if (res === undefined || res === null || res.destroyed === true || res.writableEnded === true) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 路由共用的前置校验：同源 + 方法 + JSON。返回 false 表示已回写错误。 */
function guard(req, res, method) {
  if (!isSameOrigin(req, req.method || method)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request', code: 'cross_origin' })
    return false
  }
  if (req.method !== method) {
    writeJson(res, 405, { ok: false, error: 'method not allowed', code: 'method_not_allowed' })
    return false
  }
  if (method === 'POST' && !isJsonRequest(req)) {
    writeJson(res, 415, {
      ok: false,
      error: 'unsupported media type: application/json required',
      code: 'unsupported_media_type',
    })
    return false
  }
  return true
}

// ── 插件入口 ────────────────────────────────────────────────────────────────

/**
 * Config：首次使用时才动态 import schemastery（裸克隆跑单测时它可能不存在，
 * 静态 import 会让整个模块加载失败）。同时挂 Standard Schema 的同步 validate，
 * 因为 cordis 从 0.2.1-rc 起按 standard schema 读配置，异步校验会直接让 boot 失败。
 */
export async function Config(value) {
  try {
    // @ts-expect-error schemastery 由宿主提供；未安装时故意走下面的恒等兜底分支
    const mod = await import('@deepseek-ai/schemastery')
    const S = mod.default ?? mod
    return S.object({
      dataDir: S.string()
        .description('Where SELF.md / MEMORY.md live. Empty = SOUL_HOME or ~/.agent-self')
        .default(''),
      backupKeep: S.number()
        .min(1)
        .max(365)
        .description('How many backups to keep per file')
        .default(DEFAULT_BACKUP_KEEP),
      pointer: S.boolean().description('Manage the SOUL pointer block in AGENTS.md').default(true),
    })
  } catch (error) {
    return {
      '~standard': {
        version: 1,
        vendor: 'dsh-self-layer',
        validate: (input) => ({ value: normalizeConfig(input) }),
      },
    }
  }
}

Config['~standard'] = {
  version: 1,
  vendor: 'dsh-self-layer',
  validate: (value) => ({ value: normalizeConfig(value) }),
}

export function apply(ctx, config) {
  configure(config)
  ctx.inject(['webServer'], (serverCtx) => {
    const webServer =
      serverCtx.webServer ?? (typeof serverCtx.get === 'function' ? serverCtx.get('webServer') : undefined)
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return

    const route = (routePath, method, handler) =>
      serverCtx.effect(() =>
        webServer.register({
          kind: 'exact',
          path: routePath,
          handler: async (req, res) => {
            try {
              if (!guard(req, res, method)) return
              const body = method === 'POST' ? await readBody(req, MAX_BODY_BYTES) : undefined
              writeJson(res, 200, await handler(body))
            } catch (error) {
              const status = error instanceof HttpError ? error.status : 500
              const payload = {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                code: error instanceof HttpError ? error.code : 'internal_error',
              }
              if (error instanceof HttpError && error.details !== undefined) payload.details = error.details
              writeJson(res, status, payload)
            }
          },
        }),
      )

    route('/api/self-layer/read', 'GET', async () => readPayload())
    route('/api/self-layer/write', 'POST', async (body) => applyWrite(body))
    route('/api/self-layer/restore', 'POST', async (body) =>
      restoreBackup(
        typeof body.file === 'string' ? body.file.toUpperCase() : '',
        body.backup,
        typeof body.expectRev === 'string' ? body.expectRev : undefined,
      ),
    )
    route('/api/self-layer/pointer', 'POST', async () => applyPointer())
    route('/api/self-layer/open', 'POST', async (body) => {
      const key = typeof body.file === 'string' ? body.file.toUpperCase() : ''
      const dir = dataDir()
      if (key !== 'DIR' && key !== 'AGENTS' && key !== 'SELF' && key !== 'MEMORY') {
        throw new HttpError(400, 'file must be DIR, AGENTS, SELF or MEMORY', { code: 'unknown_file' })
      }
      const abs = key === 'DIR' ? dir : key === 'AGENTS' ? agentsPath() : path.join(dir, FILES[key])
      ensureDirs()
      const ok = await systemOpen(abs, { reveal: key !== 'DIR' })
      if (!ok) throw new HttpError(500, `cannot open ${abs}`, { code: 'open_failed', details: { path: abs } })
      return { ok: true, path: abs }
    })
  })
}