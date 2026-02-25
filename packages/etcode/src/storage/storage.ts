export interface StorageDriver {
  read<T>(key: string[]): Promise<T | undefined>
  write<T>(key: string[], content: T): Promise<void>
  update<T>(key: string[], fn: (draft: T) => void): Promise<void>
  remove(key: string[]): Promise<void>
  list(prefix: string[]): Promise<string[]>
}
