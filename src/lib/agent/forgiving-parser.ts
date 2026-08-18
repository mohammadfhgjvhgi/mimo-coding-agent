// Forgiving JSON Parser — handles malformed tool-calling from small models.
// Small models (7B) often produce slightly broken JSON. This parser tries:
// 1. Strict JSON.parse
// 2. Extract JSON from surrounding text (regex)
// 3. XML-style fallback (<tool>{"name":"...","args":{...}}</tool>)
// 4. Plain text fallback (extract name + args heuristically)

import { TOOL_OPEN, TOOL_CLOSE } from "@/lib/agent/prompt"

export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
  raw: string // the original text that was parsed
  method: "strict" | "regex" | "xml" | "heuristic" | "failed"
}

// Try to extract a tool call from the model's response text
export function forgivingParseToolCall(text: string): ParsedToolCall | null {
  // 1. Look for ⟦TOOL⟧ markers first
  const markerMatch = text.match(
    new RegExp(`${escapeRegex(TOOL_OPEN)}\\s*(\\{.*?\\})\\s*${escapeRegex(TOOL_CLOSE)}`, "s")
  )

  const jsonCandidate = markerMatch ? markerMatch[1] : null
  const rawMatch = markerMatch ? markerMatch[0] : ""

  if (jsonCandidate) {
    // Try strict parse
    const strict = tryStrictParse(jsonCandidate)
    if (strict) return { ...strict, raw: rawMatch, method: "strict" }

    // Try regex extraction (find { "name": ... })
    const regex = tryRegexExtract(jsonCandidate)
    if (regex) return { ...regex, raw: rawMatch, method: "regex" }
  }

  // 2. Look for raw JSON anywhere in the text (no markers)
  if (!markerMatch) {
    const rawJsonMatch = text.match(/\{[^{}]*"name"\s*:\s*"[^"]+"[^{}]*\}/s)
    if (rawJsonMatch) {
      const strict = tryStrictParse(rawJsonMatch[0])
      if (strict) return { ...strict, raw: rawJsonMatch[0], method: "regex" }
    }
  }

  // 3. XML-style fallback (<tool>{"name":"...","args":{...}}</tool>)
  const xmlMatch = text.match(/<tool>\s*(\{.*?\})\s*<\/tool>/is)
  if (xmlMatch) {
    const strict = tryStrictParse(xmlMatch[1])
    if (strict) return { ...strict, raw: xmlMatch[0], method: "xml" }
  }

  // 4. Heuristic: look for "name" and "args" keywords
  const heuristic = tryHeuristicParse(text)
  if (heuristic) return { ...heuristic, raw: text.slice(0, 200), method: "heuristic" }

  return null
}

function tryStrictParse(jsonStr: string): { name: string; args: Record<string, unknown> } | null {
  try {
    const obj = JSON.parse(jsonStr)
    if (obj && typeof obj.name === "string") {
      return { name: obj.name, args: obj.args || {} }
    }
  } catch {
    /* continue to next method */
  }
  return null
}

function tryRegexExtract(text: string): { name: string; args: Record<string, unknown> } | null {
  // Extract name
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/)
  if (!nameMatch) return null

  // Extract args (try to find the args object)
  const argsMatch = text.match(/"args"\s*:\s*(\{[^}]*\})/)
  let args: Record<string, unknown> = {}
  if (argsMatch) {
    try {
      args = JSON.parse(argsMatch[1])
    } catch {
      // Try to extract key-value pairs manually
      const pairs = argsMatch[1].matchAll(/"(\w+)"\s*:\s*("[^"]*"|[^,}\s]+)/g)
      for (const pair of pairs) {
        let value: unknown = pair[2]
        if (typeof value === "string" && value.startsWith('"')) {
          value = value.slice(1, -1)
        }
        args[pair[1]] = value
      }
    }
  }

  return { name: nameMatch[1], args }
}

function tryHeuristicParse(text: string): { name: string; args: Record<string, unknown> } | null {
  // Look for known tool names in the text
  const knownTools = [
    "read_file", "write_file", "edit_file", "run_terminal_command",
    "list_files", "git_checkpoint", "save_memory", "recall_memory",
    "set_goal", "find_symbol", "get_references", "structural_search",
    "browser_navigate", "browser_screenshot",
    "github_get_issues", "github_get_repo_info", "call_mcp_tool",
  ]

  for (const tool of knownTools) {
    if (text.includes(tool)) {
      // Try to extract arguments from the surrounding text
      const args: Record<string, unknown> = {}

      // Look for common arg patterns
      const pathMatch = text.match(/path["\s:]+([^\s",}\]]+)/i)
      if (pathMatch) args.path = pathMatch[1]

      const urlMatch = text.match(/url["\s:]+([^\s",}\]]+)/i)
      if (urlMatch) args.url = urlMatch[1]

      const nameArgMatch = text.match(/(?:name|key)["\s:]+([^\s",}\]]+)/i)
      if (nameArgMatch && tool !== "find_symbol") args.name = nameArgMatch[1]

      const valueMatch = text.match(/value["\s:]+([^\s",}\]]+)/i)
      if (valueMatch) args.value = valueMatch[1]

      const commandMatch = text.match(/command["\s:]+([^\n",}\]]+)/i)
      if (commandMatch) args.command = commandMatch[1]

      const goalMatch = text.match(/goal["\s:]+([^\n",}\]]+)/i)
      if (goalMatch) args.goal = goalMatch[1]

      return { name: tool, args }
    }
  }

  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
