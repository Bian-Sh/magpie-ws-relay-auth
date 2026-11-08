# Codex Proxy RS (WS) · Responses WebSocket 中转

> [!TIP]
> 给 magpie 增加一个「走 WebSocket 的供应商」。把中转站的 Responses WebSocket 帧翻译成标准 SSE 回给网关；关掉开关，就退化成普通的 HTTP/SSE 自定义供应商。不改 magpie 一行代码。

**简体中文（本页）** · [English](./README.en.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Deutsch](./README.de.md)

> [!NOTE]
> magpie 的插件详情页只渲染 `README.md` 这一个文件，且只渲染文字、链接、表格和代码（不显示图片）。其它语言有独立全文；本页末尾也附了四种语言的速览，方便在详情页里直接阅读。相对链接在详情页中不会跳转，需要在 GitHub 或 npm 上打开时才会生效。

## 这是什么

很多中转站同时提供两套接口：

| 接口 | magpie 原生能直接用吗 | 本插件做什么 |
| --- | --- | --- |
| `POST /v1/responses` 的 HTTP/SSE | 能，填「自定义供应商」即可 | 关闭开关时原样透传 |
| `GET /v1/responses` 的 WebSocket Upgrade | 不能，出站只认 http(s) | 打开开关时接管：拨 ws、发一帧请求、把每个回帧拼成 SSE |

所以这个插件是**可选增强**，不是接入中转站的必需品。它带来的是官方 Responses WebSocket 的长连接路径（`response.create` 单帧请求、`response.*` 事件流、无 `[DONE]`、连接内元数据帧），并保留 HTTP/SSE 作为随时可退的后路。

兼容范围：任何实现 OpenAI 官方 Responses WebSocket 协议的中转站，包括 [zyycn/codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) 及同类兼容网关；不绑定某个域名，也不校验厂商名。已在一个兼容网关上做过真实联调（握手 101、13 个事件、错误帧、`previous_response_id`）。

> [!WARNING]
> 插件是他人的代码：它替供应商登录并发出请求，能看到请求里的对话、工具和结果。只把它指向你自己信任的中转站。密钥只保存在本机，插件不会写日志、不会把请求发到别处。

## 它登录什么、信息存在哪里

| 项 | 内容 |
| --- | --- |
| 登录方式 | API key（`Client API key`，输入框提示 `sk-…`） |
| 登录前提问 | 只有 1 个：中转站地址 `base_url`，留空用 `http://127.0.0.1:8080/v1`；答完填密钥，**两屏完事**。卡片名称、模型、模型目录 URL、余额不在登录里问（见下「高级配置」） |
| 密钥保存位置 | magpie 配置目录的 `plugin-auth.json`（权限 600），由 magpie 保管；插件不自己存文件 |
| 提问答案 | 保存在该账号登录信息的 `metadata` 里，和密钥一起，不进代码、不进日志 |
| 多账号 | 同一供应商可登录多次（magpie 用 `id#xxxxxx` 区分）。**每个账号有自己的 `base_url`、名称、模型列表和余额配置**，loader 按账号作用域运行 |
| 用量 / 余额 | 提供 `auth.usage` 钩子：填了余额接口就显示余额，没填就不显示（详见下） |
| 图标 | 供应商卡片图标来自 `auth.icon`（也兼容 `package.json` 的 `magpie.icon`），接受 https 链接或 `data:image` 内联 SVG |
| 请求代理 | HTTP 请求走 magpie 为供应商/账号设置的代理；WebSocket 目前只从 `HTTPS_PROXY` / `HTTP_PROXY` 等环境变量读取，回环地址自动直连 |

### 高级配置（卡片名称 / 模型 / 模型目录 / 余额）

登录只问地址和密钥，其余配置有两条来路，都不打断登录流程：

| 配置 | 环境变量（安装级，所有账号共享） | 旧账号遗留（按账号生效） |
| --- | --- | --- |
| 卡片名称 | `MAGPIE_WS_RELAY_NAME` | 旧版登录存过的 `display_name` |
| 手填模型 id | `MAGPIE_WS_RELAY_MODELS` | 旧版登录存过的 `models` |
| 模型目录 URL | `MAGPIE_WS_RELAY_MODELS_URL` | 旧版登录存过的 `models_url` |
| 余额接口 | `MAGPIE_WS_RELAY_BALANCE_URL` | 旧版登录存过的 `balance_url` |
| 余额方法 | `MAGPIE_WS_RELAY_BALANCE_METHOD`（GET/POST） | `balance_method` |
| 余额 POST 体 | `MAGPIE_WS_RELAY_BALANCE_QUERY`（`{key}` 代密钥） | `balance_query` |
| 余额取值路径 | `MAGPIE_WS_RELAY_BALANCE_PATH`（留空自动探测） | `balance_path` |
| 余额单位 | `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | `balance_currency` |

读取优先级：**账号 metadata（旧版登录留下的）> 环境变量 > 默认值**。用 0.4.0 及以前版本登录过的账号什么都不用改；改环境变量后重载宿主生效。`MAGPIE_WS_RELAY_ACTOR_AUTH` 设为空字符串可省略 `x-openai-actor-authorization` 握手头（旧名 `MAGPIE_CODEX_PROXY_*` 仍然兼容）。

> [!TIP]
> **为什么登录不能像内置「自定义供应商」那样一屏全填？** magpie 的插件登录协议（`host.js` 的 `nextPrompt`）一次只渲染一个提问，答完、校验、再问下一个（OpenCode `auth login` 模式），插件画不出大表单——`magpie.panels` 面板虽然能嵌进供应商编辑器，但沙箱里没有任何可持久化字符串的通道（options 只收布尔、CSP 断网）。所以本插件把提问砍到最少：**地址 + 密钥两屏**，跟内置表单必填的两个字段等长；其余配置默认值兜底，需要时用环境变量。

无头/脚本安装也可以全走环境变量；`MAGPIE_WS_RELAY_BASE_URL` 可代替登录提问里的地址。

## 有哪些模型

| 来源 | 行为 |
| --- | --- |
| 登录时手填模型 id | 优先使用，逗号分隔，例如 `gpt-5.6-terra, gpt-5.6` |
| 留空 | 每个账号向 `{base_url}/models` 拉一次，按 OpenAI 兼容的 `{"data":[{"id":…}]}` 解析 |
| 拉取失败 / 未登录 | 保留 magpie 已有的列表（首次是默认的 `gpt-5.6-terra`） |

模型默认带 `limit: { context: 272000, output: 128000 }`。如果中转站的上下文窗口不同，可在 `plugins.json` 里覆盖该供应商的 `models`。

### 自定义模型目录 URL

magpie 内置「自定义供应商」允许填一个「模型目录 URL」，本插件也有等价能力：环境变量 **`MAGPIE_WS_RELAY_MODELS_URL`**（绝对地址，例如 `https://relay.example/v1/models`；旧版登录存过的 `models_url` 按账号优先）。留空就走 `{base_url}/models`；两者都失败则保留 magpie 已有列表。手填的模型 id 优先级最高，其次 `models_url`，最后才是 `/models`。

### 供应商卡片名称自定义

magpie 内置「自定义供应商」有一个名称输入框；插件供应商没有原生的名称编辑入口（卡片名由 `config` 钩子决定），所以本插件从环境变量 **`MAGPIE_WS_RELAY_NAME`** 读卡片名（旧版登录存过的 `display_name` 按账号优先）。设置后，下次 magpie 重载宿主即可生效。都没填就用「Codex Proxy RS (WS)」。

> [!TIP]
> 想立刻生效：填完名称后，在应用里把插件关掉再打开一次（终端 `magpie` 每次读当前文件）。第一次装好、尚未登录时，卡片名是默认名，登录并重载后变成你填的名字。

### 中转站余额怎么接、怎么参与 APP

magpie 内置「自定义供应商」可以配置「余额接口」。本插件通过 **`auth.usage` 钩子**实现同等能力，配置来自环境变量（旧版登录存过的同名 metadata 按账号优先）：

| 环境变量 | 作用 |
| --- | --- |
| `MAGPIE_WS_RELAY_BALANCE_URL` | 余额接口的 GET/POST 地址；**不设就不显示余额**（不会报错） |
| `MAGPIE_WS_RELAY_BALANCE_METHOD` | `GET`（默认）或 `POST` |
| `MAGPIE_WS_RELAY_BALANCE_QUERY` | POST 时的请求体，支持 `{key}` 占位被替换成 Client Key |
| `MAGPIE_WS_RELAY_BALANCE_PATH` | 从 JSON 响应里取值的点路径，如 `data.balance`、`wallet.credits`；留空则自动取最大的数值字段 |
| `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | 单位，如 `USD` / `积分`；只用于显示，如 `123.45 USD` |

余额在 APP 里的数据流（与 magpie 一致）：

1. **手动更新**：供应商卡片上点「刷新用量 / Refresh allowance」会调用 `auth.usage`，结果写进账号的用量信息。
2. **卡片显示**：余额作为供应商的额度（`balance`）显示在卡片上，和套餐用量、限流窗口并列。
3. **用量统计 / 路由**：`balance` 是一个**预付费钱包余额**（无总额）。magpie 在 provider 的多个账号里，会把「同一单位、余额最多」的账号排在前面优先尝试（#3950）。它**不是消费计数器**——magpie 不会在每次请求后扣减它，只是把余额读出来展示和排序。
4. **可选窗口**：若中转站返回的是「已用/总额」式限流窗口（而不是纯余额），可以改成在 `auth.usage` 里返回 `windows` 结构（带 `used` / `limit` / `unit`）。当前版本默认只返回 `balance`，够覆盖绝大多数「钱包余额」场景。

> [!NOTE]
> `auth.usage` 只读、不写：它不会修改中转站上的任何状态。取数失败时返回 `{ error }`，卡片会显示读取失败而不是崩溃。

### 图标从哪来

卡片图标 = `auth.icon`（本插件已内置一个紫色内联 SVG）。magpie 的优先级是 `auth.icon` 先，`package.json` 的 `magpie.icon` 兜底，二者都接受 `https://` 链接或 `data:image/...` 内联图（≤1.5MB）。想换成自己的图标，改 `index.js` 顶部的 `ICON` 常量，或改 `package.json` 的 `magpie.icon`。

## 安装与配置

文件夹方式（开发、自用）：

```sh
magpie plugin add ./ws-relay-plugin
magpie plugin login codex-proxy-ws      # 填 Client Key、中转站地址、模型 id
magpie provider test codex-proxy-ws
```

在应用里：插件 → 添加插件 → 填文件夹路径 → 在「来自插件」分组里找到 **Codex Proxy RS (WS)** → 登录。

> [!TIP]
> 文件夹插件是按**绝对路径**注册的，装好后不要移动或改名目录。改了 `index.js` / `package.json` 之后，把插件关掉再打开即可重新加载（终端里的 `magpie` 命令每次都会读当前文件）。

### 那个开关

供应商编辑页 → **插件选项 → 走 WebSocket 中转 → 关闭 / 开启**。它来自 `auth.options`，值按供应商 id 存在 `settings.json` 的 `pluginOptions` 中，插件在每个请求开始时实时读取，**切换后下一个请求就生效，不用重启**。

| 状态 | 行为 |
| --- | --- |
| 开（默认） | `POST /responses` 走 WebSocket；其它请求、非 http(s) 地址、ws 建连失败自动回退 HTTP |
| 关 | 所有请求走 `fetch` 原样透传，连 socket 都不建，等价于普通 HTTP/SSE 自定义供应商 |

不开 GUI 也能切：

```sh
magpie plugin options codex-proxy-ws '{"ws": false}'
magpie plugin options codex-proxy-ws off          # 恢复插件默认值
```

> [!NOTE]
> 开关标签、说明和开启前确认都提供了 `zh` / `zh-TW` / `ja` / `de` 四种译文，英文为兜底，会随 magpie 窗口语言自动切换。

## 协议细节

| 环节 | 约定 |
| --- | --- |
| 握手 | `GET {base}/responses` Upgrade，`Authorization: Bearer <key>`，`OpenAI-Beta: responses_websockets=2026-02-06` |
| 请求帧 | 一条文本帧 `{"type":"response.create", ...Responses 请求体}`；强制 `stream: true` |
| `previous_response_id` | **连接内有效**，换连接会 400 `previous_response_not_found`；插件会删掉它并发送完整历史 |
| 响应帧 | 每帧一个 JSON 事件，帧字节即 SSE 的 `data:`，`event:` 取 `type`；`usage`、`id`、`model`、限流头原样保留 |
| 前导帧 | `response.metadata` / `codex.response.metadata` / `codex.rate_limits` / `response.created` / `response.in_progress` 也写进 SSE，供 quota 记账 |
| 终态 | `response.completed` / `failed` / `incomplete` / `done` / `error`；**WebSocket 没有 `[DONE]`，插件不伪造** |
| 错误帧 | `{"type":"error","status":503,"error":{…},"headers":{…}}` 在首个业务事件前到达时，合成 HTTP 错误并透传 `Retry-After`、`x-request-id`，故障切换才会生效 |
| 心跳 | Ping/Pong 由中转站和 Bun 各自处理，不转成 SSE |
| 连接模型 | 一请求一条连接；流已开始后不再重放（`GetBody` 语义），`Body.Close` / AbortSignal 会关掉 ws |

## 常见问题与提示

> [!TIP]
> **为什么开关不在「自定义供应商」那个配置页？** 那里是 magpie 内置供应商（`providers.json`）的编辑器，字段对所有自定义供应商共用；插件开关属于 `pluginOptions`，按插件注册的供应商 id 保存。把开关塞进内置页面等于改 magpie 的核心配置逻辑，会侵入所有供应商、还得加一层「哪个供应商该显示」的过滤。本插件选择零侵入：只在自己注册的供应商编辑页出现。

> [!TIP]
> **为什么我的插件详情页上半部分，和商店里别人（npm 包）的不一样？** 因为**元数据来源不同**，不是 bug。
> - 从 **npm 发布**的插件：详情页上部的「作者、`vX.Y.Z`、周下载量、许可证、更新于」以及「npm / 源码」按钮，全部来自 **npm registry + magpie 社区清单**（`market.json` / `registry.json`），本地没有这些数据的插件不会显示。
> - 用**文件夹路径**（绝对路径）安装的插件：详情页只读一个 `README.md`，`更新于` 取该文件的 mtime，其余元数据全部缺失——所以你看到的是「图标 + 名称 + 路径 + 更新于 + README 正文」。
> - 想在对齐前先补齐：在 `package.json` 里填好 `description` / `author` / `license` / `repository` / `homepage`，图标用 `magpie.icon`，这些**本地就会显示**；但「周下载量、npm/源码按钮」只有发布到 npm 后 magpie 才会拉到。
> - 结论：上半部分的差异是「文件夹安装 vs npm 安装」的固有区别，不是本插件缺功能。要完全对齐，走 [PUBLISHING.md](./PUBLISHING.md) 的 npm 发布路径即可。


> [!TIP]
> **多个中转站 / 多个 provider 怎么办？** 插件里没有任何写死的域名。一个供应商下可以登录多个账号，每个账号填各自的 `base_url`；loader 在账号作用域里运行，请求 URL 已经由 magpie 按该账号的地址拼好，直接转成 `ws(s)` 即可。若想让不同中转站各有独立开关，复制这个包、改 `index.js` 顶部的 `ID` 常量，再注册第二个供应商。

> [!TIP]
> **HTTP 能用就别开 ws。** 多数中转站的 HTTP/SSE 双栈更稳、排障更简单。只有当你要贴近官方 Codex 指纹、需要连接内元数据帧或长连接时才打开开关。

> [!WARNING]
> `e2e.mjs` 必须用 **Bun** 跑（magpie 自带的插件运行时即可）。Node 的全局 `WebSocket` 不支持自定义握手头，会丢掉 `Authorization` 而握手失败；`test.mjs` 用的是 mock，Node 就能跑。

> [!WARNING]
> 已知限制：v1 每轮新建连接，不做连接内续接；动态 `serviceTiers`、模型价格、按账号的 WebSocket 代理设置尚未实现；`magpie.panels` 面板经源码查证没有可持久化字符串的通道（options 只收布尔、沙箱 CSP 断网），故未用作配置入口。高级配置的环境变量是**安装级**（该 magpie 下所有账号共享）；按账号的余额/名称配置只来自旧版登录留下的 metadata。余额是「读取展示 + 路由排序」用途，`auth.usage` 已实现，但**不会在每次请求后扣减**（magpie 的余额语义本就不是消费计数器）。

### 排错

| 现象 | 先看哪里 |
| --- | --- |
| 详情页提示 `has no README` | `README.md` 必须和 `package.json` 在同一目录 |
| 握手一直失败、自动回退 HTTP | 地址是否以 `/v1` 结尾、`Authorization` 是否正确、是否被代理拦了 CONNECT；本地地址会自动直连 |
| `400 previous_response_not_found` | 说明有请求绕过了插件（插件必然会剥离该字段） |
| 模型列表只有默认一个 | 中转站 `/models` 不可达或格式不同；登录时手填模型 id |
| 开关改了没生效 | 值按供应商 id 保存；确认改的是插件这个供应商，或把插件关掉再打开重载一次 |

## 测试

```sh
node test.mjs                      # 23 个协议/开关/多账号/模型/名称/余额/env 场景，无需网络
CPRS_KEY=sk-… CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
```

`e2e.mjs` 会向真实中转站发四个短请求并计费：WS 开、WS 关、上游错误帧、`previous_response_id`。密钥只从环境变量读取，不落盘。

## 发布与上架

见 [PUBLISHING.md](./PUBLISHING.md)：npm 发布、GitHub `magpie-plugin` topic、社区 `registry.json` 推荐列表三条路径，以及「发现」页各区块的准入条件。本包目前**尚未发布、尚未提交 GitHub**，仅以本地文件夹方式安装。

## 多语言速览

**English** — A magpie/OpenCode provider plugin that bridges an OpenAI Responses WebSocket relay to HTTP/SSE. Sign in with a client API key and the relay's `/v1` base URL; models come from `/models` unless you list them. A per-provider switch (default on) turns WebSocket transport on or off, with automatic HTTP fallback. See [README.en.md](./README.en.md).

**繁體中文** — 讓 magpie 接入支援官方 Responses WebSocket 的中轉站，把訊框轉成 SSE。以 Client API key 與 `/v1` 位址登入，模型可自動由 `/models` 取得。供應商頁的開關（預設開）可切回 HTTP/SSE。詳見 [README.zh-TW.md](./README.zh-TW.md)。

**日本語** — 公式 Responses WebSocket 対応の中継サーバーを magpie に接続し、フレームを SSE に変換するプラグインです。Client API key と `/v1` のアドレスでログインし、モデルは `/models` から自動取得できます。プロバイダー別のスイッチ（既定オン）で HTTP/SSE に切り替え可能。詳細は [README.ja.md](./README.ja.md)。

**Deutsch** — Ein magpie-/OpenCode-Provider-Plugin, das ein OpenAI-Responses-WebSocket-Relay auf HTTP/SSE abbildet. Anmeldung mit Client-API-Key und `/v1`-Adresse; Modelle werden aus `/models` gelesen. Ein Schalter pro Anbieter (standardmäßig an) wechselt auf HTTP/SSE zurück. Siehe [README.de.md](./README.de.md).

## 许可证

MIT
