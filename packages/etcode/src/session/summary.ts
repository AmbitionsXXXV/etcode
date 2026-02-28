import { Bus } from '../bus'
import { Snapshot } from '../snapshot'
import { createJsonStorage } from '../storage/json'
import { Log } from '../util/log'
import { Message } from './message'
import { Part } from './part'
import { Session } from './session'

const log = Log.create('session.summary')
const storage = createJsonStorage()

export namespace SessionSummary {
	export async function summarize(input: {
		projectID: string
		sessionID: string
		messageID: string
	}) {
		const messages = await Message.list(input.projectID, input.sessionID)
		const parts = await collectParts(input.projectID, messages)

		await Promise.all([
			summarizeSession(input.projectID, input.sessionID, parts),
			summarizeMessage(input.projectID, input.messageID, messages, parts),
		])
	}

	async function collectParts(
		projectID: string,
		messages: Message.Info[]
	): Promise<Part.Info[]> {
		const result: Part.Info[] = []
		for (const msg of messages) {
			if (msg.role !== 'assistant') continue
			const parts = await Part.list(projectID, msg.id)
			result.push(...parts)
		}
		return result
	}

	async function summarizeSession(
		_projectID: string,
		sessionID: string,
		parts: Part.Info[]
	) {
		const diffs = await computeDiffFromParts(parts)
		Session.setSummary({
			sessionID,
			summary: {
				additions: diffs.reduce((sum, x) => sum + x.additions, 0),
				deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
				files: diffs.length,
			},
		})
		await storage.write(['session_diff', sessionID], diffs)
		await Bus.publish(Session.Event.Diff, {
			sessionID,
			diff: diffs,
		})
		log.info('session summarized', { sessionID, files: diffs.length })
	}

	async function summarizeMessage(
		_projectID: string,
		messageID: string,
		messages: Message.Info[],
		allParts: Part.Info[]
	) {
		const relevantParts = allParts.filter((p) =>
			messages.some((m) => m.role === 'assistant' && m.id === p.messageID)
		)
		const diffs = await computeDiffFromParts(relevantParts)
		log.info('message summarized', { messageID, files: diffs.length })
	}

	async function computeDiffFromParts(
		parts: Part.Info[]
	): Promise<Snapshot.FileDiff[]> {
		let from: string | undefined
		let to: string | undefined

		for (const part of parts) {
			if (!from && part.type === 'step-start' && part.snapshot) {
				from = part.snapshot
			}
			if (part.type === 'step-finish' && part.snapshot) {
				to = part.snapshot
			}
		}

		if (from && to) return await Snapshot.diffFull(from, to)
		return []
	}

	export async function diff(input: {
		sessionID: string
	}): Promise<Snapshot.FileDiff[]> {
		const stored = await storage.read<Snapshot.FileDiff[]>([
			'session_diff',
			input.sessionID,
		])
		return stored ?? []
	}
}
