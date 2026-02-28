import { Box, Text } from 'ink'
import type { Message } from '../../../../session/message'
import type { Part } from '../../../../session/part'
import { Spinner } from './spinner'
import { Tool } from './tool'

interface MessageEntry {
	info: Message.Info
	parts: Part.Info[]
	streaming: Record<string, string>
}

interface MessagesProps {
	loading: boolean
	messages: MessageEntry[]
}

function UserMessage(props: { message: Message.Info & { role: 'user' } }) {
	return (
		<Box paddingY={0}>
			<Text>
				<Text bold color="blue">
					{'>'}{' '}
				</Text>
				<Text>{props.message.content}</Text>
			</Text>
		</Box>
	)
}

function AssistantMessage(props: { entry: MessageEntry }) {
	const { parts, streaming } = props.entry

	return (
		<Box flexDirection="column" paddingY={0}>
			{parts.map((part) => {
				if (part.type === 'text') {
					const text = streaming[part.id] ?? part.text
					if (!text) return null
					return (
						<Box key={part.id}>
							<Text>{text}</Text>
						</Box>
					)
				}
				if (part.type === 'tool') {
					return (
						<Box key={part.id} paddingLeft={1}>
							<Tool part={part} />
						</Box>
					)
				}
				return null
			})}
		</Box>
	)
}

export function Messages(props: MessagesProps) {
	return (
		<Box flexDirection="column" flexGrow={1} paddingX={1}>
			{props.messages.length === 0 && !props.loading && (
				<Text dimColor>No messages yet. Type a message below to start.</Text>
			)}
			{props.messages.map((entry) => {
				if (entry.info.role === 'user') {
					return (
						<UserMessage
							key={entry.info.id}
							message={entry.info as Message.Info & { role: 'user' }}
						/>
					)
				}
				if (entry.info.role === 'assistant') {
					return <AssistantMessage entry={entry} key={entry.info.id} />
				}
				return null
			})}
			{props.loading && props.messages.length > 0 && (
				<Box paddingTop={0}>
					<Spinner label="thinking..." />
				</Box>
			)}
		</Box>
	)
}
