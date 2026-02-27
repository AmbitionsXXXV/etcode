import React, { useState } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"

interface PromptInputProps {
  onSubmit: (text: string) => void
  loading: boolean
  onCancel: () => void
}

export function PromptInput(props: PromptInputProps) {
  const [value, setValue] = useState("")

  const handleSubmit = (text: string) => {
    if (!text.trim()) return
    if (props.loading) return
    props.onSubmit(text)
    setValue("")
  }

  return (
    <Box borderStyle="round" borderColor={props.loading ? "gray" : "green"} paddingX={1}>
      <Text color={props.loading ? "gray" : "green"} bold>{"❯ "}</Text>
      {props.loading ? (
        <Text dimColor>waiting for response... (Ctrl+C to cancel)</Text>
      ) : (
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} placeholder="Type a message..." />
      )}
    </Box>
  )
}
