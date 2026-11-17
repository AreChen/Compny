import { commands, ConfigurationTarget, ExtensionContext, languages, StatusBarAlignment, window, workspace } from "vscode"

import { TWINNY_COMMAND_NAME } from "./common/constants"
import { logger } from "./common/logger"
import { getLineBreakCount } from "./common/text"
import { FileInteractionCache } from "./extension/completion/file-interaction"
import { CompletionProvider } from "./extension/completion/provider"
import { CompletionSettingsView } from "./extension/completion/settings-view"
import { GenerationTracker } from "./extension/generations"
import { setOpenAIKey } from "./extension/providers/base"
import { TwinnyStatusBar } from "./extension/status-bar"
import { TemplateProvider } from "./extension/templates/provider"
import { delayExecution } from "./extension/utils"

const SECRET_KEY = "twinny.openai.apiKey"

export async function activate(context: ExtensionContext) {
  setOpenAIKey(await context.secrets.get(SECRET_KEY) || "")
  const generations = new GenerationTracker()
  const cache = new FileInteractionCache()
  const completion = new CompletionProvider(generations, cache, new TemplateProvider(undefined), context)
  const status = new TwinnyStatusBar(window.createStatusBarItem(StatusBarAlignment.Right), context, generations)
  const settingsView = new CompletionSettingsView(context, () => status.refresh())
  const configure = async () => { await commands.executeCommand("twinny.sidebar.focus") }
  context.subscriptions.push(
    cache, completion, status,
    window.registerWebviewViewProvider("twinny.sidebar", settingsView),
    generations.onDidChange(({ stoppable }) => {
      void commands.executeCommand("setContext", "twinnyGeneratingText", stoppable)
    }),
    languages.registerInlineCompletionItemProvider({ pattern: "**" }, completion),
    commands.registerCommand("twinny.configureOpenAI", configure),
    commands.registerCommand(TWINNY_COMMAND_NAME.enable, () => workspace.getConfiguration("twinny").update("enabled", true, ConfigurationTarget.Global)),
    commands.registerCommand(TWINNY_COMMAND_NAME.disable, () => workspace.getConfiguration("twinny").update("enabled", false, ConfigurationTarget.Global)),
    commands.registerCommand(TWINNY_COMMAND_NAME.stopGeneration, () => generations.stopAll()),
    commands.registerCommand(TWINNY_COMMAND_NAME.showLogs, () => logger.show()),
    commands.registerCommand(TWINNY_COMMAND_NAME.settings, () => commands.executeCommand("workbench.action.openSettings", "twinny")),
    commands.registerCommand(TWINNY_COMMAND_NAME.statusBarMenu, async () => {
      const config = workspace.getConfiguration("twinny")
      const enabled = config.get<boolean>("autoSuggestEnabled", true)
      const choice = await window.showQuickPick([
        { label: enabled ? "Pause auto-suggest" : "Resume auto-suggest", action: "toggle" },
        { label: "Configure OpenAI", action: "configure" },
        { label: "Settings", action: "settings" },
        { label: "Show logs", action: "logs" }
      ], { title: "Compny" })
      if (choice?.action === "toggle") await config.update("autoSuggestEnabled", !enabled, ConfigurationTarget.Global)
      else if (choice?.action === "configure") await configure()
      else if (choice?.action === "settings") await commands.executeCommand(TWINNY_COMMAND_NAME.settings)
      else if (choice?.action === "logs") logger.show()
    }),
    workspace.onDidChangeTextDocument(event => {
      const change = event.contentChanges[0]
      if (!change) return
      const last = completion.lastCompletionText
      completion.setAcceptedLastCompletion(!!(change.text && last && change.text === last && getLineBreakCount(last) > 1))
      cache.incrementStrokes(change.range.start.line, change.range.start.character)
    }),
    window.onDidChangeTextEditorSelection(event => {
      completion.selectionChanged(event)
      delayExecution(() => completion.setAcceptedLastCompletion(false), 200)
    }),
    workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("twinny")) { status.refresh(); void settingsView.refresh() } })
  )
  status.refresh()
}

export function deactivate() { logger.info("Twinny deactivated") }
