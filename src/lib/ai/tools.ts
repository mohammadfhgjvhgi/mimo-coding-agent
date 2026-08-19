// Adapter: exposes listTools() backed by our @/lib/tools/registry.
// The mimo-life-os routes import listTools from "@/lib/ai/tools".
import { REGISTRY } from "@/lib/tools/registry"
import type { ToolDef } from "@/lib/tools/types"

export interface ToolInfo {
  name: string
  description: string
  riskLevel: "low" | "medium" | "high"
  inputSchema: Record<string, unknown>
  timeoutMs: number
}

// Lightweight heuristic: name-based risk classification.
function riskFor(name: string): "low" | "medium" | "high" {
  if (/^(run_terminal|run_code|execute_)/.test(name)) return "high"
  if (/^(write|edit|delete|create|move|patch)_/.test(name)) return "medium"
  return "low"
}

export function listTools(): ToolInfo[] {
  return Object.values(REGISTRY).map((t: ToolDef) => ({
    name: t.name,
    description: t.description,
    riskLevel: riskFor(t.name),
    inputSchema: t.schema,
    timeoutMs: 30_000,
  }))
}

export function getToolInfo(name: string): ToolInfo | undefined {
  return listTools().find((t) => t.name === name)
}
