# Changelog

## 1.0.0 — 2026-11-13

首个正式版本。相对于最初的内部草稿，这一版把「能跑」的插件收紧成「可分发」的插件：所有写盘路径都改成
原子写 + 校验，所有错误都有稳定的 `code`，界面文案与主题完全跟随宿主。

### Added

- **设置页「自我层」**：人设 / 记忆 / 备份三个页签，深色与浅色主题共用宿主 token。
- **分节编辑器**：`## ` 分节可新增、改名、上下移动、删除与搜索；开头说明（preamble）可编辑。
- **身份四字段**：称呼用户 / 我的名字 / 语言 / 时区就地改写「身份」节里的字段行，原节正文仍可逐字编辑。
- **长期记忆**：逐条新增与删除，另有全文编辑器；统计条数与字节数（建议 20 条 / 2 KB）。
- **备份与恢复**：SELF.md / MEMORY.md / AGENTS.md 各自列出历史版本（时间 · 大小），恢复前二次确认，恢复动作本身也会先备份当前版本。
- **AGENTS.md 指针卡**：显示指针是否注入、是否指向当前数据目录；缺失或不完整时给出一键修复，异常时才展开详情。
- **中英双语**：跟随宿主 locale 实时切换（无需刷新页面），磁盘上的字段名保持中文契约不变。
- **配置项**：`dataDir` / `backupKeep` / `pointer`，可用 `cordis.patch.yml` 覆盖。
- **错误码**：所有响应带稳定 `code`（`conflict`、`file_too_large`、`agents_encoding`、`agents_orphan_end` 等），客户端据此本地化，不再靠匹配消息文本。

### Changed

- **并发校验改用内容哈希**：`rev` 由 `sha256(内容)` 前 16 位得出，替换原来的 `mtime + size`（同毫秒同长度也能区分）。
- **冲突有出口**：409 时界面同时提供「重新载入」与「覆盖保存（二次确认）」，不再把用户困在旧 `rev` 上。
- **保存只更新自己的基线**：保存 SELF.md 不再把未保存的 MEMORY.md 标记为已保存；切走页签或关窗时的脏数据提示因此可靠。
- **不再静默截断**：超长标题、重复标题、超过 40 节、超过 256 KB 都由服务端返回 422/413 并指出位置，而不是切掉半截还报成功。
- **允许没有分节的 SELF.md**：只有开头说明（preamble）也能保存；完全空白的文件仍拒绝（`empty_file`）。
- **取消 `fields` 写通道**：快捷字段与正文行只保留一个事实源，手删字段行后不会在保存时被悄悄写回。
- **指针块路径动态生成**：`SOUL_HOME` / `dataDir` 改了，指针块跟着改，不再是写死的 `~/.agent-self`。
- **AGENTS.md 编码保真**：识别 UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE，原编码回写；无法解码时拒绝改写（`agents_encoding`）而不是写成一片替换字符。
- **残缺指针块可修复**：只有 `BEGIN` 没有 `END` 的块视为延伸到文件末尾；多个重复块收敛为一块；只有 `END` 则报 `agents_orphan_end`。
- **备份统一管理**：SELF/MEMORY 在 `<dataDir>/.backups/`，AGENTS.md 在 `<dshHome>/.self-layer-backups/`，都按 `backupKeep`（默认 30 份）清理，且可恢复。
- **原子写加固**：`open(wx)` → `write` → `fsync` → `rename` → 目录 `fsync`（尽力而为），失败清理临时文件；POSIX 下文件 0600、目录 0700。
- **安全边界**：无 `Origin` 的请求只允许 `GET`/`HEAD`；`POST` 必须同源且 `Content-Type: application/json`；`/open` 只接受白名单目标。
- **打开位置修正**：Windows 用 `explorer /select`、macOS 用 `open -R`、Linux 打开所在目录；目标不存在返回 `false` 而不是假装成功。
- **错误本地化**：宿主只返回 `code` 与英文兜底消息，界面按当前语言渲染。
- **界面细节**：主按钮改用 `button-primary-fill` + `label-primary-foreground`（修掉深色下白字白底）；禁用态、hover、focus-visible 补齐；`aria-live` 状态播报、`aria-labelledby` 输入框、`aria-expanded` 折叠头、新增分节后自动聚焦。
- **依赖收窄**：声明 `dsh.compatibility.dshReleases`，`engines.dsh` 与 peer 区间改为含 prerelease 的 `>=0.2.2-rc.1 <0.3.0-0`。

### Removed

- 移除写死的浅色回落（`#222` / `#777` / `#888` / `#ddd` / `#fff` / `#fafafa` / `#d97706`），配色全部走宿主 token。
- 移除 `readPayload()` 里整份 CHANGELOG.md 的传输，只回传最近 5 行。
- 移除 `.tgz` 构建残留与 `jsconfig.json`（TypeScript 7 不读它，改 `tsconfig.json`）。

### Fixed

- 保存后页内字节数与备份列表停在保存前的问题：保存成功会重新读取元数据。
- 新增分节时用 `index + title` 作 key，改名会重挂输入框、丢焦点。
- 记忆统计读取保存前的旧值。
- 定位文件失败被 `catch(() => {})` 吞掉。
- 同一份草稿的两处渲染导致同一条状态消息出现两次。

### Known limitations

- Windows 上 `chmod` 不改变 ACL，0600 只是尽力而为；同一台机器上的其他账户是否可读由系统 ACL 决定。
- 符号链接目标不做特殊处理：`rename` 会替换链接本身（本机仅 Windows 实测，POSIX 行为未实测）。
- 备份按「份数」保留，不按天数；频繁保存会把久远的备份挤出窗口。
- 兼容性只在 DSH `0.2.2-rc.1` 上实测，`dshReleases` 也只声明了这一条。