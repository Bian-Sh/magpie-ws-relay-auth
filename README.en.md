# Codex Proxy RS (WS) · Responses WebSocket Relay

> [!TIP]
> A magpie / OpenCode provider plugin that turns a relay's Responses WebSocket frames into standard SSE. Flip one switch off and it becomes an ordinary HTTP/SSE custom provider. No changes to magpie itself.

[简体中文](./README.md) · **English** · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Deutsch](./README.de.md)

## What it is

Many relays expose the same Responses API twice:

| Transport | Works with magpie out of the box? | This plugin |
| --- | --- | --- |
| `POST /v1/responses` over HTTP/SSE | Yes, as a custom provider | Passed through unchanged when the switch is off |
| `GET /v1/responses` WebSocket Upgrade | No, outbound requests are HTTP only | Dials ws, sends one `response.create` frame, converts every frame back into SSE |

It is an optional enhancement, not a requirement. The WebSocket path carries the official Codex/Responses fingerprint (one request frame, `response.*` events, no `[DONE]`, connection-scoped metadata frames), while HTTP/SSE remains an always-available fallback.

Any relay implementing OpenAI's official Responses WebSocket protocol works, including [zyycn/codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) and compatible gateways. No hostname is hard-coded and no vendor name is checked. Live-tested against a compatible gateway (101 handshake, 13 events, error frames, `previous_response_id`).

> [!WARNING]
> Plugins are other people's code: they sign in and make the requests, so they see the conversation, tools and results. Only point this at a relay you trust. Credentials stay on this machine; the plugin writes no logs and sends nothing elsewhere.

## Sign-in and where credentials live

| Item | Detail |
| --- | --- |
| Method | API key (`Client API key`, placeholder `sk-…`) |
| Prompts | Just one: the relay base URL (blank = `http://127.0.0.1:8080/v1`), then the key — **two screens in all**. Card name, models, the catalog URL and the balance are not asked at sign-in (see "Advanced configuration") |
| Key storage | `plugin-auth.json` in magpie's config directory, mode 600, managed by magpie |
| Prompt answers | Stored in that account's `metadata`, beside the key |
| Multiple accounts | Sign in several times under the same provider (`id#xxxxxx`). Each account has its own base URL, name, model list and balance config; loaders run in the account's scope |
| Quota | An `auth.usage` hook reports balance when configured; nothing shown when left blank |
| Icon | The card icon comes from `auth.icon` (a built-in purple inline SVG), with `package.json`'s `magpie.icon` as fallback; both accept an https link or a `data:image` URI |
| Proxy | HTTP requests use magpie's per-provider/account proxy. The WebSocket currently reads `HTTPS_PROXY` / `HTTP_PROXY`; loopback addresses bypass it |

### Advanced configuration (card name / models / catalog URL / balance)

Sign-in asks for the address and the key only. Everything else has two sources, neither of which interrupts sign-in:

| Setting | Env var (install-wide, shared by every account) | Legacy account (per account) |
| --- | --- | --- |
| Card name | `MAGPIE_WS_RELAY_NAME` | a `display_name` stored by an older sign-in |
| Manual model ids | `MAGPIE_WS_RELAY_MODELS` | a stored `models` |
| Model-catalog URL | `MAGPIE_WS_RELAY_MODELS_URL` | a stored `models_url` |
| Balance endpoint | `MAGPIE_WS_RELAY_BALANCE_URL` | a stored `balance_url` |
| Balance method | `MAGPIE_WS_RELAY_BALANCE_METHOD` (GET/POST) | `balance_method` |
| Balance POST body | `MAGPIE_WS_RELAY_BALANCE_QUERY` (`{key}` = the key) | `balance_query` |
| Balance JSON path | `MAGPIE_WS_RELAY_BALANCE_PATH` (blank = auto) | `balance_path` |
| Balance unit | `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | `balance_currency` |

Precedence: **account metadata (left by an older sign-in) > env var > default**. Accounts signed in with 0.4.0 or earlier need no changes; env changes apply on the next host reload. Set `MAGPIE_WS_RELAY_ACTOR_AUTH` to an empty string to omit the `x-openai-actor-authorization` handshake header (the older `MAGPIE_CODEX_PROXY_*` names still work).

> [!TIP]
> **Why can't sign-in be one sheet, like the built-in "Custom provider"?** magpie's plugin sign-in protocol (`nextPrompt` in `host.js`) renders one prompt per screen, checks the answer, then asks the next (the OpenCode `auth login` pattern) — a plugin cannot draw a multi-field form. `magpie.panels` panels do embed in the provider editor, but a sandboxed panel has no way to persist a string (options are booleans only, and the CSP blocks the network). So this plugin cuts the questions to the minimum: **address + key, two screens**, as long as the built-in sheet's two required fields; the rest defaults, with env vars when needed.

Headless installs can go all-env: `MAGPIE_WS_RELAY_BASE_URL` stands in for the address prompt.

## Models

Manually entered ids win. With the prompt left blank, the plugin fetches `{base}/models` once per account and reads an OpenAI-compatible `{"data":[{"id":…}]}` list. On failure, or before sign-in, magpie keeps its existing list (initially `gpt-5.6-terra`). Models default to `limit: { context: 272000, output: 128000 }`; override them in `plugins.json` if your relay differs.

### Custom model-catalog URL

magpie's built-in custom provider lets you set a model-catalog URL; this plugin has the same: the env var **`MAGPIE_WS_RELAY_MODELS_URL`** (an absolute URL, e.g. `https://relay.example/v1/models`; a `models_url` stored by an older sign-in wins per account). Blank uses `{base}/models`; both failing keeps magpie's list. Precedence: manually entered ids > `models_url` > `/models`.

### Supplier card name

The built-in custom provider has a name field; plugin providers have no native name editor (the card name is decided by the `config` hook), so this plugin reads it from the env var **`MAGPIE_WS_RELAY_NAME`** (a `display_name` stored by an older sign-in wins per account). It takes effect on the next host reload. Blank keeps "Codex Proxy RS (WS)".

### Relay balance

magpie's custom provider can configure a balance endpoint; this plugin does the same through the **`auth.usage`** hook, configured by env vars (a stored metadata of the same name wins per account):

| Env var | Purpose |
| --- | --- |
| `MAGPIE_WS_RELAY_BALANCE_URL` | GET/POST balance endpoint; **unset shows no balance** (no error) |
| `MAGPIE_WS_RELAY_BALANCE_METHOD` | `GET` (default) or `POST` |
| `MAGPIE_WS_RELAY_BALANCE_QUERY` | POST body, `{key}` is replaced with the Client Key |
| `MAGPIE_WS_RELAY_BALANCE_PATH` | dotted path into the JSON, e.g. `data.balance`; blank auto-picks the largest number |
| `MAGPIE_WS_RELAY_BALANCE_CURRENCY` | unit shown after the amount, e.g. `USD` → `123.45 USD` |

How the balance flows through the app: the card's Refresh allowance calls `auth.usage` (manual update), the balance is shown on the card, and among a provider's accounts in the same unit magpie tries the one with the most balance first (#3950). It is **not a spend counter** — magpie never deducts from it after a request. For rate-limit windows instead, return `windows` from `auth.usage`.

### Where the icon comes from

The card icon is `auth.icon` (a purple inline SVG is built in). magpie prefers `auth.icon`, then `package.json`'s `magpie.icon`; both accept an `https://` link or a `data:image/…` inline image (≤1.5 MB). Change the `ICON` constant in `index.js`, or `magpie.icon`, to use your own.

## Install

```sh
magpie plugin add ./ws-relay-plugin
magpie plugin login codex-proxy-ws      # Client Key, relay URL, model ids
magpie provider test codex-proxy-ws
```

In the app: Plugins → add a plugin → the folder path → find **Codex Proxy RS (WS)** under "From plugins" → sign in.

> [!TIP]
> A folder plugin is registered by its absolute path: do not move or rename the directory afterwards. After editing code or metadata, turn the plugin off and on again to reload the host; `magpie` CLI commands always read the current files.

### The switch

Provider editor → **Plugin options → WebSocket relay → Off / On**. Declared through `auth.options`, stored per provider id in `settings.json` under `pluginOptions`, and read by the plugin at the start of every request — flipping it needs no reload.

| State | Behaviour |
| --- | --- |
| On (default) | `POST /responses` goes over WebSocket; anything else, non-http(s) URLs and failed handshakes fall back to HTTP |
| Off | Every request is passed through plain `fetch`; no socket is created |

Without the GUI:

```sh
magpie plugin options codex-proxy-ws '{"ws": false}'
magpie plugin options codex-proxy-ws off     # restore the plugin's default
```

> [!NOTE]
> The switch label, description and confirmation are translated into `zh`, `zh-TW`, `ja` and `de`, with English as fallback; magpie picks the window language.

## Wire protocol

| Stage | Contract |
| --- | --- |
| Handshake | `GET {base}/responses` Upgrade, `Authorization: Bearer <key>`, `OpenAI-Beta: responses_websockets=2026-02-06` |
| Request | One text frame `{"type":"response.create", ...body}`, `stream: true` forced |
| `previous_response_id` | Connection-local; a new socket gets 400 `previous_response_not_found`. The plugin drops it and sends the full history |
| Reply | One JSON event per frame; frame bytes become the SSE `data:`, `event:` is `type`. `usage`, `id`, `model` and rate-limit headers survive |
| Prelude | `response.metadata`, `codex.response.metadata`, `codex.rate_limits`, `response.created`, `response.in_progress` are emitted too, for quota accounting |
| Terminal | `response.completed` / `failed` / `incomplete` / `done` / `error`. **No `[DONE]` on the WebSocket path; the plugin does not fabricate one** |
| Errors | An `{"type":"error","status":503,…}` frame arriving before the first business event becomes an HTTP error with `Retry-After` / `x-request-id`, so failover still works |
| Heartbeat | Ping/Pong handled by the relay and Bun, never turned into SSE |
| Lifetime | One connection per turn; no replay once output has started; `Body.Close` / AbortSignal closes the socket |

## Tips and FAQ

> [!TIP]
> **Why isn't the switch on the built-in "Custom provider" page?** That editor belongs to magpie's own providers (`providers.json`) and its fields are shared by all of them. Plugin options belong to `pluginOptions`, keyed by the provider id a plugin registers. Adding a switch to the built-in editor would change core configuration logic for every provider and require a "which provider shows this?" filter. This plugin stays non-invasive.

> [!TIP]
> **Several relays or providers?** Nothing is tied to a hostname. Sign in multiple accounts under one provider, each with its own base URL; magpie builds the request URL per account and the loader simply converts it to `ws(s)`. For independent switches, copy the package and change the `ID` constant to register a second provider.

> [!TIP]
> **Why does my plugin's detail page top look different from a published (npm) plugin's?** It is the metadata source, not a bug. An npm-published plugin's top (author, `vX.Y.Z`, weekly downloads, license, "updated", npm/source buttons) comes from the **npm registry and magpie's community manifest** (`market.json` / `registry.json`); a folder-installed plugin has none of that. A folder plugin's detail page only renders one `README.md` (`updated` = its mtime), so you see icon + name + path + updated + README body. Filling `description` / `author` / `license` / `repository` / `homepage` and `magpie.icon` in `package.json` makes those show locally; weekly downloads and the npm/source buttons only appear after publishing to npm (see [PUBLISHING.md](./PUBLISHING.md)).

> [!TIP]
> **If HTTP/SSE works, you may not need WebSocket.** The dual-stack HTTP path is usually easier to debug. Turn ws on when you want the official Codex fingerprint, connection-scoped metadata frames, or the long-lived connection.

> [!WARNING]
> `e2e.mjs` must run under **Bun** (magpie ships one). Node's global `WebSocket` cannot send custom handshake headers, so `Authorization` is lost. `test.mjs` uses a mock and runs fine on Node.

> [!WARNING]
> Known limits: one connection per turn (no in-connection continuation yet), no pricing or `serviceTiers`, no per-account WebSocket proxy setting. `magpie.panels` panels were verified in source to have no way to persist a string (options are booleans only, the sandbox CSP blocks the network), so they are not used as a config surface. The advanced env vars are **install-wide** (shared by every account of this magpie); per-account balance/name settings only come from metadata left by an older sign-in. Balance is read-and-displayed (and used for routing); `auth.usage` is implemented but magpie does not deduct from it after each request.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Detail page says `has no README` | `README.md` must sit beside `package.json` |
| Handshake fails, falls back to HTTP | Base URL ends with `/v1`? Key correct? A proxy blocking CONNECT? Loopback bypasses proxies |
| `400 previous_response_not_found` | A request bypassed the plugin (it always strips that field) |
| Only the default model is listed | `/models` unreachable or in another shape; enter ids at sign-in |
| Switch has no effect | Options are stored per provider id; check you edited this plugin's provider, or reload the host |

## Tests

```sh
node test.mjs                      # 23 protocol/switch/account/model/name/balance/env scenarios, no network
CPRS_KEY=sk-… CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
```

The live test sends four short billable turns: ws on, ws off, an upstream error frame and `previous_response_id`. The key is read from the environment only.

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for npm, the GitHub `magpie-plugin` topic, and the community `registry.json` list. This package is **not published and not pushed to GitHub yet**; it is installed from a local folder.

## License

MIT
