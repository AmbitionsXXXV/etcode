import { Identifier } from '@etcode/util/identifier'
import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'
import { Log } from '../util/log'

const log = Log.create('permission')

export namespace Permission {
	export const Action = z.enum(['allow', 'deny', 'ask'])
	export type Action = z.infer<typeof Action>

	export const Rule = z.object({
		permission: z.string(),
		pattern: z.string(),
		action: Action,
	})
	export type Rule = z.infer<typeof Rule>

	export const Ruleset = Rule.array()
	export type Ruleset = z.infer<typeof Ruleset>

	export const ConfigValue = z.union([Action, z.record(z.string(), Action)])

	export const ConfigSchema = z.record(z.string(), ConfigValue)
	export type Config = z.infer<typeof ConfigSchema>

	export const Reply = z.enum(['once', 'always', 'reject'])
	export type Reply = z.infer<typeof Reply>

	export const Request = z.object({
		id: z.string(),
		sessionID: z.string(),
		permission: z.string(),
		patterns: z.string().array(),
		metadata: z.record(z.string(), z.any()),
		always: z.string().array(),
		tool: z
			.object({
				messageID: z.string(),
				callID: z.string(),
			})
			.optional(),
	})
	export type Request = z.infer<typeof Request>

	export const Event = {
		Asked: BusEvent.define('permission.asked', Request),
		Replied: BusEvent.define(
			'permission.replied',
			z.object({
				sessionID: z.string(),
				requestID: z.string(),
				reply: Reply,
			})
		),
	}

	interface PendingEntry {
		info: Request
		reject: (e: unknown) => void
		resolve: () => void
	}

	const pending: Record<string, PendingEntry> = {}
	const approved: Ruleset = []

	function expand(pattern: string): string {
		if (pattern.startsWith('~/')) return process.env.HOME + pattern.slice(1)
		if (pattern === '~') return process.env.HOME ?? ''
		return pattern
	}

	function match(value: string, pattern: string): boolean {
		if (pattern === '*') return true
		if (pattern === value) return true
		if (pattern.endsWith('*')) {
			return value.startsWith(pattern.slice(0, -1))
		}
		if (pattern.startsWith('*')) {
			return value.endsWith(pattern.slice(1))
		}
		return false
	}

	export function fromConfig(config: Config): Ruleset {
		const ruleset: Ruleset = []
		for (const [key, value] of Object.entries(config)) {
			if (typeof value === 'string') {
				ruleset.push({ permission: key, action: value, pattern: '*' })
				continue
			}
			for (const [pattern, action] of Object.entries(value)) {
				ruleset.push({ permission: key, pattern: expand(pattern), action })
			}
		}
		return ruleset
	}

	export function merge(...rulesets: Ruleset[]): Ruleset {
		return rulesets.flat()
	}

	export function evaluate(
		permission: string,
		pattern: string,
		...rulesets: Ruleset[]
	): Rule {
		const merged = merge(...rulesets)
		const result = merged.findLast(
			(rule) => match(permission, rule.permission) && match(pattern, rule.pattern)
		)
		return result ?? { action: 'ask', permission, pattern: '*' }
	}

	export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
		const EDIT_TOOLS = ['edit', 'write', 'patch']
		const result = new Set<string>()
		for (const tool of tools) {
			const perm = EDIT_TOOLS.includes(tool) ? 'edit' : tool
			const rule = ruleset.findLast((r) => match(perm, r.permission))
			if (rule?.pattern === '*' && rule.action === 'deny') result.add(tool)
		}
		return result
	}

	export function ask(input: {
		sessionID: string
		permission: string
		patterns: string[]
		metadata: Record<string, unknown>
		always: string[]
		ruleset: Ruleset
		tool?: { messageID: string; callID: string }
	}): Promise<void> | undefined {
		for (const pattern of input.patterns) {
			const rule = evaluate(input.permission, pattern, input.ruleset, approved)
			log.info('evaluated', {
				permission: input.permission,
				pattern,
				action: rule.action,
			})

			if (rule.action === 'deny') {
				throw new DeniedError(
					input.ruleset.filter((r) => match(input.permission, r.permission))
				)
			}

			if (rule.action === 'ask') {
				const id = Identifier.ascending('perm')
				return new Promise<void>((resolve, reject) => {
					const info: Request = {
						id,
						sessionID: input.sessionID,
						permission: input.permission,
						patterns: input.patterns,
						metadata: input.metadata,
						always: input.always,
						tool: input.tool,
					}
					pending[id] = { info, resolve, reject }
					Bus.publish(Event.Asked, info)
				})
			}
		}
		return undefined
	}

	export function reply(input: {
		requestID: string
		reply: Reply
		message?: string
	}) {
		const entry = pending[input.requestID]
		if (!entry) return
		delete pending[input.requestID]

		Bus.publish(Event.Replied, {
			sessionID: entry.info.sessionID,
			requestID: entry.info.id,
			reply: input.reply,
		})

		if (input.reply === 'reject') {
			rejectEntry(entry, input.message)
			rejectSession(entry.info.sessionID)
			return
		}

		if (input.reply === 'once') {
			entry.resolve()
			return
		}

		if (input.reply === 'always') {
			approveAlways(entry)
			cascadeApprove(entry.info.sessionID)
			return
		}
	}

	function rejectEntry(entry: PendingEntry, message?: string) {
		entry.reject(message ? new CorrectedError(message) : new RejectedError())
	}

	function rejectSession(sessionID: string) {
		for (const [id, p] of Object.entries(pending)) {
			if (p.info.sessionID !== sessionID) continue
			delete pending[id]
			Bus.publish(Event.Replied, {
				sessionID: p.info.sessionID,
				requestID: p.info.id,
				reply: 'reject',
			})
			p.reject(new RejectedError())
		}
	}

	function approveAlways(entry: PendingEntry) {
		for (const pattern of entry.info.always) {
			approved.push({
				permission: entry.info.permission,
				pattern,
				action: 'allow',
			})
		}
		entry.resolve()
	}

	function cascadeApprove(sessionID: string) {
		for (const [id, p] of Object.entries(pending)) {
			if (p.info.sessionID !== sessionID) continue
			const ok = p.info.patterns.every(
				(pattern) =>
					evaluate(p.info.permission, pattern, approved).action === 'allow'
			)
			if (!ok) continue
			delete pending[id]
			Bus.publish(Event.Replied, {
				sessionID: p.info.sessionID,
				requestID: p.info.id,
				reply: 'always',
			})
			p.resolve()
		}
	}

	export function list(): Request[] {
		return Object.values(pending).map((x) => x.info)
	}

	export class RejectedError extends Error {
		constructor() {
			super('The user rejected permission to use this specific tool call.')
		}
	}

	export class CorrectedError extends Error {
		constructor(message: string) {
			super(`The user rejected permission with feedback: ${message}`)
		}
	}

	export class DeniedError extends Error {
		readonly rules: Ruleset
		constructor(rules: Ruleset) {
			super(
				`A rule prevents this tool call. Relevant rules: ${JSON.stringify(rules)}`
			)
			this.rules = rules
		}
	}
}
