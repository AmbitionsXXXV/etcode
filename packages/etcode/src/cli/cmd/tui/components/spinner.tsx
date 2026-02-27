import React, { useState, useEffect } from "react"
import { Text } from "ink"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

interface SpinnerProps {
  label?: string
}

export function Spinner(props: SpinnerProps) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return (
    <Text>
      <Text color="cyan">{FRAMES[frame]}</Text>
      {props.label && <Text dimColor> {props.label}</Text>}
    </Text>
  )
}
