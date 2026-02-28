import path from 'node:path'
import { Identifier } from '@etcode/util/identifier'
import z from 'zod'
import { Filesystem } from '../util/filesystem'
import { Log } from '../util/log'

const log = Log.create('project')

export namespace Project {
	export const Info = z.object({
		id: z.string(),
		name: z.string(),
		directory: z.string(),
		gitRoot: z.string().optional(),
		vcs: z.enum(['git', 'none']).default('none'),
		time: z.object({
			created: z.number(),
			updated: z.number(),
		}),
	})
	export type Info = z.infer<typeof Info>

	export async function fromDirectory(directory: string): Promise<Info> {
		const resolved = path.resolve(directory)
		const gitDir = await Filesystem.findUp('.git', resolved)
		const root = gitDir ? path.dirname(gitDir) : resolved
		const name = path.basename(root)
		const now = Date.now()
		log.debug('discovered project', { name, directory: resolved })
		return {
			id: Identifier.ascending('proj'),
			name,
			directory: resolved,
			gitRoot: gitDir ? root : undefined,
			vcs: gitDir ? 'git' : 'none',
			time: { created: now, updated: now },
		}
	}
}
