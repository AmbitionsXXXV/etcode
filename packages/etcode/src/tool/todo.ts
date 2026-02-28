import z from 'zod'
import { loadDescription } from './description'
import { Tool } from './tool'

const DESCRIPTION_WRITE = loadDescription('todowrite.txt')

import { createJsonStorage } from '../storage/json'

const storage = createJsonStorage()

const TodoItem = z.object({
	id: z.string(),
	content: z.string(),
	status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
})

type TodoItem = z.infer<typeof TodoItem>

export const TodoWriteTool = Tool.define('todowrite', {
	description: DESCRIPTION_WRITE,
	parameters: z.object({
		todos: z.array(TodoItem).describe('The updated todo list'),
	}),
	async execute(params, ctx) {
		await ctx.ask({
			permission: 'todowrite',
			patterns: ['*'],
			always: ['*'],
			metadata: {},
		})

		await storage.write([ctx.sessionID, 'todo'], params.todos)

		return {
			title: `${params.todos.filter((x) => x.status !== 'completed').length} todos`,
			output: JSON.stringify(params.todos, null, 2),
			metadata: { todos: params.todos },
		}
	},
})

export const TodoReadTool = Tool.define('todoread', {
	description: 'Use this tool to read your todo list',
	parameters: z.object({}),
	async execute(_params, ctx) {
		await ctx.ask({
			permission: 'todoread',
			patterns: ['*'],
			always: ['*'],
			metadata: {},
		})

		const todos = (await storage.read<TodoItem[]>([ctx.sessionID, 'todo'])) ?? []
		return {
			title: `${todos.filter((x) => x.status !== 'completed').length} todos`,
			metadata: { todos },
			output: JSON.stringify(todos, null, 2),
		}
	},
})
