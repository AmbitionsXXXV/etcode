import type { Argv } from 'yargs'
import { Agent } from '../../agent/agent'
import { Bus } from '../../bus'
import { Instance } from '../../project/instance'
import { Part } from '../../session/part'
import { Prompt } from '../../session/prompt'
import { Session } from '../../session/session'
import { Log } from '../../util/log'
import { bootstrap } from '../bootstrap'
import { UI } from '../ui'
import { cmd } from './cmd'

const log = Log.create('run')

export const RunCommand = cmd({
	command: 'run <message..>',
	describe: 'run etcode non-interactively with a message',
	builder: (yargs: Argv) =>
		yargs
			.positional('message', {
				describe: 'message to send',
				type: 'string',
				array: true,
				demandOption: true,
			})
			.option('continue', {
				alias: ['c'],
				describe: 'continue the last session',
				type: 'boolean',
				default: false,
			})
			.option('session', {
				alias: ['s'],
				describe: 'session ID to continue',
				type: 'string',
			})
			.option('agent', {
				alias: ['a'],
				describe: 'agent to use (default: build)',
				type: 'string',
			}),
	handler: async (args) => {
		await bootstrap(process.cwd(), async () => {
			const project = Instance.project()
			log.info('starting session', { project: project.name })

			const agentName = args.agent ?? (await Agent.defaultAgent())
			const agent = await Agent.get(agentName)
			if (!agent) {
				console.error(UI.red(`Agent "${agentName}" not found`))
				process.exit(1)
			}

			let session: Session.Info | undefined | null
			if (args.session) {
				session = await Session.get(project.id, args.session)
			} else if (args.continue) {
				const sessions = await Session.list(project.id)
				session = sessions[0]
			}
			if (!session) {
				session = await Session.create({
					projectID: project.id,
					directory: project.directory,
					agent: agent.name,
				})
			}

			console.log(`Session: ${session.id}`)
			console.log(`Project: ${project.name} (${project.directory})`)
			console.log(
				`Agent:   ${UI.cyan(agent.name)}${agent.description ? UI.dim(` — ${agent.description}`) : ''}`
			)

			const text = args.message.join(' ')

			console.log(`${UI.dim('>')} ${text}`)
			console.log()

			Bus.subscribe(Part.Event.Delta, (event) => {
				if (
					event.properties.sessionID === session?.id &&
					event.properties.field === 'text'
				) {
					process.stdout.write(event.properties.delta)
				}
			})

			Bus.subscribe(Part.Event.Updated, (event) => {
				const part = event.properties
				if (part.type === 'tool') {
					if (part.state.status === 'running') {
						console.log(
							`\n${UI.cyan('⟡')} ${UI.bold(part.tool)} ${UI.dim('running...')}`
						)
					} else if (part.state.status === 'completed') {
						const title = part.state.title ?? part.tool
						console.log(`${UI.green('✓')} ${title}`)
					} else if (part.state.status === 'failed') {
						console.log(
							`${UI.red('✗')} ${part.tool}: ${UI.red(part.state.error ?? 'failed')}`
						)
					}
				}
			})

			Bus.subscribe(Session.Event.Error, (event) => {
				if (event.properties.sessionID === session?.id) {
					console.error(`\n${UI.red('Error:')} ${event.properties.error}`)
				}
			})

			log.info('starting agent loop', { id: session.id, agent: agent.name })

			const result = await Prompt.prompt({
				projectID: project.id,
				sessionID: session.id,
				content: text,
				agent: agent.name,
			})

			console.log()
			if (result && result.role === 'assistant' && result.tokens) {
				console.log(
					UI.dim(`[tokens: in=${result.tokens.input} out=${result.tokens.output}]`)
				)
			}
		})
	},
})
