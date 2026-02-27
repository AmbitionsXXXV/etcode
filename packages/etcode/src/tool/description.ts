import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const DIR = path.dirname(fileURLToPath(import.meta.url))

export function loadDescription(filename: string): string {
  return fs.readFileSync(path.join(DIR, filename), "utf-8")
}
