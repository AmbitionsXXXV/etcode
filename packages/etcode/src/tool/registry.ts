import type { Agent } from '../agent/agent'
import { Config } from '../config/config'
import { Log } from '../util/log'
import { ApplyPatchTool } from './apply_patch'
import { BashTool } from './bash'
import { BatchTool } from './batch'
import { EditTool } from './edit'
import { GlobTool } from './glob'
import { GrepTool } from './grep'
import { InvalidTool } from './invalid'
import { PlanExitTool } from './plan'
import { QuestionTool } from './question'
import { ReadTool } from './read'
import { SkillTool } from './skill'
import { TaskTool } from './task'
import { TodoWriteTool } from './todo'
import type { Tool } from './tool'
import { WebFetchTool } from './webfetch'
import { WebSearchTool } from './websearch'
import { WriteTool } from './write'

const _log = Log.create('tool.registry')

export namespace ToolRegistry {
	const custom: Tool.Info[] = []

	export function register(tool: Tool.Info) {
		const idx = custom.findIndex((t) => t.id === tool.id)
		if (idx >= 0) {
			custom.splice(idx, 1, tool)
			return
		}
		custom.push(tool)
	}

	async function all(): Promise<Tool.Info[]> {
		let enableBatch = false
		let enableWebSearch = false
		try {
			const config = await Config.get(process.cwd())
			enableBatch = config.experimental?.batch_tool === true
			enableWebSearch = config.experimental?.websearch === true
		} catch {}

		return [
			InvalidTool,
			QuestionTool,
			BashTool,
			ReadTool,
			GlobTool,
			GrepTool,
			EditTool,
			WriteTool,
			TaskTool,
			WebFetchTool,
			TodoWriteTool,
			...(enableWebSearch ? [WebSearchTool] : []),
			SkillTool,
			ApplyPatchTool,
			...(enableBatch ? [BatchTool] : []),
			PlanExitTool,
			...custom,
		]
	}

	export function ids() {
		return all().then((x) => x.map((t) => t.id))
	}

	export async function tools(
		model: { providerID: string; modelID: string },
		agent?: Agent.Info
	) {
		const allTools = await all()
		const result = await Promise.all(
			allTools
				.filter((t) => {
					const usePatch =
						model.modelID.includes('gpt-') &&
						!model.modelID.includes('oss') &&
						!model.modelID.includes('gpt-4')
					if (t.id === 'apply_patch') return usePatch
					if (t.id === 'edit' || t.id === 'write') return !usePatch
					return true
				})
				.map(async (t) => {
					const tool = await t.init({ agent })
					return {
						id: t.id,
						...tool,
					}
				})
		)
		return result
	}
}
