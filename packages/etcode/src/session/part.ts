import { Identifier } from '@etcode/util/identifier'
import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'
import { asc, Database, eq } from '../storage/db'
import { PartTable } from './session.sql'

export namespace Part {
	export const TextPart = z.object({
		type: z.literal('text'),
		id: z.string(),
		messageID: z.string(),
		text: z.string(),
	})

	export const ToolState = z.object({
		status: z.enum(['pending', 'running', 'completed', 'failed']),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
		error: z.string().optional(),
		title: z.string().optional(),
		time: z
			.object({
				start: z.number().optional(),
				end: z.number().optional(),
			})
			.optional(),
	})

	export const ToolPart = z.object({
		type: z.literal('tool'),
		id: z.string(),
		messageID: z.string(),
		tool: z.string(),
		callID: z.string().optional(),
		state: ToolState,
	})

	export const StepStartPart = z.object({
		type: z.literal('step-start'),
		id: z.string(),
		messageID: z.string(),
		snapshot: z.string().optional(),
	})

	export const StepFinishPart = z.object({
		type: z.literal('step-finish'),
		id: z.string(),
		messageID: z.string(),
		snapshot: z.string().optional(),
	})

	export const Info = z.discriminatedUnion('type', [
		TextPart,
		ToolPart,
		StepStartPart,
		StepFinishPart,
	])
	export type Info = z.infer<typeof Info>

	export const DeltaPayload = z.object({
		sessionID: z.string(),
		messageID: z.string(),
		partID: z.string(),
		field: z.string(),
		delta: z.string(),
	})
	export type DeltaPayload = z.infer<typeof DeltaPayload>

	export const Event = {
		Updated: BusEvent.define('part.updated', Info),
		Delta: BusEvent.define('part.delta', DeltaPayload),
	}

	function toData(part: Info): Record<string, unknown> {
		if (part.type === 'text') return { type: 'text', text: part.text }
		if (part.type === 'step-start')
			return { type: 'step-start', snapshot: part.snapshot }
		if (part.type === 'step-finish')
			return { type: 'step-finish', snapshot: part.snapshot }
		return { type: 'tool', tool: part.tool, callID: part.callID, state: part.state }
	}

	function fromRow(row: typeof PartTable.$inferSelect): Info {
		const data = row.data as Record<string, unknown>
		const base = { id: row.id, messageID: row.message_id }
		if (data.type === 'text')
			return { ...base, type: 'text', text: data.text as string }
		if (data.type === 'step-start')
			return {
				...base,
				type: 'step-start',
				snapshot: data.snapshot as string | undefined,
			}
		if (data.type === 'step-finish')
			return {
				...base,
				type: 'step-finish',
				snapshot: data.snapshot as string | undefined,
			}
		return {
			...base,
			type: 'tool',
			tool: data.tool as string,
			callID: data.callID as string | undefined,
			state: data.state as z.infer<typeof ToolState>,
		}
	}

	export async function createText(
		_projectID: string,
		input: { messageID: string; sessionID?: string; text: string }
	) {
		const now = Date.now()
		const id = Identifier.ascending('part')
		const part: z.infer<typeof TextPart> = {
			type: 'text',
			id,
			messageID: input.messageID,
			text: input.text,
		}
		Database.use((db) => {
			db.insert(PartTable)
				.values({
					id,
					message_id: input.messageID,
					session_id: input.sessionID ?? '',
					time_created: now,
					time_updated: now,
					data: toData(part) as any,
				})
				.run()
		})
		await Bus.publish(Event.Updated, part)
		return part
	}

	export async function createTool(
		_projectID: string,
		input: {
			messageID: string
			sessionID?: string
			tool: string
			callID?: string
			state?: z.infer<typeof ToolState>
		}
	) {
		const now = Date.now()
		const id = Identifier.ascending('part')
		const part: z.infer<typeof ToolPart> = {
			type: 'tool',
			id,
			messageID: input.messageID,
			tool: input.tool,
			callID: input.callID,
			state: input.state ?? { status: 'pending' },
		}
		Database.use((db) => {
			db.insert(PartTable)
				.values({
					id,
					message_id: input.messageID,
					session_id: input.sessionID ?? '',
					time_created: now,
					time_updated: now,
					data: toData(part) as any,
				})
				.run()
		})
		await Bus.publish(Event.Updated, part)
		return part
	}

	export async function createStepStart(
		_projectID: string,
		input: { messageID: string; sessionID?: string; snapshot?: string }
	) {
		const now = Date.now()
		const id = Identifier.ascending('part')
		const part: z.infer<typeof StepStartPart> = {
			type: 'step-start',
			id,
			messageID: input.messageID,
			snapshot: input.snapshot,
		}
		Database.use((db) => {
			db.insert(PartTable)
				.values({
					id,
					message_id: input.messageID,
					session_id: input.sessionID ?? '',
					time_created: now,
					time_updated: now,
					data: toData(part) as Record<string, unknown>,
				})
				.run()
		})
		await Bus.publish(Event.Updated, part)
		return part
	}

	export async function createStepFinish(
		_projectID: string,
		input: { messageID: string; sessionID?: string; snapshot?: string }
	) {
		const now = Date.now()
		const id = Identifier.ascending('part')
		const part: z.infer<typeof StepFinishPart> = {
			type: 'step-finish',
			id,
			messageID: input.messageID,
			snapshot: input.snapshot,
		}
		Database.use((db) => {
			db.insert(PartTable)
				.values({
					id,
					message_id: input.messageID,
					session_id: input.sessionID ?? '',
					time_created: now,
					time_updated: now,
					data: toData(part) as Record<string, unknown>,
				})
				.run()
		})
		await Bus.publish(Event.Updated, part)
		return part
	}

	export function update(
		_projectID: string,
		_messageID: string,
		id: string,
		fn: (draft: Info) => void
	) {
		return Database.use((db) => {
			const row = db.select().from(PartTable).where(eq(PartTable.id, id)).get()
			if (!row) return undefined
			const part = fromRow(row)
			fn(part)
			db.update(PartTable)
				.set({
					data: toData(part) as any,
					time_updated: Date.now(),
				})
				.where(eq(PartTable.id, id))
				.run()
			Bus.publish(Event.Updated, part)
			return part
		})
	}

	export function get(_projectID: string, _messageID: string, id: string) {
		return Database.use((db) => {
			const row = db.select().from(PartTable).where(eq(PartTable.id, id)).get()
			if (!row) return undefined
			return fromRow(row)
		})
	}

	export function list(_projectID: string, messageID: string) {
		return Database.use((db) => {
			const rows = db
				.select()
				.from(PartTable)
				.where(eq(PartTable.message_id, messageID))
				.orderBy(asc(PartTable.time_created))
				.all()
			return rows.map(fromRow)
		})
	}
}
