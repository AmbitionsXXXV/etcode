import z from 'zod'

export abstract class NamedError extends Error {
	abstract schema(): z.core.$ZodType
	abstract toObject(): { name: string; data: unknown }

	static create<Name extends string, Data extends z.core.$ZodType>(
		name: Name,
		data: Data
	) {
		const schema = z.object({ name: z.literal(name), data })
		const result = class extends NamedError {
			static readonly Schema = schema
			readonly name = name
			readonly data: z.input<Data>

			constructor(data: z.input<Data>, options?: ErrorOptions) {
				super(name, options)
				this.data = data
			}

			static isInstance(input: unknown): input is InstanceType<typeof result> {
				return input instanceof Error && (input as NamedError).name === name
			}

			schema() {
				return schema
			}

			toObject() {
				return { name, data: this.data }
			}
		}
		return result
	}

	static readonly Unknown = NamedError.create(
		'UnknownError',
		z.object({ message: z.string() })
	)
}
