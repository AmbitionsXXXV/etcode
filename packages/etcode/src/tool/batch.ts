import z from 'zod'
import { loadDescription } from './description'
import { Tool } from './tool'

const DESCRIPTION = loadDescription('batch.txt')

const DISALLOWED = new Set(['batch'])

export const BatchTool = Tool.define('batch', async () => {
	return {
		description: DESCRIPTION,
		parameters: z.object({
			tool_calls: z
				.array(
					z.object({
						tool: z.string().describe('The name of the tool to execute'),
						parameters: z
							.object({})
							.passthrough()
							.describe('Parameters for the tool'),
					})
				)
				.min(1, 'Provide at least one tool call')
				.describe('Array of tool calls to execute in parallel'),
		}),
		formatValidationError(error: z.ZodError) {
			const formattedErrors = error.issues
				.map((issue) => {
					const path = issue.path.length > 0 ? issue.path.join('.') : 'root'
					return `  - ${path}: ${issue.message}`
				})
				.join('\n')
			return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
		},
		async execute(params, ctx) {
			const { ToolRegistry } = await import('./registry')
			const { Identifier } = await import('@etcode/util/identifier')
			const { Part } = await import('../session/part')
			const { Instance } = await import('../project/instance')

			const toolCalls = params.tool_calls.slice(0, 25)
			const discardedCalls = params.tool_calls.slice(25)

			const availableTools = await ToolRegistry.tools({
				modelID: '',
				providerID: '',
			})
			const toolMap = new Map(availableTools.map((t) => [t.id, t]))

			const executeCall = async (call: (typeof toolCalls)[0]) => {
				const _callStartTime = Date.now()
				const partID = Identifier.ascending('part')
				const projectID = Instance.project().id

				try {
					if (DISALLOWED.has(call.tool))
						throw new Error(
							`Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(', ')}`
						)

					const tool = toolMap.get(call.tool)
					if (!tool) {
						const available = Array.from(toolMap.keys()).filter(
							(name) => name !== 'invalid' && name !== 'batch'
						)
						throw new Error(
							`Tool '${call.tool}' not in registry. Available tools: ${available.join(', ')}`
						)
					}

					const validatedParams = tool.parameters.parse(call.parameters)

					await Part.createTool(projectID, {
						messageID: ctx.messageID,
						tool: call.tool,
						state: { status: 'running', input: call.parameters },
					})

					const result = await tool.execute(validatedParams, {
						...ctx,
						callID: partID,
					})

					return { success: true as const, tool: call.tool, result }
				} catch (error) {
					return { success: false as const, tool: call.tool, error }
				}
			}

			const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

			for (const call of discardedCalls) {
				results.push({
					success: false as const,
					tool: call.tool,
					error: new Error('Maximum of 25 tools allowed in batch'),
				})
			}

			const successfulCalls = results.filter((r) => r.success).length
			const failedCalls = results.length - successfulCalls

			const outputMessage =
				failedCalls > 0
					? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
					: `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

			return {
				title: `Batch execution (${successfulCalls}/${results.length} successful)`,
				output: outputMessage,
				metadata: {
					totalCalls: results.length,
					successful: successfulCalls,
					failed: failedCalls,
					tools: params.tool_calls.map((c) => c.tool),
					details: results.map((r) => ({ tool: r.tool, success: r.success })),
				},
			}
		},
	}
})
