import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { RunCommand } from './cli/cmd/run'
import { TuiCommand } from './cli/cmd/tui-cmd'
import { UI } from './cli/ui'
import { Log } from './util/log'

const VERSION = '0.1.0'

const cli = yargs(hideBin(process.argv))
	.parserConfiguration({ 'populate--': true })
	.scriptName('etcode')
	.wrap(100)
	.help('help', 'show help')
	.alias('help', 'h')
	.version('version', 'show version number', VERSION)
	.alias('version', 'v')
	.option('print-logs', {
		describe: 'print logs to stderr',
		type: 'boolean',
	})
	.option('log-level', {
		describe: 'log level',
		type: 'string',
		choices: ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const,
	})
	.middleware((opts) => {
		Log.init({
			level: opts.logLevel as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | undefined,
			output: opts.printLogs ? 'stderr' : 'etcode.log',
		})
	})
	.usage(`\n${UI.logo()}`)
	.command(TuiCommand)
	.command(RunCommand)
	.demandCommand(0)
	.strict()

try {
	await cli.parse()
} catch (e) {
	if (e instanceof Error) {
		console.error(UI.red(`Error: ${e.message}`))
	}
	process.exit(1)
}
