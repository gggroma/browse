import { afterEach, expect, test } from "bun:test"
import { installChrome } from "../chrome-stub"

const nativeFetch = globalThis.fetch
const stub = installChrome()
const stubFetch = globalThis.fetch
const nativeWebSocket = globalThis.WebSocket
;(globalThis as { __OPENCODE_BROWSER_BUILD__?: string }).__OPENCODE_BROWSER_BUILD__ = "test"

afterEach(() => {
  globalThis.fetch = stubFetch
  globalThis.WebSocket = nativeWebSocket
})

test("a stopped local relay is retried without opening a refused WebSocket", async () => {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = reservation.port!
  await reservation.stop(true)
  await stub.chrome.storage.local.set({
    agentRelayPort: port,
    agentRelayTokens: { [`127.0.0.1:${port}`]: "test-token-0123456789abcdefghijklmnopqrst" },
  })

  globalThis.fetch = ((input: string | URL, init?: RequestInit) =>
    String(input) === `http://127.0.0.1:${port}/version` ? nativeFetch(input, init) : stubFetch(input, init)) as typeof fetch
  let refused = 0
  globalThis.WebSocket = new Proxy(nativeWebSocket, {
    construct(target, args) {
      const socket: WebSocket = Reflect.construct(target, args)
      socket.addEventListener("error", () => refused++)
      return socket
    },
  })

  const { createAgentRelay } = await import("../../src/background/agent-relay")
  const relay = createAgentRelay({ changed: () => {}, badgesChanged: () => {} })
  for (let i = 0; i < 200 && !(await relay.diagnostics()).includes("(retry scheduled)"); i++) await Bun.sleep(5)
  expect(await relay.diagnostics()).toContain("(retry scheduled)")
  expect(refused, await relay.diagnostics()).toBe(0)

  const protocol = Promise.withResolvers<string>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/version") return Response.json({ version: "0.1.5", instanceId: "test" })
      if (server.upgrade(request)) return
      return new Response(null, { status: 404 })
    },
    websocket: { message: (_socket, message) => protocol.resolve(String(message)) },
  })
  try {
    expect(JSON.parse(await protocol.promise)).toMatchObject({ method: "protocol" })
    expect(refused).toBe(0)
  } finally {
    await server.stop(true)
  }
})
