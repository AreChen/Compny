import { TwinnyProvider } from "../../../common/types"
import { FimChunk, FimRequest, InferenceOptions } from "../types"

import { responseError } from "./json-stream"
import { responseEvents } from "./responses-stream"

/** Stream code completion from the Responses API. */
export async function* responsesFim(
  config: TwinnyProvider,
  request: FimRequest,
  options?: InferenceOptions
): AsyncGenerator<FimChunk> {
  const protocol = config.apiProtocol || "https"
  const host = config.apiHostname || "api.openai.com"
  const port = config.apiPort ? `:${config.apiPort}` : ""
  // Configurations saved by earlier versions used Chat Completions.
  const path = !config.apiPath || config.apiPath === "/v1/chat/completions"
    ? "/v1/responses" : config.apiPath
  const files = (request.context?.files || []).map(file => `${file.name}\n${file.text}`).join("\n")
  const input = `Language: ${request.context?.language || "unknown"}\nRelated files:\n${files}\nCode before cursor:\n${request.context?.prefix ?? request.prefix ?? request.prompt}\nCode after cursor:\n${request.context?.suffix ?? request.suffix ?? ""}`
  const body = {
    model: request.model,
    instructions: "Complete the code at the cursor. Return only the inserted code, without markdown or explanation. Do not repeat the surrounding code.",
    input,
    stream: true,
    store: false,
    ...(request.maxTokens && request.maxTokens > 0 ? { max_output_tokens: request.maxTokens } : {})
  }
  const response = await fetch(`${protocol}://${host}${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: options?.signal
  })
  if (!response.ok) throw await responseError(response)
  if (!response.body) throw new Error("The server answered without a body.")
  for await (const event of responseEvents(response.body)) {
    if (options?.signal?.aborted) return
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) yield { text: event.delta }
        break
      case "response.completed":
        if (event.response?.usage) yield { text: "", usage: {
          promptTokens: event.response.usage.input_tokens,
          completionTokens: event.response.usage.output_tokens
        } }
        return
      case "response.incomplete":
        throw new Error(`The response was incomplete${event.response?.incomplete_details?.reason ? `: ${event.response.incomplete_details.reason}` : ""}.`)
      case "response.failed":
        throw new Error(event.response?.error?.message || "The response failed.")
      case "error":
        throw new Error(event.message || event.error?.message || "The server reported an error.")
    }
  }
  if (!options?.signal?.aborted) throw new Error("The response ended without response.completed.")
}
