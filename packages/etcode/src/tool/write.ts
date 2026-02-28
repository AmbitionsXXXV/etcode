import * as path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import z from 'zod'
import { loadDescription } from './description'
import { Tool } from './tool'

const DESCRIPTION = loadDescription('write.txt')

import { Instance } from '../project/instance'
import { Filesystem } from '../util/filesystem'
import { trimDiff } from './edit'
import { assertExternalDirectory } from './external-directory'

export const WriteTool = Tool.define('write', {
	description: DESCRIPTION,
	parameters: z.object({
		content: z.string().describe('The content to write to the file'),
		filePath: z
			.string()
			.describe(
				'The absolute path to the file to write (must be absolute, not relative)'
			),
	}),
	async execute(params, ctx) {
		const filepath = path.isAbsolute(params.filePath)
			? params.filePath
			: path.join(Instance.directory(), params.filePath)

		await assertExternalDirectory(ctx, filepath)

		const exists = await Filesystem.exists(filepath)
		const contentOld = exists ? await Filesystem.readText(filepath) : ''

		const diff = trimDiff(
			createTwoFilesPatch(filepath, filepath, contentOld, params.content)
		)
		await ctx.ask({
			permission: 'edit',
			patterns: [path.relative(Instance.directory(), filepath)],
			always: ['*'],
			metadata: { filepath, diff },
		})

		await Filesystem.write(filepath, params.content)

		return {
			title: path.relative(Instance.directory(), filepath),
			metadata: { filepath, exists },
			output: 'Wrote file successfully.',
		}
	},
})
