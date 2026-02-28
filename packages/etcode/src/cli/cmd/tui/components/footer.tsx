import { Box, Text } from 'ink'

interface FooterProps {
	loading: boolean
}

export function Footer(props: FooterProps) {
	return (
		<Box gap={2} paddingX={1}>
			<Text dimColor>
				<Text bold>Ctrl+C</Text> {props.loading ? 'cancel' : 'exit'}
			</Text>
			<Text dimColor>
				<Text bold>Ctrl+N</Text> new session
			</Text>
			<Text dimColor>
				<Text bold>Enter</Text> send
			</Text>
		</Box>
	)
}
