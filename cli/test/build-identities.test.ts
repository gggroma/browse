import { expect, test } from "bun:test"
import { compareBuildIdentities } from "../src/mcp/build-identities.ts"

test("compares known builds and keeps missing identities unknown", () => {
  expect(compareBuildIdentities("a", "a", "a", "a")).toEqual({
    client: "a", relay: "a", extension: "a", repository: "a",
    relayMatch: "match", extensionMatch: "match", repositoryMatch: "match",
  })
  expect(compareBuildIdentities("a", "b", undefined, undefined)).toEqual({
    client: "a", relay: "b", extension: null, repository: null,
    relayMatch: "mismatch", extensionMatch: "unknown", repositoryMatch: "unknown",
  })
})
