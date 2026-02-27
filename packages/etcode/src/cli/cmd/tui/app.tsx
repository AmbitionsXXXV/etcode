import React, { useState, useEffect, useCallback } from "react"
import { render, Box, Text, useApp, useInput } from "ink"
import { Session } from "../../../session/session"
import { Instance } from "../../../project/instance"
import { Agent } from "../../../agent/agent"
import { Prompt } from "../../../session/prompt"
import { cancel } from "../../../session/prompt"
import { Bus } from "../../../bus"
import { Part } from "../../../session/part"
import { Message } from "../../../session/message"
import { Provider } from "../../../provider/provider"
import { Header } from "./components/header"
import { Messages } from "./components/messages"
import { PromptInput } from "./components/prompt"
import { Footer } from "./components/footer"
import { Database } from "../../../storage/db"

export interface TuiArgs {
  continue?: boolean
  session?: string
  agent?: string
  prompt?: string
}

interface AppState {
  session: Session.Info | undefined
  agent: Agent.Info | undefined
  model: Provider.Model | undefined
  messages: Array<{
    info: Message.Info
    parts: Part.Info[]
    streaming: Record<string, string>
  }>
  loading: boolean
  error: string | undefined
}

function App(props: { args: TuiArgs }) {
  const app = useApp()
  const project = Instance.project()
  const [state, setState] = useState<AppState>({
    session: undefined,
    agent: undefined,
    model: undefined,
    messages: [],
    loading: true,
    error: undefined,
  })

  const loadMessages = useCallback(async (projectID: string, sessionID: string) => {
    const msgs = await Message.list(projectID, sessionID)
    const loaded = await Promise.all(
      msgs.map(async (info) => {
        const parts = await Part.list(projectID, info.id)
        return { info, parts, streaming: {} as Record<string, string> }
      }),
    )
    setState((prev) => ({ ...prev, messages: loaded }))
  }, [])

  useEffect(() => {
    async function init() {
      const agentName = props.args.agent ?? await Agent.defaultAgent()
      const agent = await Agent.get(agentName)
      if (!agent) {
        setState((prev) => ({ ...prev, error: `Agent "${agentName}" not found`, loading: false }))
        return
      }

      const providers = await Provider.list()
      let model: Provider.Model | undefined
      for (const p of Object.values(providers)) {
        const first = Object.values(p.models)[0]
        if (first) { model = first; break }
      }

      let session: Session.Info | undefined
      if (props.args.session) {
        session = (await Session.get(project.id, props.args.session)) ?? undefined
      } else if (props.args.continue) {
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

      setState((prev) => ({ ...prev, session, agent, model, loading: false }))
      await loadMessages(project.id, session.id)

      if (props.args.prompt) {
        handleSubmit(props.args.prompt, session, agent)
      }
    }
    init()
  }, [])

  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(Bus.subscribe(Message.Event.Created, async (event) => {
      if (!state.session) return
      const msg = event.properties
      if (msg.sessionID !== state.session.id) return
      setState((prev) => {
        const exists = prev.messages.find((m) => m.info.id === msg.id)
        if (exists) {
          return {
            ...prev,
            messages: prev.messages.map((m) =>
              m.info.id === msg.id ? { ...m, info: msg } : m,
            ),
          }
        }
        return {
          ...prev,
          messages: [...prev.messages, { info: msg, parts: [], streaming: {} }],
        }
      })
    }))

    unsubs.push(Bus.subscribe(Part.Event.Updated, (event) => {
      const part = event.properties
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => {
          if (m.info.id !== part.messageID) return m
          const exists = m.parts.find((p) => p.id === part.id)
          if (exists) {
            return { ...m, parts: m.parts.map((p) => (p.id === part.id ? part : p)) }
          }
          return { ...m, parts: [...m.parts, part] }
        }),
      }))
    }))

    unsubs.push(Bus.subscribe(Part.Event.Delta, (event) => {
      const d = event.properties
      if (!state.session || d.sessionID !== state.session.id) return
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => {
          if (m.info.id !== d.messageID) return m
          return {
            ...m,
            streaming: {
              ...m.streaming,
              [d.partID]: (m.streaming[d.partID] ?? "") + d.delta,
            },
          }
        }),
      }))
    }))

    unsubs.push(Bus.subscribe(Session.Event.Error, (event) => {
      if (!state.session || event.properties.sessionID !== state.session.id) return
      setState((prev) => ({ ...prev, loading: false, error: String(event.properties.error) }))
    }))

    return () => unsubs.forEach((u) => u())
  }, [state.session?.id])

  const handleSubmit = useCallback(
    async (text: string, sessionOverride?: Session.Info, agentOverride?: Agent.Info) => {
      const session = sessionOverride ?? state.session
      const agent = agentOverride ?? state.agent
      if (!session || !agent || !text.trim()) return

      setState((prev) => ({ ...prev, loading: true, error: undefined }))

      try {
        await Prompt.prompt({
          projectID: project.id,
          sessionID: session.id,
          content: text.trim(),
          agent: agent.name,
        })
      } catch (e) {
        setState((prev) => ({ ...prev, error: String(e) }))
      } finally {
        setState((prev) => ({ ...prev, loading: false }))
      }
    },
    [state.session, state.agent, project.id],
  )

  const handleNewSession = useCallback(async () => {
    if (!state.agent) return
    if (state.session) cancel(state.session.id)
    const session = await Session.create({
      projectID: project.id,
      directory: project.directory,
      agent: state.agent.name,
    })
    setState((prev) => ({ ...prev, session, messages: [], error: undefined }))
  }, [state.agent, state.session, project.id])

  const handleCancel = useCallback(() => {
    if (state.loading && state.session) {
      cancel(state.session.id)
      setState((prev) => ({ ...prev, loading: false }))
    }
  }, [state.loading, state.session])

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (state.loading && state.session) {
        handleCancel()
      } else {
        Database.close()
        app.exit()
      }
    }
    if (key.ctrl && input === "n") {
      handleNewSession()
    }
  })

  if (state.error && !state.session) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {state.error}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%">
      <Header
        session={state.session}
        agent={state.agent}
        model={state.model}
        project={project}
      />
      <Messages messages={state.messages} loading={state.loading} />
      {state.error && <Text color="red">Error: {state.error}</Text>}
      <PromptInput
        onSubmit={handleSubmit}
        loading={state.loading}
        onCancel={handleCancel}
      />
      <Footer loading={state.loading} />
    </Box>
  )
}

export function tui(args: TuiArgs) {
  return new Promise<void>((resolve) => {
    const instance = render(<App args={args} />)
    instance.waitUntilExit().then(() => resolve())
  })
}
