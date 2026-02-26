import z from "zod"
import { Permission } from "../permission/permission"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"
import { Log } from "../util/log"

const log = Log.create("config")

export namespace Config {
  export const Provider = z.object({
    id: z.string(),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    model: z.string().optional(),
  })

  export const AgentConfig = z.object({
    model: z.string().optional(),
    prompt: z.string().optional(),
    description: z.string().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    mode: z.enum(["primary", "subagent", "all"]).optional(),
    hidden: z.boolean().optional(),
    permission: Permission.ConfigSchema.optional(),
    steps: z.number().int().positive().optional(),
    disable: z.boolean().optional(),
  })
  export type AgentConfig = z.infer<typeof AgentConfig>

  export const Info = z.object({
    provider: z.array(Provider).default([]),
    default_agent: z.string().optional(),
    agent: z.record(z.string(), AgentConfig).default({}),
    permission: Permission.ConfigSchema.optional(),
    limits: z.object({
      maxTokens: z.number().default(4096),
      maxSteps: z.number().default(50),
    }).default({ maxTokens: 4096, maxSteps: 50 }),
  })
  export type Info = z.infer<typeof Info>

  const CONFIG_FILES = ["etcode.json", "etcode.jsonc", ".etcode.json"]

  async function loadFile(dir: string): Promise<Partial<Info> | undefined> {
    for (const name of CONFIG_FILES) {
      const filepath = path.join(dir, name)
      const content = await Filesystem.readJson<Partial<Info>>(filepath)
      if (content) {
        log.debug("loaded config", { path: filepath })
        return content
      }
    }
    return undefined
  }

  export async function load(directory: string): Promise<Info> {
    const global = await loadFile(Global.Path.config)
    const project = await loadFile(directory)
    const merged = { ...global, ...project }
    return Info.parse(merged)
  }

  export async function get(directory: string) {
    return load(directory)
  }
}
