import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session/session"
import { Message } from "../../session/message"
import { Instance } from "../../project/instance"
import { Agent } from "../../agent/agent"
import { Bus } from "../../bus"
import { UI } from "../ui"
import { Log } from "../../util/log"

const log = Log.create("run")

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run etcode with a message",
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "initial message to send",
        type: "string",
        array: true,
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
        default: false,
      })
      .option("session", {
        alias: ["s"],
        describe: "session ID to continue",
        type: "string",
      })
      .option("agent", {
        alias: ["a"],
        describe: "agent to use (default: build)",
        type: "string",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const project = Instance.project()
      log.info("starting session", { project: project.name })

      const agentName = args.agent ?? await Agent.defaultAgent()
      const agent = await Agent.get(agentName)
      if (!agent) {
        console.error(UI.red(`Agent "${agentName}" not found`))
        process.exit(1)
      }

      let session: Session.Info | undefined | null
      if (args.session) {
        session = await Session.get(project.id, args.session)
      } else if (args.continue) {
        const sessions = await Session.list(project.id)
        session = sessions[0]
      }
      if (!session) {
        session = await Session.create({
          projectID: project.id,
          directory: project.directory,
          agent: agent.name,
        })
      }

      const text = args.message?.join(" ")
      if (text) {
        await Message.create(project.id, {
          sessionID: session.id,
          role: "user",
          content: text,
        })
      }

      log.info("session ready", { id: session.id, agent: agent.name })

      Bus.subscribe(Session.Event.Updated, (event) => {
        log.debug("session updated", { id: event.properties.id })
      })

      console.log(`Session: ${session.id}`)
      console.log(`Project: ${project.name} (${project.directory})`)
      console.log(`Agent:   ${UI.cyan(agent.name)}${agent.description ? UI.dim(` — ${agent.description}`) : ""}`)
      if (text) console.log(`Message: ${text}`)
      console.log(UI.dim("Agent ready. (agent loop not yet implemented)"))
    })
  },
})
