import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-soul-routes-'))
process.env.SOUL_HOME = HOME
process.env.DSH_HOME = join(HOME, 'dshhome')
const host = await import('../lib/index.js')

test.after(() => {
  rmSync(HOME, { recursive: true, force: true })
})

/** 用假 ctx / 假 webServer 把路由挂起来，拿到 path → handler。 */
function mount() {
  const routes = new Map()
  const ctx = {
    inject(_deps, callback) {
      callback({
        get: () => undefined,
        effect: (fn) => fn(),
        webServer: {
          register(route) {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      })
    },
  }
  host.apply(ctx)
  return routes
}

const ROUTES = mount()

function call(path, { method = 'GET', headers = {}, body } = {}) {
  const route = ROUTES.get(path)
  assert.ok(route !== undefined, `路由未挂载: ${path}`)
  const req = new EventEmitter()
  req.method = method
  req.headers = Object.assign({ host: '127.0.0.1:54509' }, headers)
  const res = {
    status: null,
    payload: null,
    destroyed: false,
    writableEnded: false,
    writeHead(status) {
      this.status = status
    },
    end(chunk) {
      this.payload = chunk
      this.writableEnded = true
    },
  }
  const pending = route.handler(req, res)
  if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  req.emit('end')
  return Promise.resolve(pending).then(() => ({
    status: res.status,
    json: res.payload === null ? null : JSON.parse(res.payload),
  }))
}

const json = (payload) => ({ 'content-type': 'application/json' })

test('五条路由都挂上了', () => {
  assert.deepEqual([...ROUTES.keys()].sort(), [
    '/api/self-layer/open',
    '/api/self-layer/pointer',
    '/api/self-layer/read',
    '/api/self-layer/restore',
    '/api/self-layer/write',
  ])
})

test('read：GET 返回文件、版本、限额与结构化人设', async () => {
  const r = await call('/api/self-layer/read')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.dir, HOME)
  assert.notEqual(r.json.revs.SELF, 'absent')
  assert.deepEqual(r.json.seeded, ['SELF', 'MEMORY', 'CHANGELOG'])
  assert.equal(r.json.limits.fileBytes, host.MAX_FILE_BYTES)
  assert.ok(Array.isArray(r.json.presets.language) && r.json.presets.language.length > 0)
  assert.equal(Array.isArray(r.json.self.sections), true)
})

test('read：POST → 405 method_not_allowed', async () => {
  const r = await call('/api/self-layer/read', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: {},
  })
  assert.equal(r.status, 405)
  assert.equal(r.json.code, 'method_not_allowed')
})

test('write：非 JSON content-type → 415', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'http://127.0.0.1:54509' },
    body: '{"file":"MEMORY","text":"x"}',
  })
  assert.equal(r.status, 415)
})

test('跨源请求 → 403 cross_origin', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:9999' },
    body: { file: 'MEMORY', text: 'x' },
  })
  assert.equal(r.status, 403)
  assert.equal(r.json.code, 'cross_origin')
})

test('没有 Origin 的 POST 也拒绝（只有 GET/HEAD 免 Origin）', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: json({}),
    body: { file: 'MEMORY', text: 'x', expectRev: 'absent' },
  })
  assert.equal(r.status, 403)
})

test('同源 POST 放行（Origin 与 Host 端口一致）', async () => {
  const read = await call('/api/self-layer/read')
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', text: '# 记忆\n\n- 同源', expectRev: read.json.revs.MEMORY },
  })
  assert.equal(r.status, 200)
})

test('非法 JSON → 400 invalid_json', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: '{"file":',
  })
  assert.equal(r.status, 400)
  assert.equal(r.json.code, 'invalid_json')
})

test('write：写入成功，返回新 rev，并在 CHANGELOG 留痕', async () => {
  const read = await call('/api/self-layer/read')
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', text: '# 记忆\n\n- 一条', expectRev: read.json.revs.MEMORY },
  })
  assert.equal(r.status, 200)
  assert.equal(r.json.key, 'MEMORY')
  assert.notEqual(r.json.rev, read.json.revs.MEMORY)
  assert.match(readFileSync(join(HOME, 'CHANGELOG.md'), 'utf8'), /MEMORY\.md/)
})

test('write：过期版本号 → 409 conflict，details 带 current/expected，且不落盘', async () => {
  const before = readFileSync(join(HOME, 'MEMORY.md'), 'utf8')
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', text: '# 被别人改过', expectRev: 'stale-rev' },
  })
  assert.equal(r.status, 409)
  assert.equal(r.json.code, 'conflict')
  assert.equal(r.json.details.expected, 'stale-rev')
  assert.notEqual(r.json.details.current, 'stale-rev')
  assert.equal(readFileSync(join(HOME, 'MEMORY.md'), 'utf8'), before)
})

test('write：force:true 跳过版本校验', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', text: '# 强制覆盖', expectRev: 'stale-rev', force: true },
  })
  assert.equal(r.status, 200)
  assert.match(readFileSync(join(HOME, 'MEMORY.md'), 'utf8'), /强制覆盖/)
})

test('write：未知 file 键 → 400', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'EVIL', text: 'x', expectRev: 'absent' },
  })
  assert.equal(r.status, 400)
})

test('write：超过 256 KB → 413 file_too_large', async () => {
  const read = await call('/api/self-layer/read')
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', text: 'x'.repeat(host.MAX_FILE_BYTES + 64), expectRev: read.json.revs.MEMORY },
  })
  assert.equal(r.status, 413)
  assert.equal(r.json.code, 'file_too_large')
})

test('write：SELF 重复标题 → 422 duplicate_title', async () => {
  const read = await call('/api/self-layer/read')
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: {
      file: 'SELF',
      preamble: '',
      sections: [
        { title: '边界', body: '' },
        { title: '边界', body: '' },
      ],
      expectRev: read.json.revs.SELF,
    },
  })
  assert.equal(r.status, 422)
  assert.equal(r.json.code, 'duplicate_title')
})

test('write：请求体超过 1 MB → 413 body_too_large', async () => {
  const r = await call('/api/self-layer/write', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: `{"file":"MEMORY","text":"${'x'.repeat(host.MAX_BODY_BYTES + 16)}"}`,
  })
  assert.equal(r.status, 413)
  assert.equal(r.json.code, 'body_too_large')
})

test('open：未知键 → 400；不再接受 CHANGELOG', async () => {
  for (const file of ['NOPE', 'CHANGELOG']) {
    const r = await call('/api/self-layer/open', {
      method: 'POST',
      headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
      body: { file },
    })
    assert.equal(r.status, 400, file)
  }
})

test('pointer：初始未注入；POST 后已注入；重复调用 changed=false', async () => {
  const before = await call('/api/self-layer/read')
  assert.equal(before.json.pointer.present, false)

  const applied = await call('/api/self-layer/pointer', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: {},
  })
  assert.equal(applied.status, 200)
  assert.equal(applied.json.changed, true)

  const again = await call('/api/self-layer/pointer', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: {},
  })
  assert.equal(again.json.changed, false)

  const after = await call('/api/self-layer/read')
  assert.equal(after.json.pointer.present, true)
  assert.equal(after.json.pointer.complete, true)
  assert.equal(after.json.pointer.stale, false)
  assert.match(readFileSync(join(HOME, 'dshhome', 'AGENTS.md'), 'utf8'), /SELF\.md/)
})

test('restore：按备份对象恢复；过期 expectRev → 409', async () => {
  const read = await call('/api/self-layer/read')
  const recent = read.json.backups.MEMORY[0]
  assert.ok(recent !== undefined && typeof recent.name === 'string', '应该已有 MEMORY 备份')

  const stale = await call('/api/self-layer/restore', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', backup: recent.name, expectRev: 'stale' },
  })
  assert.equal(stale.status, 409)

  const restored = await call('/api/self-layer/restore', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', backup: recent.name, expectRev: read.json.revs.MEMORY },
  })
  assert.equal(restored.status, 200)
  assert.match(readFileSync(join(HOME, 'CHANGELOG.md'), 'utf8'), /恢复备份/)
})

test('restore：非法备份名 / 未知文件 → 400', async () => {
  const badName = await call('/api/self-layer/restore', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'MEMORY', backup: '../AGENTS.md' },
  })
  assert.equal(badName.status, 400)

  const badFile = await call('/api/self-layer/restore', {
    method: 'POST',
    headers: { ...json({}), origin: 'http://127.0.0.1:54509' },
    body: { file: 'NOPE', backup: 'MEMORY.md.x' },
  })
  assert.equal(badFile.status, 400)
})