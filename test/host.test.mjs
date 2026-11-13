import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// 先把数据目录与 DSH_HOME 指到临时目录，再 import 宿主半。
// 测试永远不碰真实 ~/.agent-self 与 ~/.dsh。
const ROOT = mkdtempSync(join(tmpdir(), 'dsh-soul-host-'))
const HOME = join(ROOT, 'home')
const DSH = join(ROOT, 'dshhome')
process.env.SOUL_HOME = HOME
process.env.DSH_HOME = DSH

const host = await import('../lib/index.js')

test.after(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

let counter = 0
/** 每个用例一个干净数据目录（AGENTS.md 仍共用 DSH_HOME）。 */
function fresh(extra = {}, { keepAgents = false } = {}) {
  counter += 1
  const dir = join(ROOT, `case-${counter}`)
  host.configure({ dataDir: dir, ...extra })
  // 每个用例默认从「没有 AGENTS.md」开始，避免上一个用例的编码/内容污染下一个。
  if (!keepAgents) rmSync(agentsFile(), { force: true })
  return dir
}

const agentsFile = () => join(DSH, 'AGENTS.md')

// ── 配置与路径 ──────────────────────────────────────────────────────────────

test('normalizeConfig：坏值退回默认，backupKeep 夹到 1..365', () => {
  assert.deepEqual(host.normalizeConfig(undefined), { dataDir: '', backupKeep: 30, pointer: true })
  assert.equal(host.normalizeConfig({ backupKeep: 0 }).backupKeep, 1)
  assert.equal(host.normalizeConfig({ backupKeep: 999 }).backupKeep, 365)
  assert.equal(host.normalizeConfig({ backupKeep: 'abc' }).backupKeep, 30)
  assert.equal(host.normalizeConfig({ pointer: 'false' }).pointer, false)
  assert.equal(host.normalizeConfig({ pointer: false }).pointer, false)
  assert.equal(host.normalizeConfig({ dataDir: '  /tmp/x  ' }).dataDir, '/tmp/x')
})

test('dataDir：Config 优先于 SOUL_HOME；~ 会展开；相对路径被 resolve', () => {
  host.configure({ dataDir: '~/soul-test' })
  assert.equal(host.dataDir(), join(homedir(), 'soul-test'))
  host.configure({ dataDir: 'relative-dir' })
  assert.equal(host.dataDir(), join(process.cwd(), 'relative-dir'))
  host.configure({})
  assert.equal(host.dataDir(), HOME)
})

test('legacyDataDir：仍指向 ~/.agent-self（只用于迁移提示）', () => {
  assert.match(host.legacyDataDir(), /[\\/]\.agent-self$/)
})

// ── 播种 ────────────────────────────────────────────────────────────────────

test('首次读取：按包内模板补 SELF / MEMORY / CHANGELOG', () => {
  const dir = fresh()
  const payload = host.readPayload()
  assert.deepEqual(payload.seeded, ['SELF', 'MEMORY', 'CHANGELOG'])
  for (const file of ['SELF.md', 'MEMORY.md', 'CHANGELOG.md']) {
    assert.equal(existsSync(join(dir, file)), true, file)
  }
  assert.equal(host.readPayload().seeded.length, 0)
})

test('播种不覆盖已有文件：手改过的 SELF 仍在，seeded 为空', () => {
  const dir = fresh()
  host.readPayload()
  writeFileSync(join(dir, 'SELF.md'), '# 我自己的开头\n\n## 身份\n\n- **语言**：English\n', 'utf8')
  const payload = host.readPayload()
  assert.equal(payload.seeded.includes('SELF'), false)
  assert.equal(payload.self.sections[0].title, '身份')
  assert.equal(payload.files.SELF.text, '# 我自己的开头\n\n## 身份\n\n- **语言**：English\n')
})

// ── 读接口 ──────────────────────────────────────────────────────────────────

test('readPayload：形状完整，备份是 {name,bytes,at}，不回传整份 CHANGELOG', () => {
  fresh()
  const payload = host.readPayload()
  assert.equal(payload.ok, true)
  assert.equal(typeof payload.version, 'string')
  assert.deepEqual(Object.keys(payload.revs).sort(), ['AGENTS', 'MEMORY', 'SELF'])
  assert.equal(payload.limits.fileBytes, host.MAX_FILE_BYTES)
  assert.equal(payload.limits.bodyBytes, host.MAX_BODY_BYTES)
  assert.equal(payload.limits.agentsBytes, host.MAX_AGENTS_BYTES)
  assert.equal(payload.limits.backupKeep, 30)
  assert.ok(Array.isArray(payload.backups.SELF))
  assert.ok(Array.isArray(payload.backups.AGENTS))
  assert.equal(Array.isArray(payload.changelog), true)
  assert.equal(payload.files.SELF.text.includes('# SELF') || payload.files.SELF.text.length > 0, true)
  assert.equal(typeof payload.pointer.path, 'string')
  assert.equal(typeof payload.pointer.enabled, 'boolean')
  assert.equal(payload.presets.language.length > 0, true)
  assert.equal(typeof payload.memory.entries, 'number')
})

// ── 写接口 ──────────────────────────────────────────────────────────────────

test('writeSoulFile：写入可读回；同样字节哈希稳定；重写产生备份', () => {
  const dir = fresh()
  host.readPayload()
  const first = host.writeSoulFile('MEMORY', '# 记忆\n\n- 一条\n')
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), '# 记忆\n\n- 一条\n')
  assert.equal(host.readSoulFile('MEMORY').rev, first.rev)
  assert.equal(host.writeSoulFile('MEMORY', '# 记忆\n\n- 一条\n').rev, first.rev)
  const second = host.writeSoulFile('MEMORY', '# 记忆\n\n- 两条\n')
  assert.notEqual(second.rev, first.rev)
  assert.ok(second.backup !== null)
  assert.ok(readdirSync(join(dir, '.backups')).some((name) => name.startsWith('MEMORY.md.')))
})

test('readSoulFile：超过 256 KB 标记 tooLarge 且不回传正文', () => {
  const dir = fresh()
  host.readPayload()
  writeFileSync(join(dir, 'SELF.md'), `# 大文件\n${'x'.repeat(host.MAX_FILE_BYTES + 10)}`, 'utf8')
  const meta = host.readSoulFile('SELF')
  assert.equal(meta.tooLarge, true)
  assert.equal(meta.text, '')
  assert.equal(meta.bytes > host.MAX_FILE_BYTES, true)
})

test('applyWrite：只有 preamble 的 SELF 也能保存（不再 422）', () => {
  const dir = fresh()
  host.readPayload()
  const rev = host.readSoulFile('SELF').rev
  const result = host.applyWrite({ file: 'SELF', preamble: '# 只有开头\n\n一句话。', sections: [], expectRev: rev })
  assert.equal(result.ok, true)
  assert.equal(readFileSync(join(dir, 'SELF.md'), 'utf8'), '# 只有开头\n\n一句话。\n')
})

test('applyWrite：分节重复标题 → 422，且不落盘', () => {
  const dir = fresh()
  host.readPayload()
  const before = readFileSync(join(dir, 'SELF.md'), 'utf8')
  const rev = host.readSoulFile('SELF').rev
  assert.throws(
    () =>
      host.applyWrite({
        file: 'SELF',
        preamble: '',
        sections: [
          { title: '边界', body: '' },
          { title: '边界', body: '' },
        ],
        expectRev: rev,
      }),
    (error) => error.status === 422 && error.code === 'duplicate_title',
  )
  assert.equal(readFileSync(join(dir, 'SELF.md'), 'utf8'), before)
})

test('applyWrite：空文件 422；缺 expectRev 400；过期 409（带 details）；force 放行', () => {
  const dir = fresh()
  host.readPayload()
  assert.throws(() => host.applyWrite({ file: 'MEMORY', text: '   \n', expectRev: 'x' }), (error) => error.code === 'empty_file')
  const rev = host.readSoulFile('MEMORY').rev
  assert.throws(() => host.applyWrite({ file: 'MEMORY', text: '# x' }), (error) => error.code === 'expect_rev_required')
  assert.throws(
    () => host.applyWrite({ file: 'MEMORY', text: '# 别人写的', expectRev: 'stale' }),
    (error) => error.status === 409 && error.code === 'conflict' && error.details.current !== 'stale',
  )
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('别人写的'), false)
  host.applyWrite({ file: 'MEMORY', text: '# 覆盖', expectRev: rev, force: true })
  assert.equal(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), '# 覆盖\n')
})

test('applyWrite：超过 256 KB → 413 file_too_large', () => {
  fresh()
  host.readPayload()
  const rev = host.readSoulFile('MEMORY').rev
  assert.throws(
    () => host.applyWrite({ file: 'MEMORY', text: `# x\n${'y'.repeat(host.MAX_FILE_BYTES)}`, expectRev: rev }),
    (error) => error.status === 413 && error.code === 'file_too_large',
  )
})

// ── 常驻指针 ────────────────────────────────────────────────────────────────

test('applyPointer：首次追加；状态变为 present/complete；重复调用不再改写', () => {
  const dir = fresh()
  host.readPayload()
  const applied = host.applyPointer()
  assert.equal(applied.changed, true)
  const text = readFileSync(agentsFile(), 'utf8')
  assert.equal((text.match(/<!-- SOUL:BEGIN/g) || []).length, 1)
  assert.equal(text.includes('<!-- SOUL:END -->'), true)
  assert.equal(text.includes(join(dir, 'SELF.md')), true)

  const status = host.pointerStatus()
  assert.equal(status.present, true)
  assert.equal(status.complete, true)
  assert.equal(status.stale, false)
  assert.equal(host.applyPointer().changed, false)
})

test('applyPointer：毁掉的 BEGIN-only 块被整段修好，不追加第二块', () => {
  fresh()
  host.readPayload()
  writeFileSync(agentsFile(), '# AGENTS\n\n<!-- SOUL:BEGIN 旧的\n- 指向 ~/.agent-self/SELF.md\n', 'utf8')
  assert.equal(host.pointerStatus().stale, true)
  host.applyPointer()
  const text = readFileSync(agentsFile(), 'utf8')
  assert.equal((text.match(/<!-- SOUL:BEGIN/g) || []).length, 1)
  assert.equal((text.match(/<!-- SOUL:END -->/g) || []).length, 1)
  assert.equal(text.includes('~/.agent-self/SELF.md'), false)
  assert.equal(text.includes('# AGENTS'), true)
})

test('applyPointer：多个重复块收敛成一块', () => {
  fresh()
  host.readPayload()
  const block = host.pointerBlockFor('/tmp/old')
  writeFileSync(agentsFile(), `# AGENTS\n\n${block}\n\n${block}\n`, 'utf8')
  host.applyPointer()
  const text = readFileSync(agentsFile(), 'utf8')
  assert.equal((text.match(/<!-- SOUL:BEGIN/g) || []).length, 1)
})

test('applyPointer：只有 END 没有 BEGIN → 422 agents_orphan_end', () => {
  fresh()
  host.readPayload()
  writeFileSync(agentsFile(), '# AGENTS\n\n<!-- SOUL:END -->\n', 'utf8')
  assert.throws(() => host.applyPointer(), (error) => error.code === 'agents_orphan_end')
})

test('applyPointer：UTF-16LE 的 AGENTS.md 保持编码与原有内容', () => {
  fresh()
  host.readPayload()
  const original = '# AGENTS\n\nUTF-16 内容。\n'
  writeFileSync(agentsFile(), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(original, 'utf16le')]))
  host.applyPointer()
  const buffer = readFileSync(agentsFile())
  assert.deepEqual([...buffer.subarray(0, 2)], [0xff, 0xfe])
  const decoded = new TextDecoder('utf-16le').decode(buffer.subarray(2))
  assert.equal(decoded.includes('UTF-16 内容。'), true)
  assert.equal(decoded.includes('<!-- SOUL:BEGIN'), true)
  assert.equal(host.pointerStatus().encoding, 'utf16le')
})

test('applyPointer：非 UTF-8 且非 UTF-16 → 422 agents_encoding，原文件不动', () => {
  fresh()
  host.readPayload()
  const bogus = Buffer.from([0x47, 0x42, 0x4b, 0x80, 0xff, 0x0a])
  writeFileSync(agentsFile(), bogus)
  assert.throws(() => host.applyPointer(), (error) => error.code === 'agents_encoding')
  assert.deepEqual(readFileSync(agentsFile()), bogus)
})

test('指针管理关闭：applyPointer → 403 pointer_disabled；状态里 enabled=false', () => {
  fresh({ pointer: false })
  host.readPayload()
  assert.equal(host.pointerStatus().enabled, false)
  assert.throws(() => host.applyPointer(), (error) => error.code === 'pointer_disabled')
})

test('数据目录搬家后指针判 stale（指向旧目录）', () => {
  const first = fresh()
  host.readPayload()
  host.applyPointer()
  assert.equal(host.pointerStatus().stale, false)

  const second = fresh({}, { keepAgents: true })
  host.readPayload()
  assert.notEqual(first, second)
  const status = host.pointerStatus()
  assert.equal(status.present, true)
  assert.equal(status.stale, true)
})

// ── 恢复 ────────────────────────────────────────────────────────────────────

test('restoreBackup：恢复旧版 SELF；过期 expectRev → 409', () => {
  const dir = fresh()
  host.readPayload()
  host.applyWrite({ file: 'SELF', preamble: '# 第一版', sections: [], expectRev: host.readSoulFile('SELF').rev })
  host.applyWrite({ file: 'SELF', preamble: '# 第二版', sections: [], expectRev: host.readSoulFile('SELF').rev })
  const backup = host.listBackups('SELF')[0]
  assert.ok(backup !== undefined)

  assert.throws(
    () => host.restoreBackup('SELF', backup.name, 'stale'),
    (error) => error.status === 409 && error.code === 'conflict',
  )
  host.restoreBackup('SELF', backup.name, host.readSoulFile('SELF').rev)
  assert.equal(readFileSync(join(dir, 'SELF.md'), 'utf8'), '# 第一版\n')
})

test('restoreBackup：非法备份名 / 不存在 → 400 / 404', () => {
  fresh()
  host.readPayload()
  assert.throws(() => host.restoreBackup('SELF', '../SELF.md', undefined), (error) => error.status === 400)
  assert.throws(() => host.restoreBackup('SELF', 'SELF.md.nope', undefined), (error) => error.status === 404)
})

test('restoreBackup：AGENTS 备份可恢复，且恢复前会再备份当前版本', () => {
  fresh()
  host.readPayload()
  writeFileSync(agentsFile(), '# AGENTS\n\n原始内容。\n', 'utf8')
  host.applyPointer() // 第一次改写前会备份原始内容
  const backup = host.listAgentsBackups()[0]
  assert.ok(backup !== undefined)

  writeFileSync(agentsFile(), '# AGENTS\n\n被改坏的内容。\n', 'utf8')
  const beforeRestore = host.listAgentsBackups().length
  host.restoreBackup('AGENTS', backup.name, host.agentsRev())

  const restored = readFileSync(agentsFile(), 'utf8')
  assert.equal(restored, '# AGENTS\n\n原始内容。\n')
  // 恢复动作本身也应先备份当前（坏掉的）版本，保证可回退
  assert.equal(host.listAgentsBackups().length > beforeRestore, true)
})

// ── 备份保留与流水 ─────────────────────────────────────────────────────────

test('backupKeep：只保留最近 N 份', () => {
  fresh({ backupKeep: 2 })
  host.readPayload()
  for (let i = 0; i < 5; i += 1) {
    host.applyWrite({ file: 'MEMORY', text: `# 第 ${i} 版`, expectRev: host.readSoulFile('MEMORY').rev })
  }
  assert.equal(host.listBackups('MEMORY').length, 2)
})

test('changelogTail：保存后留痕，且只返回尾部若干行', () => {
  fresh()
  host.readPayload()
  host.applyWrite({ file: 'MEMORY', text: '# 记忆\n\n- 一条', expectRev: host.readSoulFile('MEMORY').rev })
  const tail = host.changelogTail(5)
  assert.equal(tail.length <= 5, true)
  assert.equal(tail.some((line) => line.includes('MEMORY.md')), true)
})

test('systemOpen：路径不存在时返回 false，不起进程', async () => {
  assert.equal(await host.systemOpen(join(ROOT, 'definitely-missing'), { reveal: false }), false)
})