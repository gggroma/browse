import { expect, test } from "bun:test"
import { filterNetworkExchanges } from "../src/mcp/network-filter.ts"
import type { NetworkExchange } from "../src/relay/schema.ts"

function exchange(id: number, hostname: string, status: number): NetworkExchange {
  return {
    id: String(id), startedDateTime: "2026-01-01T00:00:00Z", durationMs: 1,
    request: { method: "GET", url: `https://${hostname}/?token=%5Bredacted%5D`, headers: [], resourceType: "fetch" },
    response: { status, statusText: "", headers: [] },
  }
}

test("filters redacted failures by exact hostname and reports truncation", () => {
  const input = [...Array.from({ length: 101 }, (_, i) => exchange(i, "api.example.com", 500)),
    exchange(102, "other.example.com", 500), exchange(103, "api.example.com", 200)]
  const result = filterNetworkExchanges(input, true, ["API.EXAMPLE.COM"])
  expect(result.filteredCount).toBe(101)
  expect(result.resultsTruncated).toBe(true)
  expect(result.exchanges).toHaveLength(100)
  expect(result.exchanges[0]?.request.url).toContain("%5Bredacted%5D")
})
