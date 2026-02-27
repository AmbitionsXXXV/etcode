import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import { loadDescription } from "./description"

const DESCRIPTION = loadDescription("webfetch.txt")

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000
const MAX_TIMEOUT = 120 * 1000

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://"))
      throw new Error("URL must start with http:// or https://")

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, format: params.format, timeout: params.timeout },
    })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const onAbort = () => controller.abort()
    ctx.abort.addEventListener("abort", onAbort, { once: true })

    try {
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: params.format === "html"
          ? "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1"
          : params.format === "text"
            ? "text/plain;q=1.0, text/html;q=0.8, */*;q=0.1"
            : "text/markdown;q=1.0, text/html;q=0.7, */*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9",
      }

      const response = await fetch(params.url, { signal: controller.signal, headers })

      if (!response.ok)
        throw new Error(`Request failed with status code: ${response.status}`)

      const contentLength = response.headers.get("content-length")
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE)
        throw new Error("Response too large (exceeds 5MB limit)")

      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE)
        throw new Error("Response too large (exceeds 5MB limit)")

      const contentType = response.headers.get("content-type") || ""
      const title = `${params.url} (${contentType})`
      const content = new TextDecoder().decode(arrayBuffer)

      switch (params.format) {
        case "markdown":
          if (contentType.includes("text/html"))
            return { output: convertHTMLToMarkdown(content), title, metadata: {} }
          return { output: content, title, metadata: {} }
        case "text":
          if (contentType.includes("text/html"))
            return { output: stripHTML(content), title, metadata: {} }
          return { output: content, title, metadata: {} }
        case "html":
          return { output: content, title, metadata: {} }
        default:
          return { output: content, title, metadata: {} }
      }
    } finally {
      clearTimeout(timer)
      ctx.abort.removeEventListener("abort", onAbort)
    }
  },
})

function stripHTML(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
