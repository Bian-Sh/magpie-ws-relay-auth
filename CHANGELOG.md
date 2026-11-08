# Changelog

## 0.5.0 — 2026-11-09（登录从 10 屏砍到 2 屏）

- **登录只问一件事**：中转站地址 → API 密钥，共两屏，完事。此前是 9 个提问 + 1 个密钥框 = 10 屏，一格一格拦着用户问，体验灾难。
- **为什么不能像内置「自定义供应商」那样一屏全填**：magpie 的插件登录协议（`host.js` 的 `nextPrompt`）就是一次渲染一个提问、答完校验再问下一个（OpenCode `auth login` 模式）；插件无法画出自定义的大表单。这是宿主协议约束，不是本插件偷懒。想要那种体验需要给 magpie 上游提需求（一次性渲染 prompts 成表单，或插件供应商编辑器支持文本型 option）。
- **被砍掉的配置全部保留能力，改走两路**：
  - **旧账号无缝兼容**：用旧版登录过的账号，配置仍在账号 `metadata` 里，按账号继续生效（余额、名称、models_url、手填模型都不丢）。
  - **新配置走环境变量**：新增 `MAGPIE_WS_RELAY_MODELS_URL`、`_BALANCE_URL`、`_BALANCE_METHOD`、`_BALANCE_QUERY`、`_BALANCE_PATH`、`_BALANCE_CURRENCY`（`_NAME`、`_BASE_URL`、`_MODELS`、`_ACTOR_AUTH` 沿用）。env 是安装级的（该 magpie 下所有账号共享），适合「一个中转站多个 key」的常见姿势；每个账号不同中转站且要不同余额配置的极少数场景，用旧版登录留下的 metadata 或多账号地址区分。
- **改配置 = 重新登录一次**：现在重新登录只花两屏，比以前便宜得多。
- **测试**：`node test.mjs` 23 个场景（新增 env-only 配置：无 metadata 时余额 + 模型目录全走 env）；协议/e2e 未动。

## 0.4.0 — 2026-11-09（抄自 magpie 自定义供应商的三项能力）

- **供应商卡片名称自定义**：登录新增 `display_name` 提问；`config` 钩子读取登录信息（`plugin-auth.json`）里存的值写回卡片名，下次重载宿主生效。无原生名称编辑入口的插件供应商也能改名。
- **模型目录 URL 自定义**：登录新增 `models_url`（绝对地址），覆盖默认的 `{base}/models`；手填模型 id 优先级最高，其次 `models_url`，最后 `/models`，三者失败保留 magpie 原列表。
- **中转站余额接入**：实现 `auth.usage` 钩子。登录新增 `balance_url` / `balance_method` / `balance_query`（`{key}` 占位）/ `balance_path`（点路径，留空自动取最大数值）/ `balance_currency`。余额作为预付费钱包显示并参与路由排序（同单位余额最多的账号优先）。
- **图标**：`auth.icon` 内置紫色内联 SVG（优先于 `package.json` 的 `magpie.icon`）；二者均接受 https 链接或 `data:image`。
- **env 兼容**：新增 `MAGPIE_WS_RELAY_NAME` 兜底卡片名；旧 `MAGPIE_CODEX_PROXY_*` 环境变量继续兼容。
- **文档**：README 补三项能力说明、余额在 APP 的数据流（手动刷新 / 卡片显示 / 路由排序 / 非扣减）、图标来源、以及「文件夹安装 vs npm 安装导致详情页上半部分差异」的 FAQ；`package.json` 升 0.4.0。
- **测试**：`node test.mjs` 扩到 22 个场景（名称、models_url、余额五连测）；`bun e2e.mjs` 对真实网关 4/4 通过。

## 0.3.0 — 2026-11-08（发布准备 / release preparation）

- **文档**：新增 `README.md`（详情页读取的主文件）与英文、繁体中文、日文、德文四份独立全文；主 README 末尾附四种语言速览。补 `PUBLISHING.md`（npm / GitHub topic / registry.json / 社区仓库四条上架路径）、`LICENSE`、`registry-entry.json`。
- **tips / 多语言**：`auth.options` 的 `labels` / `descriptions` / `confirms` 补齐 `zh` / `zh-TW` / `ja` / `de`（英文兜底）；登录 prompts 改双语；README 内用 `TIP` / `NOTE` / `WARNING` 提示块。`magpie.summary` 提供五种语言。
- **去掉厂商硬编码**：删除 `url.startsWith(baseURL + "/")` 这类中转站专属过滤。现在只按「开关 + POST + `/responses` + http(s) URL」判断，任意中转站域名、多个账号、多个由本包派生的 provider 都能各自走 ws。
- **模型发现**：新增 `provider.models` 钩子。登录时手填的列表优先；留空则按账号拉 `{base}/models`；失败保留 magpie 原列表。修好了「登录 prompt 填的模型不生效」的问题。
- **开关默认值**：未设置的开关按 `default` 处理（此前会被当成关）；旧宿主没有 `magpie.option` 时保持 ws 路径。
- **元数据**：包名改为 `magpie-ws-relay-auth`（不再占用 `@magpie-community/*` 社区命名空间），补 `magpie.icon`（内联 SVG）、`files` 白名单、搜索关键词。
- **测试**：`node test.mjs` 14 个场景全过；`bun e2e.mjs` 对真实兼容网关 4 个场景全过。

## 0.2.0 — 2026-11-08

- 用 `auth.options` 在 Provider 编辑页提供原生 On/Off 开关（`placement: "top"`），切换后下一个请求生效。
- 登录 prompts 可填中转站地址与模型 id；`config` 改用 `??=` 避免覆盖 `plugins.json`。
- 补 `limit`、`description`、keywords 等清单字段。

## 0.1.0 — 2026-11-08

- 首版：`response.create` 单帧请求 → WebSocket 事件帧 → SSE 的双向翻译。
- 剥 `previous_response_id`、强制 `stream: true`；错误帧合成 HTTP 状态与 `Retry-After` / `x-request-id`。
- ws 建连失败、非 `/responses` 路径自动回退 HTTP/SSE。
