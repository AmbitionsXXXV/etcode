import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'

interface PromptInputProps {
	loading: boolean
	onCancel: () => void
	onSubmit: (text: string) => void
}

export function PromptInput(props: PromptInputProps) {
	const [value, setValue] = useState('')

	const handleSubmit = (text: string) => {
		if (!text.trim()) return
		if (props.loading) return
		props.onSubmit(text)
		setValue('')
	}

	return (
		<Box
			borderColor={props.loading ? 'gray' : 'green'}
			borderStyle="round"
			paddingX={1}
		>
			<Text bold color={props.loading ? 'gray' : 'green'}>
				{'❯ '}
			</Text>
			{props.loading ? (
				<Text dimColor>waiting for response... (Ctrl+C to cancel)</Text>
			) : (
				<TextInput
					onChange={setValue}
					onSubmit={handleSubmit}
					placeholder="Type a message..."
					value={value}
				/>
			)}
		</Box>
	)
}
