import z from "zod"
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

  export const Info = z.object({
    provider: z.array(Provider).default([]),
    agent: z.object({
      maxTokens: z.number().default(4096),
      maxSteps: z.number().default(50),
    }).default({}),
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
