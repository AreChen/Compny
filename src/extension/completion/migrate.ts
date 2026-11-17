import { ConfigurationTarget, ExtensionContext, workspace } from "vscode"

import { ACTIVE_FIM_PROVIDER_STORAGE_KEY } from "../../common/constants"

const SECRET_KEY = "compny.openai.apiKey"
const LEGACY_SECRET_KEY = "twinny.openai.apiKey"
const LEGACY_PROVIDER_KEY = "twinny.active-fim-provider"
const SETTINGS = ["enabled", "enabledLanguages", "autoSuggestEnabled", "contextLength", "debounceWait", "multilineCompletionsEnabled", "maxLines", "fileContextEnabled", "recentEditsEnabled", "lspContextEnabled", "completionCacheEnabled", "numPredictFim", "enableSubsequentCompletions", "secretShield", "enableLogging"]

export async function migrateLegacySettings(context: ExtensionContext) {
  const globalDone = context.globalState.get<boolean>("compny.migration.global") === true
  const workspaceDone = context.workspaceState.get<boolean>("compny.migration.workspace") === true
  const legacyKey = await context.secrets.get(LEGACY_SECRET_KEY)
  if (!globalDone && legacyKey && !await context.secrets.get(SECRET_KEY)) await context.secrets.store(SECRET_KEY, legacyKey)
  const provider = context.globalState.get(LEGACY_PROVIDER_KEY)
  if (!globalDone && provider !== undefined && context.globalState.get(ACTIVE_FIM_PROVIDER_STORAGE_KEY) === undefined) {
    await context.globalState.update(ACTIVE_FIM_PROVIDER_STORAGE_KEY, provider)
  }
  const scopes = [undefined, ...(workspace.workspaceFolders || []).map(folder => folder.uri)]
  for (const resource of scopes) {
    const oldConfig = workspace.getConfiguration("twinny", resource)
    const newConfig = workspace.getConfiguration("compny", resource)
    for (const key of SETTINGS) {
      const old = oldConfig.inspect(key)
      const current = newConfig.inspect(key)
      if (!old || !current) continue
      if (!resource) {
        if (!globalDone && current.globalValue === undefined && old.globalValue !== undefined) await newConfig.update(key, old.globalValue, ConfigurationTarget.Global)
        if (!workspaceDone && current.workspaceValue === undefined && old.workspaceValue !== undefined) await newConfig.update(key, old.workspaceValue, ConfigurationTarget.Workspace)
      } else if (!workspaceDone && current.workspaceFolderValue === undefined && old.workspaceFolderValue !== undefined) {
        await newConfig.update(key, old.workspaceFolderValue, ConfigurationTarget.WorkspaceFolder)
      }
    }
  }
  if (!globalDone) await context.globalState.update("compny.migration.global", true)
  if (!workspaceDone) await context.workspaceState.update("compny.migration.workspace", true)
}

