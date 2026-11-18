import { Effect, Schema } from "effect"
import * as RelayClient from "../relay/client.ts"
import * as RelayLifecycle from "../relay/lifecycle.ts"
import { opencodeBrowserBuildId } from "../version.ts"
import { registerMcpTools } from "./registry.ts"
import { executeToolResult, objectSchema, optionalBooleanField, optionalStringField, parseExecuteArguments, requiredStringField } from "./schema.ts"

registerMcpTools({
  order: 100,
  build: (ctx) => [
    {
      name: "investigation_summary",
      description: "Summarize an explicitly identified owned default tab. Page content and captured network details require separate opt-in flags.",
      inputSchema: objectSchema({
        session: { type: "string", description: "Owned session ID." },
        targetId: { type: "string", description: "Owned default tab target ID from status." },
        includePage: { type: "boolean", description: "Include a bounded semantic snapshot and title." },
        includeNetwork: { type: "boolean", description: "Include bounded redacted failures from an already active capture." },
        find: { type: "string", description: "Optional snapshot search text." },
      }, ["session", "targetId"]),
      readOnly: true, destructive: false, idempotent: false, openWorld: true,
      outputSchema: Schema.Struct({
        session: Schema.String, targetId: Schema.String, value: Schema.Unknown,
        navigationCount: Schema.Number, consoleErrorCount: Schema.Number, pageErrorCount: Schema.Number,
      }),
      handle: (input) => Effect.gen(function* () {
        const sessionId = requiredStringField(input, "session")
        const targetId = requiredStringField(input, "targetId")
        const includePage = optionalBooleanField(input, "includePage") === true
        const includeNetwork = optionalBooleanField(input, "includeNetwork") === true
        const find = optionalStringField(input, "find")
        const version = yield* ctx.relay.version
        if (version.buildId !== opencodeBrowserBuildId) {
          return yield* Effect.fail(new Error("Investigation requires a matching client and relay build for owned-tab verification"))
        }
        const targets = yield* ctx.relay.targets
        if (!targets.some(target => target.id === targetId && target.owner === "relay" && target.opencodeBrowserSessionId === sessionId)) {
          return yield* Effect.fail(new Error("Target is not owned by this session"))
        }
        const code = `const capture = network.status();
const preview = ${includeNetwork} && capture.active ? network.preview() : null;
const matching = preview ? preview.exchanges.filter(e => e.failure || (e.response && e.response.status >= 400)) : [];
const failures = matching.slice(0, 50).map(e => ({ url: e.request.url, method: e.request.method, status: e.response?.status, failed: !!e.failure }));
const pageSnapshot = ${includePage} ? await snapshot({ maxItems: 80${find ? `, find: ${JSON.stringify(find)}` : ""} }) : null;
const pageInfo = pageSnapshot === null ? null : { title: (await page.title()).slice(0, 300), snapshot: pageSnapshot.slice(0, 12000), truncated: pageSnapshot.length > 12000 };
return { url: ${includePage} ? page.url().split(/[?#]/)[0].slice(0, 2000) : null, page: pageInfo, console: pageConsole.status(), network: { active: capture.active, detailsIncluded: ${includeNetwork}, failures, truncated: matching.length > 50, pending: preview?.pending ?? 0 } };`
        const result = yield* ctx.relay.execute({ sessionId, expectedOwnedTarget: targetId, code, createIfMissing: false })
        if (result.isError) return yield* Effect.fail(new Error(result.text))
        const aftermath = result.aftermath
        return {
          session: sessionId, targetId, value: result.value,
          navigationCount: aftermath?.navigations.length ?? 0,
          consoleErrorCount: aftermath?.consoleErrorCount ?? 0,
          pageErrorCount: aftermath?.pageErrorCount ?? 0,
        }
      }),
    },
    {
      name: "execute",
      description: `Execute Playwright JavaScript against the browse session. Code runs in a restricted JavaScript realm on the relay without process, require, import(), fs, child_process, http/https or Node fetch; save and read files with the files helper inside the execute file roots (file paths, including Playwright options like screenshot({ path }), must be in folders you own without group/world write access; files.path(name) gives a safe one), and cookie access is limited to the session's pages. Synchronous code stops after about 2 seconds. It is not a security boundary, so treat code as running as the user. The result includes console logs, warnings, a bounded execution-context diagnostic when relevant, and an aftermath summary (URL movement, navigations, error counts, handoffs, and a bot challenge or block page when one appears: hand interactive ones to the user with handoff(), never solve or retry-loop them).`,
      inputSchema: objectSchema(
        {
          code: {
            type: "string",
            description:
              'JavaScript code to execute. It receives browser, context, page, state, modules (path, url, util, crypto, buffer, zlib, events, stream), files (dir and roots properties; path(name), write(target, data), read(target, encoding?)), fillInput, fillInputs, snapshot(options?) for compact semantic outlines of the page and the content of its iframes (options: find to search them, diff or delta for changes, frames: false to leave iframe content out), persistent compatible ref(id) locators that resolve inside the frame they came from, webmcp (list/call), screenshotWithLabels(options?) and screenshotDiff(options) for screenshots, ariaSnapshot for Playwright\'s YAML tree followed by a labelled block per iframe with its content, handoff, demonstrate, network (start/status/stop/cancel), and pageConsole (start/stop capturing the page\'s own console messages and errors, off by default because pages can detect it). There is no location, document or fetch global (they belong to the page: use page.url() or page.evaluate(...)), and no structuredClone. These helpers exist only inside this string, never as globals of a client\'s own code runtime: in a client that runs tools in its own code mode, pass the Playwright code here as a string.',
          },
          session: {
            type: "string",
            description:
              "Optional existing browse session id. Explicit ids must already exist; omit this field to use your current session (per agent when the client names it; see `status`), which is created when needed.",
          },
          targetUrl: {
            type: "string",
            description:
              "Optional URL substring selecting an existing attached page. This does not navigate or open a URL; use page.goto() for that.",
          },
          targetIndex: {
            type: "integer",
            minimum: 0,
            description: "Optional zero-based attached page index selector.",
          },
          browser: ctx.browserProperty,
          timeoutMs: {
            type: "integer",
            minimum: 0,
            description:
              "Optional overall script timeout in milliseconds (paused while handoff() waits on the user); defaults to 60000, 0 disables. It includes time spent waiting behind another execute on the same session, and that call's handoff does not pause it. When set, it is also the timeout for Playwright actions and navigations in the code, at least 30 seconds; 0 removes those too.",
          },
        },
        ["code"],
      ),
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: true,
      // No outputSchema: clients that validate one reject image results, which carry no structured content.
      result: executeToolResult,
      handle: (input) =>
        Effect.gen(function* () {
          const args = yield* Effect.try(() => parseExecuteArguments(input))
          const caller = yield* ctx.caller
          const sessionId = args.session ?? caller.id
          const connected = RelayLifecycle.ensureExtensionConnected({ relay: ctx.relay, sessionId, waitForReconnect: true })
          yield* connected
          const run = ctx.relay.execute({
            sessionId,
            code: args.code,
            createIfMissing: !args.session,
            ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
            ...(args.targetSelection ? { targetSelection: args.targetSelection } : {}),
            ...(args.browser ? { browser: args.browser } : {}),
          })
          // The status check and the call race the browser's link closing (a worker restart): when the relay answers
          // that the session's browser isn't connected, wait for it once more and run once more.
          const result = yield* run.pipe(Effect.catchIf(
            (error): error is RelayClient.RelayRejected => error instanceof RelayClient.RelayRejected && error.code === "browser-unavailable",
            () => connected.pipe(Effect.andThen(run)),
          ))
          const recreated = !args.session && caller.established && result.session.created === true
          ctx.establishCurrentSession(caller, sessionId)
          return {
            ...result,
            ...(recreated
              ? { notice: `Recreated session '${sessionId}' — relay had no such session; page and state were reset.` }
              : {}),
          }
        }),
    },
  ],
})
