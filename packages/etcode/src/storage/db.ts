import BetterSQLite3 from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export * from 'drizzle-orm'

import path from 'node:path'
import { Global } from '../global'
import { Context } from '../util/context'
import { lazy } from '../util/lazy'
import { Log } from '../util/log'
import * as schema from './schema'

const log = Log.create('db')

export namespace Database {
	export const Path = path.join(Global.Path.data, 'etcode.db')
	type Schema = typeof schema
	type Client = BetterSQLite3Database<Schema>

	const state = {
		sqlite: undefined as BetterSQLite3.Database | undefined,
	}

	export const open = lazy(() => {
		const dbPath = path.join(Global.Path.data, 'etcode.db')
		log.info('opening database', { path: dbPath })

		const sqlite = new BetterSQLite3(dbPath)
		state.sqlite = sqlite

		sqlite.pragma('journal_mode = WAL')
		sqlite.pragma('synchronous = NORMAL')
		sqlite.pragma('busy_timeout = 5000')
		sqlite.pragma('cache_size = -64000')
		sqlite.pragma('foreign_keys = ON')

		const db = drizzle(sqlite, { schema })

		const migrationsFolder = path.join(import.meta.dirname, '../../migration')
		try {
			migrate(db, { migrationsFolder })
			log.info('migrations applied')
		} catch (e) {
			log.debug('migration skipped or already applied', { error: String(e) })
		}

		return db
	})

	export function close() {
		const sqlite = state.sqlite
		if (!sqlite) return
		sqlite.close()
		state.sqlite = undefined
		open.reset()
	}

	export type TxOrDb = Client

	const ctx = Context.create<{
		tx: TxOrDb
		effects: (() => void | Promise<void>)[]
	}>('database')

	export function use<T>(callback: (trx: TxOrDb) => T): T {
		try {
			return callback(ctx.use().tx)
		} catch (err) {
			if (err instanceof Context.NotFound) {
				const effects: (() => void | Promise<void>)[] = []
				const result = ctx.provide({ effects, tx: open() }, () => callback(open()))
				for (const effect of effects) effect()
				return result
			}
			throw err
		}
	}

	export function effect(fn: () => any | Promise<any>) {
		try {
			ctx.use().effects.push(fn)
		} catch {
			fn()
		}
	}

	export function transaction<T>(callback: (tx: TxOrDb) => T): T {
		try {
			return callback(ctx.use().tx)
		} catch (err) {
			if (err instanceof Context.NotFound) {
				const effects: (() => void | Promise<void>)[] = []
				const result = open().transaction((tx) => {
					return ctx.provide({ tx: tx as unknown as TxOrDb, effects }, () =>
						callback(tx as unknown as TxOrDb)
					)
				})
				for (const effect of effects) effect()
				return result
			}
			throw err
		}
	}
}
