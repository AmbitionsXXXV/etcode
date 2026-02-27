import fsSync from "fs"
import fs from "fs/promises"
import path from "path"

const MIME_MAP: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".jsx": "text/javascript",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
  ".rs": "text/rust",
  ".go": "text/x-go",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript",
}

export namespace Filesystem {
  export async function exists(filepath: string) {
    return fs.access(filepath).then(() => true, () => false)
  }

  export function stat(filepath: string): fsSync.Stats | undefined {
    try {
      return fsSync.statSync(filepath)
    } catch {
      return undefined
    }
  }

  export async function isDir(filepath: string): Promise<boolean> {
    const s = stat(filepath)
    return s?.isDirectory() ?? false
  }

  export function normalizePath(filepath: string): string {
    return path.resolve(filepath).replace(/\\/g, "/")
  }

  export function mimeType(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase()
    return MIME_MAP[ext] ?? "application/octet-stream"
  }

  export async function readText(filepath: string) {
    return fs.readFile(filepath, "utf-8")
  }

  export async function readBytes(filepath: string): Promise<Buffer> {
    return fs.readFile(filepath)
  }

  export async function readJson<T>(filepath: string): Promise<T | undefined> {
    if (!(await exists(filepath))) return undefined
    const text = await readText(filepath)
    return JSON.parse(text) as T
  }

  export async function write(filepath: string, content: string) {
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await fs.writeFile(filepath, content, "utf-8")
  }

  export async function writeJson(filepath: string, content: unknown) {
    await write(filepath, JSON.stringify(content, null, 2) + "\n")
  }

  export async function remove(filepath: string) {
    await fs.rm(filepath, { force: true })
  }

  export async function list(dir: string): Promise<string[]> {
    if (!(await exists(dir))) return []
    return fs.readdir(dir)
  }

  export async function ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true })
  }

  export async function findUp(filename: string, from: string): Promise<string | undefined> {
    let current = path.resolve(from)
    while (true) {
      const candidate = path.join(current, filename)
      if (await exists(candidate)) return candidate
      const parent = path.dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }

  export async function findUpAll(filenames: string[], from: string, root?: string): Promise<string[]> {
    const results: string[] = []
    const stop = root ? path.resolve(root) : undefined
    let current = path.resolve(from)
    while (true) {
      for (const filename of filenames) {
        const candidate = path.join(current, filename)
        if (await exists(candidate)) results.push(candidate)
      }
      if (stop && current === stop) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return results
  }
}
