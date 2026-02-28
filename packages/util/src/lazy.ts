export function lazy<T>(fn: () => T) {
	let value: T | undefined
	let loaded = false
	return Object.assign(
		(): T => {
			if (loaded) return value as T
			loaded = true
			value = fn()
			return value as T
		},
		{
			reset() {
				loaded = false
				value = undefined
			},
		}
	)
}
