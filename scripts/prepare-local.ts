import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
process.env.OPENCODE_BROWSER_HOME = path.join(path.dirname(root), "browse-group-controls-runtime")
process.env.OPENCODE_BROWSER_PORT = "19990"
const { mintPairingCode, writeExtensionPairing, bundledPairingCodeTtlMs } = await import("../cli/src/relay/browser-pairing.ts")
const code = mintPairingCode(undefined, { ttlMs: bundledPairingCodeTtlMs })
writeExtensionPairing(path.join(root, "dist"), code, 19990)
console.log("Prepared private one-time pairing for the local extension on port 19990; code omitted.")
