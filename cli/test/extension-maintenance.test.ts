import { expect, test } from "bun:test"
import { Effect, Latch } from "effect"
import { RelayShutdown } from "../src/relay/shutdown.ts"
import { compareRelayBuilds, restartRelay } from "../src/relay/lifecycle.ts"
import type * as RelayClient from "../src/relay/client.ts"

test("local build identities order numerically without allowing incomparable builds", () => {
  expect(compareRelayBuilds("local-session-groups-v10", "local-session-groups-v9")).toBeGreaterThan(0)
  expect(compareRelayBuilds("local-session-groups-v6", "local-session-groups-v7")).toBeLessThan(0)
  expect(compareRelayBuilds("local-session-groups-v7", "2026-11-18T00:00:00Z")).toBeUndefined()
  expect(compareRelayBuilds("source-abc", "source-def")).toBeUndefined()
})

test("restart upgrades a local relay and refuses a local downgrade", async () => {
  const old = { version: "0.1.5", buildId: "local-session-groups-v6", instanceId: "old", managed: true, shutdownProtocol: 2 as const }
  let calls = 0
  let shutdowns = 0
  const relay = {
    endpoint: "http://127.0.0.1:19990",
    version: Effect.suspend(() => Effect.succeed(++calls < 3 ? old : { ...old, buildId: "local-session-groups-v7", instanceId: "new" })),
    shutdown: () => Effect.sync(() => { shutdowns++; return { stopping: true as const } }),
  } as unknown as RelayClient.Interface
  const result = await Effect.runPromise(restartRelay({ relay, buildId: "local-session-groups-v7", retryDelayMs: 1 }))
  expect(result.version.buildId).toBe("local-session-groups-v7")
  expect(shutdowns).toBe(1)
  calls = 0
  shutdowns = 0
  const rejected = await Effect.runPromise(Effect.exit(restartRelay({ relay, buildId: "local-session-groups-v5", retryDelayMs: 1 })))
  expect(rejected._tag).toBe("Failure")
  expect(shutdowns).toBe(0)
})

test("maintenance excludes new work and resumes admission afterward", async () => {
  const entered = Latch.makeUnsafe(false)
  const finish = Latch.makeUnsafe(false)
  let resumed = false
  const control = new RelayShutdown({
    instanceId: "one", managed: true, drain: Effect.void, resume: () => { resumed = true },
    busy: () => undefined, settle: Effect.void, quiescent: () => true,
    audit: () => Effect.void, stop: () => {}, log: () => {},
  })
  const work = Effect.runPromise(control.maintenance(Effect.gen(function* () {
    yield* entered.open
    yield* finish.await
    return "ok"
  })))
  await Effect.runPromise(entered.await)
  expect(control.accepting).toBe(false)
  expect(await Effect.runPromise(Effect.exit(control.track(Effect.void)))).toMatchObject({ _tag: "Failure" })
  await Effect.runPromise(finish.open)
  expect(await work).toBe("ok")
  expect(resumed).toBe(true)
  expect(control.accepting).toBe(true)
})

test("failed maintenance restores admission without stopping the relay", async () => {
  let resumed = 0
  const control = new RelayShutdown({
    instanceId: "one", managed: true, drain: Effect.void, resume: () => { resumed++ },
    busy: () => undefined, settle: Effect.void, quiescent: () => true,
    audit: () => Effect.void, stop: () => { throw new Error("must not stop") }, log: () => {},
  })
  const result = await Effect.runPromise(Effect.exit(control.maintenance(Effect.fail(new Error("reload failed")))))
  expect(result._tag).toBe("Failure")
  expect(resumed).toBe(1)
  expect(control.accepting).toBe(true)
})

test("a recording or capture refuses maintenance without running it", async () => {
  let executed = false
  const control = new RelayShutdown({
    instanceId: "one", managed: true, drain: Effect.void, resume: () => {},
    busy: () => ({ reason: "recordings", detail: "an active capture" }),
    settle: Effect.void, quiescent: () => true, audit: () => Effect.void, stop: () => {}, log: () => {},
  })
  const result = await Effect.runPromise(Effect.exit(control.maintenance(Effect.sync(() => { executed = true }))))
  expect(result._tag).toBe("Failure")
  expect(executed).toBe(false)
  expect(control.accepting).toBe(true)
})
