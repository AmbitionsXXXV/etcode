import { Identifier } from '@etcode/util/identifier'
import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'
import { asc, Database, eq } from '../storage/db'
import { MessageTable } from './session.sql'

export namespace Message {
	export const UserMessage = z.object({
		role: z.literal('user'),
		id: z.string(),
		sessionID: z.string(),
		content: z.string(),
		time: z.object({
			created: z.number(),
		}),
	})

	export const AssistantMessage = z.object({
		role: z.literal('assistant'),
		id: z.string(),
		sessionID: z.string(),
		finish: z.string().optional(),
		error: z.unknown().optional(),
		summary: z.boolean().optional(),
		agent: z.string().optional(),
		tokens: z
			.object({
				input: z.number(),
				output: z.number(),
			})
			.optional(),
		time: z.object({
			created: z.number(),
			completed: z.number().optional(),
		}),
	})

	export const Info = z.discriminatedUnion('role', [UserMessage, AssistantMessage])
	export type Info = z.infer<typeof Info>

	export const Event = {
		Created: BusEvent.define('message.created', Info),
		Deleted: BusEvent.define(
			'message.deleted',
			z.object({ id: z.string(), sessionID: z.string() })
		),
	}

	function toData(msg: Info): Record<string, unknown> {
		if (msg.role === 'user') {
			return { role: 'user', content: msg.content, time: msg.time }
		}
		return {
			role: 'assistant',
			finish: msg.finish,
			error: msg.error,
			summary: msg.summary,
			agent: msg.agent,
			tokens: msg.tokens,
			time: msg.time,
		}
	}

	function fromRow(row: typeof MessageTable.$inferSelect): Info {
		const data = row.data as any
		const base = { id: row.id, sessionID: row.session_id }
		if (data.role === 'user') {
			return { ...base, role: 'user', content: data.content, time: data.time }
		}
		return {
			...base,
			role: 'assistant',
			finish: data.finish,
			error: data.error,
			summary: data.summary,
			agent: data.agent,
			tokens: data.tokens,
			time: data.time,
		}
	}

	export async function create(
		_projectID: string,
		input:
			| { sessionID: string; role: 'user'; content: string }
			| { sessionID: string; role: 'assistant'; summary?: boolean; agent?: string }
	) {
		const now = Date.now()
		const id = Identifier.ascending('msg')
		const base = { id, sessionID: input.sessionID, time: { created: now } }
		const message: Info =
			input.role === 'user'
				? { ...base, role: 'user', content: input.content }
				: {
						...base,
						role: 'assistant',
						summary: input.summary,
						agent: input.agent,
					}

		Database.use((db) => {
			db.insert(MessageTable)
				.values({
					id,
					session_id: input.sessionID,
					time_created: now,
					time_updated: now,
					data: toData(message) as any,
				})
				.run()
		})
		await Bus.publish(Event.Created, message)
		return message
	}

	export function get(_projectID: string, _sessionID: string, id: string) {
		return Database.use((db) => {
			const row = db.select().from(MessageTable).where(eq(MessageTable.id, id)).get()
			if (!row) return undefined
			return fromRow(row)
		})
	}

	export function list(_projectID: string, sessionID: string) {
		return Database.use((db) => {
			const rows = db
				.select()
				.from(MessageTable)
				.where(eq(MessageTable.session_id, sessionID))
				.orderBy(asc(MessageTable.time_created))
				.all()
			return rows.map(fromRow)
		})
	}

	export function update(
		_projectID: string,
		_sessionID: string,
		id: string,
		fn: (draft: Info) => void
	) {
		return Database.use((db) => {
			const row = db.select().from(MessageTable).where(eq(MessageTable.id, id)).get()
			if (!row) return undefined
			const msg = fromRow(row)
			fn(msg)
			db.update(MessageTable)
				.set({
					data: toData(msg) as any,
					time_updated: Date.now(),
				})
				.where(eq(MessageTable.id, id))
				.run()
			Bus.publish(Event.Created, msg)
			return msg
		})
	}

	export async function remove(_projectID: string, sessionID: string, id: string) {
		Database.use((db) => {
			db.delete(MessageTable).where(eq(MessageTable.id, id)).run()
		})
		await Bus.publish(Event.Deleted, { id, sessionID })
	}
}
