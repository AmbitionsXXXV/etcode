export interface StorageDriver {
	list(prefix: string[]): Promise<string[]>
	read<T>(key: string[]): Promise<T | undefined>
	remove(key: string[]): Promise<void>
	update<T>(key: string[], fn: (draft: T) => void): Promise<void>
	write<T>(key: string[], content: T): Promise<void>
}
