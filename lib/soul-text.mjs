/**
 * SELF.md 的纯文本层：解析 / 拼回 / 快捷字段读取 / 校验。
 *
 * 这里集中所有「人设文件长什么样」的知识：宿主半边直接 import，单测 import
 * 同一份实现，不复制第二份。本模块不做任何 I/O，也不做截断——超限由调用方
 * 拒绝并报错，绝不静默丢内容（静默截断会让人以为保存成功、实际少了半份人设）。
 *
 * 文件格式（约定）：
 *   # SELF · 我是谁            ← preamble，原样保留
 *
 *   ## 身份                    ← 每 `## ` 起一节（围栏代码块里的 `## ` 不算）
 *   - **称呼用户**：魔女         ← 身份节里的「- **字段**：值」即快捷字段
 */

/** 快捷字段所在的节名，以及允许的字段名（顺序即表单顺序）。 */
export const IDENTITY = '身份'
export const QUICK_FIELDS = ['称呼用户', '名字', '语言', '时区']

/** 结构上限：只做校验，不裁剪。 */
export const TITLE_MAX = 120
export const SECTION_MAX = 500

/** 只压缩首尾空行，不动行尾空格（Markdown 硬换行靠两个空格，删了就是改内容）。 */
const stripBlankEdges = (text) => String(text ?? '').replace(/^\n+/, '').replace(/\n+$/, '')

/** 围栏行：``` 或 ~~~，允许前导空格与语言标记。 */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * 把 SELF.md 拆成 { preamble, sections: [{ title, body }] }。
 * 任何输入都返回结构完整的结果，不抛错——设置页拿到的是「可渲染的」数据。
 * 围栏代码块里的 `## ` 是正文，不是分节标题。
 */
export function parseSoulFile(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const preamble = []
  const sections = []
  let cur = null
  let fence = null
  for (const line of lines) {
    const fenceMatch = FENCE_RE.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
    }
    const heading = fence === null ? /^##\s+(.*)$/.exec(line) : null
    if (heading !== null) {
      cur = { title: heading[1].trim(), body: [] }
      sections.push(cur)
    } else if (cur !== null) {
      cur.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  return {
    preamble: stripBlankEdges(preamble.join('\n')),
    sections: sections
      .filter((s) => s.title !== '')
      .map((s) => ({ title: s.title, body: stripBlankEdges(s.body.join('\n')) })),
  }
}

/** 把 { preamble, sections } 拼回 SELF.md 文本（以单个换行收尾）。 */
export function composeSoulFile(parsed) {
  const parts = []
  const preamble = String((parsed && parsed.preamble) ?? '')
  if (preamble.trim() !== '') parts.push(stripBlankEdges(preamble))
  for (const section of (parsed && parsed.sections) || []) {
    const title = String((section && section.title) ?? '').trim()
    if (title === '') continue
    const body = stripBlankEdges(String((section && section.body) ?? ''))
    parts.push(body === '' ? `## ${title}` : `## ${title}\n\n${body}`)
  }
  return `${parts.join('\n\n')}\n`
}

/**
 * 校验存档前的分节结构。返回 { ok, code, message, details }；ok=false 时
 * 调用方应以 422 拒绝，而不是丢掉出问题的条目继续写。
 */
export function validateSections(sections) {
  if (!Array.isArray(sections)) {
    return { ok: false, code: 'sections_not_array', message: 'sections must be an array' }
  }
  if (sections.length > SECTION_MAX) {
    return {
      ok: false,
      code: 'too_many_sections',
      message: `too many sections (limit ${SECTION_MAX})`,
      details: { count: sections.length, limit: SECTION_MAX },
    }
  }
  const seen = new Map()
  for (let i = 0; i < sections.length; i += 1) {
    const raw = sections[i]
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, code: 'bad_section', message: 'each section must be an object', details: { index: i } }
    }
    const title = String(raw.title ?? '')
    const trimmed = title.trim()
    if (trimmed === '') {
      return { ok: false, code: 'empty_title', message: 'section title must not be empty', details: { index: i } }
    }
    if (/[\r\n]/.test(title)) {
      return {
        ok: false,
        code: 'multiline_title',
        message: 'section title must be a single line',
        details: { index: i, title },
      }
    }
    if (title.length > TITLE_MAX) {
      return {
        ok: false,
        code: 'title_too_long',
        message: `section title too long (limit ${TITLE_MAX} characters)`,
        details: { index: i, length: title.length, limit: TITLE_MAX },
      }
    }
    if (typeof raw.body !== 'string' && raw.body !== undefined && raw.body !== null) {
      return { ok: false, code: 'bad_body', message: 'section body must be a string', details: { index: i } }
    }
    if (seen.has(trimmed)) {
      return {
        ok: false,
        code: 'duplicate_title',
        message: `duplicate section title: ${trimmed}`,
        details: { title: trimmed, indexes: [seen.get(trimmed), i] },
      }
    }
    seen.set(trimmed, i)
  }
  return { ok: true }
}

/** 转义正则元字符（字段名来自固定清单，仍然防御性处理）。 */
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 匹配「- **字段**：值」这一行（半角/全角冒号都认）。 */
export function fieldPattern(label) {
  return new RegExp(`^- \\*\\*${escapeRe(label)}\\*\\*[：:][ \\t]*(.*)$`, 'm')
}

/** 从分节里读一个快捷字段；没有就返回空串。 */
export function getField(sections, label) {
  const identity = (sections || []).find((s) => s.title === IDENTITY)
  if (identity === undefined) return ''
  const match = fieldPattern(label).exec(String(identity.body ?? ''))
  return match === null ? '' : match[1].trim()
}

/** 一次性读出全部快捷字段，返回 { 字段名: 值 }。 */
export function readFields(sections) {
  const out = {}
  for (const label of QUICK_FIELDS) out[label] = getField(sections, label)
  return out
}

/**
 * 长期记忆的规模指标：条目数（`- ` 开头的行）与 UTF-8 字节数。
 * 只统计，不判断好坏——建议上限由界面提示，不在这里拒绝。
 */
export function memoryStats(text) {
  const source = String(text ?? '')
  const lines = source.split(/\r?\n/)
  let entries = 0
  for (const line of lines) if (line.trim().startsWith('- ')) entries += 1
  return { entries, bytes: Buffer.byteLength(source, 'utf8'), lines: lines.length }
}

/** 拆出记忆条目所在的行号（1 起），界面用来逐条删除。 */
export function memoryEntries(text) {
  const out = []
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim().startsWith('- ')) out.push({ line: i + 1, text: line })
  }
  return out
}

/**
 * 界面下拉预设：只是候选项，不是默认值。
 * 用户不选，文件里就是空的——产品不该替用户决定「风格」。
 */
export const PRESETS = {
  language: ['中文', 'English', '日本語'],
  timezone: ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York'],
  style: [
    { label: '简洁', text: '- 先给结论，再给依据。\n- 能一句说清就不写三句。' },
    { label: '详细', text: '- 先给结论，再展开依据与取舍。\n- 给出可以照做的步骤与验证方式。' },
    { label: '教学', text: '- 先讲为什么，再给做法。\n- 用最小例子说明关键概念。' },
  ],
}
