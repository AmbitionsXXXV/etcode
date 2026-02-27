import z from "zod"
import type { LanguageModel } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create("provider")

type SDK = {
  languageModel(modelID: string): LanguageModel
  [key: string]: unknown
}

export namespace Provider {
  export const Model = z.object({
    id: z.string(),
    providerID: z.string(),
    api: z.object({
      id: z.string(),
      npm: z.string(),
      url: z.string().optional(),
    }),
    capabilities: z.object({
      reasoning: z.boolean().default(false),
      toolcall: z.boolean().default(true),
      temperature: z.boolean().default(false),
    }).default({ reasoning: false, toolcall: true, temperature: false }),
    cost: z.object({
      input: z.number().default(0),
      output: z.number().default(0),
    }).default({ input: 0, output: 0 }),
    limit: z.object({
      context: z.number().default(0),
      output: z.number().default(0),
    }).default({ context: 0, output: 0 }),
  })
  export type Model = z.infer<typeof Model>

  export interface Info {
    id: string
    name: string
    env: string[]
    key?: string
    options: Record<string, unknown>
    models: Record<string, Model>
  }

  const BUNDLED_PROVIDERS: Record<string, (options: Record<string, unknown>) => SDK> = {
    "@ai-sdk/openai-compatible": (opts) => createOpenAICompatible(opts as any) as unknown as SDK,
    "@ai-sdk/anthropic": (opts) => createAnthropic(opts as any) as unknown as SDK,
    "@ai-sdk/openai": (opts) => createOpenAI(opts as any) as unknown as SDK,
    "@ai-sdk/google": (opts) => createGoogleGenerativeAI(opts as any) as unknown as SDK,
  }

  const sdkCache = new Map<string, SDK>()
  const modelCache = new Map<string, LanguageModel>()
  let providers: Record<string, Info> | undefined

  function envGet(name: string): string | undefined {
    return process.env[name]
  }

  function cacheKey(providerID: string, npm: string, options: Record<string, unknown>): string {
    return JSON.stringify({ providerID, npm, options })
  }

  export async function state(): Promise<Record<string, Info>> {
    if (providers) return providers
    providers = {}
    try {
      const cfg = await Config.get(process.cwd())
      for (const p of cfg.provider) {
        const key = envGet(p.env[0] ?? "") ?? p.apiKey
        const info: Info = {
          id: p.id,
          name: p.id,
          env: p.env,
          key,
          options: {},
          models: {},
        }
        if (p.baseURL) info.options["baseURL"] = p.baseURL
        if (p.apiKey) info.options["apiKey"] = p.apiKey

        for (const envName of p.env) {
          const val = envGet(envName)
          if (val && !info.key) info.key = val
        }

        if (p.model) {
          const model: Model = {
            id: p.model,
            providerID: p.id,
            api: {
              id: p.model,
              npm: p.npm,
              url: p.api,
            },
            capabilities: { reasoning: false, toolcall: true, temperature: false },
            cost: { input: 0, output: 0 },
            limit: { context: 0, output: 0 },
          }
          info.models[p.model] = model
        }

        providers[p.id] = info
        log.info("registered provider", { id: p.id })
      }
    } catch {
      log.debug("no provider config found")
    }
    return providers
  }

  export function reset() {
    providers = undefined
    sdkCache.clear()
    modelCache.clear()
  }

  export async function getSDK(model: Model): Promise<SDK> {
    const s = await state()
    const provider = s[model.providerID]
    const options: Record<string, unknown> = { ...provider?.options }

    const baseURL = options["baseURL"] ?? model.api.url
    if (baseURL) options["baseURL"] = baseURL

    if (!options["apiKey"] && provider?.key) options["apiKey"] = provider.key

    const key = cacheKey(model.providerID, model.api.npm, options)
    const existing = sdkCache.get(key)
    if (existing) return existing

    const factory = BUNDLED_PROVIDERS[model.api.npm]
    if (!factory) {
      throw new Error(`unsupported SDK package: ${model.api.npm}. Bundled: ${Object.keys(BUNDLED_PROVIDERS).join(", ")}`)
    }

    log.info("creating SDK instance", { providerID: model.providerID, npm: model.api.npm })
    const sdk = factory({ name: model.providerID, ...options })
    sdkCache.set(key, sdk)
    return sdk
  }

  export async function getLanguage(model: Model): Promise<LanguageModel> {
    const key = `${model.providerID}/${model.id}`
    const existing = modelCache.get(key)
    if (existing) return existing

    const sdk = await getSDK(model)
    const language = sdk.languageModel(model.api.id)
    modelCache.set(key, language)
    log.info("created language model", { providerID: model.providerID, modelID: model.id })
    return language
  }

  export async function list(): Promise<Record<string, Info>> {
    return state()
  }

  export async function getModel(providerID: string, modelID: string): Promise<Model | undefined> {
    const s = await state()
    const provider = s[providerID]
    if (!provider) return undefined
    return provider.models[modelID]
  }

  export function resolveModel(agent: { model?: { providerID: string; modelID: string } }): Model | undefined {
    if (!agent.model) return undefined
    return {
      id: agent.model.modelID,
      providerID: agent.model.providerID,
      api: {
        id: agent.model.modelID,
        npm: "@ai-sdk/openai-compatible",
        url: undefined,
      },
      capabilities: { reasoning: false, toolcall: true, temperature: false },
      cost: { input: 0, output: 0 },
      limit: { context: 0, output: 0 },
    }
  }
}
