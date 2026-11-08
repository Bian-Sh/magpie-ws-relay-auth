# 发布与上架指南 / Publishing

> **English in one paragraph.** magpie does not host plugin code. Its Plugins → Discover page is an *index* over three places: npm's search API, GitHub repositories tagged `magpie-plugin`, and the community `registry.json`. To "upload" the plugin you publish an npm package and/or push a GitHub repository with the topic; nothing is uploaded to magpie's servers. This document lists every requirement and the exact commands. **Nothing here has been executed** — no npm publish, no git push, no pull request.

## 结论先讲：没有「上传到 magpie」这一步

magpie 的插件发现页是**索引**，不是应用商店。代码托管在 npm 或 GitHub，magpie 只是去读：

| 发现页区块 | 数据来源 | 谁托管 | 是否需要别人审核 | 本包怎么进 |
| --- | --- | --- | --- | --- |
| 搜索（按名字 / 简介 / 发布者） | npm 搜索 `<关键词> opencode` | npmjs.com | 否，发布即可 | 路径 A |
| 非官方插件 · GitHub | GitHub `topic:magpie-plugin archived:false fork:false`，按 Star 排序 | GitHub 仓库 | 否，但卡片标注「无人审阅」 | 路径 B |
| 推荐列表 | 社区仓库 `registry.json`（最多每 6 小时拉一次，内置副本兜底） | magpie-community | 是，要提 PR | 路径 C |
| 社区自带包（自动更新） | `magpie-community/plugins` 的 `packages/`，dist 分支 + npm | 社区仓库 | 是，贡献代码并审核 | 路径 D |

> [!NOTE]
> 本地文件夹插件（现在这种）**不会**出现在发现页。它的详情页读本地 `README.md`（`folderReadme`：只认 `README.md` / `readme.md` / `.markdown` / `.txt` / 无扩展名，大小写不敏感，200 KB 上限），`更新于` 取该文件的修改时间；Version / Downloads / License 为空，所以截图里显示「—」。发布到 npm 后，详情页改读 npm 的 `readme` 字段，`更新于` 取 `time.modified`，并补上版本、周下载量、许可证和 npm / GitHub / Homepage 链接。

## 发布前检查清单

| 状态 | 项 |
| --- | --- |
| 完成 | `README.md` 与 `package.json` 同目录（修好截图里的报错） |
| 完成 | 五种语言 README；`magpie.summary` 提供 en / zh / zh-TW / ja / de |
| 完成 | `auth.options` 的 labels / descriptions / confirms 提供 zh / zh-TW / ja / de，英文兜底 |
| 完成 | `TIP` / `NOTE` / `WARNING` 提示块（详情页会渲染成 `TIP:` 等，纯文字，无图片） |
| 完成 | `LICENSE`（MIT 原文，GitHub 才能识别出许可证） |
| 完成 | `keywords` 含 `opencode` 与 `auth` / `plugin` / `provider`，满足插件搜索过滤 |
| 完成 | `magpie.icon` 内联 data URI；`files` 白名单排除测试脚本与联调脚本 |
| 完成 | 无写死的厂商域名、无写死的 key；`e2e.mjs` 不进 npm 包 |
| 待办 | 填 `author`、`repository`、`homepage`（当前故意留空，避免假链接） |
| 待办 | 确认包名 `magpie-ws-relay-auth` 未被占用；占用则改用 `@<your-scope>/…` 并同步改 `registry-entry.json` |
| 待办 | **你先完成实机测试**（GUI 开关 + 网关 3425 路由集成还没点过） |
| 待办 | 决定走 A / B / C 哪条路径 |

## 路径 A · npm（最快、完全自助）

```sh
npm view magpie-ws-relay-auth version        # 查重名；返回 404 表示可用
npm login
npm publish --access public --dry-run        # 先看打包内容
npm publish --access public
```

发布前在 `package.json` 补：

```json
{
  "author": "Your Name",
  "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" },
  "homepage": "https://github.com/<owner>/<repo>#readme"
}
```

准入规则（源码 `internal/plugin/market.go` 的 `Search`）：magpie 搜索 `<关键词> opencode`，只保留**名字或 keywords 里同时含 `opencode` 和 `auth` / `plugin` / `provider` 之一**的包。本包 keywords 已满足。之后用户可以：

```sh
magpie plugin add magpie-ws-relay-auth
magpie plugin add magpie-ws-relay-auth@0.3.0     # 固定版本
```

更新：改 `version` 后重新 `npm publish`；非社区包有新版本时，插件那一行会出现小圆点，侧栏显示「1 个更新」，用户点一下或运行 `magpie plugin update` 更新（固定了版本的写法不会被自动更新）。

> [!TIP]
> `npm publish --dry-run` 会列出实际进包的文件。应当只有 `index.js`、五份 README、`CHANGELOG.md`、`LICENSE`、`package.json`；`test.mjs` / `e2e.mjs` / `PUBLISHING.md` / `registry-entry.json` 不应出现（`files` 白名单已排除）。

## 路径 B · GitHub topic（不发布 npm 也能进发现页）

1. 把**本目录内容放在仓库根目录**（`package.json` 必须在根目录，且加载用到的文件都要提交进仓库；`dist` 只在发布时构建的仓库不会显示）。
2. 提交标准 `LICENSE`（已在包内）。GitHub 识别不出许可证时会回退用 `package.json` 的 `license`，卡片显示不带社区标记。
3. 在仓库 Settings → Topics 加 `magpie-plugin`。
4. 卡片取 `magpie.icon`，名字取 `magpie.name`，简介取 `magpie.summary`（按窗口语言，繁中读 `zh`）；会标注「包自己的话 / 无人审阅」。

```sh
git init
git add package.json index.js README*.md CHANGELOG.md LICENSE
git commit -m "magpie-ws-relay-auth 0.3.0"
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
# 然后在 GitHub 网页上加 topic: magpie-plugin
```

判定细节（源码 `internal/plugin/github.go`）：`topic:magpie-plugin archived:false fork:false`、按 Star 降序、排除 magpie-community 自己的仓库；magpie 最多每 10 分钟问一次 GitHub，打上标签后几分钟内出现在 **插件 → 发现 → 非官方插件 · GitHub**。

> [!TIP]
> 若**同时**发布到 npm 且 `repository` 指向这个仓库，卡片会从 npm 安装；否则按仓库当前代码安装。两条都做时记得每次改版本同时推 npm 和 GitHub，否则两边代码会分叉。用户说先不提交 GitHub，以上命令只是备用，**我没有执行**。

## 路径 C · 社区推荐列表（要 PR，别人审核）

`registry-entry.json` 是现成的条目草稿，复制进 `magpie-community/plugins` 根目录的 `registry.json` 即可：

```json
{ "package": "magpie-ws-relay-auth", "name": "Codex Proxy RS (WS)",
  "providers": ["codex-proxy-ws"], "icon": "…",
  "summary": { "en": "…", "zh": "…" } }
```

要点：

- 供应商插件**不写 `kind`**，用 `providers` 列出 `auth.provider` 的 id。
- 「从你自己的仓库发布的包不写 `community`」：它会以作者自己的包身份出现在搜索里，卡片显示 npm 发布者，不带 magpie 社区标记，也不进社区分组。
- `summary` 固定 `en` + `zh` 两种语言，各一行 ≤ 300 字节。
- 社区 README 的「One channel already listed」规则：如果同一渠道已经有条目，PR、README 和 summary 都要写清差异（登录方式、端点、能力），否则不合并。
- 本地预览：`MAGPIE_PLUGIN_MARKET=<你的 registry.json URL>` 让 magpie 改用另一份列表；设为 `off` 只用内置副本。

## 路径 D · 贡献进社区仓库（另一种性质）

放到 `packages/<name>/`，包名按规范为 `@magpie-community/opencode-<name>-auth`，尽量不要运行时依赖。把版本号改动推到 `main` 后由 CI 自动发布：先打包到 `dist` 分支（tgz + `index.json`，magpie 在 npm 没有该版本时从 dist 装，校验 sha512），再由 npm trusted publishing 发布。这类包在每个 magpie 里**每小时自动更新**。

检查钩子用 `bun scripts/check.mjs`，沙箱试跑用 `scripts/try.sh <name>`。这等于把维护权交给社区仓库，和「自己发布、自己维护」是两回事；本包目前按 A/B 自助发布的思路准备。

## 发布后怎么验证（不碰正在运行的 magpie）

官方文档给的沙箱做法：给 magpie 一个单独的 `HOME`，本机在用的服务、agent 和登录信息都不会被碰到。

```sh
sb=$(mktemp -d)
m() { env HOME=$sb XDG_CONFIG_HOME=$sb/.config XDG_CACHE_HOME=$sb/.cache MAGPIE_ADDR=127.0.0.1:3499 magpie "$@"; }
m plugin add magpie-ws-relay-auth </dev/null
m plugin --json
m provider test codex-proxy-ws
m plugin logout codex-proxy-ws
```

另外可在现有 GUI 会话里只读核对详情页：`/api/plugins/page?name=<spec>` 对本地路径返回 `{"readme","updated"}`；发布后对包名返回 npm 的 README 与更新时间。

## 本包当前状态

- 包内文件已按发布标准补齐；版本 `0.3.0`。
- **未**执行 `npm publish`、**未**创建 / 推送 GitHub 仓库、**未**提 PR、**未**做任何 git 提交。
- 本地仍以 `D:\AppData\Github\magpie\ws-relay-plugin` 这个绝对路径注册在 `~/.config/magpie/plugins.json`；目录不要移动。
- 下一步由你决定：先实机测试 → 再选 A / B / C。
