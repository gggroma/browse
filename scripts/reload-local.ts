import path from "node:path"
import { readFileSync } from "node:fs"
import { verifiedRelayEndpoint } from "../cli/src/relay/port.ts"
import { relayAuthorization } from "../cli/src/relay/secrets.ts"

// The local relay verifies idle state while blocking admission, then reloads only this browser.
const root = path.resolve(import.meta.dir, "..")
const build = (JSON.parse(readFileSync(path.join(root, "dist", "build.json"), "utf8")) as { build?: unknown }).build
if (typeof build !== "string" || !build.trim()) throw new Error("Build the repository extension first")
const endpoint = await verifiedRelayEndpoint()
if (!endpoint) throw new Error("The configured relay is unavailable or cannot be verified")
const headers = { authorization: relayAuthorization(), "content-type": "application/json" }
type Status = { connected?: boolean; pairingState?: string; origin?: string; browsers?: { id: string; connected: boolean }[] }
let status: Status = {}
// A managed relay restart can leave the paired extension offline until its reconnect alarm fires.
for (let attempt = 0; attempt < 45; attempt++) {
  const response = await fetch(`${endpoint}/extension/status`, { headers, redirect: "error", signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Cannot inspect extension status: HTTP ${response.status}`)
  status = await response.json() as Status
  if (status.connected || status.pairingState !== "paired-offline") break
  await Bun.sleep(1000)
}
const connected = status.browsers?.filter(browser => browser.connected) ?? []
if (!status.connected || status.origin !== "chrome-extension://afeafocngkodbmaipcngoamamfmekgfo" || connected.length !== 1) {
  throw new Error("Expected exactly one connected Browse-Agents browser with the local unpacked identity")
}
const response = await fetch(`${endpoint}/extension/reload-safe`, {
  method: "POST", headers, body: JSON.stringify({ browser: connected[0]!.id, build }),
  redirect: "error", signal: AbortSignal.timeout(30000),
})
if (response.status === 404) throw new Error("The running relay lacks guarded reload; restart it after browser work is idle")
const result = await response.json() as { reloaded?: boolean; build?: string; error?: string }
if (!response.ok || result.reloaded !== true || result.build !== build) {
  throw new Error(result.error ?? `Reload was not verified (HTTP ${response.status}); update the relay first`)
}
console.log(`Browse-Agents reloaded and verified: ${build}`)
