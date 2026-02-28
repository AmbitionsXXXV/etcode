import { Box, Text } from 'ink'
import type { Agent } from '../../../../agent/agent'
import type { Project } from '../../../../project/project'
import type { Provider } from '../../../../provider/provider'
import type { Session } from '../../../../session/session'

interface HeaderProps {
	agent: Agent.Info | undefined
	model: Provider.Model | undefined
	project: Project.Info
	session: Session.Info | undefined
}

export function Header(props: HeaderProps) {
	return (
		<Box borderColor="cyan" borderStyle="single" flexDirection="column" paddingX={1}>
			<Box justifyContent="space-between">
				<Text bold color="cyan">
					etcode
				</Text>
				<Text dimColor>
					{props.project.name} ({props.project.directory})
				</Text>
			</Box>
			<Box gap={2}>
				{props.session && (
					<Text>
						<Text dimColor>session:</Text>{' '}
						<Text color="yellow">{props.session.title}</Text>
					</Text>
				)}
				{props.agent && (
					<Text>
						<Text dimColor>agent:</Text>{' '}
						<Text color="green">{props.agent.name}</Text>
					</Text>
				)}
				{props.model && (
					<Text>
						<Text dimColor>model:</Text>{' '}
						<Text color="magenta">
							{props.model.providerID}/{props.model.id}
						</Text>
					</Text>
				)}
			</Box>
		</Box>
	)
}
