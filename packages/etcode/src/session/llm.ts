import { streamText } from "ai"
import type { ModelMessage, ToolSet, StreamTextResult, ToolChoice } from "ai"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"

const log = Log.create("llm")

export namespace LLM {
  export interface StreamInput {
    model: Provider.Model
    messages: ModelMessage[]
    system: string[]
    temperature?: number
    topP?: number
    tools?: ToolSet
    toolChoice?: ToolChoice<ToolSet>
    maxTokens?: number
    abort?: AbortSignal
    retries?: number
  }

  export type StreamResult = StreamTextResult<ToolSet, any>

  export async function stream(input: StreamInput): Promise<StreamResult> {
    const language = await Provider.getLanguage(input.model)
    log.info("starting stream", {
      providerID: input.model.providerID,
      modelID: input.model.id,
    })

    return streamText({
      model: language,
      messages: [
        ...input.system.map((x): ModelMessage => ({ role: "system", content: x })),
        ...input.messages,
      ],
      temperature: input.temperature,
      topP: input.topP,
      tools: input.tools,
      toolChoice: input.toolChoice,
      maxOutputTokens: input.maxTokens,
      maxRetries: input.retries ?? 0,
      abortSignal: input.abort,
      onError(error) {
        log.error("stream error", { error: String(error) })
      },
    })
  }
}
