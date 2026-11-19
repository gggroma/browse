import { expect, test } from "bun:test"
import { pairingProof, randomNonce } from "../../src/background/pairing"
import { installChrome } from "../chrome-stub"

const nativeFetch = globalThis.fetch
const stub = installChrome()
const stubFetch = globalThis.fetch
const nativeSocket = globalThis.WebSocket
const nativeSign = crypto.subtle.sign
;(globalThis as { __OPENCODE_BROWSER_BUILD__?: string }).__OPENCODE_BROWSER_BUILD__ = "test"

test("closing during an asynchronous pairing proof skips the stale send and reconnects", async () => {
  const token = "test-token-0123456789abcdefghijklmnopqrst"
  const ready = Promise.withResolvers<void>()
  const sentWhileClosing: string[] = []
  let current: WebSocket | undefined
  let interrupted = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/version") return Response.json({ version: "test", instanceId: "test" })
      if (server.upgrade(request)) return
      return new Response(null, { status: 404 })
    },
    websocket: {
      async message(socket, data) {
        const message = JSON.parse(String(data))
        if (message.method === "hello") {
          const nonce = randomNonce()
          const proof = await pairingProof(token, "relay", server.port!, nonce, message.params.pairing.nonce)
          socket.send(JSON.stringify({ method: "auth.challenge", params: { nonce, proof } }))
        }
        if (message.method === "ready") ready.resolve()
      },
    },
  })
  const port = server.port!
  try {
    await stub.chrome.storage.local.set({ agentRelayPort: port, agentRelayTokens: { [`127.0.0.1:${port}`]: token } })
    globalThis.fetch = ((input: string | URL, init?: RequestInit) =>
      String(input) === `http://127.0.0.1:${port}/version` ? nativeFetch(input, init) : stubFetch(input, init)) as typeof fetch
    globalThis.WebSocket = new Proxy(nativeSocket, {
      construct(target, args) {
        const socket: WebSocket = Reflect.construct(target, args)
        current = socket
        const send = socket.send.bind(socket)
        socket.send = (data) => {
          if (socket.readyState !== nativeSocket.OPEN) sentWhileClosing.push(JSON.parse(String(data)).method)
          send(data)
        }
        return socket
      },
    })
    crypto.subtle.sign = async (algorithm, key, data) => {
      if (!interrupted && new TextDecoder().decode(data).includes("|extension|")) {
        // Start a real close while the worker is between the OPEN check and the completed proof.
        current!.close(1000, "Test interruption")
        interrupted = true
      }
      return nativeSign.call(crypto.subtle, algorithm, key, data)
    }
    const { createAgentRelay } = await import("../../src/background/agent-relay")
    const relay = createAgentRelay({ changed: () => {}, badgesChanged: () => {} })
    await ready.promise
    expect(interrupted).toBe(true)
    expect(relay.state().status).toBe("connected")
    expect(sentWhileClosing).toEqual([])
  } finally {
    await server.stop(true)
    globalThis.fetch = stubFetch
    globalThis.WebSocket = nativeSocket
    crypto.subtle.sign = nativeSign
  }
})
