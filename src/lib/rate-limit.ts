// Re-export shim — preserves the @/lib/rate-limit path used by copied
// mimo-ai components while delegating to the canonical utils implementation.
export { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit"
