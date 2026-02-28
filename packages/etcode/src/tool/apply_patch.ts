import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createTwoFilesPatch, diffLines } from 'diff'
import z from 'zod'
import { Instance } from '../project/instance'
import { loadDescription } from './description'
import { trimDiff } from './edit'
import { assertExternalDirectory } from './external-directory'
import { Tool } from './tool'

const DESCRIPTION = loadDescription('apply_patch.txt')

interface PatchHunk {
	chunks: PatchChunk[]
	contents: string
	movePath?: string
	path: string
	type: 'add' | 'update' | 'delete'
}

interface PatchChunk {
	adds: string[]
	context: string
	removes: string[]
}

function parsePatch(patchText: string): { hunks: PatchHunk[] } {
	const lines = patchText.replace(/\r\n/g, '\n').split('\n')
	const hunks: PatchHunk[] = []
	let i = 0

	while (i < lines.length && !lines[i].startsWith('*** Begin Patch')) i++
	if (i >= lines.length) return { hunks: [] }
	i++

	while (i < lines.length && !lines[i].startsWith('*** End Patch')) {
		const line = lines[i]

		if (line.startsWith('*** Add File: ')) {
			const filePath = line.slice('*** Add File: '.length).trim()
			i++
			let contents = ''
			while (i < lines.length && !lines[i].startsWith('***')) {
				const addLine = lines[i]
				contents += `${addLine.startsWith('+') ? addLine.slice(1) : addLine}\n`
				i++
			}
			hunks.push({ type: 'add', path: filePath, contents, chunks: [] })
			continue
		}

		if (line.startsWith('*** Delete File: ')) {
			const filePath = line.slice('*** Delete File: '.length).trim()
			hunks.push({ type: 'delete', path: filePath, contents: '', chunks: [] })
			i++
			continue
		}

		if (line.startsWith('*** Update File: ')) {
			const filePath = line.slice('*** Update File: '.length).trim()
			i++
			let movePath: string | undefined
			if (i < lines.length && lines[i].startsWith('*** Move to: ')) {
				movePath = lines[i].slice('*** Move to: '.length).trim()
				i++
			}

			const chunks: PatchChunk[] = []
			while (i < lines.length && !lines[i].startsWith('***')) {
				const chunkLine = lines[i]
				if (chunkLine.startsWith('@@')) {
					const context = chunkLine.slice(3).trim()
					i++
					const removes: string[] = []
					const adds: string[] = []
					while (
						i < lines.length &&
						!lines[i].startsWith('@@') &&
						!lines[i].startsWith('***')
					) {
						if (lines[i].startsWith('-')) removes.push(lines[i].slice(1))
						else if (lines[i].startsWith('+')) adds.push(lines[i].slice(1))
						i++
					}
					chunks.push({ context, removes, adds })
				} else {
					i++
				}
			}
			hunks.push({ type: 'update', path: filePath, movePath, contents: '', chunks })
			continue
		}

		i++
	}

	return { hunks }
}

function applyChunks(original: string, chunks: PatchChunk[]): string {
	let content = original
	for (const chunk of chunks) {
		const removeText = chunk.removes.join('\n')
		const addText = chunk.adds.join('\n')

		if (removeText && content.includes(removeText)) {
			content = content.replace(removeText, addText)
		} else if (chunk.context) {
			const idx = content.indexOf(chunk.context)
			if (idx !== -1) {
				const afterContext = idx + chunk.context.length
				const nextNewline = content.indexOf('\n', afterContext)
				const insertAt = nextNewline === -1 ? content.length : nextNewline + 1
				if (removeText) {
					const removeIdx = content.indexOf(removeText, afterContext)
					if (removeIdx !== -1)
						content =
							content.slice(0, removeIdx) +
							addText +
							content.slice(removeIdx + removeText.length)
				} else if (addText) {
					content = `${content.slice(0, insertAt) + addText}\n${content.slice(insertAt)}`
				}
			}
		}
	}
	return content
}

const PatchParams = z.object({
	patchText: z
		.string()
		.describe('The full patch text that describes all changes to be made'),
})

export const ApplyPatchTool = Tool.define('apply_patch', {
	description: DESCRIPTION,
	parameters: PatchParams,
	async execute(params, ctx) {
		if (!params.patchText) throw new Error('patchText is required')

		const { hunks } = parsePatch(params.patchText)
		if (hunks.length === 0) {
			const normalized = params.patchText
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n')
				.trim()
			if (normalized === '*** Begin Patch\n*** End Patch')
				throw new Error('patch rejected: empty patch')
			throw new Error('apply_patch verification failed: no hunks found')
		}

		const fileChanges: Array<{
			filePath: string
			oldContent: string
			newContent: string
			type: 'add' | 'update' | 'delete' | 'move'
			movePath?: string
			diff: string
			additions: number
			deletions: number
		}> = []

		let totalDiff = ''

		for (const hunk of hunks) {
			const filePath = path.resolve(Instance.directory(), hunk.path)
			await assertExternalDirectory(ctx, filePath)

			switch (hunk.type) {
				case 'add': {
					const newContent = hunk.contents.endsWith('\n')
						? hunk.contents
						: `${hunk.contents}\n`
					const diff = trimDiff(
						createTwoFilesPatch(filePath, filePath, '', newContent)
					)
					let additions = 0
					for (const change of diffLines('', newContent))
						if (change.added) additions += change.count || 0
					fileChanges.push({
						filePath,
						oldContent: '',
						newContent,
						type: 'add',
						diff,
						additions,
						deletions: 0,
					})
					totalDiff += `${diff}\n`
					break
				}
				case 'update': {
					const stats = await fs.stat(filePath).catch(() => null)
					if (!stats || stats.isDirectory())
						throw new Error(
							`apply_patch verification failed: Failed to read file to update: ${filePath}`
						)
					const oldContent = await fs.readFile(filePath, 'utf-8')
					const newContent = applyChunks(oldContent, hunk.chunks)
					const diff = trimDiff(
						createTwoFilesPatch(filePath, filePath, oldContent, newContent)
					)
					let additions = 0,
						deletions = 0
					for (const change of diffLines(oldContent, newContent)) {
						if (change.added) additions += change.count || 0
						if (change.removed) deletions += change.count || 0
					}
					const movePath = hunk.movePath
						? path.resolve(Instance.directory(), hunk.movePath)
						: undefined
					if (movePath) await assertExternalDirectory(ctx, movePath)
					fileChanges.push({
						filePath,
						oldContent,
						newContent,
						type: hunk.movePath ? 'move' : 'update',
						movePath,
						diff,
						additions,
						deletions,
					})
					totalDiff += `${diff}\n`
					break
				}
				case 'delete': {
					const contentToDelete = await fs
						.readFile(filePath, 'utf-8')
						.catch((error) => {
							throw new Error(`apply_patch verification failed: ${error}`)
						})
					const deleteDiff = trimDiff(
						createTwoFilesPatch(filePath, filePath, contentToDelete, '')
					)
					fileChanges.push({
						filePath,
						oldContent: contentToDelete,
						newContent: '',
						type: 'delete',
						diff: deleteDiff,
						additions: 0,
						deletions: contentToDelete.split('\n').length,
					})
					totalDiff += `${deleteDiff}\n`
					break
				}
				default:
					break
			}
		}

		const relativePaths = fileChanges.map((c) =>
			path.relative(Instance.directory(), c.filePath)
		)
		await ctx.ask({
			permission: 'edit',
			patterns: relativePaths,
			always: ['*'],
			metadata: { filepath: relativePaths.join(', '), diff: totalDiff },
		})

		for (const change of fileChanges) {
			switch (change.type) {
				case 'add':
					await fs.mkdir(path.dirname(change.filePath), { recursive: true })
					await fs.writeFile(change.filePath, change.newContent, 'utf-8')
					break
				case 'update':
					await fs.writeFile(change.filePath, change.newContent, 'utf-8')
					break
				case 'move':
					if (change.movePath) {
						await fs.mkdir(path.dirname(change.movePath), { recursive: true })
						await fs.writeFile(change.movePath, change.newContent, 'utf-8')
						await fs.unlink(change.filePath)
					}
					break
				case 'delete':
					await fs.unlink(change.filePath)
					break
				default:
					break
			}
		}

		const summaryLines = fileChanges.map((change) => {
			if (change.type === 'add')
				return `A ${path.relative(Instance.directory(), change.filePath)}`
			if (change.type === 'delete')
				return `D ${path.relative(Instance.directory(), change.filePath)}`
			const target = change.movePath ?? change.filePath
			return `M ${path.relative(Instance.directory(), target)}`
		})
		const output = `Success. Updated the following files:\n${summaryLines.join('\n')}`

		return {
			title: output,
			metadata: { diff: totalDiff },
			output,
		}
	},
})
