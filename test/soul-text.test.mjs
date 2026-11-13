import test from 'node:test'
import assert from 'node:assert/strict'

import {
  IDENTITY,
  PRESETS,
  QUICK_FIELDS,
  SECTION_MAX,
  TITLE_MAX,
  composeSoulFile,
  fieldPattern,
  getField,
  memoryEntries,
  memoryStats,
  parseSoulFile,
  readFields,
  validateSections,
} from '../lib/soul-text.mjs'

const SAMPLE = `# SELF · 我是谁

> 只改这一份。

## 身份

- **称呼用户**：魔女
- **名字**：守夜人
- **语言**：中文
- **时区**：Asia/Shanghai

## 边界

不替用户做不可逆的决定。

## 代码

\`\`\`md
## 这不是分节
\`\`\`

## 结尾

最后一行有硬换行  
第二行。
`

test('parseSoulFile：preamble、分节、围栏里的 ## 不拆节', () => {
  const parsed = parseSoulFile(SAMPLE)
  assert.equal(parsed.preamble, '# SELF · 我是谁\n\n> 只改这一份。')
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ['身份', '边界', '代码', '结尾'],
  )
  assert.match(parsed.sections[2].body, /## 这不是分节/)
  assert.match(parsed.sections[3].body, /最后一行有硬换行  \n第二行。/)
})

test('parseSoulFile：空输入返回空结构，不抛错', () => {
  assert.deepEqual(parseSoulFile(''), { preamble: '', sections: [] })
  assert.deepEqual(parseSoulFile(undefined), { preamble: '', sections: [] })
})

test('parseSoulFile：没有分节时整份都是 preamble', () => {
  const parsed = parseSoulFile('# 只有开头\n\n一段话。\n')
  assert.equal(parsed.sections.length, 0)
  assert.equal(parsed.preamble, '# 只有开头\n\n一段话。')
})

test('composeSoulFile：parse 之后拼回等价文本', () => {
  const parsed = parseSoulFile(SAMPLE)
  const text = composeSoulFile(parsed)
  assert.equal(text.endsWith('\n'), true)
  assert.deepEqual(parseSoulFile(text), parsed)
})

test('composeSoulFile：空正文的分节只留标题，不塞空行垃圾', () => {
  assert.equal(composeSoulFile({ preamble: '', sections: [{ title: '空', body: '' }] }), '## 空\n')
})

test('composeSoulFile：只有 preamble 也能拼回（与空分节列表兼容）', () => {
  assert.equal(composeSoulFile({ preamble: '只有开头', sections: [] }), '只有开头\n')
})

test('readFields：只认身份节，全角/半角冒号都认，值去首尾空格', () => {
  const sections = parseSoulFile(SAMPLE).sections
  assert.deepEqual(readFields(sections), {
    称呼用户: '魔女',
    名字: '守夜人',
    语言: '中文',
    时区: 'Asia/Shanghai',
  })
  const halfWidth = [{ title: IDENTITY, body: '- **语言**: English ' }]
  assert.equal(getField(halfWidth, '语言'), 'English')
})

test('readFields：没有身份节时每个字段都是空串', () => {
  const fields = readFields([{ title: '边界', body: '- **称呼用户**：不该被读到' }])
  assert.deepEqual(Object.keys(fields), QUICK_FIELDS)
  assert.equal(fields.称呼用户, '')
})

test('fieldPattern：字段名里的正则元字符被转义，不会误匹配', () => {
  const pattern = fieldPattern('a.b')
  assert.equal(pattern.test('- **axb**：x'), false)
  assert.equal(pattern.test('- **a.b**：x'), true)
})

test('validateSections：合法结构返回 ok', () => {
  assert.deepEqual(validateSections([]), { ok: true })
  assert.deepEqual(validateSections([{ title: '身份', body: '' }]), { ok: true })
})

test('validateSections：非数组 / 非对象 / 空标题', () => {
  assert.equal(validateSections(null).code, 'sections_not_array')
  assert.equal(validateSections([null]).code, 'bad_section')
  assert.equal(validateSections(['字符串']).code, 'bad_section')
  assert.equal(validateSections([{ title: '   ', body: '' }]).code, 'empty_title')
})

test('validateSections：换行标题 / 超长标题', () => {
  assert.equal(validateSections([{ title: 'a\nb', body: '' }]).code, 'multiline_title')
  const long = validateSections([{ title: 'x'.repeat(TITLE_MAX + 1), body: '' }])
  assert.equal(long.code, 'title_too_long')
  assert.equal(long.details.limit, TITLE_MAX)
})

test('validateSections：正文必须是字符串（undefined/null 允许）', () => {
  assert.equal(validateSections([{ title: 'a', body: 42 }]).code, 'bad_body')
  assert.equal(validateSections([{ title: 'a' }]).ok, true)
})

test('validateSections：重复标题给出两处下标', () => {
  const verdict = validateSections([
    { title: '边界', body: '' },
    { title: ' 边界 ', body: '' },
  ])
  assert.equal(verdict.code, 'duplicate_title')
  assert.deepEqual(verdict.details.indexes, [0, 1])
})

test('validateSections：分节数量上限', () => {
  const many = Array.from({ length: SECTION_MAX + 1 }, (_value, index) => ({ title: `s${index}`, body: '' }))
  const verdict = validateSections(many)
  assert.equal(verdict.code, 'too_many_sections')
  assert.equal(verdict.details.limit, SECTION_MAX)
  assert.equal(validateSections(many.slice(1)).ok, true)
})

test('memoryStats / memoryEntries：条目数、字节数、行号（1 起）', () => {
  const text = '# 记忆\n\n- 第一条\n说明\n- 第二条\n'
  assert.deepEqual(memoryStats(text), { entries: 2, bytes: Buffer.byteLength(text, 'utf8'), lines: 6 })
  assert.deepEqual(memoryEntries(text), [
    { line: 3, text: '- 第一条' },
    { line: 5, text: '- 第二条' },
  ])
})

test('PRESETS：只给候选项，不含默认值', () => {
  assert.ok(PRESETS.language.includes('中文'))
  assert.ok(PRESETS.timezone.includes('UTC'))
  assert.ok(PRESETS.style.every((item) => typeof item.label === 'string' && typeof item.text === 'string'))
})