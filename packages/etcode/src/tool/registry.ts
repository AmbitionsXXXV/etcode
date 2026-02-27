import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { WebSearchTool } from "./websearch"
import { ApplyPatchTool } from "./apply_patch"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create("tool.registry")

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

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: { providerID: string; modelID: string },
    agent?: Agent.Info,
  ) {
    const allTools = await all()
    const result = await Promise.all(
      allTools
        .filter((t) => {
          const usePatch =
            model.modelID.includes("gpt-") &&
            !model.modelID.includes("oss") &&
            !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch
          return true
        })
        .map(async (t) => {
          const tool = await t.init({ agent })
          return {
            id: t.id,
            ...tool,
          }
        }),
    )
    return result
  }
}
