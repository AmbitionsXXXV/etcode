import z from "zod"
import path from "path"
import { spawn } from "child_process"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./glob.txt"
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

async function rgFiles(options: {
  cwd: string
  glob: string[]
  signal?: AbortSignal
}): Promise<string[]> {
  const args = ["--files", "--hidden", "--no-messages"]
  for (const g of options.glob) args.push("--glob", g)
  args.push(options.cwd)

  const proc = spawn("rg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  })

  const output = await text(proc.stdout!)
  await new Promise<void>((resolve) => proc.once("exit", () => resolve()))
  return output.trim().split("\n").filter(Boolean)
}

export const GlobTool = Tool.define("glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe("The directory to search in. If not specified, the current working directory will be used."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "glob",
      patterns: [params.pattern],
      always: ["*"],
      metadata: { pattern: params.pattern, path: params.path },
    })

    let search = params.path ?? Instance.directory()
    search = path.isAbsolute(search) ? search : path.resolve(Instance.directory(), search)
    await assertExternalDirectory(ctx, search, { kind: "directory" })

    const limit = 100
    const raw = await rgFiles({ cwd: search, glob: [params.pattern], signal: ctx.abort })
    const files = raw.slice(0, limit + 1).map((file) => {
      const full = path.resolve(search, file)
      const stats = Filesystem.stat(full)?.mtime.getTime() ?? 0
      return { path: full, mtime: stats }
    })
    files.sort((a, b) => b.mtime - a.mtime)

    const truncated = files.length > limit
    const result = truncated ? files.slice(0, limit) : files

    const output = []
    if (result.length === 0) output.push("No files found")
    else {
      output.push(...result.map((f) => f.path))
      if (truncated)
        output.push("", `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`)
    }

    return {
      title: path.relative(Instance.directory(), search),
      metadata: { count: result.length, truncated },
      output: output.join("\n"),
    }
  },
})
