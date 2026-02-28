import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from 'drizzle-orm/sqlite-core'
import { Timestamps } from '../storage/schema.sql'

export const SessionTable = sqliteTable(
	'session',
	{
		id: text().primaryKey(),
		project_id: text().notNull(),
		directory: text().notNull(),
		title: text().notNull(),
		agent: text(),
		summary_additions: integer().default(0),
		summary_deletions: integer().default(0),
		summary_files: integer().default(0),
		...Timestamps,
	},
	(table) => [index('session_project_idx').on(table.project_id)]
)

export const MessageTable = sqliteTable(
	'message',
	{
		id: text().primaryKey(),
		session_id: text()
			.notNull()
			.references(() => SessionTable.id, { onDelete: 'cascade' }),
		...Timestamps,
		data: text({ mode: 'json' }).notNull().$type<Record<string, unknown>>(),
	},
	(table) => [index('message_session_idx').on(table.session_id)]
)

export const PartTable = sqliteTable(
	'part',
	{
		id: text().primaryKey(),
		message_id: text()
			.notNull()
			.references(() => MessageTable.id, { onDelete: 'cascade' }),
		session_id: text().notNull(),
		...Timestamps,
		data: text({ mode: 'json' }).notNull().$type<Record<string, unknown>>(),
	},
	(table) => [
		index('part_message_idx').on(table.message_id),
		index('part_session_idx').on(table.session_id),
	]
)

export const PermissionTable = sqliteTable('permission', {
	project_id: text().primaryKey(),
	data: text({ mode: 'json' }).notNull().$type<Record<string, unknown>[]>(),
	...Timestamps,
})

export const TodoTable = sqliteTable(
	'todo',
	{
		session_id: text()
			.notNull()
			.references(() => SessionTable.id, { onDelete: 'cascade' }),
		content: text().notNull(),
		status: text().notNull(),
		priority: text().notNull(),
		position: integer().notNull(),
		...Timestamps,
	},
	(table) => [
		primaryKey({ columns: [table.session_id, table.position] }),
		index('todo_session_idx').on(table.session_id),
	]
)
