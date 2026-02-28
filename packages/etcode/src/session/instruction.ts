import path from 'node:path'
import { Config } from '../config/config'
import { Global } from '../global'
import { Instance } from '../project/instance'
import { Filesystem } from '../util/filesystem'
import { Log } from '../util/log'

const log = Log.create('instruction')

const INSTRUCTION_FILES = ['AGENTS.md', 'ETCODE.md']

const URL_TIMEOUT_MS = 5000

export namespace InstructionPrompt {
	export async function systemPaths(): Promise<Set<string>> {
		const config = await Config.get(Instance.directory())
		const paths = new Set<string>()

		const project = Instance.project()
		const root = project.gitRoot ?? project.directory
		const found = await Filesystem.findUpAll(
			INSTRUCTION_FILES,
			Instance.directory(),
			root
		)
		for (const p of found) {
			paths.add(path.resolve(p))
		}

		const globalPath = path.join(Global.Path.config, 'AGENTS.md')
		if (await Filesystem.exists(globalPath)) {
			paths.add(path.resolve(globalPath))
		}

		if (config.instructions) {
			for (let instruction of config.instructions) {
				if (instruction.startsWith('https://') || instruction.startsWith('http://'))
					continue
				if (instruction.startsWith('~/')) {
					instruction = path.join(Global.Path.home, instruction.slice(2))
				}
				const resolved = path.isAbsolute(instruction)
					? instruction
					: path.resolve(Instance.directory(), instruction)
				if (await Filesystem.exists(resolved)) {
					paths.add(path.resolve(resolved))
				}
			}
		}

		return paths
	}

	export async function system(): Promise<string[]> {
		const config = await Config.get(Instance.directory())
		const paths = await systemPaths()

		const files = Array.from(paths).map(async (p) => {
			const content = await Filesystem.readText(p).catch(() => '')
			if (!content) return ''
			return `Instructions from: ${p}\n${content}`
		})

		const urls: string[] = []
		if (config.instructions) {
			for (const instruction of config.instructions) {
				if (
					instruction.startsWith('https://') ||
					instruction.startsWith('http://')
				) {
					urls.push(instruction)
				}
			}
		}

		const fetches = urls.map((url) =>
			fetch(url, { signal: AbortSignal.timeout(URL_TIMEOUT_MS) })
				.then((res) => (res.ok ? res.text() : ''))
				.catch((err) => {
					log.debug('failed to fetch instruction URL', { url, error: String(err) })
					return ''
				})
				.then((text) => (text ? `Instructions from: ${url}\n${text}` : ''))
		)

		const results = await Promise.all([...files, ...fetches])
		return results.filter(Boolean)
	}

	export async function find(dir: string): Promise<string | undefined> {
		for (const file of INSTRUCTION_FILES) {
			const filepath = path.resolve(path.join(dir, file))
			if (await Filesystem.exists(filepath)) return filepath
		}
		return undefined
	}
}
