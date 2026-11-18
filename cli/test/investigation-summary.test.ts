import "../src/mcp.ts"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { buildRegisteredMcpTools, createMcpToolContext } from "../src/mcp/registry.ts"
import type * as RelayClient from "../src/relay/client.ts"
import { opencodeBrowserBuildId } from "../src/version.ts"

test("summary rejects foreign targets and carries the owned-target guard to execute", async () => {
  let request: Record<string, unknown> | undefined
  const relay = {
    version: Effect.succeed({ buildId: opencodeBrowserBuildId }),
    targets: Effect.succeed([{ id: "owned", owner: "relay", opencodeBrowserSessionId: "c-one" }]),
    execute: (input: Record<string, unknown>) => {
      request = input
      return Effect.succeed({ isError: false, value: { console: { capturing: false }, network: { active: false } }, logs: [] })
    },
  } as unknown as RelayClient.Interface
  const context = createMcpToolContext({ relay, currentSession: { id: "c-one", established: true }, packageRoot: "/tmp" })
  const summary = buildRegisteredMcpTools(context).find(tool => tool.name === "investigation_summary")!
  await expect(Effect.runPromise(summary.handle({ session: "c-one", targetId: "foreign" }))).rejects.toThrow("not owned")
  const result = await Effect.runPromise(summary.handle({ session: "c-one", targetId: "owned" }))
  expect(request?.expectedOwnedTarget).toBe("owned")
  expect(request?.createIfMissing).toBe(false)
  expect(JSON.stringify(result)).toContain('"capturing":false')
})
