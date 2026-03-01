import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'
import { Agent } from '../agent/agent'
import type { Provider } from '../provider/provider'
import { Log } from '../util/log'
import { LLM } from './llm'
import { Message } from './message'
import { Part } from './part'
import { toModelMessages } from './prompt'

const log = Log.create('session.compaction')

const COMPACTION_BUFFER = 20_000
const PRUNE_MINIMUM = 20_000
const PRUNE_PROTECT = 40_000

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export namespace SessionCompaction {
	export const Event = {
		Compacted: BusEvent.define(
			'session.compacted',
			z.object({ sessionID: z.string() })
		),
	}

	export function isOverflow(input: {
		tokens: { input: number; output: number }
		model: Provider.Model
	}): boolean {
		const context = input.model.limit.context
		if (context === 0) return false
		const count = input.tokens.input + input.tokens.output
		const maxOutput = input.model.limit.output || COMPACTION_BUFFER
		const reserved = Math.min(COMPACTION_BUFFER, maxOutput)
		const usable = context - reserved
		return count >= usable
	}

	export async function process(input: {
		projectID: string
		sessionID: string
		messages: Message.Info[]
		abort: AbortSignal
		auto: boolean
	}): Promise<'continue' | 'stop'> {
		const agent = await Agent.get('compaction')
		if (!agent) {
			log.error('compaction agent not found')
			return 'stop'
		}

		const assistantMsg = await Message.create(input.projectID, {
			sessionID: input.sessionID,
			role: 'assistant',
			summary: true,
			agent: 'compaction',
		})

		const modelMessages = await toModelMessages(input.projectID, input.messages)

		const compactionPrompt = `Provide a detailed summary for continuing our conversation above.
Focus on information helpful for continuing, including what we did, what we're doing, which files we're working on, and what we're going to do next.

When constructing the summary, use this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [Important instructions from the user]
- [If there is a plan or spec, include information about it]

## Discoveries

[Notable things learned during this conversation]

## Accomplished

[What work has been completed, what is still in progress, what is left?]

## Relevant files / directories

[Structured list of relevant files that have been read, edited, or created]
---`

		modelMessages.push({
			role: 'user',
			content: compactionPrompt,
		})

		const model = await resolveCompactionModel(agent, input.messages)
		const system = agent.prompt ? [agent.prompt] : []

		const stream = await LLM.stream({
			model,
			messages: modelMessages,
			system,
			temperature: agent.temperature,
			tools: {},
			abort: input.abort,
		})

		let text = ''
		for await (const chunk of stream.fullStream) {
			if (input.abort.aborted) break
			if (chunk.type === 'text-delta') text += chunk.text
			if (chunk.type === 'error') throw chunk.error
		}

		if (text) {
			await Part.createText(input.projectID, {
				messageID: assistantMsg.id,
				sessionID: input.sessionID,
				text: text.trimEnd(),
			})
		}

		await Message.update(
			input.projectID,
			input.sessionID,
			assistantMsg.id,
			(draft) => {
				if (draft.role === 'assistant') {
					draft.finish = 'stop'
					draft.time.completed = Date.now()
				}
			}
		)

		if (input.auto) {
			await Message.create(input.projectID, {
				sessionID: input.sessionID,
				role: 'user',
				content:
					'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.',
			})
		}

		await Bus.publish(Event.Compacted, { sessionID: input.sessionID })
		log.info('compaction complete', { sessionID: input.sessionID })
		return 'continue'
	}

	export async function create(input: {
		projectID: string
		sessionID: string
		auto: boolean
	}) {
		const msg = await Message.create(input.projectID, {
			sessionID: input.sessionID,
			role: 'user',
			content: '[context compaction requested]',
		})
		await Part.createCompaction(input.projectID, {
			messageID: msg.id,
			sessionID: input.sessionID,
			auto: input.auto,
		})
	}

	export async function prune(input: {
		projectID: string
		sessionID: string
	}) {
		const messages = await Message.list(input.projectID, input.sessionID)
		let total = 0
		let pruned = 0
		const toPrune: { messageID: string; partID: string }[] = []
		let turns = 0

		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.role === 'user') turns++
			if (turns < 2) continue
			if (msg.role === 'assistant' && msg.summary) break
			if (msg.role !== 'assistant') continue

			const parts = await Part.list(input.projectID, msg.id)
			for (let j = parts.length - 1; j >= 0; j--) {
				const part = parts[j]
				if (part.type !== 'tool') continue
				if (part.state.status !== 'completed') continue
				const output = typeof part.state.output === 'string' ? part.state.output : JSON.stringify(part.state.output ?? '')
				const estimate = estimateTokens(output)
				total += estimate
				if (total > PRUNE_PROTECT) {
					pruned += estimate
					toPrune.push({ messageID: msg.id, partID: part.id })
				}
			}
		}

		if (pruned > PRUNE_MINIMUM) {
			for (const item of toPrune) {
				Part.update(input.projectID, item.messageID, item.partID, (draft) => {
					if (draft.type === 'tool' && draft.state.status === 'completed') {
						draft.state.output = '[output pruned for context management]'
					}
				})
			}
			log.info('pruned tool outputs', { count: toPrune.length, tokens: pruned })
		}
	}

	async function resolveCompactionModel(
		agent: Agent.Info,
		_messages: Message.Info[]
	): Promise<Provider.Model> {
		const { Provider } = await import('../provider/provider')
		if (agent.model) {
			const found = await Provider.getModel(agent.model.providerID, agent.model.modelID)
			if (found) return found
		}
		const providers = await Provider.list()
		for (const provider of Object.values(providers)) {
			const first = Object.values(provider.models)[0]
			if (first) return first
		}
		throw new Error('No model available for compaction')
	}
}
