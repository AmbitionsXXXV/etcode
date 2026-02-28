import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))

export function loadDescription(filename: string): string {
	return fs.readFileSync(path.join(DIR, filename), 'utf-8')
}
