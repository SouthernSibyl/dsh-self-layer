// dsh-self-layer — Client 半（window.__ModuleLoader__ bundle，零构建）
//
// 「设置 → 自我层」：人设 / 记忆 / 备份三个页签。
// - 结构化解析与校验在宿主（lib/soul-text.mjs、lib/index.js），这里只负责编辑与提交；
// - 界面文案跟宿主 locale 走，中文/英文两套，缺键回落中文而不是静默空白；
// - 只用真实主题 token，不写死浅色值：写错 token 时应当露出来，而不是在深色主题下变白卡片。
//
// 客户端模块的注册 id 必须是包名，否则加载器判 "loaded without registering"，
// 整个 web boot 直接失败。
const loader = /** @type {{ __ModuleLoader__?: { load: (spec: unknown) => void } }} */ (window).__ModuleLoader__
// 没有加载器就什么都不注册：抛错比静默失败更容易定位。
if (!loader) throw new Error('dsh-self-layer: window.__ModuleLoader__ is missing')
loader.load({
  id: 'dsh-self-layer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const react = require('react')
    const h = react.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = react
    const inject = ['slots']

    /**
     * 从事件里取输入值。直接写 inputValue(event) 在 checkJs 下是 10 条 TS2339；
     * 集中在这里做一次收窄，同时允许 select / textarea。
     * @param {{ target: EventTarget | null }} event
     * @returns {string}
     */
    const inputValue = (event) => {
      const target = /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null} */ (event.target)
      return target === null || typeof target.value !== 'string' ? '' : target.value
    }

    const API = '/api/self-layer'
    const QUICK_FIELDS = ['称呼用户', '名字', '语言', '时区']
    const IDENTITY = '身份'
    const KB = 1024

    // ── 文案 ────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        title: '自我层',
        subtitle: '所有对话流共用这一份设定。保存后写回数据目录，写前自动备份；新开的对话流生效。',
        openDir: '打开数据目录',
        openAgents: '打开 AGENTS.md',
        loading: '读取中…',
        readFail: '读取失败',
        retry: '重试',
        tabsSelf: '人设',
        tabsMemory: '记忆',
        tabsBackups: '备份',
        saved: '已保存',
        dirty: '未保存',
        save: '保存',
        saveAll: '保存全部',
        saving: '保存中…',
        cleanAll: '没有未保存的改动',
        notEditable: '这个文件超过 {kb} KB，页面不提供编辑，避免显示出存不回去的正文。请手动精简后再回来。',
        movedFrom: '数据目录已改为 {dir}，但旧目录 {old} 里仍有 SELF.md。为避免覆盖，没有自动迁移——需要的话手动复制过去。',
        readError: '读不了 {file}：{message}',
        seeded: '已用包内模板初始化：{files}',
        identity: '称呼与身份',
        identityHint: '决定我开口时怎么叫你、用什么语言。这几行就是「身份」节里的字段行，下面的原文框可编辑整节内容。',
        fieldAddress: '称呼用户',
        fieldName: '我的名字',
        fieldLanguage: '语言',
        fieldTimezone: '时区',
        rawIdentity: '显示「身份」节原文',
        hideRaw: '收起原文',
        preamble: '开头说明（preamble）',
        preambleHint: '文件顶部、第一个 `##` 之前的内容，原样保留。',
        sections: '分节',
        sectionsHint: '每个 `## 标题` 一节；用 ↑↓ 调整顺序，标题可改名，正文支持 Markdown。',
        search: '搜索标题或正文',
        addSection: '新增分节',
        newSectionPlaceholder: '分节标题，例如：边界',
        confirm: '确定',
        cancel: '取消',
        delete: '删除',
        deleteConfirm: '确认删除？',
        moveUp: '上移',
        moveDown: '下移',
        expand: '展开',
        collapse: '收起',
        sectionTitle: '标题',
        sectionBody: '正文',
        noSections: '还没有分节。点「新增分节」写下第一条规则。',
        noMatch: '没有匹配的分节。',
        emptyBody: '（空）',
        chars: '{n} 字符',
        duplicateTitle: '标题重复：保存会被拒绝，请改成唯一的标题。',
        emptyTitleWarn: '标题不能为空。',
        memory: '长期记忆',
        memoryHint: '跨会话保留的事实与约定。建议 20 条 / 2 KB 以内：只记「下次还会用到、文件里查不到」的东西。',
        memoryEntries: '{n} 条',
        memoryBytes: '{kb} KB',
        memoryWarnEntries: '条目偏多，建议精简',
        memoryWarnBytes: '体积偏大，建议精简',
        memoryList: '条目',
        memoryEmpty: '还没有条目。每条以「- 」开头。',
        addEntry: '新增一条',
        entryPlaceholder: '一句话事实，例如：2026-11-13 · 用户偏好中文回答 · 对话',
        removeEntry: '删除这条',
        rawMemory: '编辑全文',
        rawMemoryHint: '上面的条目列表与这里编辑的是同一份文本。',
        backupsFor: '{file} 的备份',
        backupHint: '每次保存前自动备份，最多保留 {n} 份。恢复会先把当前版本也备份一次。',
        noBackups: '还没有备份。',
        restore: '恢复',
        restoreConfirm: '确认恢复？',
        restoring: '恢复中…',
        latest: '最新',
        changelog: '最近改动',
        noChangelog: '还没有改动记录。',
        pointer: '常驻指针',
        pointerOk: '已注入，指向当前数据目录。',
        pointerStale: '已注入，但指向旧路径或块不完整——刷新一次即可。',
        pointerMissing: '还没有注入。缺了它，改完设置也不会被读到。',
        pointerDisabled: '配置里关掉了指针管理（pointer: false）。',
        pointerRefresh: '刷新指针',
        pointerRefreshing: '写入中…',
        pointerDetails: '详情',
        pointerBackups: 'AGENTS.md 备份',
        pointerEncoding: '编码',
        pointerPath: '文件',
        conflictTitle: '文件已被别处修改',
        conflictBody: '你读到的版本是 {expected}，现在是 {current}。你的草稿还在这一页。',
        conflictReload: '重新载入（丢弃我的改动）',
        conflictForce: '覆盖保存（用我的）',
        conflictForceConfirm: '确认覆盖？对方的版本会先被备份。',
        forceConfirm: '确认覆盖？',
        err_conflict: '文件已被别处修改，保存被拒绝。',
        err_file_too_large: '文件太大（{bytes} 字节，上限 {limit}）。',
        err_body_too_large: '请求体太大，保存被拒绝。',
        err_invalid_json: '请求格式不对（JSON 解析失败）。',
        err_cross_origin: '跨站请求被拒绝。',
        err_method_not_allowed: '请求方法不被允许。',
        err_unsupported_media_type: '请求类型必须是 application/json。',
        err_invalid_payload: '提交的内容不合法。',
        err_sections_not_array: '分节数据格式不对。',
        err_empty_title: '有一节的标题是空的。',
        err_multiline_title: '标题不能换行。',
        err_title_too_long: '标题太长（上限 {limit} 字符）。',
        err_duplicate_title: '标题重复：{title}。',
        err_too_many_sections: '分节太多（{count} 节，上限 {limit}）。',
        err_bad_section: '有一节的数据不完整。',
        err_bad_body: '正文必须是文本。',
        err_bad_preamble: '开头说明必须是文本。',
        err_text_required: '正文不能为空。',
        err_empty_file: '拒绝写入空文件。',
        err_expect_rev_required: '页面缺版本号，请刷新后重试。',
        err_unknown_file: '未知的文件。',
        err_invalid_backup_name: '备份名不合法。',
        err_backup_not_found: '备份不存在（可能已被清理）。',
        err_backup_too_large: '备份超过上限，不能恢复。',
        err_agents_encoding: 'AGENTS.md 不是 UTF-8/UTF-16，拒绝改写（宽松解码会写坏中文）。请用编辑器另存为 UTF-8。',
        err_agents_orphan_end: 'AGENTS.md 里有 SOUL:END 但没有 SOUL:BEGIN，先手动修好。',
        err_agents_too_large: 'AGENTS.md 太大，拒绝整份重写。',
        err_agents_read_failed: '读不了 AGENTS.md。',
        err_pointer_disabled: '配置里关掉了指针管理。',
        err_open_failed: '系统没能打开：{path}。',
        err_not_found: '找不到。',
        err_forbidden: '被拒绝。',
        err_too_large: '太大。',
        err_internal_error: '宿主内部错误。',
        err_network: '连不上宿主服务。',
        err_unknown: '操作失败。',
      },
      en: {
        title: 'Self layer',
        subtitle:
          'One profile shared by every conversation. Saving writes to the data directory with automatic backups; new conversations pick it up.',
        openDir: 'Open data folder',
        openAgents: 'Open AGENTS.md',
        loading: 'Loading…',
        readFail: 'Could not load',
        retry: 'Retry',
        tabsSelf: 'Profile',
        tabsMemory: 'Memory',
        tabsBackups: 'Backups',
        saved: 'Saved',
        dirty: 'Unsaved',
        save: 'Save',
        saveAll: 'Save all',
        saving: 'Saving…',
        cleanAll: 'Nothing to save',
        notEditable:
          'This file is larger than {kb} KB, so the page will not edit it — a body this large could not be saved back. Trim it by hand and reload.',
        movedFrom:
          'The data directory is now {dir}, but the old location {old} still has SELF.md. Nothing was migrated automatically (to avoid overwriting); copy it over if you want it.',
        readError: 'Cannot read {file}: {message}',
        seeded: 'Initialized from bundled templates: {files}',
        identity: 'Name and identity',
        identityHint:
          'How I address you, and what language I answer in. These inputs edit the field lines inside the “Identity” section; the raw box below edits the whole section.',
        fieldAddress: 'Address you as',
        fieldName: 'My name',
        fieldLanguage: 'Language',
        fieldTimezone: 'Time zone',
        rawIdentity: 'Show raw section',
        hideRaw: 'Hide raw section',
        preamble: 'Opening note (preamble)',
        preambleHint: 'Everything above the first `##`, preserved verbatim.',
        sections: 'Sections',
        sectionsHint: 'Each `## heading` is a section. Reorder with ↑↓, rename the heading, or edit the Markdown body.',
        search: 'Search titles and bodies',
        addSection: 'Add section',
        newSectionPlaceholder: 'Section title, e.g. Boundaries',
        confirm: 'Add',
        cancel: 'Cancel',
        delete: 'Delete',
        deleteConfirm: 'Really delete?',
        moveUp: 'Move up',
        moveDown: 'Move down',
        expand: 'Expand',
        collapse: 'Collapse',
        sectionTitle: 'Title',
        sectionBody: 'Body',
        noSections: 'No sections yet. Use “Add section” to write the first rule.',
        noMatch: 'No matching sections.',
        emptyBody: '(empty)',
        chars: '{n} characters',
        duplicateTitle: 'Duplicate title: saving would be rejected. Make it unique.',
        emptyTitleWarn: 'Title must not be empty.',
        memory: 'Long-term memory',
        memoryHint:
          'Facts and agreements that must survive across sessions. Keep it under ~20 entries / 2 KB: only what will be needed again and is not in the files.',
        memoryEntries: '{n} entries',
        memoryBytes: '{kb} KB',
        memoryWarnEntries: 'Many entries — consider trimming',
        memoryWarnBytes: 'Getting large — consider trimming',
        memoryList: 'Entries',
        memoryEmpty: 'No entries yet. Each starts with “- ”.',
        addEntry: 'Add entry',
        entryPlaceholder: 'One fact, e.g. 2026-11-13 · prefers Chinese replies · chat',
        removeEntry: 'Delete this entry',
        rawMemory: 'Edit full text',
        rawMemoryHint: 'The list above and this box edit the same text.',
        backupsFor: 'Backups of {file}',
        backupHint: 'One backup before every save, keeping the newest {n}. Restoring backs up the current version first.',
        noBackups: 'No backups yet.',
        restore: 'Restore',
        restoreConfirm: 'Really restore?',
        restoring: 'Restoring…',
        latest: 'newest',
        changelog: 'Recent changes',
        noChangelog: 'No changes recorded yet.',
        pointer: 'Always-on pointer',
        pointerOk: 'Injected and pointing at the current data directory.',
        pointerStale: 'Injected, but the block points at an old path or is incomplete — refresh it once.',
        pointerMissing: 'Not injected yet. Without it, changes here will never be read.',
        pointerDisabled: 'Pointer management is disabled in config (pointer: false).',
        pointerRefresh: 'Refresh pointer',
        pointerRefreshing: 'Writing…',
        pointerDetails: 'Details',
        pointerBackups: 'AGENTS.md backups',
        pointerEncoding: 'Encoding',
        pointerPath: 'File',
        conflictTitle: 'The file changed elsewhere',
        conflictBody: 'You read version {expected}, the file is now {current}. Your draft is still on this page.',
        conflictReload: 'Reload (discard mine)',
        conflictForce: 'Overwrite (keep mine)',
        conflictForceConfirm: 'Overwrite? The other version is backed up first.',
        forceConfirm: 'Really overwrite?',
        err_conflict: 'The file changed elsewhere; the save was rejected.',
        err_file_too_large: 'File too large ({bytes} bytes, limit {limit}).',
        err_body_too_large: 'Request body too large; nothing was written.',
        err_invalid_json: 'Malformed request (JSON parse failed).',
        err_cross_origin: 'Cross-origin request rejected.',
        err_method_not_allowed: 'Method not allowed.',
        err_unsupported_media_type: 'Content type must be application/json.',
        err_invalid_payload: 'The submitted content is invalid.',
        err_sections_not_array: 'Malformed sections payload.',
        err_empty_title: 'A section has an empty title.',
        err_multiline_title: 'A title contains a newline.',
        err_title_too_long: 'A title is too long (limit {limit} characters).',
        err_duplicate_title: 'Duplicate title: {title}.',
        err_too_many_sections: 'Too many sections ({count}, limit {limit}).',
        err_bad_section: 'A section is malformed.',
        err_bad_body: 'A body must be text.',
        err_bad_preamble: 'The opening note must be text.',
        err_text_required: 'The body must not be empty.',
        err_empty_file: 'Refusing to write an empty file.',
        err_expect_rev_required: 'The page is missing its version stamp; reload and retry.',
        err_unknown_file: 'Unknown file.',
        err_invalid_backup_name: 'Invalid backup name.',
        err_backup_not_found: 'Backup not found (it may have been pruned).',
        err_backup_too_large: 'Backup exceeds the size limit and cannot be restored.',
        err_agents_encoding:
          'AGENTS.md is not UTF-8/UTF-16, so rewriting it is refused (lossy decoding would corrupt it). Save it as UTF-8 in your editor.',
        err_agents_orphan_end: 'AGENTS.md has SOUL:END without SOUL:BEGIN; fix it by hand first.',
        err_agents_too_large: 'AGENTS.md is too large to rewrite as a whole.',
        err_agents_read_failed: 'Cannot read AGENTS.md.',
        err_pointer_disabled: 'Pointer management is disabled in config.',
        err_open_failed: 'The system could not open {path}.',
        err_not_found: 'Not found.',
        err_forbidden: 'Denied.',
        err_too_large: 'Too large.',
        err_internal_error: 'Internal host error.',
        err_network: 'Cannot reach the host service.',
        err_unknown: 'The operation failed.',
      },
    }

    const FALLBACK_LOCALE = 'zh'

    /**
     * 读宿主当前语言。locale 服务返回的是快照对象 { active, locales, revision }，
     * 不是字符串——直接 String() 会得到 "[object Object]"，于是永远判成英文。
     * @param {any} ctx
     * @returns {'zh' | 'en'}
     */
    function detectLocale(ctx) {
      try {
        const locale = ctx.get('locale')
        if (locale !== undefined && locale !== null && typeof locale.getLocale === 'function') {
          const snapshot = locale.getLocale()
          const active = snapshot !== null && typeof snapshot === 'object' ? snapshot.active : snapshot
          if (typeof active === 'string' && active !== '') return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        }
      } catch (error) {
        // 宿主没有 locale 服务时继续走浏览器语言
      }
      try {
        const text = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : ''
        return text.toLowerCase().startsWith('zh') ? 'zh' : text === '' ? FALLBACK_LOCALE : 'en'
      } catch (error) {
        return FALLBACK_LOCALE
      }
    }

    function makeT(lang) {
      const table = DICT[lang] || DICT[FALLBACK_LOCALE]
      return (key) => {
        const value = table[key]
        if (typeof value === 'string') return value
        const fallback = DICT[FALLBACK_LOCALE][key]
        return typeof fallback === 'string' ? fallback : key
      }
    }

    function fmt(text, vars) {
      if (vars === null || vars === undefined) return String(text)
      return String(text).replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== null && vars[name] !== undefined
          ? String(vars[name])
          : match,
      )
    }

    function errorText(t, error) {
      const code = error && error.code ? String(error.code) : 'unknown'
      const key = `err_${code}`
      const message = t(key)
      if (message === key) return (error && error.message) || t('err_unknown')
      return fmt(message, { ...(error && error.details ? error.details : {}), message: error && error.message })
    }

    // ── 纯函数 ──────────────────────────────────────────────────────────────
    const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    function fieldPattern(label) {
      return new RegExp(`^- \\*\\*${escapeRe(label)}\\*\\*[：:][ \\t]*(.*)$`, 'm')
    }

    function readField(body, label) {
      const match = fieldPattern(label).exec(String(body || ''))
      return match === null ? '' : match[1].trim()
    }

    /** 写一个字段行：有就替换，没有就追加；值为空则删掉该行。 */
    function writeField(body, label, value) {
      const source = String(body || '')
      const line = `- **${label}**：${value}`
      const pattern = fieldPattern(label)
      if (pattern.test(source)) {
        if (value.trim() === '') {
          return source
            .split('\n')
            .filter((row) => !fieldPattern(label).test(row))
            .join('\n')
        }
        return source.replace(pattern, () => line)
      }
      if (value.trim() === '') return source
      const trimmed = source.replace(/\s+$/, '')
      return trimmed === '' ? line : `${trimmed}\n${line}`
    }

    function identityIndex(sections) {
      return sections.findIndex((section) => section.title === IDENTITY)
    }

    function summaryOf(body, emptyLabel) {
      const first = String(body || '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '')
      if (first === undefined) return emptyLabel
      // 摘要只做阅读提示，把 Markdown 记号去掉，避免列表里出现 ** 或反引号。
      const plain = first
        .replace(/^[-*+]\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      return plain.length > 96 ? `${plain.slice(0, 96)}…` : plain
    }

    function serializeSelf(draft) {
      return JSON.stringify({ preamble: draft ? draft.preamble : '', sections: draft ? draft.sections : [] })
    }

    function kbOf(bytes) {
      return (Number(bytes || 0) / KB).toFixed(1)
    }

    function memoryBytes(text) {
      try {
        return new TextEncoder().encode(String(text || '')).length
      } catch (error) {
        return String(text || '').length
      }
    }

    function timeOf(ms) {
      if (!ms) return ''
      try {
        return new Date(ms).toLocaleString()
      } catch (error) {
        return ''
      }
    }

    function memoryLines(text) {
      const out = []
      const rows = String(text || '').split('\n')
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].trim().startsWith('- ')) out.push({ line: i, text: rows[i] })
      }
      return out
    }

    function removeLine(text, lineIndex) {
      const rows = String(text || '').split('\n')
      if (lineIndex < 0 || lineIndex >= rows.length) return text
      rows.splice(lineIndex, 1)
      return rows.join('\n')
    }

    function appendMemoryLine(text, value) {
      const entry = String(value || '').trim()
      if (entry === '') return text
      const body = String(text || '').replace(/\s+$/, '')
      return `${body}${body === '' ? '' : '\n'}- ${entry}\n`
    }

    async function api(path, body) {
      let response
      try {
        response = await fetch(`${API}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch (error) {
        throw { code: 'network', message: error && error.message ? error.message : 'network error' }
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (!response.ok || (payload !== null && payload.ok === false)) {
        throw payload !== null && typeof payload === 'object' ? payload : { code: 'unknown', message: `HTTP ${response.status}` }
      }
      return payload
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    const CSS = `
.dsl-root { display:flex; flex-direction:column; gap:12px; max-width:880px; color:var(--dsw-alias-label-primary); font-size:13px; line-height:1.55; }
.dsl-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.dsl-head__actions { display:flex; flex:0 0 auto; gap:8px; }
.dsl-head__meta { min-width:0; }
.dsl-title { margin:0; font-size:16px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsl-sub { margin:4px 0 0; max-width:56em; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsl-path { margin:2px 0 0; color:var(--dsw-alias-label-quaternary); font-size:11px; word-break:break-all; }
.dsl-card { display:flex; flex-direction:column; gap:10px; padding:14px 16px; background:var(--dsw-alias-settings-card-fill); border:.5px solid var(--dsw-alias-settings-card-stroke); border-radius:var(--dsw-radius-xl); }
.dsl-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dsl-row.between { justify-content:space-between; }
.dsl-h3 { margin:0; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsl-hint { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsl-meta { margin:0; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.dsl-btn { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; font:inherit; white-space:nowrap; color:var(--dsw-alias-label-primary); background:transparent; border:.5px solid var(--dsw-alias-border-l3); border-radius:7px; cursor:pointer; }
.dsl-btn:hover { background:var(--dsw-alias-bg-layer-2); }
.dsl-btn:focus-visible { outline:2px solid var(--dsw-alias-link); outline-offset:2px; }
.dsl-btn.primary { color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); border-color:transparent; }
.dsl-btn.primary:hover { background:var(--dsw-alias-button-primary-hover); }
.dsl-btn.primary:disabled { color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-bg-layer-2); border:.5px solid var(--dsw-alias-border-l2); opacity:1; cursor:default; }
.dsl-btn.danger { color:var(--dsw-alias-label-error); }
.dsl-btn.ghost { border-color:transparent; padding:3px 6px; }
.dsl-btn[disabled] { opacity:.6; cursor:default; }
.dsl-input,.dsl-textarea { width:100%; box-sizing:border-box; padding:6px 8px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); border:.5px solid var(--dsw-alias-border-l2); border-radius:7px; }
.dsl-input:focus,.dsl-textarea:focus { outline:2px solid var(--dsw-alias-link); outline-offset:0; }
.dsl-textarea { min-height:88px; resize:vertical; line-height:1.5; }
.dsl-textarea.tall { min-height:180px; }
.dsl-field { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsl-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
.dsl-tabs { display:flex; gap:2px; border-bottom:.5px solid var(--dsw-alias-separator-primary); }
.dsl-tab { padding:7px 10px; font:inherit; color:var(--dsw-alias-label-secondary); background:none; border:none; border-bottom:2px solid transparent; cursor:pointer; }
.dsl-tab:hover { color:var(--dsw-alias-label-primary); }
.dsl-tab:focus-visible { outline:2px solid var(--dsw-alias-link); outline-offset:-2px; }
.dsl-tab[aria-selected="true"] { color:var(--dsw-alias-label-primary); border-bottom-color:var(--dsw-alias-link); }
.dsl-statusbar { position:sticky; top:0; z-index:3; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; background:var(--dsw-alias-bg-layer-1); border:.5px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-xl); }
.dsl-statusbar .grow { flex:1; }
.dsl-chip { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; font-size:12px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); border-radius:999px; }
.dsl-dot { width:6px; height:6px; border-radius:50%; background:var(--dsw-alias-label-quaternary); }
.dsl-dot.on { background:var(--dsw-alias-state-warn-primary); }
.dsl-banner { display:flex; flex-direction:column; gap:8px; padding:10px 12px; border:.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-xl); background:var(--dsw-alias-bg-layer-2); }
.dsl-banner.error { border-color:var(--dsw-alias-label-error); }
.dsl-banner.warn { border-color:var(--dsw-alias-state-warn-primary); }
.dsl-banner .dsl-h3 { color:inherit; }
.dsl-banner.error .dsl-h3 { color:var(--dsw-alias-label-error); }
.dsl-banner.warn .dsl-h3 { color:var(--dsw-alias-state-warn-label); }
.dsl-sec { border:.5px solid var(--dsw-alias-border-l1); border-radius:10px; overflow:hidden; }
.dsl-sec + .dsl-sec { margin-top:6px; }
.dsl-sec-head { display:flex; align-items:center; gap:6px; padding:2px 4px 2px 0; }
.dsl-sec-toggle { display:flex; align-items:center; gap:8px; flex:1; min-width:0; padding:7px 10px; font:inherit; text-align:left; color:var(--dsw-alias-label-primary); background:none; border:none; cursor:pointer; }
.dsl-sec-toggle:hover { background:var(--dsw-alias-bg-layer-2); }
.dsl-sec-toggle:focus-visible { outline:2px solid var(--dsw-alias-link); outline-offset:-2px; }
.dsl-caret { width:0; height:0; border-left:5px solid currentColor; border-top:4px solid transparent; border-bottom:4px solid transparent; transition:transform .12s ease; opacity:.65; }
.dsl-sec-toggle[aria-expanded="true"] .dsl-caret { transform:rotate(90deg); }
.dsl-sec-title { font-weight:500; white-space:nowrap; }
.dsl-sec-summary { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsl-sec-actions { display:flex; gap:2px; }
.dsl-sec-body { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; border-top:.5px solid var(--dsw-alias-separator-primary); }
.dsl-pointer { display:flex; align-items:center; gap:8px; padding:8px 12px; border:.5px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-xl); background:var(--dsw-alias-bg-layer-1); }
.dsl-pointer.warn { border-color:var(--dsw-alias-state-warn-primary); }
.dsl-pointer.error { border-color:var(--dsw-alias-label-error); }
.dsl-pointer .grow { flex:1; min-width:0; }
.dsl-backup-row { display:flex; align-items:center; gap:8px; padding:6px 0; border-top:.5px solid var(--dsw-alias-separator-primary); }
.dsl-backup-row:first-of-type { border-top:none; }
.dsl-backup-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsl-list { display:flex; flex-direction:column; gap:6px; }
.dsl-warn { margin:0; color:var(--dsw-alias-state-warn-label); font-size:12px; }
.dsl-empty { margin:0; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsl-clog { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:2px; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; color:var(--dsw-alias-label-tertiary); }
@media (max-width:640px) { .dsl-head { flex-direction:column; } }
`

    let styleInjected = false
    function ensureStyle() {
      if (styleInjected || typeof document === 'undefined') return
      styleInjected = true
      if (document.getElementById('dsh-self-layer-style') !== null) return
      const element = document.createElement('style')
      element.id = 'dsh-self-layer-style'
      element.textContent = CSS
      document.head.appendChild(element)
    }

    // ── 组件 ────────────────────────────────────────────────────────────────
    function SelfLayerPage(props) {
      const ctx = props.ctx
      ensureStyle()

      const [lang, setLang] = useState(() => detectLocale(ctx))
      const t = useMemo(() => makeT(lang), [lang])

      const [payload, setPayload] = useState(null)
      const [revs, setRevs] = useState({ SELF: 'absent', MEMORY: 'absent', AGENTS: 'absent' })
      const [draft, setDraft] = useState(null)
      const [saved, setSaved] = useState({ SELF: '', MEMORY: '' })
      const [phase, setPhase] = useState('loading')
      const [loadError, setLoadError] = useState(null)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)
      const [conflict, setConflict] = useState(null)
      const [tab, setTab] = useState('self')
      const [query, setQuery] = useState('')
      const [expanded, setExpanded] = useState({})
      const [identityRaw, setIdentityRaw] = useState(false)
      const [preambleOpen, setPreambleOpen] = useState(false)
      const [adding, setAdding] = useState(false)
      const [newTitle, setNewTitle] = useState('')
      const [pendingDelete, setPendingDelete] = useState(null)
      const [asksRestore, setAsksRestore] = useState(null)
      const [asksForce, setAsksForce] = useState(false)
      const [pointerOpen, setPointerOpen] = useState(false)
      const [entryInput, setEntryInput] = useState('')
      const bodyRefs = useRef({})
      const addRef = useRef(null)
      const noticeRef = useRef(null)

      const dirtySelf = draft !== null && serializeSelf(draft.self) !== saved.SELF
      const dirtyMemory = draft !== null && draft.memory !== saved.MEMORY
      const dirtyAny = dirtySelf || dirtyMemory

      const adopt = useCallback(
        (next, adoptKeys) => {
          const selfDirty = draft !== null && serializeSelf(draft.self) !== saved.SELF
          const memoryDirty = draft !== null && draft.memory !== saved.MEMORY
          const keepSelf = selfDirty && !adoptKeys.includes('SELF')
          const keepMemory = memoryDirty && !adoptKeys.includes('MEMORY')
          const nextSelf = { preamble: next.self.preamble, sections: next.self.sections.map((section) => ({ ...section })) }
          setDraft((current) => {
            if (current === null) return { self: nextSelf, memory: next.files.MEMORY.text }
            return {
              self: keepSelf ? current.self : nextSelf,
              memory: keepMemory ? current.memory : next.files.MEMORY.text,
            }
          })
          setSaved((current) => ({
            SELF: keepSelf ? current.SELF : serializeSelf(nextSelf),
            MEMORY: keepMemory ? current.MEMORY : next.files.MEMORY.text,
          }))
          setPayload(next)
          setRevs((current) => ({
            ...next.revs,
            SELF: keepSelf ? current.SELF : next.revs.SELF,
            MEMORY: keepMemory ? current.MEMORY : next.revs.MEMORY,
          }))
        },
        [draft, saved],
      )

      const load = useCallback(
        async (adoptKeys = []) => {
          const next = await api('/read')
          adopt(next, adoptKeys)
          setPhase('ready')
          setLoadError(null)
          return next
        },
        [adopt],
      )

      useEffect(() => {
        let alive = true
        load([])
          .then((next) => {
            if (!alive) return
            setPointerOpen(!next.pointer.present || next.pointer.stale || next.pointer.undecodable === true)
          })
          .catch((error) => {
            if (!alive) return
            setPhase('error')
            setLoadError(error)
          })
        return () => {
          alive = false
        }
        // 只在挂载时读一次；后续刷新由各操作显式触发
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        const locale = ctx.get('locale')
        if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
        const update = () => setLang(detectLocale(ctx))
        const dispose = locale.subscribe(update)
        return typeof dispose === 'function' ? dispose : undefined
      }, [ctx])

      useEffect(() => {
        if (!dirtyAny) return undefined
        const guard = (event) => {
          event.preventDefault()
          event.returnValue = ''
        }
        window.addEventListener('beforeunload', guard)
        return () => window.removeEventListener('beforeunload', guard)
      }, [dirtyAny])

      useEffect(() => {
        if (pendingDelete === null) return undefined
        const timer = window.setTimeout(() => setPendingDelete(null), 4000)
        return () => window.clearTimeout(timer)
      }, [pendingDelete])

      useEffect(() => {
        if (notice !== null) noticeRef.current?.focus?.()
      }, [notice])

      const sections = draft !== null ? draft.self.sections : []
      const identityAt = identityIndex(sections)
      const identityBody = identityAt >= 0 ? sections[identityAt].body : ''
      const fields = {}
      for (const label of QUICK_FIELDS) fields[label] = readField(identityBody, label)

      const titleCounts = useMemo(() => {
        const counts = new Map()
        for (const section of sections) {
          const key = section.title.trim()
          counts.set(key, (counts.get(key) || 0) + 1)
        }
        return counts
      }, [sections])

      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return sections
          .map((section, index) => ({ section, index }))
          .filter(({ section }) => {
            if (needle === '') return true
            return `${section.title}\n${section.body}`.toLowerCase().includes(needle)
          })
      }, [sections, query])

      const updateSection = (index, patch) => {
        setDraft((current) => {
          if (current === null) return current
          const next = current.self.sections.slice()
          next[index] = { ...next[index], ...patch }
          return { ...current, self: { ...current.self, sections: next } }
        })
      }

      const writeIdentity = (label, value) => {
        setDraft((current) => {
          if (current === null) return current
          const list = current.self.sections.slice()
          const at = identityIndex(list)
          if (at < 0) {
            if (value.trim() === '') return current
            const line = `- **${label}**：${value}`
            list.unshift({ title: IDENTITY, body: line })
            return { ...current, self: { ...current.self, sections: list } }
          }
          list[at] = { ...list[at], body: writeField(list[at].body, label, value) }
          return { ...current, self: { ...current.self, sections: list } }
        })
      }

      const moveSection = (index, delta) => {
        const target = index + delta
        if (target < 0 || target >= sections.length) return
        setDraft((current) => {
          if (current === null) return current
          const list = current.self.sections.slice()
          const item = list[index]
          list[index] = list[target]
          list[target] = item
          return { ...current, self: { ...current.self, sections: list } }
        })
        setExpanded((current) => ({ ...current, [index]: current[target], [target]: current[index] }))
      }

      const removeSection = (index) => {
        setDraft((current) => {
          if (current === null) return current
          const list = current.self.sections.slice()
          list.splice(index, 1)
          return { ...current, self: { ...current.self, sections: list } }
        })
        setPendingDelete(null)
      }

      const confirmAdd = () => {
        const title = newTitle.trim()
        if (title === '') {
          setNotice({ tone: 'error', text: t('emptyTitleWarn') })
          addRef.current?.focus?.()
          return
        }
        if (titleCounts.get(title)) {
          setNotice({ tone: 'error', text: fmt(t('duplicateTitle'), { title }) })
          addRef.current?.focus?.()
          return
        }
        const index = sections.length
        setDraft((current) => {
          if (current === null) return current
          return {
            ...current,
            self: { ...current.self, sections: [...current.self.sections, { title, body: '' }] },
          }
        })
        setExpanded((current) => ({ ...current, [index]: true }))
        setAdding(false)
        setNewTitle('')
        setNotice(null)
        window.requestAnimationFrame(() => bodyRefs.current[index]?.focus?.())
      }

      const saveFile = async (file, force) => {
        setBusy(`save:${file}`)
        setNotice(null)
        try {
          const body =
            file === 'SELF'
              ? { file: 'SELF', preamble: draft.self.preamble, sections: draft.self.sections, expectRev: revs.SELF, force: force === true }
              : { file: 'MEMORY', text: draft.memory, expectRev: revs.MEMORY, force: force === true }
          const result = await api('/write', body)
          setSaved((current) => ({ ...current, [file]: file === 'SELF' ? serializeSelf(draft.self) : draft.memory }))
          setRevs((current) => ({ ...current, [file]: result.rev }))
          setNotice({ tone: 'ok', text: t('saved') })
          setConflict(null)
          setAsksForce(false)
          await load([file])
        } catch (error) {
          if (error && error.code === 'conflict') {
            setConflict({ file, current: error.details ? error.details.current : '', expected: error.details ? error.details.expected : '' })
          }
          setNotice({ tone: 'error', text: errorText(t, error) })
        } finally {
          setBusy('')
        }
      }

      const saveAll = async () => {
        if (dirtySelf) await saveFile('SELF')
        if (dirtyMemory) await saveFile('MEMORY')
      }

      const applyPointer = async () => {
        setBusy('pointer')
        setNotice(null)
        try {
          await api('/pointer', {})
          await load([])
          setNotice({ tone: 'ok', text: t('pointerOk') })
          setPointerOpen(false)
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(t, error) })
          setPointerOpen(true)
        } finally {
          setBusy('')
        }
      }

      const doRestore = async (key, name) => {
        setBusy(`restore:${key}`)
        setNotice(null)
        try {
          const expectRev = key === 'AGENTS' ? revs.AGENTS : revs[key]
          await api('/restore', { file: key, backup: name, expectRev })
          await load([key])
          setAsksRestore(null)
          setNotice({ tone: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(t, error) })
        } finally {
          setBusy('')
        }
      }

      const openFile = async (file) => {
        setNotice(null)
        try {
          await api('/open', { file })
        } catch (error) {
          setNotice({ tone: 'error', text: errorText(t, error) })
        }
      }

      const addEntry = () => {
        const value = entryInput.trim()
        if (value === '') return
        setDraft((current) => (current === null ? current : { ...current, memory: appendMemoryLine(current.memory, value) }))
        setEntryInput('')
      }

      // ── 渲染辅助 ──────────────────────────────────────────────────────────
      const noticeBox =
        notice === null
          ? null
          : h(
              'div',
              {
                ref: noticeRef,
                tabIndex: -1,
                role: 'status',
                'aria-live': 'polite',
                className: `dsl-banner ${notice.tone === 'error' ? 'error' : notice.tone === 'warn' ? 'warn' : ''}`,
              },
              h('p', { className: 'dsl-hint' }, notice.text),
            )

      const conflictBox =
        conflict === null
          ? null
          : h(
              'div',
              { className: 'dsl-banner warn', role: 'alert' },
              h('h3', { className: 'dsl-h3' }, t('conflictTitle')),
              h('p', { className: 'dsl-hint' }, fmt(t('conflictBody'), { expected: conflict.expected, current: conflict.current })),
              h(
                'div',
                { className: 'dsl-row' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsl-btn',
                    onClick: async () => {
                      setBusy('reload')
                      try {
                        await load([conflict.file])
                        setConflict(null)
                        setNotice({ tone: 'ok', text: t('saved') })
                      } catch (error) {
                        setNotice({ tone: 'error', text: errorText(t, error) })
                      } finally {
                        setBusy('')
                      }
                    },
                  },
                  t('conflictReload'),
                ),
                asksForce
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsl-btn danger',
                        onClick: () => saveFile(conflict.file, true),
                        disabled: busy !== '',
                      },
                      t('conflictForceConfirm'),
                    )
                  : h(
                      'button',
                      { type: 'button', className: 'dsl-btn danger', onClick: () => setAsksForce(true) },
                      t('conflictForce'),
                    ),
              ),
            )

      const statusbar =
        draft === null
          ? null
          : h(
              'div',
              { className: 'dsl-statusbar' },
              h('span', { className: 'dsl-chip' }, h('span', { className: `dsl-dot ${dirtySelf ? 'on' : ''}` }), `SELF.md · ${dirtySelf ? t('dirty') : t('saved')}`),
              h('span', { className: 'dsl-chip' }, h('span', { className: `dsl-dot ${dirtyMemory ? 'on' : ''}` }), `MEMORY.md · ${dirtyMemory ? t('dirty') : t('saved')}`),
              h('span', { className: 'grow' }),
              h(
                'button',
                { type: 'button', className: 'dsl-btn primary', disabled: !dirtyAny || busy !== '', onClick: saveAll },
                busy.startsWith('save:') ? t('saving') : t('saveAll'),
              ),
            )

      const identityCard = (() => {
        if (draft === null) return null
        const warnings = []
        if (sections.some((section) => section.title.trim() === '')) warnings.push(t('emptyTitleWarn'))
        const duplicates = [...titleCounts.entries()].filter(([, count]) => count > 1).map(([title]) => title)
        if (duplicates.length > 0) warnings.push(fmt(t('duplicateTitle'), { title: duplicates.join(', ') }))
        return h(
          'section',
          { className: 'dsl-card', 'aria-labelledby': 'dsl-identity-title' },
          h('h3', { className: 'dsl-h3', id: 'dsl-identity-title' }, t('identity')),
          h('p', { className: 'dsl-hint' }, t('identityHint')),
          h(
            'div',
            { className: 'dsl-grid' },
            ...QUICK_FIELDS.map((label) =>
              h(
                'label',
                { className: 'dsl-field', key: label },
                h('span', {}, label === '称呼用户' ? t('fieldAddress') : label === '名字' ? t('fieldName') : label === '语言' ? t('fieldLanguage') : t('fieldTimezone')),
                h('input', {
                  className: 'dsl-input',
                  value: fields[label],
                  list: label === '语言' ? 'dsl-language-presets' : label === '时区' ? 'dsl-timezone-presets' : undefined,
                  onChange: (event) => writeIdentity(label, inputValue(event)),
                }),
              ),
            ),
          ),
          h('datalist', { id: 'dsl-language-presets' }, ...(payload.presets.language || []).map((value) => h('option', { key: value, value }))),
          h('datalist', { id: 'dsl-timezone-presets' }, ...(payload.presets.timezone || []).map((value) => h('option', { key: value, value }))),
          identityAt < 0
            ? h('p', { className: 'dsl-meta' }, t('noSections'))
            : h(
                'div',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsl-btn ghost',
                    'aria-expanded': identityRaw,
                    onClick: () => setIdentityRaw((value) => !value),
                  },
                  identityRaw ? t('hideRaw') : t('rawIdentity'),
                ),
                identityRaw
                  ? h('textarea', {
                      className: 'dsl-textarea',
                      'aria-label': t('identity'),
                      value: identityBody,
                      onChange: (event) => updateSection(identityAt, { body: inputValue(event) }),
                    })
                  : null,
              ),
          ...warnings.map((text, index) => h('p', { className: 'dsl-warn', key: `warn-${index}` }, text)),
        )
      })()

      const preambleCard =
        draft === null
          ? null
          : h(
              'section',
              { className: 'dsl-card' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsl-btn ghost',
                  'aria-expanded': preambleOpen,
                  onClick: () => setPreambleOpen((value) => !value),
                },
                `${preambleOpen ? '▾' : '▸'} ${t('preamble')}`,
              ),
              preambleOpen
                ? h(react.Fragment, null, h('p', { className: 'dsl-hint' }, t('preambleHint')), h('textarea', {
                    className: 'dsl-textarea',
                    'aria-label': t('preamble'),
                    value: draft.self.preamble,
                    onChange: (event) =>
                      setDraft((current) => (current === null ? current : { ...current, self: { ...current.self, preamble: inputValue(event) } })),
                  }))
                : null,
            )

      const sectionsCard =
        draft === null
          ? null
          : h(
              'section',
              { className: 'dsl-card', 'aria-labelledby': 'dsl-sections-title' },
              h(
                'div',
                { className: 'dsl-row between' },
                h('h3', { className: 'dsl-h3', id: 'dsl-sections-title' }, `${t('sections')} · ${sections.length}`),
                h(
                  'div',
                  { className: 'dsl-row' },
                  h('input', {
                    className: 'dsl-input',
                    style: { width: '180px' },
                    placeholder: t('search'),
                    'aria-label': t('search'),
                    value: query,
                    onChange: (event) => setQuery(inputValue(event)),
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsl-btn',
                      onClick: () => {
                        setAdding(true)
                        window.requestAnimationFrame(() => addRef.current?.focus?.())
                      },
                      'aria-expanded': adding,
                    },
                    `+ ${t('addSection')}`,
                  ),
                ),
              ),
              h('p', { className: 'dsl-hint' }, t('sectionsHint')),
              adding
                ? h(
                    'div',
                    { className: 'dsl-row' },
                    h('input', {
                      ref: addRef,
                      className: 'dsl-input',
                      placeholder: t('newSectionPlaceholder'),
                      'aria-label': t('newSectionPlaceholder'),
                      value: newTitle,
                      onChange: (event) => setNewTitle(inputValue(event)),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          confirmAdd()
                        } else if (event.key === 'Escape') {
                          setAdding(false)
                          setNewTitle('')
                        }
                      },
                    }),
                    h('button', { type: 'button', className: 'dsl-btn primary', onClick: confirmAdd }, t('confirm')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsl-btn',
                        onClick: () => {
                          setAdding(false)
                          setNewTitle('')
                        },
                      },
                      t('cancel'),
                    ),
                  )
                : null,
              h(
                'div',
                { className: 'dsl-list' },
                ...visible.map(({ section, index }) => {
                  const open = expanded[index] === true
                  const titleId = `dsl-sec-${index}-title`
                  const bodyId = `dsl-sec-${index}-body`
                  const duplicate = (titleCounts.get(section.title.trim()) || 0) > 1
                  return h(
                    'div',
                    { className: 'dsl-sec', key: index },
                    h(
                      'div',
                      { className: 'dsl-sec-head' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsl-sec-toggle',
                          'aria-expanded': open,
                          'aria-controls': bodyId,
                          onClick: () => setExpanded((current) => ({ ...current, [index]: !open })),
                        },
                        h('span', { className: 'dsl-caret', 'aria-hidden': 'true' }),
                        h('span', { className: 'dsl-sec-title', id: titleId }, section.title || t('emptyBody')),
                        h('span', { className: 'dsl-sec-summary' }, summaryOf(section.body, t('emptyBody'))),
                      ),
                      h(
                        'div',
                        { className: 'dsl-sec-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsl-btn ghost',
                            'aria-label': t('moveUp'),
                            title: t('moveUp'),
                            disabled: index === 0 || query !== '',
                            onClick: () => moveSection(index, -1),
                          },
                          '↑',
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsl-btn ghost',
                            'aria-label': t('moveDown'),
                            title: t('moveDown'),
                            disabled: index === sections.length - 1 || query !== '',
                            onClick: () => moveSection(index, 1),
                          },
                          '↓',
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsl-btn ghost danger',
                            'aria-label': t('delete'),
                            onClick: () => (pendingDelete === index ? removeSection(index) : setPendingDelete(index)),
                          },
                          pendingDelete === index ? t('deleteConfirm') : '✕',
                        ),
                      ),
                    ),
                    open
                      ? h(
                          'div',
                          { className: 'dsl-sec-body', id: bodyId, role: 'group', 'aria-labelledby': titleId },
                          h(
                            'label',
                            { className: 'dsl-field' },
                            h('span', {}, t('sectionTitle')),
                            h('input', {
                              className: 'dsl-input',
                              value: section.title,
                              onChange: (event) => updateSection(index, { title: inputValue(event) }),
                              'aria-labelledby': titleId,
                            }),
                          ),
                          duplicate ? h('p', { className: 'dsl-warn' }, t('duplicateTitle')) : null,
                          h('textarea', {
                            ref: (node) => {
                              bodyRefs.current[index] = node
                            },
                            className: 'dsl-textarea',
                            'aria-labelledby': titleId,
                            value: section.body,
                            onChange: (event) => updateSection(index, { body: inputValue(event) }),
                          }),
                          h('p', { className: 'dsl-meta' }, fmt(t('chars'), { n: section.body.length })),
                        )
                      : null,
                  )
                }),
              ),
              visible.length === 0
                ? h('p', { className: 'dsl-empty' }, query === '' ? t('noSections') : t('noMatch'))
                : null,
            )

      const pointerRow = (() => {
        if (payload === null) return null
        const pointer = payload.pointer
        const tone = pointer.enabled === false ? 'warn' : pointer.undecodable || pointer.tooLarge ? 'error' : !pointer.present || pointer.stale ? 'warn' : ''
        const label =
          pointer.enabled === false
            ? t('pointerDisabled')
            : pointer.undecodable === true
              ? t('err_agents_encoding')
              : pointer.tooLarge === true
                ? t('err_agents_too_large')
                : !pointer.present
                  ? fmt(t('pointerMissing'), {})
                  : pointer.stale
                    ? t('pointerStale')
                    : t('pointerOk')
        return h(
          'div',
          { className: `dsl-pointer ${tone}` },
          h('span', { className: `dsl-dot ${pointer.present && !pointer.stale ? '' : 'on'}` }),
          h('span', { className: 'grow' }, label),
          h(
            'button',
            {
              type: 'button',
              className: 'dsl-btn ghost',
              'aria-expanded': pointerOpen,
              onClick: () => setPointerOpen((value) => !value),
            },
            t('pointerDetails'),
          ),
          h(
            'button',
            { type: 'button', className: 'dsl-btn ghost', onClick: () => openFile('AGENTS') },
            t('openAgents'),
          ),
        )
      })()

      const pointerPanel = (() => {
        if (payload === null || !pointerOpen) return null
        const pointer = payload.pointer
        return h(
          'section',
          { className: 'dsl-card' },
          h('h3', { className: 'dsl-h3' }, t('pointer')),
          h('p', { className: 'dsl-meta' }, `${t('pointerPath')}：${pointer.path}`),
          h('p', { className: 'dsl-meta' }, `${t('pointerEncoding')}：${pointer.encoding || '—'} · ${kbOf(pointer.bytes)} KB`),
          payload.movedFrom !== null
            ? h('p', { className: 'dsl-warn' }, fmt(t('movedFrom'), { dir: payload.dir, old: payload.movedFrom }))
            : null,
          h(
            'div',
            { className: 'dsl-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsl-btn primary',
                disabled: pointer.enabled === false || busy !== '',
                onClick: applyPointer,
              },
              busy === 'pointer' ? t('pointerRefreshing') : t('pointerRefresh'),
            ),
            h('button', { type: 'button', className: 'dsl-btn', onClick: () => openFile('AGENTS') }, t('openAgents')),
          ),
          h('p', { className: 'dsl-hint' }, t('pointerBackups')),
          pointer.backups.length === 0
            ? h('p', { className: 'dsl-empty' }, t('noBackups'))
            : h(
                'div',
                {},
                ...pointer.backups.slice(0, 5).map((backup) =>
                  h(
                    'div',
                    { className: 'dsl-backup-row', key: backup.name },
                    h('span', { className: 'dsl-backup-name' }, `${timeOf(backup.at)} · ${kbOf(backup.bytes)} KB`),
                    asksRestore !== null && asksRestore.key === 'AGENTS' && asksRestore.name === backup.name
                      ? h(
                          'button',
                          { type: 'button', className: 'dsl-btn danger', onClick: () => doRestore('AGENTS', backup.name), disabled: busy !== '' },
                          t('restoreConfirm'),
                        )
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsl-btn',
                            onClick: () => setAsksRestore({ key: 'AGENTS', name: backup.name }),
                          },
                          t('restore'),
                        ),
                  ),
                ),
              ),
        )
      })()

      const memoryPane = (() => {
        if (draft === null) return null
        const file = payload.files.MEMORY
        const entries = memoryLines(draft.memory)
        const bytes = memoryBytes(draft.memory)
        const warnEntries = entries.length > 20
        const warnBytes = bytes > 2048
        return h(
          'div',
          { className: 'dsl-list' },
          h(
            'section',
            { className: 'dsl-card', 'aria-labelledby': 'dsl-memory-title' },
            h(
              'div',
              { className: 'dsl-row between' },
              h('h3', { className: 'dsl-h3', id: 'dsl-memory-title' }, t('memory')),
              h(
                'span',
                { className: `dsl-meta ${warnEntries ? 'dsl-warn' : ''}` },
                `${fmt(t('memoryEntries'), { n: entries.length })} · ${fmt(t('memoryBytes'), { kb: kbOf(bytes) })}${warnEntries ? ` · ${t('memoryWarnEntries')}` : ''}${warnBytes ? ` · ${t('memoryWarnBytes')}` : ''}`,
              ),
            ),
            h('p', { className: 'dsl-hint' }, t('memoryHint')),
            h(react.Fragment, null,
              h(
                'div',
                { className: 'dsl-row' },
                h('input', {
                  className: 'dsl-input',
                  placeholder: t('entryPlaceholder'),
                  'aria-label': t('entryPlaceholder'),
                  value: entryInput,
                  onChange: (event) => setEntryInput(inputValue(event)),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addEntry()
                    }
                  },
                }),
                h('button', { type: 'button', className: 'dsl-btn', onClick: addEntry }, `+ ${t('addEntry')}`),
              ),
            ),
            h('p', { className: 'dsl-h3' }, t('memoryList')),
            entries.length === 0
              ? h('p', { className: 'dsl-empty' }, t('memoryEmpty'))
              : h(
                  'div',
                  { className: 'dsl-list' },
                  ...entries.map((entry) =>
                    h(
                      'div',
                      { className: 'dsl-backup-row', key: entry.line },
                      h('span', { className: 'dsl-backup-name' }, entry.text),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsl-btn ghost danger',
                          'aria-label': t('removeEntry'),
                          onClick: () =>
                            setDraft((current) => (current === null ? current : { ...current, memory: removeLine(current.memory, entry.line) })),
                        },
                        '✕',
                      ),
                    ),
                  ),
                ),
          ),
          h(
            'section',
            { className: 'dsl-card', 'aria-labelledby': 'dsl-memory-raw' },
            h('h3', { className: 'dsl-h3', id: 'dsl-memory-raw' }, t('rawMemory')),
            h('p', { className: 'dsl-hint' }, t('rawMemoryHint')),
            file.tooLarge
              ? h('p', { className: 'dsl-warn' }, fmt(t('notEditable'), { kb: Math.round(payload.limits.fileBytes / KB) }))
              : h('textarea', {
                  className: 'dsl-textarea tall',
                  'aria-labelledby': 'dsl-memory-raw',
                  value: draft.memory,
                  onChange: (event) => setDraft((current) => (current === null ? current : { ...current, memory: inputValue(event) })),
                }),
            h('p', { className: 'dsl-meta' }, `${payload.files.MEMORY.path} · ${kbOf(file.bytes)} KB`),
          ),
        )
      })()

      const backupsPane = (() => {
        if (payload === null) return null
        const card = (file) =>
          h(
            'section',
            { className: 'dsl-card', key: file },
            h('h3', { className: 'dsl-h3' }, fmt(t('backupsFor'), { file: `${file}.md` })),
            h('p', { className: 'dsl-hint' }, fmt(t('backupHint'), { n: payload.limits.backupKeep })),
            payload.backups[file].length === 0
              ? h('p', { className: 'dsl-empty' }, t('noBackups'))
              : h(
                  'div',
                  {},
                  ...payload.backups[file].map((backup, index) =>
                    h(
                      'div',
                      { className: 'dsl-backup-row', key: backup.name },
                      h('span', { className: 'dsl-backup-name' }, `${index === 0 ? `${t('latest')} · ` : ''}${timeOf(backup.at)} · ${kbOf(backup.bytes)} KB`),
                      asksRestore !== null && asksRestore.key === file && asksRestore.name === backup.name
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsl-btn danger',
                              disabled: busy !== '',
                              onClick: () => doRestore(file, backup.name),
                            },
                            t('restoreConfirm'),
                          )
                        : h(
                            'button',
                            { type: 'button', className: 'dsl-btn', onClick: () => setAsksRestore({ key: file, name: backup.name }) },
                            t('restore'),
                          ),
                    ),
                  ),
                ),
          )
        return h(
          'div',
          { className: 'dsl-list' },
          card('SELF'),
          card('MEMORY'),
          h(
            'section',
            { className: 'dsl-card' },
            h('h3', { className: 'dsl-h3' }, t('changelog')),
            payload.changelog.length === 0
              ? h('p', { className: 'dsl-empty' }, t('noChangelog'))
              : h('ul', { className: 'dsl-clog' }, ...payload.changelog.map((line, index) => h('li', { key: index }, line))),
            h('p', { className: 'dsl-meta' }, payload.dirs.data),
            h(
              'div',
              { className: 'dsl-row' },
              h('button', { type: 'button', className: 'dsl-btn', onClick: () => openFile('DIR') }, t('openDir')),
            ),
          ),
        )
      })()

      const body = (() => {
        if (phase === 'loading') return h('p', { className: 'dsl-hint' }, t('loading'))
        if (phase === 'error') {
          return h(
            'div',
            { className: 'dsl-banner error', role: 'alert' },
            h('h3', { className: 'dsl-h3' }, t('readFail')),
            h('p', { className: 'dsl-hint' }, errorText(t, loadError)),
            h(
              'div',
              { className: 'dsl-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsl-btn primary',
                  onClick: async () => {
                    setPhase('loading')
                    try {
                      await load([])
                    } catch (error) {
                      setPhase('error')
                      setLoadError(error)
                    }
                  },
                },
                t('retry'),
              ),
            ),
          )
        }
        if (draft === null) return null
        const tooLarge = payload.files.SELF.tooLarge || payload.files.MEMORY.tooLarge
        return h(
          react.Fragment,
          null,
          noticeBox,
          conflictBox,
          statusbar,
          pointerRow,
          pointerPanel,
          tooLarge
            ? h(
                'div',
                { className: 'dsl-banner warn', role: 'alert' },
                h('p', { className: 'dsl-hint' }, fmt(t('notEditable'), { kb: Math.round(payload.limits.fileBytes / KB) })),
              )
            : null,
          h(
            'nav',
            { className: 'dsl-tabs', role: 'tablist', 'aria-label': t('title') },
            ...[
              ['self', t('tabsSelf')],
              ['memory', t('tabsMemory')],
              ['backups', t('tabsBackups')],
            ].map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'tab',
                  id: `dsl-tab-${key}`,
                  'aria-selected': tab === key,
                  'aria-controls': `dsl-panel-${key}`,
                  className: 'dsl-tab',
                  onClick: () => setTab(key),
                },
                label,
                key === 'self' && dirtySelf ? ' •' : '',
                key === 'memory' && dirtyMemory ? ' •' : '',
              ),
            ),
          ),
          h(
            'div',
            { role: 'tabpanel', id: 'dsl-panel-self', 'aria-labelledby': 'dsl-tab-self', hidden: tab !== 'self' },
            tab === 'self' ? h(react.Fragment, null, identityCard, preambleCard, sectionsCard) : null,
          ),
          h(
            'div',
            { role: 'tabpanel', id: 'dsl-panel-memory', 'aria-labelledby': 'dsl-tab-memory', hidden: tab !== 'memory' },
            tab === 'memory' ? memoryPane : null,
          ),
          h(
            'div',
            { role: 'tabpanel', id: 'dsl-panel-backups', 'aria-labelledby': 'dsl-tab-backups', hidden: tab !== 'backups' },
            tab === 'backups' ? backupsPane : null,
          ),
        )
      })()

      return h(
        'div',
        { className: 'dsl-root' },
        h(
          'header',
          { className: 'dsl-head' },
          h(
            'div',
            { className: 'dsl-head__meta' },
            h('h2', { className: 'dsl-title', id: 'dsl-title' }, t('title')),
            h('p', { className: 'dsl-sub' }, t('subtitle')),
            payload !== null ? h('p', { className: 'dsl-path', title: payload.dir }, payload.dir) : null,
          ),
          h(
            'div',
            { className: 'dsl-head__actions' },
            payload !== null ? h('button', { type: 'button', className: 'dsl-btn', onClick: () => openFile('DIR') }, t('openDir')) : null,
          ),
        ),
        body,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined || slots === null) return
      const label = () => makeT(detectLocale(ctx))('title')
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'self-layer', order: 26, label }, () => h(SelfLayerPage, { ctx })),
      )
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})