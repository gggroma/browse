import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import WebSocket from "ws"
import { connectCdp, FakeExtension, startRelay, stopRelay } from "./relay-harness.ts"

test("reload selects one browser and verifies its reconnected build", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "browse-reload-safe-"))
  let relay: Awaited<ReturnType<typeof startRelay>> | undefined
  let first: FakeExtension | undefined
  let second: FakeExtension | undefined
  let replacement: FakeExtension | undefined
  try {
    relay = await startRelay(home)
    const active = relay
    const api = (route: string, body?: object) => fetch(`http://127.0.0.1:${active.port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${active.token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    first = new FakeExtension(home, relay.port).on("runtime.reload", () => {
      setTimeout(async () => {
        first!.close()
        replacement = new FakeExtension(home, active.port)
        await replacement.pair({ hello: { profileId: "first", name: "First", build: "new-build" } })
      }, 20)
      return {}
    })
    expect(await first.pair({ hello: { profileId: "first", name: "First", build: "old-build" } })).toBe(true)
    second = new FakeExtension(home, relay.port)
    expect(await second.pair({ hello: { profileId: "second", name: "Second" } })).toBe(true)
    const status = await (await api("/extension/status")).json() as { browsers: { id: string; name: string }[] }
    const browser = status.browsers.find(item => item.name === "First")!.id
    const client = await connectCdp(`ws://127.0.0.1:${relay.port}/devtools/browser/test`, { authorization: `Bearer ${relay.token}` })
    if (!(client instanceof WebSocket)) throw new Error(`CDP connection refused: ${client}`)
    const busy = await api("/extension/reload-safe", { browser, build: "new-build" })
    expect(busy.status).toBe(409)
    expect(first.commands.some(command => command.method === "runtime.reload")).toBe(false)
    client.close()
    await new Promise<void>(resolve => client.once("close", () => resolve()))
    const result = await api("/extension/reload-safe", { browser, build: "new-build" })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ browser, build: "new-build", reloaded: true })
    expect(second.commands.some(command => command.method === "runtime.reload")).toBe(false)
  } finally {
    first?.close()
    second?.close()
    replacement?.close()
    await stopRelay(relay?.child)
    fs.rmSync(home, { recursive: true, force: true })
  }
}, 30000)
