// Multi-Provider Registry — unified config for 8 LLM providers.
// Most are OpenAI-compatible (just baseURL + key); Anthropic Claude needs a
// separate adapter (system prompt is top-level, max_tokens required).

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "groq"
  | "mistral"
  | "openrouter"
  | "ollama"
  | "zai" // built-in default

export interface ProviderConfig {
  id: ProviderId
  name: string
  logo: string // emoji or short text
  description: string
  /** Default base URL — user can override */
  baseURL: string
  /** Environment variable name for API key (fallback if DB empty) */
  keyEnv: string
  /** Whether the provider speaks OpenAI chat-completions API */
  openAICompatible: boolean
  /** Whether an adapter is needed (Anthropic) */
  needsAdapter?: boolean
  /** Default models offered */
  models: ProviderModel[]
  /** Whether API key is required (Ollama = false, local) */
  requiresKey: boolean
  /** Accent color for UI */
  accent: string
  /** Documentation URL */
  docsURL: string
}

export interface ProviderModel {
  id: string
  name: string
  contextWindow: number
  pricing?: { input: number; output: number } // per 1M tokens, USD
  capabilities?: ("chat" | "vision" | "tools" | "reasoning" | "embedding")[]
  isDefault?: boolean
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    logo: "🟢",
    description: "GPT-4o, o1, GPT-4o-mini",
    baseURL: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    openAICompatible: true,
    requiresKey: true,
    accent: "#10a37f",
    docsURL: "https://platform.openai.com/docs/api-reference",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, pricing: { input: 2.5, output: 10 }, capabilities: ["chat", "vision", "tools"], isDefault: true },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, pricing: { input: 0.15, output: 0.6 }, capabilities: ["chat", "vision", "tools"] },
      { id: "o1", name: "o1 Reasoning", contextWindow: 200000, pricing: { input: 15, output: 60 }, capabilities: ["chat", "reasoning"] },
      { id: "o1-mini", name: "o1 Mini", contextWindow: 128000, pricing: { input: 3, output: 12 }, capabilities: ["chat", "reasoning"] },
    ],
  },

  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    logo: "🟣",
    description: "Claude 3.5 Sonnet, Haiku",
    baseURL: "https://api.anthropic.com/v1",
    keyEnv: "ANTHROPIC_API_KEY",
    openAICompatible: false,
    needsAdapter: true,
    requiresKey: true,
    accent: "#d97757",
    docsURL: "https://docs.anthropic.com/en/api/messages",
    models: [
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200000, pricing: { input: 3, output: 15 }, capabilities: ["chat", "vision", "tools"], isDefault: true },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, pricing: { input: 0.8, output: 4 }, capabilities: ["chat", "vision", "tools"] },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", contextWindow: 200000, pricing: { input: 15, output: 75 }, capabilities: ["chat", "vision", "tools"] },
    ],
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    logo: "🔵",
    description: "Gemini 2.0 Flash, 1.5 Pro",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    openAICompatible: true, // uses OpenAI-compat endpoint
    requiresKey: true,
    accent: "#4285f4",
    docsURL: "https://ai.google.dev/gemini-api/docs/openai",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1000000, pricing: { input: 0.1, output: 0.4 }, capabilities: ["chat", "vision", "tools"], isDefault: true },
      { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", contextWindow: 1000000, pricing: { input: 0.075, output: 0.3 }, capabilities: ["chat", "vision"] },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2000000, pricing: { input: 1.25, output: 5 }, capabilities: ["chat", "vision", "tools"] },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1000000, pricing: { input: 0.075, output: 0.3 }, capabilities: ["chat", "vision"] },
    ],
  },

  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    logo: "🐳",
    description: "DeepSeek-V3 (chat), R1 (reasoner)",
    baseURL: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    openAICompatible: true,
    requiresKey: true,
    accent: "#4f8bf7",
    docsURL: "https://api-docs.deepseek.com/",
    models: [
      { id: "deepseek-chat", name: "DeepSeek-V3 Chat", contextWindow: 64000, pricing: { input: 0.27, output: 1.1 }, capabilities: ["chat", "tools"], isDefault: true },
      { id: "deepseek-reasoner", name: "DeepSeek-R1 Reasoner", contextWindow: 64000, pricing: { input: 0.55, output: 2.19 }, capabilities: ["chat", "reasoning"] },
    ],
  },

  groq: {
    id: "groq",
    name: "Groq",
    logo: "⚡",
    description: "Ultra-fast Llama, Mixtral",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    openAICompatible: true,
    requiresKey: true,
    accent: "#f55036",
    docsURL: "https://console.groq.com/docs",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128000, pricing: { input: 0.59, output: 0.79 }, capabilities: ["chat", "tools"], isDefault: true },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", contextWindow: 128000, pricing: { input: 0.05, output: 0.08 }, capabilities: ["chat"] },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32768, pricing: { input: 0.24, output: 0.24 }, capabilities: ["chat"] },
    ],
  },

  mistral: {
    id: "mistral",
    name: "Mistral AI",
    logo: "🌫️",
    description: "Mistral Large, Small",
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    openAICompatible: true,
    requiresKey: true,
    accent: "#ff7000",
    docsURL: "https://docs.mistral.ai/",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large", contextWindow: 128000, pricing: { input: 2, output: 6 }, capabilities: ["chat", "tools"], isDefault: true },
      { id: "mistral-small-latest", name: "Mistral Small", contextWindow: 32000, pricing: { input: 0.2, output: 0.6 }, capabilities: ["chat"] },
      { id: "open-mistral-nemo", name: "Mistral Nemo", contextWindow: 128000, pricing: { input: 0.15, output: 0.15 }, capabilities: ["chat"] },
    ],
  },

  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    logo: "🌐",
    description: "300+ models unified",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    openAICompatible: true,
    requiresKey: true,
    accent: "#6366f1",
    docsURL: "https://openrouter.ai/docs",
    models: [
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (via OR)", contextWindow: 200000, capabilities: ["chat", "vision"], isDefault: true },
      { id: "openai/gpt-4o", name: "GPT-4o (via OR)", contextWindow: 128000, capabilities: ["chat", "vision"] },
      { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (via OR)", contextWindow: 1000000, capabilities: ["chat"] },
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3 (via OR)", contextWindow: 64000, capabilities: ["chat"] },
    ],
  },

  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    logo: "🦙",
    description: "Local models, no API key",
    baseURL: "http://localhost:11434",
    keyEnv: "",
    openAICompatible: true, // Ollama has /v1 compat endpoint
    requiresKey: false,
    accent: "#22c55e",
    docsURL: "https://ollama.com/",
    models: [
      { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", contextWindow: 32768, capabilities: ["chat", "tools"], isDefault: true },
      { id: "qwen3:4b", name: "Qwen 3 4B", contextWindow: 32768, capabilities: ["chat"] },
      { id: "llama3.2:7b", name: "Llama 3.2 7B", contextWindow: 128000, capabilities: ["chat"] },
      { id: "mistral:7b", name: "Mistral 7B", contextWindow: 32768, capabilities: ["chat"] },
    ],
  },

  zai: {
    id: "zai",
    name: "Z.ai (Built-in)",
    logo: "✨",
    description: "Default cloud fallback",
    baseURL: "",
    keyEnv: "",
    openAICompatible: false,
    requiresKey: false,
    accent: "#10b981",
    docsURL: "https://z.ai",
    models: [
      { id: "glm-5v-turbo", name: "GLM 5V Turbo", contextWindow: 128000, capabilities: ["chat", "vision"], isDefault: true },
    ],
  },
}

export function getProviderConfig(id: ProviderId): ProviderConfig | undefined {
  return PROVIDER_REGISTRY[id]
}

export function listProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_REGISTRY)
}

export function getProviderModels(id: ProviderId): ProviderModel[] {
  return PROVIDER_REGISTRY[id]?.models ?? []
}
