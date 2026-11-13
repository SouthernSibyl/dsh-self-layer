# 发布与收录

这份文档记录「把 `dsh-self-layer` 从仓库发到 npm、再进插件市场」的完整步骤，以及每一步的验收证据。
它是给维护者看的，不随 npm 包发布。

## 0. 发布前自检

```bash
npm ci
npm run verify     # test + typecheck + pack:check，三者必须全绿
```

`npm run verify` 覆盖：

- `node --test`：解析、宿主（原子写、备份、指针、编码）、路由（403/405/409/413/415/422）。
- `tsc --noEmit`：`lib/` 全量 `checkJs`。
- `node scripts/check-pack.mjs`：发布清单里该有的文件都在、不该有的不在（`assets/`、`tsconfig.json`、
  `package-lock.json` 不进包）。

## 1. 发 npm

```bash
npm login            # 需要能通过 2FA
npm publish          # prepublishOnly 会自动再跑一次 npm test
```

发布后核对：

```bash
npm view dsh-self-layer version dist.tarball
npm view dsh-self-layer dsh.compatibility
```

npm 上包名 `dsh-self-layer` 已确认可用（2026-11-13 查询返回 404）。若发布被 2FA 拒绝（`E403`/`EOTP`），
用 `npm publish --otp=<code>`；若 `registry` 被本机配置指到镜像，先在当前 shell 里
`npm config set registry https://registry.npmjs.org/`。

## 2. 推仓库

仓库地址按 `package.json` 的 `repository` 字段：`https://github.com/SouthernSibyl/dsh-self-layer`。

```bash
git init -b main
git add .
git commit -m "dsh-self-layer 1.0.0"
git remote add origin https://github.com/SouthernSibyl/dsh-self-layer.git
git push -u origin main
```

推完在 GitHub 仓库设置里：

- **Topics**：至少加 `dsh-plugin`（catalog 的硬门槛之一）。
- **Description**：与 `package.json` 的 `description` 一致。
- 确认 `https://raw.githubusercontent.com/SouthernSibyl/dsh-self-layer/main/assets/icon-128.png`
  能打开——catalog 的 `icon` 字段要的就是这个 URL，且只接受 GitHub 托管的位图。

## 3. 进 awesome-dsh-plugin

catalog 是一个 PR：在 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
里新增 `data/plugins/SouthernSibyl__dsh-self-layer.yml`，内容为：

```yaml
url: https://github.com/SouthernSibyl/dsh-self-layer
name: SouthernSibyl/dsh-self-layer
category: identity
icon: https://raw.githubusercontent.com/SouthernSibyl/dsh-self-layer/main/assets/icon-128.png
description:
  en: A settings page for one shared DSH persona and long-term memory. Edits SELF.md and MEMORY.md as plain Markdown with per-file backups, restores, live conflict handling and a self-repairing AGENTS.md boot pointer; all copy follows the host language.
  zh: DSH 设置页里的「自我层」：用 Markdown 统一管理称呼、人设、守则与长期记忆，写前自动备份、可逐份回滚、冲突有出口，并维护一条会自我修复的 AGENTS.md 常驻指针；界面跟随宿主中英双语。
```

硬门槛（缺一不可）：

| 条件 | 现状 |
| --- | --- |
| 包里有 `dsh.bundle` | ✅ `cordis.patch.yml` |
| 仓库带 `dsh-plugin` topic | 待建仓后添加 |
| 仓库存在满 1 天 | 建仓次日才可投 |
| `icon` 是 GitHub 托管的位图 | ✅ `assets/icon-128.png`（SVG 会被拒收） |
| 截图在仓库自己的 `screenshots.json` | ✅ 4 张，相对路径，1–8 张 |

截图规范（[上游 contributing](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）：
`package.json` 旁边放 `screenshots.json`，可以是裸数组或 `{"screenshots": [...]}`，路径相对该文件、
不得以 `/` 开头或含 `..`，1–8 张；也接受 GitHub 托管的 https 绝对 URL。

## 4. 收录进 dsh-market（可选）

dsh-market 直接读 catalog 的 `docs/plugins.json`，不需要单独提交。收录后：
设置 → 插件市场 → 搜索「自我层」或 `self-layer`。

## 5. 发版节奏

- 改代码 → `npm run verify` → 更新 `CHANGELOG.md` → `npm version patch|minor` → `npm publish`。
- 动了 `lib/client.js` 或 `cordis.patch.yml` 之后，在 DSH 里重启并实际点一遍（深浅色、三页签、
  409、备份恢复、指针修复），再发版。
- 兼容性只有实测过才写进 `dsh.compatibility.dshReleases`；没测过的版本不要声明。