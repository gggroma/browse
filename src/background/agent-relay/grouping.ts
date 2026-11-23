import { isJsonObject } from "../../agent-relay/protocol"
import { AgentGroups } from "./groups"
import { serialQueue } from "../serial"
import { TabCleanup } from "../tab-cleanup"
import {
  autoNamed,
  GROUP_COLOR,
  groupTitle,
  GROUP_MARKER,
  ownedGroup,
  SESSION_GROUPS_KEY,
  sharedGroup,
  sharedTitle,
  type AgentRelayLog,
} from "./wire"

export function createRelayGrouping(deps: {
  readonly log: AgentRelayLog
  readonly relayTabs: Set<number>
  readonly currentSocket: () => WebSocket | undefined
  readonly isReloading: () => boolean
}) {
  /**
   * Each agent session's tab group, so a session keeps one group while its display name changes. Stored, so a service
   * worker restart doesn't put a session's next tab in a second group. Group ids don't survive a browser restart.
   */
  const sessionGroups = new Map<string, number>()
  const titles = new Map<string, string>()
  const titlesKey = "agentSessionGroupTitles"
  let sessionGroupsRestored: Promise<void> | undefined
  let recount: ReturnType<typeof setTimeout> | undefined

  const restoreSessionGroups = () =>
    (sessionGroupsRestored ??= chrome.storage.local
      .get([SESSION_GROUPS_KEY, titlesKey])
      .then((stored) => {
        const labels = stored[titlesKey]
        if (isJsonObject(labels)) for (const [id, title] of Object.entries(labels))
          if (typeof title === "string") titles.set(id, title)
        const saved = stored[SESSION_GROUPS_KEY]
        if (!isJsonObject(saved)) return
        for (const [key, groupId] of Object.entries(saved))
          if (typeof groupId === "number" && !sessionGroups.has(key)) sessionGroups.set(key, groupId)
      })
      .catch(() => undefined))

  const setSessionGroup = (key: string, groupId: number) => {
    if (sessionGroups.get(key) === groupId) return
    sessionGroups.set(key, groupId)
    void chrome.storage.local.set({ [SESSION_GROUPS_KEY]: Object.fromEntries(sessionGroups), [titlesKey]: Object.fromEntries(titles) }).catch(() => undefined)
  }

  const serially = serialQueue()

  /** Opera can resolve tabs.group before tabGroups publishes the new group to its other methods. */
  const waitForGroup = async (groupId: number) => {
    const deadline = Date.now() + 1_000
    let lastError: unknown
    do {
      try {
        return await chrome.tabGroups.get(groupId)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("No group with id:")) throw error
        lastError = error
        if (Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    } while (Date.now() < deadline)
    throw lastError
  }

  /** Undoes a group the relay made itself. A tab it is still responsible for keeps its idle tracking. */
  const undoGroup = (tabId: number) => TabCleanup.relayUngroup(tabId, () => chrome.tabs.ungroup(tabId).catch(() => undefined))

  /** Keeps a shared group's title counting its tabs. */
  const countShared = async (groupId: number) => {
    const item = await chrome.tabGroups.get(groupId).catch(() => undefined)
    if (!item || !sharedGroup(item.title)) return
    const count = (await chrome.tabs.query({ groupId }).catch(() => [])).length
    if (count && item.title !== sharedTitle(count))
      await chrome.tabGroups.update(groupId, { title: sharedTitle(count) }).catch(() => undefined)
  }

  /** Recounts every shared group soon: tabs closed, moved, or left or joined a group. */
  const recountShared = () => {
    clearTimeout(recount)
    recount = setTimeout(() => {
      void chrome.tabGroups
        .query({})
        .then(async (groups) => {
          for (const item of groups) if (sharedGroup(item.title)) await countShared(item.id)
        })
        .catch(() => undefined)
    }, 100)
  }

  /**
   * The shared group: one per window ("Agents · 3"), for every agent session's tabs, collapsed like a session's group.
   * Run one at a time so concurrent sessions find the group the first one made instead of each making one.
   */
  const groupShared = async (tabId: number, current: WebSocket) => {
    const tab = await chrome.tabs.get(tabId)
    const target = (await chrome.tabGroups.query({ windowId: tab.windowId })).find(
      (item) => item.windowId === tab.windowId && sharedGroup(item.title),
    )
    let groupId = target?.id
    if (groupId !== undefined) {
      if (tab.groupId !== groupId) await chrome.tabs.group({ tabIds: [tabId], groupId })
    } else {
      if (deps.currentSocket() !== current) throw new Error("The relay reconnected while grouping the tab")
      groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } })
      if (deps.currentSocket() !== current) {
        await undoGroup(tabId)
        throw new Error("The relay reconnected while grouping the tab")
      }
      await waitForGroup(groupId)
      if (deps.currentSocket() !== current) {
        await undoGroup(tabId)
        throw new Error("The relay reconnected while grouping the tab")
      }
      await chrome.tabGroups.update(groupId, { title: sharedTitle(1), color: GROUP_COLOR })
    }
    await countShared(groupId)
    await AgentGroups.adopt(groupId)
    return groupId
  }

  /**
   * Puts an agent's tab in its group, by the Grouping setting: the window's shared group (the default), the
   * session's group, or none. A tab already in an agent group of another kind (the setting changed since) stays where it is:
   * new tabs follow the new setting, and tabs aren't moved around under the user.
   */
  const group = async (tabId: number, sessionId: string | undefined, current: WebSocket) => {
    const tab = await chrome.tabs.get(tabId)
    // window.open(..., "popup") has no tab strip. A group here can't join the opener's group; creating
    // and naming a separate saved group needlessly blocks Chrome's UI thread during concurrent opens.
    if ((await chrome.windows.get(tab.windowId)).type === "popup") return chrome.tabGroups.TAB_GROUP_ID_NONE
    const mode = await AgentGroups.mode()
    const existing =
      tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? undefined : await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
    if (existing && ownedGroup(existing.title) && (mode === "none" || sharedGroup(existing.title) !== (mode === "shared"))) {
      await AgentGroups.adopt(existing.id)
      return existing.id
    }
    if (mode === "none") return chrome.tabGroups.TAB_GROUP_ID_NONE
    if (mode === "shared") return serially(() => groupShared(tabId, current))
    const key = sessionId ?? ""
    await restoreSessionGroups()
    const title = titles.has(key) ? `${titles.get(key)}${GROUP_MARKER}` : groupTitle(sessionId, tab.url)
    const known = sessionGroups.get(key)
    let target = known === undefined ? undefined : await chrome.tabGroups.get(known).catch(() => undefined)
    // The tab is already in a session group of ours the session has no record of (a worker restart lost it): it is
    // the session's group, so its other tabs join it rather than a new one.
    if ((!target || target.windowId !== tab.windowId) && existing && ownedGroup(existing.title) && !sharedGroup(existing.title)) {
      target = existing
      setSessionGroup(key, existing.id)
    }
    if (target && target.windowId === tab.windowId && ownedGroup(target.title)) {
      if (tab.groupId !== target.id) await chrome.tabs.group({ tabIds: [tabId], groupId: target.id })
      if (target.title !== title) await chrome.tabGroups.update(target.id, { title, color: GROUP_COLOR })
      await AgentGroups.adopt(target.id)
      return target.id
    }
    if (deps.currentSocket() !== current) throw new Error("The relay reconnected while grouping the tab")
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } })
    // chrome.tabs.group changes the tab before it resolves, so a stale command undoes its anonymous group.
    if (deps.currentSocket() !== current) {
      await undoGroup(tabId)
      throw new Error("The relay reconnected while grouping the tab")
    }
    await waitForGroup(groupId)
    if (deps.currentSocket() !== current) {
      await undoGroup(tabId)
      throw new Error("The relay reconnected while grouping the tab")
    }
    await chrome.tabGroups.update(groupId, { title, color: GROUP_COLOR })
    setSessionGroup(key, groupId)
    await AgentGroups.adopt(groupId)
    return groupId
  }

  /** Auto-named sessions take their group name from the site the agent is on, so it follows navigation. */
  const renameForPage = async (tabId: number, url: string | undefined) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return
    await restoreSessionGroups()
    const sessionId = Array.from(sessionGroups).find(([, id]) => id === tab.groupId)?.[0]
    if (sessionId === undefined || !autoNamed(sessionId)) return
    const current = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
    const title = groupTitle(sessionId, url)
    if (current && ownedGroup(current.title) && current.title !== title)
      await chrome.tabGroups.update(current.id, { title }).catch(() => undefined)
  }

  /**
   * The relay is done with a tab. A tab an agent opened closes with its group rather than spilling into the
   * user's tabs; a tab the user lent an agent just leaves the group. With grouping off an agent's tab has no group:
   * it closes when the relay detaches it (`finished`, the toolbar button on it) like a grouped one does. A tab in a
   * group of the user's own is theirs and stays. `released` is the user taking the tab back from the browser's
   * debugging bar: it leaves the group and idle cleanup tracks it no more, but it stays open.
   */
  const ungroup = async (tabId: number, options: { finished?: boolean; released?: boolean } = {}) => {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined)
    if (!tab) return
    if (options.released) TabCleanup.forget(tabId)
    const grouped = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
    if (!grouped && !options.finished && !options.released) return
    const current = grouped ? await chrome.tabGroups.get(tab.groupId).catch(() => undefined) : undefined
    if (grouped && !ownedGroup(current?.title)) return
    if (!options.released && !deps.isReloading() && (await TabCleanup.isTracked(tabId))) {
      deps.log.add("tab.closed", { tabId, reason: "agent finished with it" })
      await TabCleanup.closeAgentTab(tabId).catch(() => undefined)
      return
    }
    if (grouped) await undoGroup(tabId)
  }

  /**
   * After a restart, relay groups may hold tabs the relay no longer uses. Tabs an agent opened stay in their group
   * (a named session reclaims the ones its inventory marks as an agent's, and idle cleanup closes the rest), so a
   * restart never leaves loose agent tabs behind; a tab the user lent an agent goes back to being an ordinary tab.
   * A tab the relay released instead of closing stays grouped and tracked, so the idle setting still applies.
   */
  const ungroupStale = async () => {
    const groups = (await chrome.tabGroups.query({})).filter((item) => ownedGroup(item.title))
    for (const item of groups)
      for (const tab of await chrome.tabs.query({ groupId: item.id }))
        if (tab.id !== undefined && !deps.relayTabs.has(tab.id) && !(await TabCleanup.isTracked(tab.id)))
          await chrome.tabs.ungroup(tab.id).catch(() => undefined)
  }

  const onGroupRemoved = (removed: chrome.tabGroups.TabGroup) => {
    void restoreSessionGroups().then(() => {
      const keys = Array.from(sessionGroups)
        .filter(([, groupId]) => groupId === removed.id)
        .map(([key]) => key)
      if (!keys.length) return
      keys.forEach((key) => { sessionGroups.delete(key); titles.delete(key) })
      void chrome.storage.local.set({ [SESSION_GROUPS_KEY]: Object.fromEntries(sessionGroups), [titlesKey]: Object.fromEntries(titles) }).catch(() => undefined)
    })
  }

  /** Ownership comes from relay-held IDs, never a display title. */
  const sessionGroup = async (params: { sessionId: string; tabIds: number[]; title?: string; collapsed?: boolean }) => {
    await restoreSessionGroups()
    if (!params.tabIds.length) return { groups: [] }
    if (params.tabIds.some(id => !deps.relayTabs.has(id))) throw new Error("Session group contains an unattached tab")
    if (params.title !== undefined && (!params.title.trim() || params.title.length > 28 || /[\x00-\x1f\x7f\u2063]/.test(params.title)))
      throw new Error("Group title must contain 1 to 28 visible characters without control markers")
    const allowed = new Set(params.tabIds)
    const ids = new Set<number>()
    for (const id of allowed) {
      const tab = await chrome.tabs.get(id)
      if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) throw new Error("Session tab is ungrouped; use session grouping")
      ids.add(tab.groupId)
    }
    const groups = []
    // Check every group before writing, including all of its members.
    for (const id of ids) {
      const group = await waitForGroup(id)
      const members = await chrome.tabs.query({ groupId: id })
      if (!ownedGroup(group.title) || sharedGroup(group.title) || group.shared || members.some(t => t.id === undefined || !allowed.has(t.id)))
        throw new Error("Group includes shared, user or another session's tabs")
      groups.push({ group, members })
    }
    const result = []
    for (const { group } of groups) {
      const members = await chrome.tabs.query({ groupId: group.id })
      if (members.some(t => t.id === undefined || !allowed.has(t.id))) throw new Error("Group membership changed; retry after inspection")
      let blocked = members.some(t => t.active) && (params.title !== undefined || params.collapsed !== undefined)
        ? "active-tab"
        : params.collapsed === undefined ? undefined : await AgentGroups.setCollapsed(group.id, params.collapsed)
      if (!blocked && params.title !== undefined && (await chrome.tabs.query({ groupId: group.id })).some(t => t.active)) {
        blocked = "active-tab"
      }
      if (params.title !== undefined && !blocked) {
        titles.set(params.sessionId, params.title)
        await chrome.storage.local.set({ [titlesKey]: Object.fromEntries(titles) })
        await chrome.tabGroups.update(group.id, { title: `${params.title}${GROUP_MARKER}` })
      }
      const actual = await waitForGroup(group.id)
      const confirmedMembers = await chrome.tabs.query({ groupId: group.id })
      if (actual.shared || confirmedMembers.some(t => t.id === undefined || !allowed.has(t.id))) throw new Error("Group membership changed during update")
      if (members.length !== confirmedMembers.length || members.some(t => !confirmedMembers.some(current => current.id === t.id))) throw new Error("Group membership changed during update")
      if (params.collapsed !== undefined && !blocked && actual.collapsed !== params.collapsed) throw new Error("Group state changed during update; inspect before retrying")
      result.push({ id: actual.id, windowId: actual.windowId, title: actual.title?.replace(/\u2063+$/, "") ?? "", collapsed: actual.collapsed,
        tabIds: confirmedMembers.map(t => t.id!), ...(blocked ? { blocked } : {}) })
    }
    return { groups: result }
  }

  const onBrowserStartup = () => {
    sessionGroups.clear()
    void chrome.storage.local.remove(SESSION_GROUPS_KEY)
  }

  return {
    group,
    sessionGroup,
    countShared,
    recountShared,
    renameForPage,
    ungroup,
    ungroupStale,
    onGroupRemoved,
    onBrowserStartup,
  }
}
