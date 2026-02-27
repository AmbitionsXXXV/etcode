import z from "zod"
import { spawn } from "child_process"
import { text } from "node:stream/consumers"
import { Tool } from "./tool"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) throw new Error("pattern is required")

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: { pattern: params.pattern, path: params.path, include: params.include },
    })

    let searchPath = params.path ?? Instance.directory()
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory(), searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) args.push("--glob", params.include)
    args.push(searchPath)

    const proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] })
    const output = await text(proc.stdout!)
    const errorOutput = await text(proc.stderr!)
    const exitCode = await new Promise<number | null>((resolve) => proc.once("exit", resolve))

    if (exitCode === 1 || (exitCode === 2 && !output.trim()))
      return { title: params.pattern, metadata: { matches: 0, truncated: false }, output: "No files found" }

    if (exitCode !== 0 && exitCode !== 2)
      throw new Error(`ripgrep failed: ${errorOutput}`)

    const hasErrors = exitCode === 2
    const lines = output.trim().split(/\r?\n/)
    const matches = []

    for (const line of lines) {
      if (!line) continue
      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue
      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")
      const stats = Filesystem.stat(filePath)
      if (!stats) continue
      matches.push({ path: filePath, modTime: stats.mtime.getTime(), lineNum, lineText })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0)
      return { title: params.pattern, metadata: { matches: 0, truncated: false }, output: "No files found" }

    const totalMatches = matches.length
    const outputLines = [`Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") outputLines.push("")
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push(`(Results truncated: showing ${limit} of ${totalMatches} matches (${totalMatches - limit} hidden). Consider using a more specific path or pattern.)`)
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: { matches: totalMatches, truncated },
      output: outputLines.join("\n"),
    }
  },
})
