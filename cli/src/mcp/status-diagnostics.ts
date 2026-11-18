type Connection = {
  readonly connected: boolean
  readonly pairingState?: string
  readonly protocolCompatible?: boolean | null
}

export function statusDiagnostics(status: Connection, relayProblem: boolean) {
  const diagnostics: Array<{ layer: string; reason: string; nextStep: string }> = []
  if (!status.connected && (status.pairingState === "unpaired" || status.pairingState === "refused")) {
    diagnostics.push({ layer: "pairing", reason: status.pairingState, nextStep: "Pair the extension using the supported Browse pairing flow." })
  } else if (!status.connected) {
    diagnostics.push({ layer: "extension", reason: status.pairingState ?? "disconnected", nextStep: "Check the extension connection and its status before retrying." })
  }
  if (status.protocolCompatible === false) {
    diagnostics.push({ layer: "extension", reason: "protocol-incompatible", nextStep: "Update the extension and relay to compatible builds." })
  }
  if (relayProblem) {
    diagnostics.push({ layer: "relay", reason: "build-mismatch", nextStep: "Restart the isolated relay when its sessions and clients are idle." })
  }
  return diagnostics
}
