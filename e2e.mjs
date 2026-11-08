// Optional live check against a real relay. Run with Bun (magpie's own
// plugin runtime), NOT Node: Node's global WebSocket cannot send custom
// handshake headers, so the Authorization header would be dropped.
//
//   CPRS_KEY=sk-... CPRS_BASE=https://your-relay/v1 bun run e2e.mjs
//
// CPRS_BASE defaults to a local codex-proxy-rs. CPRS_MODEL defaults to
// gpt-5.6-terra. Four short turns are sent and billed by the relay.
import assert from "node:assert/strict"
import { CodexProxyWsPlugin } from "./index.js"

if (typeof Bun === "undefined") {
  console.error("Run this with Bun: bun run e2e.mjs")
  process.exit(1)
}

const key = process.env.CPRS_KEY
if (!key) {
  console.error("CPRS_KEY is required")
  process.exit(1)
}
const base = String(process.env.CPRS_BASE || "http://127.0.0.1:8080/v1").replace(/\/+$/, "")
const model = process.env.CPRS_MODEL || "gpt-5.6-terra"

const switches = { "codex-proxy-ws": { ws: true } }
const input = { magpie: { option: (p, k) => switches[p]?.[k] === true } }
const plugin = await CodexProxyWsPlugin(input)
const auth = { type: "api", key, metadata: { base_url: base, models: model } }
const loader = await plugin.auth.loader(async () => auth)

const body = (extra = {}) => JSON.stringify({
  model, input: "Reply with exactly one word: pong", stream: true, max_output_tokens: 16, ...extra,
})
const init = (extra = {}) => ({
  method: "POST",
  headers: new Headers({ "content-type": "application/json", authorization: `Bearer ${key}`, "x-magpie-probe": "1" }),
  body: body(),
  signal: new AbortController().signal,
  ...extra,
})
const timeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
])
const events = (text) => [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1])

// 1. switch ON -> the plugin's WebSocket path.
switches["codex-proxy-ws"].ws = true
let res = await timeout(loader.fetch(`${base}/responses`, init()), 60000, "ws turn")
let text = await res.text()
console.log("1 WS_ON  status=%d ct=%s bytes=%d", res.status, res.headers.get("content-type"), text.length)
console.log("  events:", events(text).join(" -> "))
console.log("  pong=%s usage=%s DONE=%s", text.includes("pong"), text.includes('"usage"'), text.includes("[DONE]"))
assert.equal(res.status, 200)
assert.match(res.headers.get("content-type"), /text\/event-stream/)
assert.ok(events(text).includes("response.created") && events(text).includes("response.completed"))
assert.ok(text.includes("pong") && text.includes('"usage"'))
assert.ok(!text.includes("[DONE]"), "ws path must not fabricate [DONE]")

// 2. switch OFF -> the same turn over plain HTTP/SSE.
switches["codex-proxy-ws"].ws = false
res = await timeout(loader.fetch(`${base}/responses`, init()), 60000, "http turn")
text = await res.text()
console.log("2 WS_OFF status=%d ct=%s bytes=%d", res.status, res.headers.get("content-type"), text.length)
assert.equal(res.status, 200)
assert.ok(text.includes("pong"))

// 3. an upstream error frame becomes an HTTP error for magpie's failover.
switches["codex-proxy-ws"].ws = true
res = await timeout(loader.fetch(`${base}/responses`, init({ body: body({ model: "no-such-model-xyz" }) })), 60000, "error frame")
const errBody = await res.json().catch(() => ({}))
console.log("3 ERROR  status=%d code=%s request-id=%s", res.status, errBody.error?.code, res.headers.get("x-request-id"))
assert.ok(res.status >= 400, "error frame must become an HTTP error")
assert.ok(errBody.error, "error body must be JSON with an error object")

// 4. a connection-local previous_response_id is stripped so the turn works.
res = await timeout(loader.fetch(`${base}/responses`, init({ body: body({ previous_response_id: "resp_from_another_socket" }) })), 60000, "previous_response_id turn")
text = await res.text()
console.log("4 PREV_ID status=%d pong=%s events=%d", res.status, text.includes("pong"), events(text).length)
assert.equal(res.status, 200)
assert.ok(text.includes("pong"))

console.log("E2E ALL PASS")
process.exit(0)
