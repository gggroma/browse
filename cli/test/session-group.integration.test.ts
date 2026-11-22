import { test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { startRelay, stopRelay, FakeExtension } from "./relay-harness.ts"
import { mcpStdio } from "./support/mcp-stdio.ts"

test("MCP session_group routes only owned physical tabs and preserves read-only sessions", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "browse-session-groups-"))
  const relay = await startRelay(home)
  let next = 100
  const extension = new FakeExtension(home, relay.port)
    .on("settings.get", () => ({ settings: { window: "current", grouping: "session" } }))
    .on("tabs.create", () => ({ tabId: ++next }))
    .on("Target.getTargetInfo", command => ({ targetInfo: { targetId: `T${command.params?.tabId}`, type: "page", title: "", url: "about:blank", attached: true, browserContextId: "CTX" } }))
    .on("Page.getFrameTree", command => ({ frameTree: { frame: { id: `T${command.params?.tabId}`, loaderId: "L", url: "about:blank", securityOrigin: "null", mimeType: "text/html" } } }))
    .on("tabs.group", () => ({ groupId: 7 }))
    .on("session.group", command => ({ groups: [{ id: 7, windowId: 1, title: command.params?.title ?? "C", collapsed: true, tabIds: command.params?.tabIds }] }))
  const mcp = mcpStdio({ home, port: relay.port })
  const call = async (name: string, args: Record<string, unknown>) => (await mcp.request("tools/call", { name, arguments: args })).result!
  try {
    expect(await extension.pair({ capabilities: ["session-groups"], hello: { profileId: "opera-profile", name: "Opera on Test" } })).toBe(true)
    const currentFile = path.join(home, "session.json")
    const priorCurrent = JSON.stringify({ endpoints: { [`http://127.0.0.1:${relay.port}`]: { id: "other-session" } } })
    fs.writeFileSync(currentFile, priorCurrent)
    const cli = spawn(process.execPath, [path.join(import.meta.dir, "../src/main.ts"), "session", "new-grouped", "c-cli", "--title", "C", "--browser", "opera-test"], {
      env: { ...process.env, OPENCODE_BROWSER_HOME: home, OPENCODE_BROWSER_PORT: String(relay.port), OPENCODE_BROWSER_AUTOSTART: "false" },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    cli.stdout.on("data", chunk => { output += chunk })
    cli.stderr.on("data", chunk => { output += chunk })
    const cliExit = await new Promise<number | null>(resolve => cli.on("close", resolve))
    expect(cliExit, output).toBe(0)
    expect(JSON.parse(output)).toMatchObject({ session: { id: "c-cli", browser: "opera-test" }, groups: [{ title: "C", collapsed: true }] })
    expect(fs.readFileSync(currentFile, "utf8")).toBe(priorCurrent)
    await mcp.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } })
    mcp.notify("notifications/initialized")
    expect((await call("session_delete", { id: "c-cli" })).isError).toBe(false)
    next = 100
    let groupedReady = false
    extension.on("tabs.group", async command => {
      if (command.params?.sessionId === "c-ready") {
        await Bun.sleep(75)
        groupedReady = true
      }
      return { groupId: 7 }
    })
    extension.on("session.group", command => {
      if (command.params?.sessionId === "c-ready" && !groupedReady) throw new Error("Session tab is ungrouped; use session grouping")
      return { groups: [{ id: 7, windowId: 1, title: command.params?.title ?? "C", collapsed: true, tabIds: command.params?.tabIds }] }
    })
    const prepared = await call("session_new_grouped", { id: "c-ready", title: "C", browser: "opera-test" })
    expect(prepared.isError, JSON.stringify(prepared)).toBe(false)
    expect(JSON.stringify(prepared)).toContain('"browser":"opera-test"')
    expect(extension.commands.filter(c => c.method === "tabs.group").at(-1)?.params).toEqual({ tabId: 101, sessionId: "c-ready" })
    expect(extension.commands.filter(c => c.method === "session.group").at(-1)?.params).toEqual({
      sessionId: "c-ready", title: "C", collapsed: true, tabIds: [101],
    })
    expect((await call("session_delete", { id: "c-ready" })).isError).toBe(false)
    extension.on("session.group", command => ({ groups: [{ id: 7, windowId: 1, title: "C", collapsed: false, tabIds: command.params?.tabIds, blocked: "active-tab" }] }))
    expect((await call("session_new_grouped", { id: "c-blocked", title: "C" })).isError).toBe(true)
    expect(JSON.stringify(await call("session_list", {}))).toContain("c-blocked")
    expect((await call("execute", { session: "c-blocked", code: "return 42" })).isError).toBe(true)
    expect((await call("session_delete", { id: "c-blocked" })).isError).toBe(false)
    expect((await call("session_new_grouped", { id: "c-blocked-2", title: "C" })).isError).toBe(true)
    extension.on("session.group", command => ({ groups: [{ id: 7, windowId: 1, title: command.params?.title ?? "C", collapsed: true, tabIds: command.params?.tabIds }] }))
    expect((await call("session_group", { session: "c-blocked-2", title: "C", collapsed: true })).isError).toBe(false)
    expect((await call("session_delete", { id: "c-blocked-2" })).isError).toBe(false)
    next = 100
    for (const session of ["c-one", "c-two"]) {
      expect((await call("session_new", { id: session })).isError).toBe(false)
      expect((await call("execute", { session, code: "return 42" })).isError).toBe(false)
    }
    const result = await call("session_group", { session: "c-one", title: "C", collapsed: true })
    expect(result.isError).toBe(false)
    expect(extension.commands.filter(c => c.method === "session.group").at(-1)?.params).toEqual({ sessionId: "c-one", title: "C", collapsed: true, tabIds: [101] })
    const groups = extension.commands.filter(c => c.method === "session.group").length
    expect((await call("session_group", { session: "missing", title: "C" })).isError).toBe(true)
    expect((await call("session_new", { id: "look", readOnly: true })).isError).toBe(false)
    expect((await call("session_group", { session: "look", title: "C" })).isError).toBe(true)
    expect(extension.commands.filter(c => c.method === "session.group")).toHaveLength(groups)
    const refused = await fetch(`http://127.0.0.1:${relay.port}/cli/session/group`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "c-one" }) })
    expect(refused.status).toBe(401)
  } finally {
    mcp.close()
    extension.close()
    await stopRelay(relay.child)
    fs.rmSync(home, { recursive: true })
  }
}, 15000)
