import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session/session"
import { Message } from "../../session/message"
import { Instance } from "../../project/instance"
import { Bus } from "../../bus"
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
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const project = Instance.project()
      log.info("starting session", { project: project.name })

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

      log.info("session ready", { id: session.id, title: session.title })

      Bus.subscribe(Session.Event.Updated, (event) => {
        log.debug("session updated", { id: event.properties.id })
      })

      console.log(`Session: ${session.id}`)
      console.log(`Project: ${project.name} (${project.directory})`)
      if (text) console.log(`Message: ${text}`)
      console.log("Agent ready. (agent loop not yet implemented)")
    })
  },
})
