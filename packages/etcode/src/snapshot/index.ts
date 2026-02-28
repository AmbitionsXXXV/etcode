import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import z from 'zod'
import { Global } from '../global'
import { Instance } from '../project/instance'
import { Log } from '../util/log'

const log = Log.create('snapshot')

interface ExecResult {
	exitCode: number
	stderr: string
	stdout: string
}

function exec(
	cmd: string,
	args: string[],
	options: { cwd?: string; env?: Record<string, string> } = {}
): Promise<ExecResult> {
	return new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				cwd: options.cwd,
				env: { ...process.env, ...options.env },
				maxBuffer: 50 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				let code = 0
				if (error) code = typeof error.code === 'number' ? error.code : 1
				resolve({
					exitCode: code,
					stdout: typeof stdout === 'string' ? stdout : '',
					stderr: typeof stderr === 'string' ? stderr : '',
				})
			}
		)
	})
}

function parseStatus(code: string): 'added' | 'deleted' | 'modified' {
	if (code.startsWith('A')) return 'added'
	if (code.startsWith('D')) return 'deleted'
	return 'modified'
}

export namespace Snapshot {
	export const FileDiff = z.object({
		file: z.string(),
		before: z.string(),
		after: z.string(),
		additions: z.number(),
		deletions: z.number(),
		status: z.enum(['added', 'deleted', 'modified']).optional(),
	})
	export type FileDiff = z.infer<typeof FileDiff>

	export const Patch = z.object({
		hash: z.string(),
		files: z.string().array(),
	})
	export type Patch = z.infer<typeof Patch>

	function gitdir() {
		const project = Instance.project()
		return path.join(Global.Path.data, 'snapshot', project.id)
	}

	function worktree() {
		return Instance.directory()
	}

	function baseArgs(): string[] {
		return [
			'-c',
			'core.autocrlf=false',
			'-c',
			'core.longpaths=true',
			'-c',
			'core.symlinks=true',
			'--git-dir',
			gitdir(),
			'--work-tree',
			worktree(),
		]
	}

	async function ensureRepo(): Promise<boolean> {
		const git = gitdir()
		try {
			const stat = await fs.stat(git)
			if (stat.isDirectory()) return false
		} catch {
			// does not exist, will initialize
		}
		await fs.mkdir(git, { recursive: true })
		await exec('git', ['init'], {
			cwd: worktree(),
			env: { GIT_DIR: git, GIT_WORK_TREE: worktree() },
		})
		const configs: [string, string][] = [
			['core.autocrlf', 'false'],
			['core.longpaths', 'true'],
			['core.symlinks', 'true'],
			['core.fsmonitor', 'false'],
		]
		for (const [key, value] of configs) {
			await exec('git', ['--git-dir', git, 'config', key, value])
		}
		log.info('initialized snapshot repo', { git })
		return true
	}

	async function syncExclude() {
		const git = gitdir()
		const wt = worktree()
		const target = path.join(git, 'info', 'exclude')
		await fs.mkdir(path.join(git, 'info'), { recursive: true })

		const result = await exec(
			'git',
			['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
			{ cwd: wt }
		)

		const source = result.stdout.trim()
		if (!source) {
			await fs.writeFile(target, '')
			return
		}

		const text = await fs.readFile(source, 'utf-8').catch(() => '')
		await fs.writeFile(target, text)
	}

	async function add() {
		await syncExclude()
		await exec('git', [...baseArgs(), 'add', '.'], { cwd: Instance.directory() })
	}

	export async function track(): Promise<string | undefined> {
		const project = Instance.project()
		if (project.vcs !== 'git') return undefined

		await ensureRepo()
		await add()

		const result = await exec('git', [...baseArgs(), 'write-tree'], {
			cwd: Instance.directory(),
		})

		if (result.exitCode !== 0) {
			log.warn('write-tree failed', { stderr: result.stderr })
			return undefined
		}

		const hash = result.stdout.trim()
		log.info('tracking', { hash })
		return hash
	}

	export async function patchFiles(hash: string): Promise<Patch> {
		await add()
		const result = await exec(
			'git',
			[
				...baseArgs(),
				'-c',
				'core.quotepath=false',
				'diff',
				'--no-ext-diff',
				'--name-only',
				hash,
				'--',
				'.',
			],
			{ cwd: Instance.directory() }
		)

		if (result.exitCode !== 0) {
			log.warn('patch diff failed', { hash, exitCode: result.exitCode })
			return { hash, files: [] }
		}

		const wt = worktree()
		const files = result.stdout
			.trim()
			.split('\n')
			.map((x) => x.trim())
			.filter(Boolean)
			.map((x) => path.join(wt, x).replaceAll('\\', '/'))

		return { hash, files }
	}

	export async function restore(snapshot: string) {
		log.info('restore', { snapshot })
		const git = gitdir()
		const wt = worktree()
		const longpathArgs = [
			'-c',
			'core.longpaths=true',
			'-c',
			'core.symlinks=true',
			'--git-dir',
			git,
			'--work-tree',
			wt,
		]

		const readTree = await exec('git', [...longpathArgs, 'read-tree', snapshot], {
			cwd: wt,
		})
		if (readTree.exitCode !== 0) {
			log.error('restore read-tree failed', { snapshot, stderr: readTree.stderr })
			return
		}

		const checkout = await exec(
			'git',
			[...longpathArgs, 'checkout-index', '-a', '-f'],
			{ cwd: wt }
		)
		if (checkout.exitCode !== 0) {
			log.error('restore checkout-index failed', {
				snapshot,
				stderr: checkout.stderr,
			})
		}
	}

	export async function revert(patches: Patch[]) {
		const visited = new Set<string>()
		const git = gitdir()
		const wt = worktree()
		const longpathArgs = [
			'-c',
			'core.longpaths=true',
			'-c',
			'core.symlinks=true',
			'--git-dir',
			git,
			'--work-tree',
			wt,
		]

		for (const item of patches) {
			for (const file of item.files) {
				if (visited.has(file)) continue
				log.info('reverting', { file, hash: item.hash })

				const result = await exec(
					'git',
					[...longpathArgs, 'checkout', item.hash, '--', file],
					{ cwd: wt }
				)
				if (result.exitCode !== 0) {
					await handleRevertFailure(longpathArgs, wt, item.hash, file)
				}
				visited.add(file)
			}
		}
	}

	async function handleRevertFailure(
		longpathArgs: string[],
		wt: string,
		hash: string,
		file: string
	) {
		const relative = path.relative(wt, file)
		const check = await exec(
			'git',
			[...longpathArgs, 'ls-tree', hash, '--', relative],
			{ cwd: wt }
		)
		if (check.exitCode === 0 && check.stdout.trim()) {
			log.info('file existed in snapshot but checkout failed, keeping', { file })
		} else {
			log.info('file did not exist in snapshot, deleting', { file })
			await fs.unlink(file).catch(() => undefined)
		}
	}

	export async function diff(hash: string): Promise<string> {
		await add()
		const result = await exec(
			'git',
			[...baseArgs(), 'diff', '--no-ext-diff', hash, '--', '.'],
			{ cwd: worktree() }
		)

		if (result.exitCode !== 0) {
			log.warn('diff failed', { hash, stderr: result.stderr })
			return ''
		}

		return result.stdout.trim()
	}

	export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
		const git = gitdir()
		const wt = worktree()
		const coreArgs = [
			'-c',
			'core.autocrlf=false',
			'-c',
			'core.longpaths=true',
			'-c',
			'core.symlinks=true',
			'-c',
			'core.quotepath=false',
			'--git-dir',
			git,
			'--work-tree',
			wt,
		]
		const showArgs = [
			'-c',
			'core.autocrlf=false',
			'-c',
			'core.longpaths=true',
			'-c',
			'core.symlinks=true',
			'--git-dir',
			git,
			'--work-tree',
			wt,
		]

		const statusMap = await collectStatus(coreArgs, from, to)
		return collectDiffs(coreArgs, showArgs, from, to, statusMap)
	}

	async function collectStatus(
		coreArgs: string[],
		from: string,
		to: string
	): Promise<Map<string, 'added' | 'deleted' | 'modified'>> {
		const statusMap = new Map<string, 'added' | 'deleted' | 'modified'>()
		const result = await exec(
			'git',
			[
				...coreArgs,
				'diff',
				'--no-ext-diff',
				'--name-status',
				'--no-renames',
				from,
				to,
				'--',
				'.',
			],
			{ cwd: Instance.directory() }
		)

		for (const line of result.stdout.trim().split('\n')) {
			if (!line) continue
			const [code, file] = line.split('\t')
			if (code && file) statusMap.set(file, parseStatus(code))
		}
		return statusMap
	}

	async function collectDiffs(
		coreArgs: string[],
		showArgs: string[],
		from: string,
		to: string,
		statusMap: Map<string, 'added' | 'deleted' | 'modified'>
	): Promise<FileDiff[]> {
		const result: FileDiff[] = []
		const numstat = await exec(
			'git',
			[
				...coreArgs,
				'diff',
				'--no-ext-diff',
				'--no-renames',
				'--numstat',
				from,
				to,
				'--',
				'.',
			],
			{ cwd: Instance.directory() }
		)

		for (const line of numstat.stdout.trim().split('\n')) {
			if (!line) continue
			const parts = line.split('\t')
			const additions = parts[0] ?? '0'
			const deletions = parts[1] ?? '0'
			const file = parts[2]
			if (!file) continue

			const isBinary = additions === '-' && deletions === '-'
			let before = ''
			let after = ''
			if (!isBinary) {
				const beforeResult = await exec('git', [
					...showArgs,
					'show',
					`${from}:${file}`,
				])
				before = beforeResult.stdout
				const afterResult = await exec('git', [...showArgs, 'show', `${to}:${file}`])
				after = afterResult.stdout
			}

			const added = isBinary ? 0 : Number.parseInt(additions, 10)
			const deleted = isBinary ? 0 : Number.parseInt(deletions, 10)
			result.push({
				file,
				before,
				after,
				additions: Number.isFinite(added) ? added : 0,
				deletions: Number.isFinite(deleted) ? deleted : 0,
				status: statusMap.get(file) ?? 'modified',
			})
		}
		return result
	}

	export async function cleanup() {
		const project = Instance.project()
		if (project.vcs !== 'git') return
		const git = gitdir()
		const wt = worktree()

		const exists = await fs.stat(git).then(
			() => true,
			() => false
		)
		if (!exists) return

		const result = await exec(
			'git',
			['--git-dir', git, '--work-tree', wt, 'gc', '--prune=7.days'],
			{ cwd: Instance.directory() }
		)

		if (result.exitCode !== 0) {
			log.warn('cleanup failed', { stderr: result.stderr })
			return
		}
		log.info('cleanup done')
	}
}
