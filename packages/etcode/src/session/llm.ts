import { streamText } from "ai"
import type { ModelMessage, ToolSet, StreamTextResult } from "ai"
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
    maxTokens?: number
    abort?: AbortSignal
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
      maxOutputTokens: input.maxTokens,
      abortSignal: input.abort,
      onError(error) {
        log.error("stream error", { error: String(error) })
      },
    })
  }
}
