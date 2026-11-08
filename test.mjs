// Unit / protocol tests. Node is enough here: the mock WebSocket accepts
// the same options as Bun's. Run: node test.mjs
import assert from "node:assert/strict"
import fs from "node:fs"
import { CodexProxyWsPlugin } from "./index.js"

process.env.MAGPIE_CODEX_PROXY_BASE_URL = "http://127.0.0.1:8080/v1"

class MockWebSocket {
  static instances = []
  static frames = []
  static failOpen = false
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.listeners = {}
    this.readyState = 0
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      if (MockWebSocket.failOpen) {
        this.emit("close", { code: 1006, reason: "refused" })
        return
      }
      this.readyState = 1
      this.emit("open", {})
    })
  }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn) }
  emit(t, e) { for (const fn of this.listeners[t] ?? []) fn(e) }
  send(frame) {
    this.sent = frame
    queueMicrotask(() => {
      for (const f of MockWebSocket.frames) this.emit("message", { data: f })
    })
  }
  close() { this.emit("close", { code: 1000, reason: "" }) }
}
globalThis.WebSocket = MockWebSocket

let fallbackCalls = 0
const httpFetch = async () => {
  fallbackCalls += 1
  return new Response("http fallback", { status: 599 })
}
globalThis.fetch = httpFetch

// 0. the switch, its translated words, the config hook and the models hook
const switches = { "codex-proxy-ws": { ws: true } }
const input = { magpie: { option: (provider, key) => switches[provider]?.[key] === true } }
const p = await CodexProxyWsPlugin(input)
const opt = p.auth.options[0]
assert.equal(opt.key, "ws")
assert.equal(opt.placement, "top")
assert.equal(opt.default, true)
for (const lang of ["zh", "zh-TW", "ja", "de"]) {
  assert.ok(opt.labels[lang], `missing label for ${lang}`)
  assert.ok(opt.descriptions[lang], `missing description for ${lang}`)
  assert.ok(opt.confirms[lang], `missing confirm tip for ${lang}`)
}
assert.equal(p.auth.methods[0].prompts.length, 1, "sign-in must ask ONE question (host renders prompts one per screen)")
assert.equal(p.auth.methods[0].prompts[0].key, "base_url")
assert.equal(p.provider.id, "codex-proxy-ws")
const cfg = {}
await p.config(cfg)
assert.equal(cfg.provider["codex-proxy-ws"].npm, "@ai-sdk/openai", "must register Responses protocol")
assert.equal(cfg.provider["codex-proxy-ws"].api, "http://127.0.0.1:8080/v1")
assert.equal(cfg.provider["codex-proxy-ws"].models["gpt-5.6-terra"].limit.context, 272000)
const mine = { provider: { "codex-proxy-ws": { name: "mine" } } }
await p.config(mine)
assert.equal(mine.provider["codex-proxy-ws"].name, "mine", "config must not overwrite plugins.json")
console.log("PASS 0 · switch + 4-language tips + config + models contracts")

const loader = await p.auth.loader(async () => ({ type: "api", key: "sk-test" }))
assert.equal(loader.baseURL, "http://127.0.0.1:8080/v1")

const init = (extra = {}) => ({
  method: "POST",
  headers: new Headers({ "content-type": "application/json", "x-magpie-fallback": "1" }),
  body: JSON.stringify({
    model: "gpt-5.6-terra",
    input: "hello",
    stream: true,
    previous_response_id: "resp_old_connection_local",
  }),
  signal: new AbortController().signal,
  ...extra,
})
const URL = "http://127.0.0.1:8080/v1/responses"
const okFrames = [
  JSON.stringify({ type: "response.created", response: { id: "resp_1" } }),
  JSON.stringify({ type: "response.output_text.delta", delta: "hi" }),
  JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 3, output_tokens: 1 } } }),
]

// 1. normal streaming turn: frames become SSE, previous_response_id is dropped
MockWebSocket.instances = []
MockWebSocket.frames = [
  JSON.stringify({ type: "response.created", response: { id: "resp_1" } }),
  JSON.stringify({ type: "codex.rate_limits", rate_limits: { primary: { used_percent: 12 } } }),
  ...okFrames.slice(1),
]
MockWebSocket.failOpen = false
let res = await loader.fetch(URL, init())
assert.equal(res.status, 200)
assert.match(res.headers.get("content-type"), /text\/event-stream/)
const text = await res.text()
for (const kind of ["response.created", "codex.rate_limits", "response.output_text.delta", "response.completed"]) {
  assert.ok(text.includes(`event: ${kind}\n`), `missing SSE event ${kind}`)
}
assert.ok(text.includes('"usage"'), "usage block must survive")
assert.ok(!text.includes("[DONE]"), "Responses WS has no [DONE] frame")
const ws = MockWebSocket.instances[0]
assert.equal(ws.url, "ws://127.0.0.1:8080/v1/responses")
assert.equal(ws.opts.headers.authorization, "Bearer sk-test")
assert.equal(ws.opts.headers["openai-beta"], "responses_websockets=2026-02-06")
assert.equal(ws.opts.headers["x-magpie-fallback"], undefined, "internal headers stay off the handshake")
const sent = JSON.parse(ws.sent)
assert.equal(sent.type, "response.create")
assert.equal(sent.stream, true)
assert.equal(sent.previous_response_id, undefined, "connection-local id must not cross sockets")
assert.equal(sent.input, "hello")
assert.equal(fallbackCalls, 0, "must not fall back on a healthy turn")
console.log("PASS 1 · streaming frames -> SSE, handshake + response.create")

// 2. error frame before any output becomes an HTTP error for magpie failover
MockWebSocket.frames = [JSON.stringify({
  type: "error",
  status: 429,
  error: { type: "quota", code: "insufficient_quota", message: "quota exhausted" },
  headers: { "retry-after": "30", "x-request-id": "req_1" },
})]
res = await loader.fetch(URL, init())
assert.equal(res.status, 429)
assert.equal(res.headers.get("retry-after"), "30")
assert.equal(res.headers.get("x-request-id"), "req_1")
const err = await res.json()
assert.equal(err.error.code, "insufficient_quota")
console.log("PASS 2 · error frame -> HTTP 429 with retry headers")

// 3. a broken socket falls back to the relay's HTTP/SSE endpoint
MockWebSocket.failOpen = true
fallbackCalls = 0
res = await loader.fetch(URL, init())
assert.equal(res.status, 599)
assert.equal(fallbackCalls, 1)
console.log("PASS 3 · ws handshake failure -> HTTP fallback")

// 4. non-responses paths stay plain HTTP
MockWebSocket.failOpen = false
fallbackCalls = 0
res = await loader.fetch("http://127.0.0.1:8080/v1/models", init({ method: "GET" }))
assert.equal(res.status, 599)
assert.equal(fallbackCalls, 1)
console.log("PASS 4 · non-turn requests -> plain HTTP")

// 5. switch off -> the same request over plain HTTP, no socket at all
switches["codex-proxy-ws"].ws = false
MockWebSocket.failOpen = false
MockWebSocket.instances = []
fallbackCalls = 0
res = await loader.fetch(URL, init())
assert.equal(res.status, 599)
assert.equal(fallbackCalls, 1)
assert.equal(MockWebSocket.instances.length, 0, "switch off must not open a socket")
console.log("PASS 5 · switch off -> plain HTTP, no WebSocket")

// 6. flipping it back takes effect on the very next request (no reload)
switches["codex-proxy-ws"].ws = true
MockWebSocket.instances = []
MockWebSocket.frames = okFrames
fallbackCalls = 0
res = await loader.fetch(URL, init())
assert.equal(res.status, 200)
assert.equal(fallbackCalls, 0)
assert.equal(MockWebSocket.instances.length, 1)
console.log("PASS 6 · switch on again -> ws on the next request, no reload")

// 7. no vendor host is hard-coded: any http(s) /responses turn may use ws
MockWebSocket.instances = []
MockWebSocket.frames = okFrames
fallbackCalls = 0
res = await loader.fetch("https://other.example/v1/responses", init())
assert.equal(res.status, 200)
assert.equal(fallbackCalls, 0)
assert.equal(MockWebSocket.instances.length, 1)
assert.equal(MockWebSocket.instances[0].url, "wss://other.example/v1/responses")
console.log("PASS 7 · any relay host -> ws (no hard-coded URL filter)")

// 8. a URL that is not http(s) is never turned into a socket
MockWebSocket.instances = []
fallbackCalls = 0
res = await loader.fetch("ws://other.example/v1/responses", init())
assert.equal(res.status, 599)
assert.equal(fallbackCalls, 1)
assert.equal(MockWebSocket.instances.length, 0)
console.log("PASS 8 · non-http(s) URL -> plain HTTP")

// 9. an unset switch uses the declared default (ws on)
const fresh = await CodexProxyWsPlugin({ magpie: { option: () => undefined } })
const freshLoader = await fresh.auth.loader(async () => ({ type: "api", key: "sk-test" }))
MockWebSocket.instances = []
MockWebSocket.frames = okFrames
fallbackCalls = 0
res = await freshLoader.fetch(URL, init())
assert.equal(res.status, 200)
assert.equal(MockWebSocket.instances.length, 1)
console.log("PASS 9 · unset switch -> declared default")

// 10. a second account with its own relay address keeps its own socket
const second = await p.auth.loader(async () => ({
  type: "api", key: "sk-second", metadata: { base_url: "https://second.example/v1" },
}))
assert.equal(second.baseURL, "https://second.example/v1")
MockWebSocket.instances = []
MockWebSocket.frames = okFrames
fallbackCalls = 0
res = await second.fetch("https://second.example/v1/responses", init())
assert.equal(res.status, 200)
assert.equal(fallbackCalls, 0)
assert.equal(MockWebSocket.instances[0].url, "wss://second.example/v1/responses")
assert.equal(MockWebSocket.instances[0].opts.headers.authorization, "Bearer sk-second")
console.log("PASS 10 · per-account relay addresses, no shared filter")

// 11-13. per-account models: manual list, relay /models, graceful fallback
const current = { models: { "gpt-5.6-terra": { id: "gpt-5.6-terra", name: "gpt-5.6-terra" } } }
let models = await p.provider.models(current, {
  auth: { type: "api", key: "sk-test", metadata: { models: "m1, m2" } },
})
assert.deepEqual(Object.keys(models), ["m1", "m2"])
console.log("PASS 11 · sign-in prompt models win")

globalThis.fetch = async (url) => {
  if (String(url).endsWith("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "model-a", name: "Model A" }, { id: "model-b" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    })
  }
  return httpFetch(url)
}
models = await p.provider.models(current, { auth: { type: "api", key: "sk-test" } })
assert.deepEqual(Object.keys(models), ["model-a", "model-b"])
assert.equal(models["model-a"].name, "Model A")
console.log("PASS 12 · blank prompt -> relay /models list")

globalThis.fetch = async () => { throw new Error("offline") }
models = await p.provider.models(current, { auth: { type: "api", key: "sk-test" } })
assert.equal(models, current.models, "a failed lookup keeps the existing list")
console.log("PASS 13 · /models failure keeps magpie's list")

globalThis.fetch = httpFetch

// 14. auth.icon is set so the provider card shows it (auth.icon wins)
assert.equal(p.auth.icon?.startsWith("data:image/svg+xml"), true, "auth.icon should be an inline svg")
console.log("PASS 14 · provider icon present")

// 15. supplier card name from a stored sign-in (metadata kept in
// plugin-auth.json — accounts signed in with the older, longer prompt list)
const tmpHome = "C:/Users/BianShanghai/AppData/Local/Temp/wsrelay-test-home"
const authFile = `${tmpHome}/magpie/plugin-auth.json`
fs.mkdirSync(`${tmpHome}/magpie`, { recursive: true })
fs.writeFileSync(authFile, JSON.stringify({
  "codex-proxy-ws": { metadata: { display_name: "我的中转站", base_url: "https://named.example/v1" } },
}))
const savedEnv = { XDG: process.env.XDG_CONFIG_HOME, APP: process.env.APPDATA, LOCAL: process.env.LOCALAPPDATA, HOME: process.env.HOME }
for (const k of ["XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "HOME"]) process.env[k] = tmpHome
const named = await CodexProxyWsPlugin(input)
const namedCfg = {}
await named.config(namedCfg)
assert.equal(namedCfg.provider["codex-proxy-ws"].name, "我的中转站", "config must pick up the stored display name")
Object.assign(process.env, savedEnv)
fs.rmSync(authFile, { force: true })
console.log("PASS 15 · card name from a stored sign-in (legacy metadata)")

// 16. models_url override (absolute) wins over the relay's /models
globalThis.fetch = async (url) => {
  if (String(url) === "https://cat.example/models") {
    return new Response(JSON.stringify({ data: [{ id: "cat-a" }, { id: "cat-b", name: "Cat B" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    })
  }
  return httpFetch(url)
}
models = await p.provider.models(current, { auth: { type: "api", key: "sk-test", metadata: { models_url: "https://cat.example/models" } } })
assert.deepEqual(Object.keys(models), ["cat-a", "cat-b"])
assert.equal(models["cat-b"].name, "Cat B")
// and a broken models_url keeps magpie's list
globalThis.fetch = async (url) => {
  if (String(url) === "https://broken.example/models") return new Response("err", { status: 500 })
  return httpFetch(url)
}
models = await p.provider.models(current, { auth: { type: "api", key: "sk-test", metadata: { models_url: "https://broken.example/models" } } })
assert.equal(models, current.models, "broken models_url keeps the existing list")
console.log("PASS 16 · models_url override + graceful fallback")

// 17-22. balance / credits hook
const balFetch = (body, status = 200) => async (url, init) => {
  if (typeof url === "string" && url.includes("credits")) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  return httpFetch(url, init)
}
// 17. explicit path + currency
globalThis.fetch = balFetch({ data: { balance: 123.45 } })
let u = await p.auth.usage(async () => ({ type: "api", key: "sk-test", metadata: { balance_url: "https://r/v1/credits", balance_path: "data.balance", balance_currency: "USD" } }))
assert.equal(u.balance, "123.45 USD")
// 18. auto-detect when no path (largest number)
globalThis.fetch = balFetch({ user: { name: "x" }, wallet: { credits: 9.5 }, plan: "pro", used: 2 })
u = await p.auth.usage(async () => ({ type: "api", key: "sk-test", metadata: { balance_url: "https://r/v1/credits" } }))
assert.equal(u.balance, "9.5")
// 19. POST with {key} substitution
let seenMethod = "", seenBody = ""
globalThis.fetch = async (url, init) => {
  seenMethod = init?.method ?? "GET"; seenBody = String(init?.body ?? "")
  return new Response(JSON.stringify({ amount: 7 }), { status: 200, headers: { "content-type": "application/json" } })
}
u = await p.auth.usage(async () => ({ type: "api", key: "sk-SECRET", metadata: { balance_url: "https://r/v1/credits", balance_method: "POST", balance_query: '{ "key": "{key}" }', balance_path: "amount" } }))
assert.equal(seenMethod, "POST")
assert.ok(seenBody.includes("sk-SECRET"), "{key} must be replaced in the body")
assert.equal(u.balance, "7")
// 20. HTTP error surfaces as error, not a crash
globalThis.fetch = balFetch({}, 500)
u = await p.auth.usage(async () => ({ type: "api", key: "sk-test", metadata: { balance_url: "https://r/v1/credits" } }))
assert.ok(u.error && /500/.test(u.error), "HTTP error must be reported")
// 21. no balance_url => report nothing (no error surfaced)
u = await p.auth.usage(async () => ({ type: "api", key: "sk-test", metadata: {} }))
assert.deepEqual(u, {}, "unconfigured balance reports nothing")
console.log("PASS 17-21 · balance: path+currency, auto, POST {key}, HTTP error, unconfigured")

// 22. env-only configuration: since sign-in asks one question, the balance
// endpoint and the model catalog can be set without touching any account —
// meta() falls back to MAGPIE_WS_RELAY_* for every earlier prompt key.
const envSaved = { BAL: process.env.MAGPIE_WS_RELAY_BALANCE_URL, PATH: process.env.MAGPIE_WS_RELAY_BALANCE_PATH, CUR: process.env.MAGPIE_WS_RELAY_BALANCE_CURRENCY, CAT: process.env.MAGPIE_WS_RELAY_MODELS_URL }
process.env.MAGPIE_WS_RELAY_BALANCE_URL = "https://envrelay/v1/credits"
process.env.MAGPIE_WS_RELAY_BALANCE_PATH = "data.balance"
process.env.MAGPIE_WS_RELAY_BALANCE_CURRENCY = "USD"
globalThis.fetch = balFetch({ data: { balance: 42 } })
u = await p.auth.usage(async () => ({ type: "api", key: "sk-test" }))
assert.equal(u.balance, "42 USD", "balance_url from env must work with no stored metadata")
// model catalog via env, on a metadata-less account
globalThis.fetch = async (url) => {
  if (String(url) === "https://envrelay/v1/models") {
    return new Response(JSON.stringify({ data: [{ id: "env-a" }, { id: "env-b", name: "Env B" }] }), {
      status: 200, headers: { "content-type": "application/json" },
    })
  }
  return httpFetch(url)
}
process.env.MAGPIE_WS_RELAY_MODELS_URL = "https://envrelay/v1/models"
models = await p.provider.models(current, { auth: { type: "api", key: "sk-test" } })
assert.deepEqual(Object.keys(models), ["env-a", "env-b"], "models_url from env must work with no stored metadata")
assert.equal(models["env-b"].name, "Env B")
for (const [k, v] of Object.entries({ MAGPIE_WS_RELAY_BALANCE_URL: envSaved.BAL, MAGPIE_WS_RELAY_BALANCE_PATH: envSaved.PATH, MAGPIE_WS_RELAY_BALANCE_CURRENCY: envSaved.CUR, MAGPIE_WS_RELAY_MODELS_URL: envSaved.CAT })) {
  if (v === undefined) delete process.env[k]; else process.env[k] = v
}
console.log("PASS 22 · env-only configuration (balance + model catalog, no stored metadata)")

globalThis.fetch = httpFetch
console.log("ALL PASS")
process.exit(0)
