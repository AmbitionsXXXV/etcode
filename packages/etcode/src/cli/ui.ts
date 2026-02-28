export namespace UI {
	export function logo() {
		return [
			'         _                 _      ',
			'   ___  | |_   ___  ___  | |  ___ ',
			'  / _ \\ | __| / __|/ _ \\ | | / _ \\',
			' |  __/ | |_ | (__| (_) || ||  __/',
			'  \\___|  \\__| \\___|\\___/ |_| \\___|',
		].join('\n')
	}

	export function divider(char = '─', width = 40) {
		return char.repeat(width)
	}

	export function dim(text: string) {
		return `\x1b[2m${text}\x1b[0m`
	}

	export function bold(text: string) {
		return `\x1b[1m${text}\x1b[0m`
	}

	export function green(text: string) {
		return `\x1b[32m${text}\x1b[0m`
	}

	export function red(text: string) {
		return `\x1b[31m${text}\x1b[0m`
	}

	export function cyan(text: string) {
		return `\x1b[36m${text}\x1b[0m`
	}
}
