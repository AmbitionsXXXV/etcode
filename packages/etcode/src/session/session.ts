import { Identifier } from '@etcode/util/identifier'
import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'
import { Database, desc, eq } from '../storage/db'
import { SessionTable } from './session.sql'

export namespace Session {
	export const Summary = z.object({
		additions: z.number(),
		deletions: z.number(),
		files: z.number(),
	})
	export type Summary = z.infer<typeof Summary>

	export const Info = z.object({
		id: z.string(),
		title: z.string(),
		projectID: z.string(),
		directory: z.string(),
		agent: z.string().optional(),
		summary: Summary.optional(),
		time: z.object({
			created: z.number(),
			updated: z.number(),
		}),
	})
	export type Info = z.infer<typeof Info>

	export const Event = {
		Created: BusEvent.define('session.created', Info),
		Updated: BusEvent.define('session.updated', Info),
		Deleted: BusEvent.define('session.deleted', z.object({ id: z.string() })),
		Diff: BusEvent.define(
			'session.diff',
			z.object({
				sessionID: z.string(),
				diff: z.array(
					z.object({
						file: z.string(),
						before: z.string(),
						after: z.string(),
						additions: z.number(),
						deletions: z.number(),
						status: z.enum(['added', 'deleted', 'modified']).optional(),
					})
				),
			})
		),
		Error: BusEvent.define(
			'session.error',
			z.object({
				sessionID: z.string(),
				error: z.unknown(),
			})
		),
	}

	function fromRow(row: typeof SessionTable.$inferSelect): Info {
		const hasSummary =
			row.summary_additions || row.summary_deletions || row.summary_files
		return {
			id: row.id,
			title: row.title,
			projectID: row.project_id,
			directory: row.directory,
			agent: row.agent ?? undefined,
			summary: hasSummary
				? {
						additions: row.summary_additions ?? 0,
						deletions: row.summary_deletions ?? 0,
						files: row.summary_files ?? 0,
					}
				: undefined,
			time: { created: row.time_created, updated: row.time_updated },
		}
	}

	export async function create(input: {
		projectID: string
		directory: string
		title?: string
		agent?: string
	}) {
		const now = Date.now()
		const id = Identifier.ascending('sess')
		Database.use((db) => {
			db.insert(SessionTable)
				.values({
					id,
					project_id: input.projectID,
					directory: input.directory,
					title: input.title ?? 'New Session',
					agent: input.agent,
					time_created: now,
					time_updated: now,
				})
				.run()
		})
		const session: Info = {
			id,
			title: input.title ?? 'New Session',
			projectID: input.projectID,
			directory: input.directory,
			agent: input.agent,
			time: { created: now, updated: now },
		}
		await Bus.publish(Event.Created, session)
		return session
	}

	export function get(projectID: string, id: string) {
		return Database.use((db) => {
			const row = db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
			if (!row || row.project_id !== projectID) return undefined
			return fromRow(row)
		})
	}

	export function list(projectID: string) {
		return Database.use((db) => {
			const rows = db
				.select()
				.from(SessionTable)
				.where(eq(SessionTable.project_id, projectID))
				.orderBy(desc(SessionTable.time_updated))
				.all()
			return rows.map(fromRow)
		})
	}

	export async function touch(projectID: string, id: string) {
		const now = Date.now()
		Database.use((db) => {
			db.update(SessionTable)
				.set({ time_updated: now })
				.where(eq(SessionTable.id, id))
				.run()
		})
		const session = await get(projectID, id)
		if (session) await Bus.publish(Event.Updated, session)
		return session
	}

	export async function setTitle(projectID: string, id: string, title: string) {
		const now = Date.now()
		Database.use((db) => {
			db.update(SessionTable)
				.set({ title, time_updated: now })
				.where(eq(SessionTable.id, id))
				.run()
		})
		const session = await get(projectID, id)
		if (session) await Bus.publish(Event.Updated, session)
		return session
	}

	export async function remove(_projectID: string, id: string) {
		Database.use((db) => {
			db.delete(SessionTable).where(eq(SessionTable.id, id)).run()
		})
		await Bus.publish(Event.Deleted, { id })
	}

	export function setSummary(input: { sessionID: string; summary: Summary }) {
		const now = Date.now()
		Database.use((db) => {
			db.update(SessionTable)
				.set({
					summary_additions: input.summary.additions,
					summary_deletions: input.summary.deletions,
					summary_files: input.summary.files,
					time_updated: now,
				})
				.where(eq(SessionTable.id, input.sessionID))
				.run()
		})
	}
}
