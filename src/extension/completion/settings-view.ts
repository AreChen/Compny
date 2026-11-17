import { ConfigurationTarget, ExtensionContext, WebviewView, WebviewViewProvider, window, workspace } from "vscode"

import { ACTIVE_FIM_PROVIDER_STORAGE_KEY, API_PROVIDERS } from "../../common/constants"
import { TwinnyProvider } from "../../common/types"
import { setOpenAIKey } from "../providers/base"
import { getNonce } from "../utils"

const SECRET_KEY = "compny.openai.apiKey"
const DEFAULT_URL = "https://api.openai.com/v1/responses"

/** The completion-only settings view. The saved key is never sent to the webview. */
export class CompletionSettingsView implements WebviewViewProvider {
  private view?: WebviewView

  constructor(private readonly context: ExtensionContext, private readonly onSave: () => void) {}

  public resolveWebviewView(view: WebviewView) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = this.html()
    view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "ready") await this.refresh()
      if (message?.type === "save") await this.save(message)
      if (message?.type === "settings") await workspace.getConfiguration("compny").update("autoSuggestEnabled", !!message.autoSuggest, ConfigurationTarget.Global)
    }, undefined, this.context.subscriptions)
  }

  public async refresh() {
    const provider = this.context.globalState.get<TwinnyProvider>(ACTIVE_FIM_PROVIDER_STORAGE_KEY)
    const oldPath = !provider?.apiPath || provider.apiPath === "/v1/chat/completions"
    const endpoint = provider?.provider === API_PROVIDERS.OpenAI && provider.apiHostname
      ? `${provider.apiProtocol || "https"}://${provider.apiHostname}${provider.apiPort ? `:${provider.apiPort}` : ""}${oldPath ? "/v1/responses" : provider.apiPath}`
      : DEFAULT_URL
    await this.view?.webview.postMessage({ type: "state", model: provider?.provider === API_PROVIDERS.OpenAI ? provider.modelName : "gpt-4.1-mini", endpoint,
      hasKey: !!(await this.context.secrets.get(SECRET_KEY)),
      autoSuggest: workspace.getConfiguration("compny").get<boolean>("autoSuggestEnabled", true) })
  }

  private async save(message: { model?: unknown; endpoint?: unknown; key?: unknown }) {
    const model = typeof message.model === "string" ? message.model.trim() : ""
    const endpoint = typeof message.endpoint === "string" ? message.endpoint.trim() : ""
    const key = typeof message.key === "string" ? message.key.trim() : ""
    try {
      if (!model) throw new Error("请输入模型名称。")
      const url = new URL(endpoint)
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请输入有效的 HTTP(S) Responses 地址，不能包含凭据、查询参数或片段。")
      if (!url.pathname || url.pathname === "/") url.pathname = "/v1/responses"
      else if (url.pathname.replace(/\/$/, "").endsWith("/v1")) url.pathname = `${url.pathname.replace(/\/$/, "")}/responses`
      const savedKey = key || await this.context.secrets.get(SECRET_KEY)
      if (!savedKey) throw new Error("请输入 API Key。")
      const provider: TwinnyProvider = {
        id: "openai-completion", label: "OpenAI", provider: API_PROVIDERS.OpenAI,
        type: "fim", modelName: model, apiProtocol: url.protocol.slice(0, -1),
        apiHostname: url.hostname, apiPort: url.port ? Number(url.port) : undefined, apiPath: url.pathname
      }
      await this.context.secrets.store(SECRET_KEY, savedKey)
      setOpenAIKey(savedKey)
      await this.context.globalState.update(ACTIVE_FIM_PROVIDER_STORAGE_KEY, provider)
      this.onSave()
      await this.refresh()
      void window.showInformationMessage("OpenAI 补全配置已保存。")
    } catch (error) {
      void window.showErrorMessage(error instanceof TypeError ? "请输入有效的 Responses 地址。" : error instanceof Error ? error.message : "无法保存配置。")
    }
  }

  private html() {
    const nonce = getNonce()
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
      <style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:12px;color:var(--vscode-foreground)}h2{font-size:1.2em;margin:4px 0 16px}label{display:block;margin:14px 0 6px}input[type=text],input[type=password]{box-sizing:border-box;width:100%;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent)}button{width:100%;margin-top:16px;padding:8px;border:0;cursor:pointer;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:hover{background:var(--vscode-button-hoverBackground)}small{display:block;opacity:.8;margin-top:5px;line-height:1.4}.check{display:flex;gap:8px;align-items:center}</style></head>
      <body><h2>Compny 代码补全</h2><form id="form"><label for="endpoint">Responses API 地址</label><input id="endpoint" type="text" required><small>填写完整 /responses 地址，或以 /v1 结尾的 API 地址。</small><label for="model">模型</label><input id="model" type="text" required><label for="key">API Key</label><input id="key" type="password" autocomplete="off"><small id="keyHint">密钥保存在 VS Code 安全存储中。</small><button type="submit">保存配置</button></form><label class="check"><input type="checkbox" id="auto">输入时自动补全</label><small>也可按 Alt+\u005c 手动触发补全。</small>
      <script nonce="${nonce}">const vscode=acquireVsCodeApi();const endpoint=document.getElementById('endpoint'),model=document.getElementById('model'),key=document.getElementById('key'),auto=document.getElementById('auto');window.addEventListener('message',event=>{const s=event.data;if(s.type!=='state')return;endpoint.value=s.endpoint;model.value=s.model;key.value='';key.placeholder=s.hasKey?'已保存，留空则保持不变':'请输入 API Key';auto.checked=s.autoSuggest});document.getElementById('form').addEventListener('submit',event=>{event.preventDefault();vscode.postMessage({type:'save',endpoint:endpoint.value,model:model.value,key:key.value})});auto.addEventListener('change',()=>vscode.postMessage({type:'settings',autoSuggest:auto.checked}));vscode.postMessage({type:'ready'});</script></body></html>`
  }
}
