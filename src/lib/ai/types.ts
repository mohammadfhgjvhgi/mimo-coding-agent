// ===================================================================
// MiMo AI Engineering Intelligence Platform — Shared Types
// ===================================================================

export type AgentRole =
  | "orchestrator"
  | "researcher"
  | "developer"
  | "debugger"
  | "qa"
  | "security"
  | "reviewer"
  | "documentation"
  | "knowledge"
  | "architect"
  | "database"
  | "requirements";

export type MemoryType =
  | "working"
  | "short_term"
  | "long_term"
  | "episodic"
  | "semantic"
  | "procedural"
  | "preference"
  | "failure"
  | "skill";

export type TaskStatus =
  | "pending"
  | "planning"
  | "in_progress"
  | "blocked"
  | "validating"
  | "completed"
  | "failed";

export type ExecutionPhase =
  | "plan"
  | "execute"
  | "observe"
  | "validate"
  | "repair"
  | "retest"
  | "review"
  | "complete";

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface AgentDefinition {
  name: string;
  role: AgentRole;
  title: string;
  description: string;
  capabilities: string[];
  defaultTools: string[];
  color: string; // tailwind bg class
  accent: string; // tailwind text class
  icon: string; // lucide icon name
  systemPrompt: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  timeoutMs: number;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface SkillDefinition {
  name: string;
  slug?: string;
  description: string;
  version?: string;
  license?: string;
  path: string;
  size: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  agentName?: AgentRole;
  autonomous?: boolean;
  projectType?: string;
}

export interface StreamEvent {
  type:
    | "start"
    | "delta"
    | "tool"
    | "agent"
    | "memory"
    | "artifact"
    | "task"
    | "decision"
    | "preview"
    | "end"
    | "error";
  [key: string]: unknown;
}

export interface PlanTask {
  title: string;
  description?: string;
  assignedAgent: AgentRole;
  objective?: string;
  expectedOutput?: string;
  priority?: number;
  dependencies?: number[]; // indices of tasks this depends on (0-based)
}

export interface ExecutionContext {
  conversationId: string;
  taskId?: string;
  agentName: AgentRole;
  userMessage: string;
  projectId?: string; // P2-1: system-injected from Conversation.projectId
  toolsUsed: string[];
  artifactsCreated: string[];
  memoriesWritten: string[];
  decisionsMade: string[];
}

export interface SystemState {
  conversations: number;
  tasks: number;
  memories: number;
  artifacts: number;
  decisions: number;
  executionLogs: number;
  skills: number;
  agents: number;
  knowledgeEntries: number;
  recentExecutions: ExecutionLogSummary[];
}

export interface ExecutionLogSummary {
  id: string;
  agentName: string | null;
  toolName: string | null;
  phase: string;
  level: string;
  message: string;
  status: string;
  durationMs: number;
  createdAt: string;
}
