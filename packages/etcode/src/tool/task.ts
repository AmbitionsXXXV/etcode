import { loadDescription } from './description'
import { Tool } from './tool'

const DESCRIPTION = loadDescription('task.txt')

import z from 'zod'
import { Agent } from '../agent/agent'
import { Permission } from '../permission/permission'
import { Part } from '../session/part'
import { Session } from '../session/session'

const parameters = z.object({
	description: z.string().describe('A short (3-5 words) description of the task'),
	prompt: z.string().describe('The task for the agent to perform'),
	subagent_type: z
		.string()
		.describe('The type of specialized agent to use for this task'),
	task_id: z
		.string()
		.describe(
			'Set this to resume a previous task (pass a prior task_id to continue the same subagent session)'
		)
		.optional(),
})

export const TaskTool = Tool.define('task', async (ctx) => {
	const agents = await Agent.list().then((x) =>
		x.filter((a) => a.mode !== 'primary')
	)

	const caller = ctx?.agent
	const accessibleAgents = caller
		? agents.filter(
				(a) =>
					Permission.evaluate('task', a.name, caller.permission).action !== 'deny'
			)
		: agents

	const description = DESCRIPTION.replace(
		'{agents}',
		accessibleAgents
			.map(
				(a) =>
					`- ${a.name}: ${a.description ?? 'This subagent should only be called manually by the user.'}`
			)
			.join('\n')
	)

	return {
		description,
		parameters,
		async execute(params: z.infer<typeof parameters>, ctx) {
			await ctx.ask({
				permission: 'task',
				patterns: [params.subagent_type],
				always: ['*'],
				metadata: {
					description: params.description,
					subagent_type: params.subagent_type,
				},
			})

			const agent = await Agent.get(params.subagent_type)
			if (!agent)
				throw new Error(
					`Unknown agent type: ${params.subagent_type} is not a valid agent type`
				)

			const project = (await import('../project/instance')).Instance.project()

			let session: Session.Info | undefined
			if (params.task_id) {
				const found = await Session.get(project.id, params.task_id)
				if (found) session = found
			}

			if (!session) {
				session = await Session.create({
					projectID: project.id,
					directory: project.directory,
					agent: agent.name,
					title: `${params.description} (@${agent.name} subagent)`,
				})
			}

			const model = agent.model ?? undefined

			ctx.metadata({
				title: params.description,
				metadata: { sessionId: session.id, model },
			})

			function cancelChild() {
				const { cancel } = require('../session/prompt') as typeof import('../session/prompt')
				cancel(session!.id)
			}
			ctx.abort.addEventListener('abort', cancelChild)

			try {
				const { Prompt } = await import('../session/prompt')

				const result = await Prompt.prompt({
					projectID: project.id,
					sessionID: session.id,
					content: params.prompt,
					agent: agent.name,
					model,
				})

				let text = ''
				if (result) {
					const parts = await Part.list(project.id, result.id)
					const textPart = parts.findLast((p) => p.type === 'text')
					if (textPart?.type === 'text') text = textPart.text
				}

				const output = [
					`task_id: ${session.id} (for resuming to continue this task if needed)`,
					'',
					'<task_result>',
					text || `Task "${params.description}" completed by @${agent.name} agent.`,
					'</task_result>',
				].join('\n')

				return {
					title: params.description,
					metadata: { sessionId: session.id, model },
					output,
				}
			} finally {
				ctx.abort.removeEventListener('abort', cancelChild)
			}
		},
	}
})
