import fs from 'node:fs/promises'
import path from 'node:path'
import { Identifier } from '@etcode/util/identifier'
import { Global } from '../global'
import { Filesystem } from '../util/filesystem'

export namespace Truncate {
	export const MAX_LINES = 2000
	export const MAX_BYTES = 50 * 1024
	export const DIR = path.join(Global.Path.data, 'tool-output')

	export type Result =
		| { content: string; truncated: false }
		| { content: string; truncated: true; outputPath: string }

	export interface Options {
		direction?: 'head' | 'tail'
		maxBytes?: number
		maxLines?: number
	}

	export async function cleanup() {
		const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
		const entries = await fs.readdir(DIR).catch(() => [] as string[])
		for (const entry of entries) {
			const full = path.join(DIR, entry)
			const stat = Filesystem.stat(full)
			if (stat && stat.mtimeMs < cutoff) await fs.unlink(full).catch(() => {})
		}
	}

	export async function output(
		text: string,
		options: Options = {}
	): Promise<Result> {
		const maxLines = options.maxLines ?? MAX_LINES
		const maxBytes = options.maxBytes ?? MAX_BYTES
		const direction = options.direction ?? 'head'
		const lines = text.split('\n')
		const totalBytes = Buffer.byteLength(text, 'utf-8')

		if (lines.length <= maxLines && totalBytes <= maxBytes)
			return { content: text, truncated: false }

		const out: string[] = []
		let bytes = 0
		let hitBytes = false

		if (direction === 'head') {
			for (let i = 0; i < lines.length && i < maxLines; i++) {
				const size = Buffer.byteLength(lines[i], 'utf-8') + (i > 0 ? 1 : 0)
				if (bytes + size > maxBytes) {
					hitBytes = true
					break
				}
				out.push(lines[i])
				bytes += size
			}
		} else {
			for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
				const size = Buffer.byteLength(lines[i], 'utf-8') + (out.length > 0 ? 1 : 0)
				if (bytes + size > maxBytes) {
					hitBytes = true
					break
				}
				out.unshift(lines[i])
				bytes += size
			}
		}

		const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
		const unit = hitBytes ? 'bytes' : 'lines'
		const preview = out.join('\n')

		const id = Identifier.ascending('tool')
		const filepath = path.join(DIR, id)
		await Filesystem.write(filepath, text)

		const hint = `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
		const message =
			direction === 'head'
				? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
				: `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

		return { content: message, truncated: true, outputPath: filepath }
	}
}
