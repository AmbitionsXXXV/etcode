const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const RANDOM_LEN = 8

function randomBase62(len: number) {
	const buf = new Uint8Array(len)
	crypto.getRandomValues(buf)
	let result = ''
	for (const byte of buf) result += BASE62[byte % 62]
	return result
}

function timestampHex() {
	return Date.now().toString(16)
}

export namespace Identifier {
	export function ascending(prefix = '') {
		const ts = timestampHex()
		const rand = randomBase62(RANDOM_LEN)
		return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`
	}

	export function descending(prefix = '') {
		const ts = (Number.MAX_SAFE_INTEGER - Date.now()).toString(16)
		const rand = randomBase62(RANDOM_LEN)
		return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`
	}
}
