// magpie plugin: bridge an OpenAI Responses WebSocket relay to HTTP/SSE.
//
// Works with any relay that speaks OpenAI's official Responses WebSocket
// protocol (codex-proxy-rs, and compatible gateways). The relay address,
// the model-catalog URL, the card name and the balance endpoint are all
// per account, read at sign-in; nothing in this file names a vendor host.
//
// Sign-in asks ONE question — the relay address — and then the key: two
// screens in all. magpie's plugin protocol asks its questions one at a
// time (host.js nextPrompt renders one prompt per screen), so a built-in-
// style all-fields dialog is not something a plugin can draw; the only way
// to keep sign-in painless is to keep it short. Everything the earlier
// build asked (card name, model ids, model-catalog URL, balance endpoint)
// still works and is read per account, from the account's stored metadata
// (accounts signed in with the older build) or from MAGPIE_WS_RELAY_* env
// vars — see README "Advanced configuration".
//
// Three fields magpie's built-in custom-provider form offers are covered:
//   1. supplier card name  -> MAGPIE_WS_RELAY_NAME (or a stored
//      "display_name" from an earlier sign-in), written back through the
//      config hook (the only place a plugin sets its card name)
//   2. model catalog URL    -> MAGPIE_WS_RELAY_MODELS_URL; blank uses the
//      relay's own /models; either way a failure keeps magpie's list
//   3. balance / credits    -> MAGPIE_WS_RELAY_BALANCE_* + the auth.usage
//      hook, surfaced on the card and used by routing (#3950)
//
// Wire contract (verified against zyycn/codex-proxy-rs docs/api.md and
// backend/crates/gateway-api/src/openai/responses/websocket/protocol.rs,
// then against a live compatible gateway):
//
//   handshake  GET {base}/responses with Upgrade: websocket
//              Authorization: Bearer <client-api-key>
//   request    one text frame: {"type":"response.create", <Responses body>}
//              stream must be omitted or true; explicit false is rejected.
//              previous_response_id is connection-local: drop it and send
//              the full history on every new connection.
//   reply      one text frame per Responses event. The frame's bytes are the
//              SSE `data:` payload; `event:` is the frame's "type" field.
//   prelude    response.metadata / codex.response.metadata /
//              codex.rate_limits / response.created / response.in_progress
//   terminal   response.completed / response.failed / response.incomplete /
//              response.done / error
//   error      {"type":"error","status":429,"error":{...},"headers":{...}}
//   heartbeat  the relay keeps Ping/Pong on both legs; Bun answers pongs.
//   close 1000 before any output: reconnect and resend the full input.
//
// Compatible relays serve the same API over HTTP/SSE as well. Anything that
// is not a POST /responses turn, and any ws failure before the first event,
// falls back to a plain fetch, so a broken WebSocket never takes the
// provider down.
//
// auth.options draws a per-provider On/Off switch in magpie's provider
// editor. The words are declared for zh / zh-TW / ja / de; English is the
// fallback. input.magpie.option reads the value as each request starts, so
// flipping the switch in the GUI needs no plugin reload.

import fs from "node:fs"
import path from "node:path"

const ID = "codex-proxy-ws"
const WS_OPTION = "ws"
const DEFAULT_WS = true
const DEFAULT_BASE = "http://127.0.0.1:8080/v1"
const DEFAULT_MODELS = "gpt-5.6-terra"
const OPEN_TIMEOUT_MS = 15_000
const FIRST_FRAME_TIMEOUT_MS = 60_000
const MAX_PRELUDE = 8

const ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%235b5bd6'/%3E%3Cpath%20d='M16%2024h22a8%208%200%200%201%200%2016H26'%20fill='none'%20stroke='white'%20stroke-width='5'%20stroke-linecap='round'/%3E%3Cpath%20d='m30%2018-8%206%208%206M30%2034l-8%206%208%206'%20fill='none'%20stroke='white'%20stroke-width='5'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E"

const PRELUDE = new Set([
  "response.created",
  "response.in_progress",
  "response.metadata",
  "codex.response.metadata",
  "codex.rate_limits",
  "responsesapi.websocket_timing",
])

const TERMINAL = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.done",
  "error",
])

const SKIP_HANDSHAKE = /^(content-type|content-length|content-encoding|accept|accept-encoding|connection|upgrade|host|sec-websocket-[a-z-]+|x-magpie-[a-z-]+|x-idempotency-key|idempotency-key)$/i
const KEEP_REPLY_HEADER = /^(x-request-id|x-gateway-request-id|x-oai-request-id|retry-after|.*ratelimit.*|x-codex-.*)$/i

// Headless installs may use env vars. The short names are the published
// ones; the CODEX_PROXY spellings stay as aliases for earlier installs.
function env(name, alias) {
  return process.env[name] || process.env[alias] || ""
}

function keyOf(auth) {
  if (!auth) return ""
  return auth.type === "oauth" ? auth.access ?? "" : auth.key ?? ""
}

function meta(auth, key, alias) {
  const m = auth?.metadata ?? {}
  return m[key] ?? m[alias] ?? env(envName(key), envName(alias)) ?? ""
}

// env names mirror the prompt keys, upper-cased and MAGPIE_WS_RELAY_ prefixed
function envName(key) {
  return "MAGPIE_WS_RELAY_" + String(key).toUpperCase().replace(/-/g, "_")
}

// The one sign-in prompt sets the relay address per account; the other
// settings come from stored metadata or env (see meta()). Any http(s)
// base works. The CODEX_PROXY env spellings stay as aliases for earlier
// installs that set them.
function baseURL(auth) {
  const own = meta(auth, "base_url") || env("MAGPIE_CODEX_PROXY_BASE_URL")
  return String(own || DEFAULT_BASE).replace(/\/+$/, "")
}

function manualModels(auth) {
  return String((meta(auth, "models") || env("MAGPIE_CODEX_PROXY_MODELS")) ?? "").trim()
}

function modelCatalogURL(auth) {
  const u = String(meta(auth, "models_url") ?? "").trim()
  if (!u) return "" // blank => relay's own {base}/models
  return u
}

function modelList(raw) {
  const out = {}
  for (const id of String(raw || DEFAULT_MODELS).split(",")) {
    const name = id.trim()
    if (name) out[name] = { id: name, name, limit: { context: 272_000, output: 128_000 } }
  }
  return out
}

// A relay's own /models list is used when the sign-in prompt was left
// blank. Any failure keeps the list magpie already has (docs: "连不上厂商
// 时"). A manually entered list, or a models_url, always wins.
async function remoteModels(base, auth, catalog) {
  const url = catalog || `${base}/models`
  const secret = keyOf(auth)
  if (!secret) return null
  try {
    const init = { headers: { authorization: `Bearer ${secret}` } }
    if (catalog && /^post$/i.test(String(meta(auth, "balance_method") || ""))) {
      init.method = "POST"
      const q = String(meta(auth, "balance_query") || "").trim()
      if (q) { init.headers["content-type"] = "application/json"; init.body = q }
    }
    const res = await globalThis.fetch(url, init)
    if (!res.ok) return null
    const body = await res.json()
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []
    const out = {}
    for (const row of rows) {
      const id = typeof row === "string" ? row : row?.id ?? row?.name
      if (!id) continue
      const name = typeof row === "string" ? row : row?.name ?? id
      out[id] = { id, name, limit: { context: row?.context_length ?? 272_000, output: 128_000 } }
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

// ---- supplier card name -----------------------------------------------------
// A plugin's card name is whatever config.provider[id].name says at load;
// the GUI has no native field for it, so the config hook reads the name the
// user typed at sign-in (kept in magpie's plugin-auth.json) and writes it
// back. Best-effort: if the file isn't there yet (first load, before any
// sign-in), the default name stands until the next host reload.
function authStorePath() {
  const cands = []
  const push = (base, ...segs) => { if (base) cands.push(path.join(base, ...segs)) }
  push(process.env.XDG_CONFIG_HOME, "magpie", "plugin-auth.json")
  push(process.env.APPDATA, "magpie", "plugin-auth.json")
  push(process.env.LOCALAPPDATA, "magpie", "plugin-auth.json")
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) { push(home, ".config", "magpie", "plugin-auth.json"); push(home, "magpie", "plugin-auth.json") }
  for (const f of cands) {
    try { fs.accessSync(f); return f } catch { /* try the next candidate */ }
  }
  return ""
}

function storedDisplayName(providerId) {
  try {
    const f = authStorePath()
    if (!f) return ""
    const raw = JSON.parse(fs.readFileSync(f, "utf8"))
    for (const [k, v] of Object.entries(raw)) {
      if (k === providerId || k.startsWith(providerId + "#")) {
        const m = v?.metadata ?? {}
        const name = m.display_name ?? m.DisplayName ?? ""
        if (name) return String(name)
      }
    }
  } catch { /* no sign-ins yet, or unreadable */ }
  return ""
}

// ---- balance / credits ------------------------------------------------------
// Walk a dotted path with optional [n] index into an object.
function dig(obj, p) {
  if (!obj || !p) return undefined
  let cur = obj
  for (const seg of String(p).split(".")) {
    const m = /^([\w$]+)\[(\d+)\]$/.exec(seg)
    if (m) cur = cur?.[m[1]]?.[Number(m[2])]
    else cur = cur?.[seg]
    if (cur == null) return undefined
  }
  return cur
}

// magpie's usage hook gives the allowance shown on the card and used by
// routing (#3950): an account with the most balance left is tried first
// among the provider's accounts in the same unit. Defining auth.usage with
// no balance_url configured just reports nothing (no error surfaced).
async function readBalance(auth) {
  const url = String(meta(auth, "balance_url") ?? "").trim()
  if (!url) return null
  const method = String(meta(auth, "balance_method") || "GET").toUpperCase()
  const secret = keyOf(auth)
  const init = { method, headers: { authorization: `Bearer ${secret}` } }
  const q = String(meta(auth, "balance_query") || "").trim()
  if (method === "POST" && q) {
    init.headers["content-type"] = "application/json"
    init.body = q.replace(/\{key\}/g, secret)
  }
  const res = await globalThis.fetch(url.replace(/\{key\}/g, secret), init)
  if (!res.ok) throw new Error(`balance endpoint ${res.status}`)
  const body = await res.json()
  const p = String(meta(auth, "balance_path") || "").trim()
  let amount = p ? dig(body, p) : autoBalance(body)
  amount = typeof amount === "string" ? Number(amount.replace(/[^0-9.\-]/g, "")) : Number(amount)
  if (!Number.isFinite(amount)) throw new Error("balance not found at the given path")
  const cur = String(meta(auth, "balance_currency") || "").trim()
  return { amount, currency: cur }
}

// Heuristic when no path is given: the largest plain number-bearing field.
function autoBalance(obj) {
  let best = undefined
  const walk = (o, depth) => {
    if (!o || depth > 6) return
    if (typeof o === "number") { if (best === undefined || o > best) best = o; return }
    if (typeof o === "object") for (const v of Object.values(o)) walk(v, depth + 1)
  }
  walk(obj, 0)
  return best
}

function socketURL(httpURL) {
  return httpURL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
}

function bodyText(body) {
  if (body == null) return "{}"
  if (typeof body === "string") return body
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
  return String(body)
}

function frameText(data) {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  if (data instanceof Blob) return null
  return String(data ?? "")
}

// One frame is one SSE event. JSON is re-serialised so a frame containing
// newlines cannot break the `data:` line, exactly as magpie's sseEvent does.
function sseEvent(kind, text) {
  let data = text.trim()
  try {
    data = JSON.stringify(JSON.parse(text))
  } catch {
    data = data.replace(/\r?\n/g, " ")
  }
  return `${kind ? `event: ${kind}\n` : ""}data: ${data}\n\n`
}

function handshakeHeaders(h) {
  const out = {}
  for (const [k, v] of h) {
    if (!SKIP_HANDSHAKE.test(k)) out[k] = v
  }
  out["openai-beta"] = "responses_websockets=2026-02-06"
  // A marker some relays use to recognise a proxy-managed credential. It is
  // not authentication; set the env var to an empty string to omit it.
  const actor = process.env.MAGPIE_WS_RELAY_ACTOR_AUTH ?? "proxy-managed"
  if (actor) out["x-openai-actor-authorization"] = actor
  return out
}

function proxyFor(url) {
  if (/^(wss?):\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(url)) return ""
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || ""
}

function statusOf(ev) {
  const n = Number(ev.status ?? ev.status_code)
  return n >= 400 && n <= 599 ? n : 502
}

function errorResponse(ev) {
  const h = new Headers({ "content-type": "application/json" })
  for (const bag of [ev.headers, ev.error?.headers, ev.response?.error?.headers]) {
    for (const [k, v] of Object.entries(bag ?? {})) {
      if (KEEP_REPLY_HEADER.test(k)) h.set(k, String(v))
    }
  }
  const error = ev.error ?? { type: "upstream_error", code: "websocket_error", message: "The relay answered with an error frame" }
  return new Response(JSON.stringify({ error }), { status: statusOf(ev), headers: h })
}

function collectHeaders(ev, into) {
  for (const bag of [ev.headers, ev.response?.headers, ev.response?.error?.headers]) {
    for (const [k, v] of Object.entries(bag ?? {})) {
      if (KEEP_REPLY_HEADER.test(k) && !into[k.toLowerCase()]) into[k.toLowerCase()] = String(v)
    }
  }
}

// One turn = one WebSocket. The Response is handed back as soon as the first
// real event arrives, so magpie sees a streaming SSE body, not a buffered one.
function openTurn(url, frame, headers, fallback, signal) {
  return new Promise((resolve) => {
    const enc = new TextEncoder()
    const replyHeaders = {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    }
    let ws = null
    let controller = null
    let settled = false
    let ended = false
    let anyFrame = false
    let attempts = 0
    let prelude = []
    let openTimer = null
    let firstTimer = null

    const clearTimers = () => {
      clearTimeout(openTimer)
      clearTimeout(firstTimer)
      openTimer = firstTimer = null
    }
    const done = (res) => {
      if (settled) return
      settled = true
      clearTimers()
      resolve(res)
    }
    let fallingBack = false
    // Only replayable turns fall back. Once the SSE Response is handed to
    // magpie the stream may already hold output, so close decides instead.
    const httpFallback = async (why) => {
      if (fallingBack || settled) return
      fallingBack = true
      try {
        ws?.close()
      } catch {
        // already closed
      }
      try {
        done(await fallback())
      } catch (e) {
        done(new Response(JSON.stringify({ error: { message: `WebSocket relay failed: ${why}: ${String(e?.message ?? e)}`, type: "upstream_error" } }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }))
      }
    }

    const finish = () => {
      if (ended) return
      ended = true
      try {
        controller?.close()
      } catch {
        // stream already closed by the reader
      }
      try {
        ws?.close(1000, "done")
      } catch {
        // already closed
      }
    }

    const onFrame = (text) => {
      if (text == null || !text.trim() || fallingBack) return
      anyFrame = true
      clearTimeout(firstTimer)
      firstTimer = null
      let ev
      try {
        ev = JSON.parse(text)
      } catch {
        return
      }
      const kind = typeof ev.type === "string" ? ev.type : ""

      if (!settled) {
        collectHeaders(ev, replyHeaders)
        if (kind === "error" && Number(ev.status ?? ev.status_code) >= 400) {
          done(errorResponse(ev))
          try {
            ws?.close(1000, "error frame")
          } catch {
            // already closed
          }
          return
        }
      }

      const event = sseEvent(kind, text)
      if (!settled) {
        prelude.push(event)
        if (PRELUDE.has(kind) && prelude.length < MAX_PRELUDE) return
        const pending = prelude
        prelude = []
        const stream = new ReadableStream({
          start(c) {
            controller = c
            for (const p of pending) c.enqueue(enc.encode(p))
          },
          cancel() {
            try {
              ws?.close(1000, "client cancelled")
            } catch {
              // already closed
            }
          },
        })
        done(new Response(stream, { status: 200, headers: replyHeaders }))
      } else {
        try {
          controller?.enqueue(enc.encode(event))
        } catch {
          // reader went away
        }
      }

      if (TERMINAL.has(kind)) finish()
    }

    const connect = () => {
      const opts = { headers: handshakeHeaders(headers) }
      const proxy = proxyFor(url)
      if (proxy) opts.proxy = proxy
      let current
      try {
        current = new WebSocket(url, opts)
      } catch (e) {
        httpFallback(String(e?.message ?? e))
        return
      }
      ws = current
      current.binaryType = "arraybuffer"
      current.addEventListener("open", () => {
        clearTimeout(openTimer)
        openTimer = null
        firstTimer = setTimeout(() => {
          if (!settled) httpFallback("no event before the first-frame timeout")
        }, FIRST_FRAME_TIMEOUT_MS)
        current.send(frame)
      })
      current.addEventListener("message", (e) => onFrame(frameText(e.data)))
      current.addEventListener("error", () => {
        // Bun follows an error with close; close decides what to do.
      })
      current.addEventListener("close", (e) => {
        clearTimers()
        if (settled) {
          if (!ended) {
            try {
              controller?.error(new Error(`relay websocket closed (${e.code}) before a terminal event`))
            } catch {
              // reader went away
            }
          }
          return
        }
        // A relay closes 1000 to ask for a reconnect with the full input.
        if (e.code === 1000 && !anyFrame && attempts < 1) {
          attempts += 1
          connect()
          return
        }
        httpFallback(`closed ${e.code} before any event ${e.reason ?? ""}`.trim())
      })
      openTimer = setTimeout(() => {
        if (!settled && current.readyState === 0) httpFallback("websocket handshake timed out")
      }, OPEN_TIMEOUT_MS)
    }

    signal?.addEventListener("abort", () => {
      if (settled && !ended) {
        try {
          controller?.error(signal.reason ?? new Error("cancelled"))
        } catch {
          // reader went away
        }
      } else {
        done(new Response(JSON.stringify({ error: { message: "cancelled", type: "cancelled" } }), {
          status: 502,
          headers: { "content-type": "application/json" },
        }))
      }
      try {
        ws?.close(1000, "cancelled")
      } catch {
        // already closed
      }
    }, { once: true })

    connect()
  })
}

export const CodexProxyWsPlugin = async (input) => {
  // magpie draws this switch in the provider's editor (auth.options) and
  // keeps its value per provider id. option() reads it as it stands, so a
  // change in the GUI reaches the next request with no plugin reload.
  // An unset switch falls back to the declared default; an older host that
  // has no magpie.option at all keeps the WebSocket path.
  const wsOn = () => {
    const read = input?.magpie?.option
    if (typeof read !== "function") return DEFAULT_WS
    for (const pid of [ID, `${ID}-plugin`]) {
      const v = read(pid, WS_OPTION)
      if (typeof v === "boolean") return v
    }
    return DEFAULT_WS
  }

  // Card name: a stored "display_name" (an account signed in with the
  // older, longer prompt list) first, else the env var, else a readable
  // default. Written into cfg so the GUI shows the user's name.
  const cardName = () => {
    const stored = storedDisplayName(ID)
    return stored || env("MAGPIE_WS_RELAY_NAME") || "Codex Proxy RS (WS)"
  }

  return {
    config: async (cfg) => {
      cfg.provider ??= {}
      // ??= keeps a provider the user configured in plugins.json.
      cfg.provider[ID] ??= {
        name: cardName(),
        // @ai-sdk/openai makes magpie speak Responses to this plugin, so the
        // request body can become a response.create frame without translation.
        npm: "@ai-sdk/openai",
        api: baseURL(),
        models: modelList(manualModels()),
      }
    },
    auth: {
      provider: ID,
      // The provider card shows this icon (auth.icon wins over package.json's
      // magpie.icon); both accept an https URL or a data:image URI.
      icon: ICON,
      options: [
        {
          key: WS_OPTION,
          label: "WebSocket relay",
          labels: {
            zh: "走 WebSocket 中转",
            "zh-TW": "走 WebSocket 中轉",
            ja: "WebSocket 中継を使う",
            de: "WebSocket-Relay verwenden",
          },
          description: "On: Responses turns go over the relay's WebSocket. Off: the same request goes over HTTP/SSE.",
          descriptions: {
            zh: "开：Responses 请求走中转站的 WebSocket；关：同一个请求走 HTTP/SSE 直连。切换后下一个请求立即生效，无需重启插件。",
            "zh-TW": "開：Responses 請求走中轉站的 WebSocket；關：同一個請求走 HTTP/SSE 直連。切換後下一個請求立即生效，無需重啟外掛。",
            ja: "オン：Responses リクエストを中継サーバーの WebSocket で送ります。オフ：同じリクエストを HTTP/SSE で送ります。切り替えは次のリクエストから有効です。",
            de: "An: Responses-Anfragen laufen über das WebSocket des Relays. Aus: dieselbe Anfrage läuft über HTTP/SSE. Gilt ab der nächsten Anfrage.",
          },
          confirm: "Turning this on sends Responses turns over the relay's WebSocket. If the relay does not support it, the request falls back to HTTP/SSE automatically.",
          confirms: {
            zh: "开启后 Responses 请求会改走中转站的 WebSocket；若中转站不支持，插件会自动回退到 HTTP/SSE，不会中断请求。",
            "zh-TW": "開啟後 Responses 請求會改走中轉站的 WebSocket；若中轉站不支援，外掛會自動回退到 HTTP/SSE，不會中斷請求。",
            ja: "オンにすると Responses リクエストは WebSocket 経由になります。中継サーバーが対応しない場合は自動的に HTTP/SSE へフォールバックします。",
            de: "Beim Einschalten laufen Responses-Anfragen über WebSocket. Unterstützt das Relay dies nicht, fällt die Anfrage automatisch auf HTTP/SSE zurück.",
          },
          default: DEFAULT_WS,
          placement: "top",
        },
      ],
      methods: [
        {
          type: "api",
          label: "Client API key",
          placeholder: "sk-…",
          // ONE question on purpose: magpie renders plugin prompts one per
          // screen (host.js nextPrompt), so every extra prompt is another
          // interruption. The relay address is the only thing sign-in cannot
          // guess; card name, models, the catalog URL and the balance
          // endpoint are read from stored metadata or MAGPIE_WS_RELAY_* env
          // vars instead (see meta()).
          prompts: [
            {
              type: "text",
              key: "base_url",
              message: "中转站地址 / Relay base URL（留空用默认值）",
              placeholder: "https://relay.example/v1  ·  https://…/v1",
              validate: (v) => (!v || /^https?:\/\//i.test(v) ? undefined : "请填 http(s):// 开头的地址 / Use an http(s):// URL"),
            },
          ],
        },
      ],
      loader: async (getAuth) => {
        let first
        try {
          first = await getAuth()
        } catch {
          // the fetch below reads the account again on every request
        }
        return {
          apiKey: keyOf(first),
          baseURL: baseURL(first),
          async fetch(url, init) {
            const a = await getAuth()
            const h = new Headers(init.headers)
            h.set("authorization", `Bearer ${keyOf(a)}`)
            const plain = { ...init, headers: h }
            const target = String(url)

            // The switch decides the transport. magpie already builds the
            // URL from this account's own baseURL and runs this loader in
            // the account's scope, so no vendor-specific URL check is
            // needed: any http(s) /responses turn can become a WS frame.
            // That also means several accounts, or several providers built
            // from this package, each get their own relay address.
            if (!wsOn() || !/^https?:\/\//i.test(target)) {
              return globalThis.fetch(url, plain)
            }
            // Only streamed Responses turns have a WebSocket endpoint.
            if ((init.method ?? "POST").toUpperCase() !== "POST" || !/\/responses(?:\?.*)?$/.test(target)) {
              return globalThis.fetch(url, plain)
            }
            let body
            try {
              body = JSON.parse(bodyText(init.body))
            } catch {
              return globalThis.fetch(url, plain)
            }
            // A previous_response_id belongs to the connection that produced
            // it. A new socket must carry the full history instead.
            delete body.previous_response_id
            body.stream = true
            const frame = JSON.stringify({ type: "response.create", ...body })
            return openTurn(socketURL(target), frame, h, () => globalThis.fetch(url, plain), init.signal)
          },
        }
      },
      // Per-account balance, shown on the card and used by routing (#3950).
      // No balance_url => report nothing (no error surfaced).
      async usage(getAuth) {
        const a = await getAuth()
        try {
          const b = await readBalance(a)
          if (!b) return {}
          const text = b.currency ? `${b.amount} ${b.currency}` : String(b.amount)
          return { balance: text }
        } catch (e) {
          return { error: String(e?.message ?? e) }
        }
      },
    },
    // Per-account models. A manually entered list wins; a models_url wins
    // over the relay's own /models; otherwise ask /models. Any failure
    // keeps magpie's list.
    provider: {
      id: ID,
      async models(current, { auth } = {}) {
        const manual = manualModels(auth)
        if (manual) return modelList(manual)
        const catalog = modelCatalogURL(auth)
        const live = await remoteModels(baseURL(auth), auth, catalog)
        return live ?? current.models
      },
    },
  }
}
