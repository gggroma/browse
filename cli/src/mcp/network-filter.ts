import type { NetworkExchange } from "../relay/schema.ts"

/** Filters only after the relay has redacted every exchange. */
export function filterNetworkExchanges(exchanges: readonly NetworkExchange[], failedOnly: boolean, domains: readonly string[]) {
  const hosts = new Set(domains.map((domain) => domain.toLowerCase()))
  const matching = exchanges.filter((entry) => {
    if (failedOnly && !entry.failure && (entry.response?.status ?? 0) < 400) return false
    if (!hosts.size) return true
    try {
      return hosts.has(new URL(entry.request.url).hostname.toLowerCase())
    } catch {
      return false
    }
  })
  return { exchanges: matching.slice(0, 100), filteredCount: matching.length, resultsTruncated: matching.length > 100 }
}
