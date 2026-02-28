import type { ModelMessage, StreamTextResult, ToolChoice, ToolSet } from 'ai'
import { streamText } from 'ai'
import { Provider } from '../provider/provider'
import { Log } from '../util/log'

const log = Log.create('llm')

export namespace LLM {
	export interface StreamInput {
		abort?: AbortSignal
		maxTokens?: number
		messages: ModelMessage[]
		model: Provider.Model
		retries?: number
		system: string[]
		temperature?: number
		toolChoice?: ToolChoice<ToolSet>
		tools?: ToolSet
		topP?: number
	}

	export type StreamResult = StreamTextResult<ToolSet, any>

	export async function stream(input: StreamInput): Promise<StreamResult> {
		const language = await Provider.getLanguage(input.model)
		log.info('starting stream', {
			providerID: input.model.providerID,
			modelID: input.model.id,
		})

		return streamText({
			model: language,
			messages: [
				...input.system.map((x): ModelMessage => ({ role: 'system', content: x })),
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
				log.error('stream error', { error: String(error) })
			},
		})
	}
}
