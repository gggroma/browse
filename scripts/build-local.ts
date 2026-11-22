import { $ } from "bun"
import path from "node:path"
import { bundleCli } from "../cli/bundle.ts"

const root = path.resolve(import.meta.dir, "..")
const version = "0.1.5-local-groups.16"
const buildId = "local-session-groups-v16"
await $`${process.execPath} run build`.cwd(root).env({ ...process.env, OPENCODE_BROWSER_BUILD: buildId })
await bundleCli({ outdir: path.join(root, "cli/dist"), version, buildId })
await Bun.write(path.join(root, "dist/build.json"), JSON.stringify({ build: buildId }) + "\n")
console.log(`Built local extension and MCP client ${version} (${buildId}).`)
