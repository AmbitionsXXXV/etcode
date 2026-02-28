import path from 'node:path'
import { Context } from '../util/context'
import { Project } from './project'

interface InstanceContext {
	directory: string
	project: Project.Info
}

const context = Context.create<InstanceContext>('Instance')

export namespace Instance {
	export async function provide<R>(input: { directory: string; fn: () => R }) {
		const project = await Project.fromDirectory(input.directory)
		return context.provide({ directory: input.directory, project }, input.fn)
	}

	export function directory() {
		return context.use().directory
	}

	export function project() {
		return context.use().project
	}

	export function containsPath(target: string): boolean {
		const dir = directory()
		const resolved = path.resolve(target)
		const base = path.resolve(dir)
		return resolved === base || resolved.startsWith(base + path.sep)
	}
}
