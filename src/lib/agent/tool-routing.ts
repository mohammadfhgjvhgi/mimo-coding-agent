// 2-stage Tool Routing — reduces schema tokens by 80%.
// Instead of showing all 17 tools (~2500 tokens), show 6 categories (~200 tokens).
// The model picks a category, then only tools in that category are injected.

import { buildToolManifest, listToolNames } from "@/lib/tools/registry"

export type ToolCategory = "read" | "write" | "run" | "memory" | "external"

export const CATEGORY_MAP: Record<ToolCategory, string[]> = {
  read: ["read_file", "list_files", "find_symbol", "get_references", "structural_search"],
  write: ["write_file", "edit_file", "git_checkpoint"],
  run: ["run_terminal_command"],
  memory: ["save_memory", "recall_memory", "set_goal"],
  external: ["browser_navigate", "browser_screenshot", "github_get_issues", "github_get_repo_info", "call_mcp_tool"],
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  read: "📖 قراءة/بحث (read_file, list_files, find_symbol, get_references, structural_search)",
  write: "✏️ كتابة/تعديل (write_file, edit_file, git_checkpoint)",
  run: "⚡ تنفيذ (run_terminal_command)",
  memory: "🧠 ذاكرة/أهداف (save_memory, recall_memory, set_goal)",
  external: "🌐 خارجي (browser, github, mcp)",
}

// Stage 1: Show only categories to the model (compact)
export function buildCategoryPrompt(): string {
  const lines = Object.entries(CATEGORY_LABELS).map(([cat, desc]) => `- ${desc}`)
  return [
    "## استدعاء الأدوات (2-stage routing)",
    "بدل حفظ أسماء 17 أداة، اختر فئة أولاً ثم استدعِ أداة منها:",
    "",
    ...lines,
    "",
    "ثم استدعِ الأداة بالصيغة المعتادة: ⟦TOOL⟧{\"name\":\"<tool_name>\",\"args\":{...}}⟦/TOOL⟧",
  ].join("\n")
}

// Stage 2: Get the full manifest for a specific category only
export function getCategoryManifest(category: ToolCategory): string {
  const tools = CATEGORY_MAP[category] || []
  // Import the full tool definitions for just these tools
  const fullManifest = buildToolManifest()
  // Extract only the tools in this category from the full manifest
  const sections = fullManifest.split("\n\n### ").filter((section) => {
    const toolName = section.split("\n")[0].replace("### ", "").trim()
    return tools.includes(toolName)
  })
  if (sections.length === 0) return ""
  return "### " + sections.join("\n\n### ")
}

// Detect which category a tool belongs to
export function getToolCategory(toolName: string): ToolCategory | null {
  for (const [cat, tools] of Object.entries(CATEGORY_MAP)) {
    if (tools.includes(toolName)) return cat as ToolCategory
  }
  return null
}

// Estimate token savings
export function estimateTokenSavings(): { full: number; staged: number; savings: number; pct: number } {
  const fullManifest = buildToolManifest()
  const fullTokens = Math.ceil(fullManifest.length / 3.5)
  const categoryPrompt = buildCategoryPrompt()
  const stagedTokens = Math.ceil(categoryPrompt.length / 3.5)
  const savings = fullTokens - stagedTokens
  const pct = fullTokens > 0 ? Math.round((savings / fullTokens) * 100) : 0
  return { full: fullTokens, staged: stagedTokens, savings, pct }
}
