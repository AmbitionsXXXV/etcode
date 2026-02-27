import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Instance } from "../project/instance"
import { Truncate } from "./truncation"
import { Log } from "../util/log"

const log = Log.create("bash-tool")

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000

function detectShell(): string {
  if (process.platform === "win32") return "cmd.exe"
  return process.env.SHELL || "/bin/sh"
}

export const BashTool = Tool.define("bash", async () => {
  const shell = detectShell()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION
      .replaceAll("${directory}", Instance.directory())
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(`The working directory to run the command in. Defaults to ${Instance.directory()}. Use this instead of 'cd' commands.`)
        .optional(),
      description: z
        .string()
        .describe("Clear, concise description of what this command does in 5-10 words."),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory()
      if (params.timeout !== undefined && params.timeout < 0)
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)

      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      await ctx.ask({
        permission: "bash",
        patterns: [params.command],
        always: ["*"],
        metadata: { command: params.command, description: params.description },
      })

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      ctx.metadata({
        metadata: { output: "", description: params.description },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH
              ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
              : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => {
        try {
          if (proc.pid && !exited)
            process.kill(-proc.pid, "SIGTERM")
        } catch {
          try { proc.kill("SIGTERM") } catch {}
        }
      }

      if (ctx.abort.aborted) {
        aborted = true
        kill()
      }

      const abortHandler = () => {
        aborted = true
        kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }
        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })
        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []
      if (timedOut) resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      if (aborted) resultMetadata.push("User aborted the command")
      if (resultMetadata.length > 0)
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
