import { compressConversation, estimateTokens } from "./src/lib/context-os"

const messages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "اقرأ calculator.js" },
  { role: "assistant" as const, content: "سأقرأ\n⟦TOOL⟧{\"name\":\"read_file\",\"args\":{\"path\":\"calculator.js\"}}⟦/TOOL⟧" },
  { role: "user" as const, content: "⟦RESULT⟧📄 calculator.js\n" + "LINE\n".repeat(500) + "⟦/RESULT⟧" },
  { role: "assistant" as const, content: "تم\n⟦TOOL⟧{\"name\":\"write_file\",\"args\":{}}⟦/TOOL⟧" },
  { role: "user" as const, content: "⟦RESULT⟧✅ تم الكتابة⟦/RESULT⟧" },
  { role: "user" as const, content: "اشرح" },
]

const original = estimateTokens(messages.map(m=>m.content).join(""))
console.log("original:", original, "tokens")

// Force compression with a tiny budget
const { messages: compressed, stats } = compressConversation(messages, 200)
console.log("compressed:", stats.compressedTokens, "tokens")
console.log("messages compressed:", stats.messagesCompressed)
console.log("saved:", stats.originalTokens - stats.compressedTokens)
console.log("\nCompressed RESULT preview:")
const r = compressed.find(m => m.content.includes("RESULT"))
if (r) console.log(r.content.slice(0, 200))
