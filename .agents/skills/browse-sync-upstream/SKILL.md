---
name: browse-sync-upstream
description: Merge new official Browse upstream/dev commits into this fork's dev-group-controls branch, preserve the local Chrome extension and group controls, verify the merged build, and commit locally. Use for an explicit request to update the custom branch from official Browse.
---

# Sync official Browse into the custom branch

The official source is `upstream/dev` on `anomalyco/browse`. The destination is
`dev-group-controls` in this checkout. The fork's plain `dev` is its upstream
mirror. This workflow changes only `dev-group-controls` and creates one local
merge commit. A separate request is required to push. After a successful sync,
build and activate the verified local extension using the README's guarded
workflow when the relay is idle; preserve other chats' browser work.

## Fetch and merge

1. Verify the repository root, `upstream` URL, current branch and worktree
   status. Use the existing `dev-group-controls` checkout with a clean tree
   and no unrelated Git operation. Preserve uncommitted work and unpublished
   branch commits. If resuming this workflow's existing merge, verify both
   parents and continue in place without replacing the merge.
2. Run `git fetch upstream`, record the exact `upstream/dev` SHA and the
   current HEAD, and inspect the incoming commits and their authors with
   `git log --format='%h %an %s' HEAD..upstream/dev`. If the incoming SHA is
   already an ancestor of HEAD, report that the branch is current and finish
   without creating a commit. Check the upstream tip's latest CI status rather
   than assuming it is green.
3. Merge the recorded SHA with `git merge --no-commit --no-ff <sha>`. Resolve
   conflicts against both parents and inspect files changed on both sides
   even when Git merged them automatically. Keep upstream fixes and preserve
   the fork's TypeScript client and relay, explicit `session_group` tool,
   CLI group command, per-session title and collapse behavior, and tab
   ownership and handoff safeguards. Check both sides of the extension/relay
   protocol, tool schemas and relevant tests. If upstream replaces a component
   the fork depends on, reconcile its behavior at the new boundary before
   committing.
   Upstream now also ships a Rust runtime and retains `cli/` as a TypeScript
   reference. Integrate and verify Rust changes without silently changing the
   fork's local TypeScript MCP registration or dropping its group controls. Do
   not claim Rust group-control parity unless those contracts are implemented
   and tested in Rust.
   Compare incoming features and changed tool contracts with the local browser
   workflow. Update the canonical Browse usage guidance and affected dependent
   skills when those changes alter agent behavior or available capabilities.
4. Preserve the unpacked extension's manifest key, Chrome identity, and
   checkout-backed installation at `dist`. Follow the README's local version
   and build ID guidance when the merged code changes the extension or relay.
   Keep the isolated runtime, pairing and agent registrations out of the merge
   changes.

## Verify and commit

1. Read the merged package scripts and use the Bun version pinned in
   `package.json` (currently 1.4.4), the Node version used by CI (currently 24),
   and the Rust toolchain used by CI (currently 1.99.1). Check applicable types
   in the root and CLI, then run focused checks for changed boundaries,
   including the extension grouping and pairing scenarios, CLI session-group
   integration and MCP schema tests, and focused Rust tests for changed
   upstream behavior.
2. Build and test without writing to the live checkout's `dist` or
   `cli/dist`. On Windows, a disposable Linux container is a verified route
   for the POSIX-dependent suites. To test the exact resolved index, archive
   `git write-tree` with `git -c core.autocrlf=false archive`, verify LF shell
   scripts in the export, and extract it in the container. Initialize a Git
   index there for the tracked-file checks. Use the pinned Bun, frozen
   lockfiles, Node per the package requirements, and the suite's shell tools
   including `zip` and `jq`. Run `bun scripts/build-local.ts` there.
3. Review the complete staged merge with review-and-fix, scope thread.
   Verify both parents, the fork contracts, `git diff --check`,
   `git diff --cached --check`, and an empty `git ls-files -u`. After a clean
   review and passing focused checks, run the required full suites once on
   that exact merged tree: root `bun test ./test`, `bun test` in `cli`,
   `cargo clippy --workspace --all-targets --locked -- -D warnings`, and
   `cargo test --workspace --locked` in `rust`. Check any new upstream gates
   relevant to the merge. Record platform skips accurately, diagnose failures
   and rerun affected checks after fixes.

   This fork intentionally gives its unpacked local extension a
   `-local-groups.<N>` manifest version while the package and Rust workspace
   retain the upstream release version. `bun run release:check` rejects that
   intentional local identity, so do not treat it as an integration failure or
   normalize the exact merged tree. When release packaging also needs
   validation, make a second disposable export and run
   `bun scripts/version.ts set <package-version>` followed by
   `bun run release:check` there; report it as a normalized release check, not
   an exact-tree check. If the manifest has no local suffix, run
   `bun run release:check` on the exact merged tree. If required verification
   remains red, preserve the in-progress merge and report the exact blocker
   before committing.
4. Remove only task-owned verification artifacts and containers. Commit the
   verified merge on `dev-group-controls`. Confirm the two recorded parents,
   ancestry of the fetched official tip, no pending merge, and a clean
   worktree. Build and activate as described in the README when safe, verify
   the running extension identity and report any activation blocker. Report the
   upstream SHA, highlights and authors, tests and merge commit.
