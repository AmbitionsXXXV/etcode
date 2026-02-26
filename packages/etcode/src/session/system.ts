import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Instance } from "../project/instance"
import { InstructionPrompt } from "./instruction"
import type { Agent } from "../agent/agent"

const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompt")

function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.txt`), "utf-8")
}

const PROMPT_ANTHROPIC = loadPrompt("anthropic")
const PROMPT_OPENAI = loadPrompt("openai")
const PROMPT_GEMINI = loadPrompt("gemini")
const PROMPT_DEFAULT = loadPrompt("default")

export namespace SystemPrompt {
  export function provider(modelID: string): string[] {
    if (modelID.includes("claude")) return [PROMPT_ANTHROPIC]
    if (modelID.includes("gpt-") || modelID.includes("o1") || modelID.includes("o3") || modelID.includes("o4"))
      return [PROMPT_OPENAI]
    if (modelID.includes("gemini")) return [PROMPT_GEMINI]
    return [PROMPT_DEFAULT]
  }

  export function environment(): string[] {
    const project = Instance.project()
    const dir = Instance.directory()
    return [
      [
        `Here is useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${dir}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
      ].join("\n"),
    ]
  }

  export async function build(input: {
    agent: Agent.Info
    modelID?: string
  }): Promise<string[]> {
    const parts: string[] = []

    if (input.agent.prompt) {
      parts.push(input.agent.prompt)
    } else if (input.modelID) {
      parts.push(...provider(input.modelID))
    } else {
      parts.push(...provider(""))
    }

    parts.push(...environment())

    const instructions = await InstructionPrompt.system()
    parts.push(...instructions)

    return parts.filter(Boolean)
  }
}
