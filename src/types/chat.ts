export type Role = "user" | "assistant" | "system"

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  result: string
  status: "success" | "error" | "pending"
  error?: string
  durationMs: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: Role
  content: string
  model?: string | null
  toolCalls?: ToolCallRecord[] | null
  parentMessageId?: string | null
  tokens?: number
  thinking?: string | null
  isEdited?: boolean
  createdAt: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  messages?: ChatMessage[]
}

export interface StreamChunk {
  delta: string
  done?: boolean
  error?: string
}

export interface ChatRequestBody {
  message: string
  conversationId?: string
  history?: { role: Role; content: string }[]
  model?: string
  thinking?: boolean
  settings?: unknown
}
