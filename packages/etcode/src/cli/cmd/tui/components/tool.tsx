import React from "react"
import { Box, Text } from "ink"
import type { Part } from "../../../../session/part"
import { Spinner } from "./spinner"

interface ToolProps {
  part: Part.Info & { type: "tool" }
}

export function Tool(props: ToolProps) {
  const { state, tool } = props.part
  const title = state.title ?? tool

  if (state.status === "running" || state.status === "pending") {
    return (
      <Box gap={1}>
        <Spinner />
        <Text color="cyan">{title}</Text>
      </Box>
    )
  }

  if (state.status === "completed") {
    const elapsed = state.time?.start && state.time?.end
      ? `${((state.time.end - state.time.start) / 1000).toFixed(1)}s`
      : undefined

    return (
      <Box gap={1}>
        <Text color="green">✓</Text>
        <Text>{title}</Text>
        {elapsed && <Text dimColor>({elapsed})</Text>}
      </Box>
    )
  }

  return (
    <Box gap={1}>
      <Text color="red">✗</Text>
      <Text>{title}</Text>
      {state.error && <Text color="red" dimColor> {state.error}</Text>}
    </Box>
  )
}
