import { Agent } from '../agent/agent'
import { Log } from '../util/log'
import { LLM } from './llm'
import type { Message } from './message'
import { Session } from './session'

const log = Log.create('session.title')

export namespace SessionTitle {
	export async function generate(input: {
		projectID: string
		sessionID: string
		messages: Message.Info[]
	}) {
		const agent = await Agent.get('title')
		if (!agent) {
			log.warn('title agent not found, skipping title generation')
			return
		}

		const preview = input.messages.slice(0, 4)
		const content = preview
			.map((m) => {
				if (m.role === 'user') return `User: ${m.content}`
				return 'Assistant: [response]'
			})
			.join('\n')

		const model = await resolveModel(agent)
		if (!model) {
			log.warn('no model for title generation')
			return
		}

		const system = agent.prompt ? [agent.prompt] : []
		const stream = await LLM.stream({
			model,
			messages: [{ role: 'user', content }],
			system,
			temperature: agent.temperature ?? 0.5,
			tools: {},
		})

		let title = ''
		for await (const chunk of stream.fullStream) {
			if (chunk.type === 'text-delta') title += chunk.text
			if (chunk.type === 'error') {
				log.error('title generation error', { error: String(chunk.error) })
				return
			}
		}

		title = title.trim().replace(/^["']|["']$/g, '').slice(0, 60)
		if (!title) return

		await Session.setTitle(input.projectID, input.sessionID, title)
		log.info('title generated', { sessionID: input.sessionID, title })
	}

	async function resolveModel(agent: Agent.Info) {
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
		return undefined
	}
}
