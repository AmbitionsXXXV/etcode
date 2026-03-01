import z from 'zod'
import { Bus } from '../bus'
import { BusEvent } from '../bus/bus-event'

export namespace SessionStatus {
	export const Type = z.enum(['idle', 'busy', 'retry'])
	export type Type = z.infer<typeof Type>

	export const Info = z.object({
		sessionID: z.string(),
		status: Type,
		retryAt: z.number().optional(),
	})
	export type Info = z.infer<typeof Info>

	export const Event = {
		Changed: BusEvent.define('session.status', Info),
	}

	const state: Record<string, Info> = {}

	export function get(sessionID: string): Info {
		return state[sessionID] ?? { sessionID, status: 'idle' }
	}

	export function set(sessionID: string, status: Type, retryAt?: number) {
		const info: Info = { sessionID, status, retryAt }
		state[sessionID] = info
		Bus.publish(Event.Changed, info)
	}
}
