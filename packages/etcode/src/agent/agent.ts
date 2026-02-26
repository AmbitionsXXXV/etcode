import z from "zod"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Permission } from "../permission/permission"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create("agent")

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompt")

function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.txt`), "utf-8")
}

export namespace Agent {
  export const Info = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["primary", "subagent", "all"]),
    hidden: z.boolean().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    permission: Permission.Ruleset,
    model: z.object({
      providerID: z.string(),
      modelID: z.string(),
    }).optional(),
    prompt: z.string().optional(),
    steps: z.number().int().positive().optional(),
  })
  export type Info = z.infer<typeof Info>

  const defaults = Permission.fromConfig({
    "*": "allow",
    doom_loop: "ask",
    plan_enter: "deny",
    plan_exit: "deny",
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
    },
  })

  function builtin(): Record<string, Info> {
    return {
      build: {
        name: "build",
        description: "The default agent. Executes tools based on configured permissions.",
        mode: "primary",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
        ),
        prompt: loadPrompt("build"),
      },
      plan: {
        name: "plan",
        description: "Plan mode. Disallows all edit tools.",
        mode: "primary",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({
            question: "allow",
            plan_exit: "allow",
            edit: {
              "*": "deny",
              ".etcode/plans/*.md": "allow",
            },
          }),
        ),
        prompt: loadPrompt("plan"),
      },
      general: {
        name: "general",
        description: "General-purpose agent for researching complex questions and executing multi-step tasks.",
        mode: "subagent",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
        ),
      },
      explore: {
        name: "explore",
        description: "Fast agent specialized for exploring codebases with read-only access.",
        mode: "subagent",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            read: "allow",
            bash: "allow",
            websearch: "allow",
          }),
        ),
        prompt: loadPrompt("explore"),
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        hidden: true,
        description: "Context compaction agent for handling token limits.",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({ "*": "deny" }),
        ),
        prompt: loadPrompt("compaction"),
      },
      title: {
        name: "title",
        mode: "primary",
        hidden: true,
        temperature: 0.5,
        description: "Generates descriptive titles for sessions.",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({ "*": "deny" }),
        ),
        prompt: loadPrompt("title"),
      },
      summary: {
        name: "summary",
        mode: "primary",
        hidden: true,
        description: "Generates conversation summaries.",
        permission: Permission.merge(
          defaults,
          Permission.fromConfig({ "*": "deny" }),
        ),
        prompt: loadPrompt("summary"),
      },
    }
  }

  let cached: Record<string, Info> | undefined

  async function state(): Promise<Record<string, Info>> {
    if (cached) return cached
    const result = builtin()
    try {
      const cfg = await Config.get(process.cwd())
      const user = Permission.fromConfig(cfg.permission ?? {})

      for (const [key, value] of Object.entries(cfg.agent ?? {})) {
        if (value.disable) {
          delete result[key]
          continue
        }
        let item = result[key]
        if (!item) {
          item = result[key] = {
            name: key,
            mode: "all",
            permission: Permission.merge(defaults, user),
          }
        }
        if (value.model) item.model = { providerID: value.model, modelID: value.model }
        if (value.prompt !== undefined) item.prompt = value.prompt
        if (value.description !== undefined) item.description = value.description
        if (value.temperature !== undefined) item.temperature = value.temperature
        if (value.top_p !== undefined) item.topP = value.top_p
        if (value.mode !== undefined) item.mode = value.mode
        if (value.hidden !== undefined) item.hidden = value.hidden
        if (value.steps !== undefined) item.steps = value.steps
        if (value.permission) {
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission))
        }
        item.permission = Permission.merge(item.permission, user)
      }
    } catch {
      log.debug("no config loaded, using builtin agents only")
    }
    cached = result
    return result
  }

  export function reset() {
    cached = undefined
  }

  export async function get(name: string): Promise<Info | undefined> {
    const agents = await state()
    return agents[name]
  }

  export async function list(): Promise<Info[]> {
    const agents = await state()
    const def = await defaultAgent()
    return Object.values(agents).sort((a, b) => {
      if (a.name === def) return -1
      if (b.name === def) return 1
      return a.name.localeCompare(b.name)
    })
  }

  export async function defaultAgent(): Promise<string> {
    const agents = await state()
    try {
      const cfg = await Config.get(process.cwd())
      if (cfg.default_agent) {
        const agent = agents[cfg.default_agent]
        if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
        if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
        if (agent.hidden) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
        return agent.name
      }
    } catch {
      // fall through to default
    }
    const primary = Object.values(agents).find((a) => a.mode !== "subagent" && !a.hidden)
    if (!primary) throw new Error("no primary visible agent found")
    return primary.name
  }
}
