import fs from "fs/promises"
import path from "path"

export namespace Filesystem {
  export async function exists(filepath: string) {
    return fs.access(filepath).then(() => true, () => false)
  }

  export async function readText(filepath: string) {
    return fs.readFile(filepath, "utf-8")
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
}
