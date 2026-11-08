# Codex Proxy RS (WS) · Responses WebSocket 中轉

> [!TIP]
> 讓 magpie 接入支援官方 Responses WebSocket 的中轉站：把 WebSocket 訊框轉成標準 SSE 回給閘道；關掉開關，就變成一般的 HTTP/SSE 自訂供應商。不必修改 magpie 本身。

[简体中文](./README.md) · [English](./README.en.md) · **繁體中文** · [日本語](./README.ja.md) · [Deutsch](./README.de.md)

## 這是什麼

很多中轉站同時提供兩套介面：

| 介面 | magpie 原生能用嗎 | 本外掛做什麼 |
| --- | --- | --- |
| `POST /v1/responses` 的 HTTP/SSE | 能，填「自訂供應商」即可 | 關閉開關時原樣透傳 |
| `GET /v1/responses` 的 WebSocket Upgrade | 不能，出站只認 http(s) | 打開開關時接管：撥 ws、送一幀請求、把每個回幀拼成 SSE |

所以這個外掛是**選用增強**，不是接上中轉站的必要條件。它帶來的是官方 Responses WebSocket 的長連線路徑（`response.create` 單幀請求、`response.*` 事件流、沒有 `[DONE]`、連線內中繼資料幀），並保留 HTTP/SSE 作為隨時可退的後路。

相容範圍：任何實作 OpenAI 官方 Responses WebSocket 協定的中轉站，包含 [zyycn/codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) 與相容閘道；不綁網域、不檢查廠商名稱。已在一個相容閘道完成真實聯調（握手 101、13 個事件、錯誤幀、`previous_response_id`）。

> [!WARNING]
> 外掛是他人的程式碼：它會替供應商登入並發出請求，看得到對話、工具與結果。只指向你信任的中轉站。金鑰只存在本機，外掛不寫紀錄、不把請求發往他處。

## 登入與資料存放

| 項目 | 內容 |
| --- | --- |
| 登入方式 | API key（`Client API key`，提示 `sk-…`） |
| 登入前提問 | 只有 1 個：中轉站位址 `base_url`，留空用 `http://127.0.0.1:8080/v1`；答完填金鑰，**兩屏完事**。卡片名稱、模型、模型目錄 URL、餘額不在登入裡問（見下「進階設定」） |
| 金鑰 | magpie 設定目錄下的 `plugin-auth.json`（權限 600），由 magpie 保管 |
| 提問答案 | 存在該帳號登入資訊的 `metadata`，和金鑰一起，不進程式碼、不進紀錄 |
| 多帳號 | 同一供應商可登入多次（`id#xxxxxx`）。**每個帳號有自己的 `base_url`、名稱、模型清單和餘額設定**，loader 依帳號作用域執行 |
| 用量 / 餘額 | 提供 `auth.usage` 鉤子：填了餘額介面就顯示餘額，沒填就不顯示（詳見下） |
| 圖示 | 卡片圖示來自 `auth.icon`（也相容 `package.json` 的 `magpie.icon`），接受 https 連結或 `data:image` 內聯 SVG |
| 代理 | HTTP 走 magpie 的供應商／帳號代理；WebSocket 目前只讀 `HTTPS_PROXY` / `HTTP_PROXY`，回環位址直連 |

### 進階設定（卡片名稱 / 模型 / 模型目錄 / 餘額）

登入只問位址和金鑰，其餘設定有兩條來路，都不打斷登入流程：

| 設定 | 環境變數（安裝級，所有帳號共享） | 舊帳號遺留（按帳號生效） |
| --- | --- | --- |
| 卡片名稱 | `MAGPIE_WS_RELAY_NAME` | 舊版登入存過的 `display_name` |
| 手填模型 id | `MAGPIE_WS_RELAY_MODELS` | 舊版登入存過的 `models` |
| 模型目錄 URL | `MAGPIE_WS_RELAY_MODELS_URL` | 舊版登入存過的 `models_url` |
| 餘額介面 | `MAGPIE_WS_RELAY_BALANCE_URL` | 舊版登入存過的 `balance_url` |
| 餘額方法 | `MAGPIE_WS_RELAY_BALANCE_METHOD`（GET/POST） | `balance_method` |
| 餘額 POST 內容 | `MAGPIE_WS_RELAY_BALANCE_QUERY`（`{key}` 代金鑰） | `balance_query` |
| 餘額取值路徑 | `MAGPIE_WS_RELAY_BALANCE_PATH`（留空自動探測） | `balance_path` |
| 餘額單位 | `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | `balance_currency` |

讀取優先級：**帳號 metadata（舊版登入留下的）> 環境變數 > 預設值**。用 0.4.0 及以前版本登入過的帳號什麼都不用改；改環境變數後重載宿主生效。`MAGPIE_WS_RELAY_ACTOR_AUTH` 設為空字串可省略 `x-openai-actor-authorization` 握手頭（舊名 `MAGPIE_CODEX_PROXY_*` 仍相容）。

> [!TIP]
> **為什麼登入不能像內建「自訂供應商」那樣一屏全填？** magpie 的外掛登入協定（`host.js` 的 `nextPrompt`）一次只渲染一個提問，答完、校驗、再問下一個（OpenCode `auth login` 模式），外掛畫不出大表單——`magpie.panels` 面板雖然能嵌進供應商編輯器，但沙箱裡沒有任何可持久化字串的通道（options 只收布林、CSP 斷網）。所以本外掛把提問砍到最少：**位址 + 金鑰兩屏**，跟內建表單必填的兩個欄位等長；其餘設定預設值兜底，需要時用環境變數。

無頭安裝也可以全走環境變數；`MAGPIE_WS_RELAY_BASE_URL` 可代替登入提問裡的位址。

## 模型

| 來源 | 行為 |
| --- | --- |
| 登入時手填模型 id | 優先使用，逗號分隔，例如 `gpt-5.6-terra, gpt-5.6` |
| 留空 | 每個帳號向 `{base_url}/models` 拉一次，依 OpenAI 相容的 `{"data":[{"id":…}]}` 解析 |
| 拉取失敗 / 未登入 | 保留 magpie 已有的清單（首次是預設的 `gpt-5.6-terra`） |

模型預設帶 `limit: { context: 272000, output: 128000 }`。如果中轉站的上下文視窗不同，可在 `plugins.json` 裡覆寫該供應商的 `models`。

### 自訂模型目錄 URL

magpie 內建「自訂供應商」允許填一個「模型目錄 URL」，本外掛也有同等能力：環境變數 **`MAGPIE_WS_RELAY_MODELS_URL`**（絕對位址，例如 `https://relay.example/v1/models`；舊版登入存過的 `models_url` 按帳號優先）。留空就走 `{base_url}/models`；兩者都失敗則保留 magpie 已有清單。手填的模型 id 優先級最高，其次 `models_url`，最後才是 `/models`。

### 供應商卡片名稱自訂

magpie 內建「自訂供應商」有一個名稱輸入框；外掛供應商沒有原生的名稱編輯入口（卡片名由 `config` 鉤子決定），所以本外掛從環境變數 **`MAGPIE_WS_RELAY_NAME`** 讀卡片名（舊版登入存過的 `display_name` 按帳號優先）。設定後，下次 magpie 重載宿主即可生效。都沒填就用「Codex Proxy RS (WS)」。

> [!TIP]
> 想立刻生效：填完名稱後，在應用裡把外掛關掉再打開一次（終端 `magpie` 每次讀目前檔案）。第一次裝好、尚未登入時，卡片名是預設名，登入並重載後變成你填的名字。

### 中轉站餘額怎麼接、怎麼參與 APP

magpie 內建「自訂供應商」可以設定「餘額介面」。本外掛透過 **`auth.usage` 鉤子**實作同等能力，設定來自環境變數（舊版登入存過的同名 metadata 按帳號優先）：

| 環境變數 | 作用 |
| --- | --- |
| `MAGPIE_WS_RELAY_BALANCE_URL` | 餘額介面的 GET/POST 位址；**不設就不顯示餘額**（不會報錯） |
| `MAGPIE_WS_RELAY_BALANCE_METHOD` | `GET`（預設）或 `POST` |
| `MAGPIE_WS_RELAY_BALANCE_QUERY` | POST 時的請求體，支援 `{key}` 佔位被替換成 Client Key |
| `MAGPIE_WS_RELAY_BALANCE_PATH` | 從 JSON 回應裡取值的點路徑，如 `data.balance`、`wallet.credits`；留空則自動取最大的數值欄位 |
| `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | 單位，如 `USD` / `積分`；只用於顯示，如 `123.45 USD` |

餘額在 APP 裡的資料流（與 magpie 一致）：

1. **手動更新**：供應商卡片上點「重新整理用量 / Refresh allowance」會呼叫 `auth.usage`，結果寫進帳號的用量資訊。
2. **卡片顯示**：餘額作為供應商的額度（`balance`）顯示在卡片上，和套餐用量、限流視窗並列。
3. **用量統計 / 路由**：`balance` 是一個**預付錢包餘額**（無總額）。magpie 在 provider 的多個帳號裡，會把「同一單位、餘額最多」的帳號排在前面優先嘗試（#3950）。它**不是消費計數器**——magpie 不會在每次請求後扣減它，只是把餘額讀出來展示和排序。
4. **選用視窗**：若中轉站回傳的是「已用/總額」式限流視窗（而不是純餘額），可以改成在 `auth.usage` 裡回傳 `windows` 結構（帶 `used` / `limit` / `unit`）。目前版本預設只回傳 `balance`，夠覆蓋絕大多數「錢包餘額」場景。

> [!NOTE]
> `auth.usage` 只讀、不寫：它不會修改中轉站上的任何狀態。取數失敗時回傳 `{ error }`，卡片會顯示讀取失敗而不是崩潰。

### 圖示從哪裡來

卡片圖示 = `auth.icon`（本外掛已內建一個紫色內聯 SVG）。magpie 的優先級是 `auth.icon` 先，`package.json` 的 `magpie.icon` 兜底，二者都接受 `https://` 連結或 `data:image/…` 內聯圖（≤1.5MB）。想換成自己的圖示，改 `index.js` 頂部的 `ICON` 常數，或改 `package.json` 的 `magpie.icon`。

## 安裝

資料夾方式（開發、自用）：

```sh
magpie plugin add ./ws-relay-plugin
magpie plugin login codex-proxy-ws      # Client Key、中轉站位址、模型 id
magpie provider test codex-proxy-ws
```

應用程式：外掛 → 新增外掛 → 資料夾路徑 → 在「來自外掛」找到 **Codex Proxy RS (WS)** → 登入。

> [!TIP]
> 資料夾外掛以絕對路徑註冊，裝好後不要搬動或改名目錄。改過 `index.js` / `package.json` 後，把外掛關閉再開啟即可重新載入（終端裡的 `magpie` 指令每次都會讀目前檔案）。

### 開關

供應商編輯頁 → **外掛選項 → 走 WebSocket 中轉 → 關閉 / 開啟**。來自 `auth.options`，依供應商 id 存進 `settings.json` 的 `pluginOptions`，每個請求開始時即時讀取，**切換後下一個請求就生效，不用重啟**。

| 狀態 | 行為 |
| --- | --- |
| 開（預設） | `POST /responses` 走 WebSocket；其它請求、非 http(s) 位址、建連失敗自動回退 HTTP |
| 關 | 全部走 `fetch` 透傳，不建立 socket |

```sh
magpie plugin options codex-proxy-ws '{"ws": false}'
magpie plugin options codex-proxy-ws off          # 回復外掛預設值
```

> [!NOTE]
> 開關標題、說明與開啟前確認提供 `zh` / `zh-TW` / `ja` / `de` 四種譯文，英文為後備，隨視窗語言切換。

## 協定

| 環節 | 約定 |
| --- | --- |
| 握手 | `GET {base}/responses` Upgrade、`Authorization: Bearer <key>`、`OpenAI-Beta: responses_websockets=2026-02-06` |
| 請求幀 | 一條文字幀 `{"type":"response.create", ...body}`，強制 `stream: true` |
| `previous_response_id` | 僅在原連線有效，換連線會 400 `previous_response_not_found`；外掛會移除並送完整歷史 |
| 回應幀 | 每幀一個 JSON 事件，幀內容即 SSE `data:`，`event:` 取 `type`；`usage`、`id`、`model`、限流標頭保留 |
| 前導幀 | `response.metadata` / `codex.response.metadata` / `codex.rate_limits` / `response.created` / `response.in_progress` 等也寫入 SSE，供 quota 記帳 |
| 終態 | `response.completed` / `failed` / `incomplete` / `done` / `error`；**沒有 `[DONE]`，不偽造** |
| 錯誤幀 | 首個業務事件前的 `{"type":"error","status":503,…}` 會合成 HTTP 錯誤並帶上 `Retry-After` / `x-request-id`，故障切換才會生效 |
| 心跳 | Ping/Pong 由中轉站與 Bun 處理，不轉成 SSE |
| 生命週期 | 一請求一連線；輸出開始後不重放；AbortSignal 會關閉 ws |

## 提示與常見問題

> [!TIP]
> **為什麼開關不在內建的「自訂供應商」頁？** 那是 magpie 自己供應商（`providers.json`）的編輯器，欄位由所有自訂供應商共用；外掛選項屬於 `pluginOptions`，按外掛註冊的供應商 id 存放。把開關放進內建頁等於改核心設定邏輯，還得加一層「哪個供應商該顯示」的過濾。本外掛選擇零侵入。

> [!TIP]
> **為什麼我的外掛詳細頁上半部，和商店裡別人（npm 套件）的不一樣？** 因為**中繼資料來源不同**，不是 bug。
> - 從 **npm 發布**的外掛：詳細頁上部的「作者、`vX.Y.Z`、週下載量、授權、更新於」以及「npm / 原始碼」按鈕，全部來自 **npm registry + magpie 社群清單**（`market.json` / `registry.json`），本機沒有這些資料的外掛不會顯示。
> - 用**資料夾路徑**（絕對路徑）安裝的外掛：詳細頁只讀一個 `README.md`，`更新於` 取該檔案的 mtime，其餘中繼資料全部缺失——所以你看到的是「圖示 + 名稱 + 路徑 + 更新於 + README 正文」。
> - 想對齊前先補齊：在 `package.json` 裡填好 `description` / `author` / `license` / `repository` / `homepage`，圖示用 `magpie.icon`，這些**本機就會顯示**；但「週下載量、npm/原始碼按鈕」只有發布到 npm 後 magpie 才會拉到。
> - 結論：上半部的差異是「資料夾安裝 vs npm 安裝」的固有區別，不是本外掛缺功能。要完全對齊，走 [PUBLISHING.md](./PUBLISHING.md) 的 npm 發布路徑即可。

> [!TIP]
> **多個中轉站 / 多個 provider 怎麼辦？** 沒有寫死任何網域。同一供應商可登入多個帳號，各自填位址；magpie 依帳號拼好請求 URL，loader 直接轉成 `ws(s)`。想讓不同中轉站各有開關，複製此套件、改 `index.js` 頂部的 `ID` 常數，再註冊第二個供應商。

> [!TIP]
> **HTTP 能用就別開 ws。** 多數中轉站的 HTTP/SSE 雙棧更穩、排障更簡單。只有當你要貼近官方 Codex 指紋、需要連線內中繼資料幀或長連線時才打開開關。

> [!WARNING]
> `e2e.mjs` 必須用 **Bun** 執行（magpie 自帶）。Node 的全域 `WebSocket` 無法帶自訂握手標頭，會漏掉 `Authorization`。`test.mjs` 用 mock，Node 即可。

> [!WARNING]
> 已知限制：每輪新建連線、不做連線內續接；動態 `serviceTiers`、模型價格、按帳號的 WebSocket 代理設定尚未實作；`magpie.panels` 面板經原始碼查證沒有可持久化字串的通道（options 只收布林、沙箱 CSP 斷網），故未用作設定入口。進階設定的環境變數是**安裝級**（該 magpie 下所有帳號共享）；按帳號的餘額/名稱設定只來自舊版登入留下的 metadata。餘額是「讀取展示 + 路由排序」用途，`auth.usage` 已實作，但**不會在每次請求後扣減**（magpie 的餘額語意本就不是消費計數器）。

### 疑難排解

| 現象 | 檢查 |
| --- | --- |
| 詳細頁顯示 `has no README` | `README.md` 要和 `package.json` 同目錄 |
| 握手失敗並回退 HTTP | 位址是否以 `/v1` 結尾、金鑰、代理是否擋 CONNECT（回環會直連） |
| `400 previous_response_not_found` | 有請求繞過外掛（它一定會移除該欄位） |
| 只有預設模型 | `/models` 不可達或格式不同；登入時手填 id |
| 開關沒反應 | 選項按供應商 id 存放；確認改的是這個外掛的供應商，或重載外掛 |

## 測試

```sh
node test.mjs                      # 23 個協定/開關/多帳號/模型/名稱/餘額/env 場景，無需網路
CPRS_KEY=sk-… CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
```

`e2e.mjs` 會向真實中轉站發四個短請求並計費：WS 開、WS 關、上游錯誤幀、`previous_response_id`。金鑰只從環境變數讀取，不落盤。

## 上架

見 [PUBLISHING.md](./PUBLISHING.md)：npm、GitHub `magpie-plugin` topic、社群 `registry.json` 推薦列表三條路徑，以及「發現」頁各區塊的准入條件。本套件**尚未發布、尚未推送 GitHub**，僅以本地資料夾方式安裝。

## 授權

MIT
