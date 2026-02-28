import path from 'node:path'
import { Global } from '../global'
import { Filesystem } from '../util/filesystem'
import type { StorageDriver } from './storage'

const JSON_EXTENSION_REGEX = /\.json$/

function resolve(key: string[]) {
	return `${path.join(Global.Path.data, 'storage', ...key)}.json`
}

function resolveDir(prefix: string[]) {
	return path.join(Global.Path.data, 'storage', ...prefix)
}

export function createJsonStorage(): StorageDriver {
	return {
		read<T>(key: string[]) {
			return Filesystem.readJson<T>(resolve(key))
		},

		async write<T>(key: string[], content: T) {
			await Filesystem.writeJson(resolve(key), content)
		},

		async update<T>(key: string[], fn: (draft: T) => void) {
			const target = resolve(key)
			const content = await Filesystem.readJson<T>(target)
			if (!content) return
			fn(content)
			await Filesystem.writeJson(target, content)
		},

		async remove(key: string[]) {
			await Filesystem.remove(resolve(key))
		},

		async list(prefix: string[]) {
			const dir = resolveDir(prefix)
			const entries = await Filesystem.list(dir)
			return entries
				.filter((e) => e.endsWith('.json'))
				.map((e) => e.replace(JSON_EXTENSION_REGEX, ''))
		},
	}
}
