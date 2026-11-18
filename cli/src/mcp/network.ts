import { Effect } from "effect"
import * as RelayLifecycle from "../relay/lifecycle.ts"
import { registerMcpTools } from "./registry.ts"
import {
  NetworkToolOutput,
  ensureSessionExists,
  objectSchema,
  optionalBooleanField,
  optionalStringArrayField,
  optionalStringField,
  requiredAction,
  requireObject,
  sessionSchemaProperty,
} from "./schema.ts"

const actions = ["start", "status", "stop", "cancel"] as const

registerMcpTools({
  order: 300,
  build: (ctx) => [
    {
      name: "network",
      description:
        "Start, inspect, stop, or cancel session-scoped network capture. browse records Playwright exchanges and replaces credential-bearing headers, cookies, query fields and structured body fields with [redacted]. Bodies are embedded with per-body and total memory limits. Actions: start begins a capture; status returns bounded metadata without captured values; stop ends it and returns the redacted exchanges; cancel ends it and discards them.",
      inputSchema: objectSchema(
        {
          action: {
            type: "string",
            enum: [...actions],
            description: "start begins a capture, status reports its bounded metadata, stop returns the redacted exchanges, cancel discards them.",
          },
          session: {
            type: "string",
            description:
              "Optional session id. Defaults to your current session; start creates it when missing.",
          },
          urlFilter: { type: "string", description: "For start: capture only request URLs containing this text." },
          failedOnly: { type: "boolean", description: "For stop: include only failed requests and HTTP errors." },
          domains: { type: "array", items: { type: "string" }, description: "For stop: include exact request hostnames." },
        },
        ["action"],
      ),
      readOnly: false,
      destructive: true,
      idempotent: false,
      openWorld: false,
      requiresRelayCompatibility: (input) => optionalStringField(input, "action") !== "status",
      outputSchema: NetworkToolOutput,
      handle: (input) =>
        Effect.gen(function* () {
          const action = yield* Effect.try(() => requiredAction(input, actions))
          const object = requireObject(input)
          if (action === "status") {
            const sessionId = yield* ctx.resolveSessionId(object)
            return { action, session: sessionId, ...(yield* ctx.relay.networkStatus({ sessionId })) }
          }
          if (action === "cancel") {
            const sessionId = yield* ctx.resolveSessionId(object)
            return { action, session: sessionId, ...(yield* ctx.relay.networkCancel({ sessionId })) }
          }
          if (action === "stop") {
            const sessionId = yield* ctx.resolveSessionId(object)
            const failedOnly = optionalBooleanField(object, "failedOnly")
            const domains = optionalStringArrayField(object, "domains")
            const result = yield* ctx.relay.networkStop({ sessionId })
            if (!failedOnly && !domains?.length) return { action, session: sessionId, ...result }
            const hosts = new Set(domains?.map((domain) => domain.toLowerCase()))
            const matching = result.exchanges.filter((entry) => {
              if (failedOnly && !entry.failure && (entry.response?.status ?? 0) < 400) return false
              if (!hosts.size) return true
              try {
                return hosts.has(new URL(entry.request.url).hostname.toLowerCase())
              } catch {
                return false
              }
            })
            const exchanges = matching.slice(0, 100)
            return { action, session: sessionId, ...result, exchanges, filteredCount: matching.length, resultsTruncated: matching.length > exchanges.length }
          }
          const explicitSession = optionalStringField(object, "session")
          const caller = yield* ctx.caller
          const sessionId = explicitSession ?? caller.id
          if (explicitSession) {
            yield* ensureSessionExists(ctx.relay, sessionId)
          } else {
            yield* ctx.relay.sessionEnsure(sessionId)
            caller.established = true
          }
          yield* RelayLifecycle.ensureExtensionConnected({ relay: ctx.relay, sessionId, waitForReconnect: true })
          const urlFilter = optionalStringField(object, "urlFilter")
          const result = yield* ctx.relay.networkStart({
            sessionId,
            ...(urlFilter ? { urlFilter } : {}),
          })
          return { action, session: sessionId, ...result }
        }),
    },
  ],
})
