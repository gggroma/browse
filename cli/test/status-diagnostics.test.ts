import { expect, test } from "bun:test"
import { statusDiagnostics } from "../src/mcp/status-diagnostics.ts"

test("reports pairing, protocol and build failures with a layer and next step", () => {
  expect(statusDiagnostics({ connected: false, pairingState: "unpaired", protocolCompatible: null }, true)).toEqual([
    { layer: "pairing", reason: "unpaired", nextStep: "Pair the extension using the supported Browse pairing flow." },
    { layer: "relay", reason: "build-mismatch", nextStep: "Restart the isolated relay when its sessions and clients are idle." },
  ])
  expect(statusDiagnostics({ connected: true, protocolCompatible: false }, false)[0]?.layer).toBe("extension")
  expect(statusDiagnostics({ connected: true, protocolCompatible: true }, false)).toEqual([])
})
