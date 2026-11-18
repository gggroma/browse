import fs from "node:fs"
import path from "node:path"

export function compareBuildIdentities(client: string, relay?: string | null, extension?: string | null, repository?: string | null) {
  const compare = (value?: string | null) => value ? (value === client ? "match" : "mismatch") : "unknown"
  return {
    client,
    relay: relay ?? null,
    extension: extension ?? null,
    repository: repository ?? null,
    relayMatch: compare(relay),
    extensionMatch: compare(extension),
    repositoryMatch: compare(repository),
  }
}

export function repositoryBuild(packageRoot: string): string | undefined {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(packageRoot, "../dist/build.json"), "utf8"))
    if (data && typeof data === "object" && "build" in data && typeof data.build === "string") return data.build
  } catch {
    // Installed clients may not have a checkout or a local build manifest.
  }
  return undefined
}
