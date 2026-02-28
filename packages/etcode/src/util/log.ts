import fs from 'node:fs/promises'
import path from 'node:path'
import { Global } from '../global'

export namespace Log {
	export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

	const LEVELS: Record<Level, number> = {
		DEBUG: 0,
		INFO: 1,
		WARN: 2,
		ERROR: 3,
	}

	let minLevel: Level = 'INFO'
	let output: 'stderr' | string = 'stderr'

	export function init(options: { level?: Level; output?: 'stderr' | string }) {
		if (options.level) minLevel = options.level
		if (options.output) output = options.output
	}

	function shouldLog(level: Level) {
		return LEVELS[level] >= LEVELS[minLevel]
	}

	async function write(
		level: Level,
		service: string,
		message: string,
		data?: Record<string, unknown>
	) {
		if (!shouldLog(level)) return
		const entry = JSON.stringify({
			ts: new Date().toISOString(),
			level,
			service,
			msg: message,
			...data,
		})
		if (output === 'stderr') {
			process.stderr.write(`${entry}\n`)
			return
		}
		const file = path.join(Global.Path.log, output)
		await fs.appendFile(file, `${entry}\n`)
	}

	export function create(service: string) {
		return {
			debug: (msg: string, data?: Record<string, unknown>) =>
				write('DEBUG', service, msg, data),
			info: (msg: string, data?: Record<string, unknown>) =>
				write('INFO', service, msg, data),
			warn: (msg: string, data?: Record<string, unknown>) =>
				write('WARN', service, msg, data),
			error: (msg: string, data?: Record<string, unknown>) =>
				write('ERROR', service, msg, data),
		}
	}

	export const Default = create('etcode')
}
