// Agent Planning — Task Intelligence system.
// 11 operations: Intent Classification, Task Classification, Complexity Estimation,
// Risk Estimation, Scope Estimation, Acceptance Criteria Extraction,
// Task Decomposition, Plan Generation, Plan Validation, Plan Repair, Plan Replanning.
// All deterministic — 0 LLM calls (keyword + pattern matching).

import { createHash } from "node:crypto"

// ============ TYPES ============
export type IntentType =
  | "create"      // create something new
  | "modify"      // change existing
  | "debug"       // fix a problem
  | "research"    // find information
  | "plan"        // plan an approach
  | "review"      // review/analyze
  | "test"        // write/run tests
  | "deploy"      // deploy/build
  | "learn"       // learn/understand
  | "automate"    // automate a process
  | "chat"        // general conversation

export type TaskCategory =
  | "coding"      // code writing/editing
  | "architecture"// design/structure
  | "devops"      // build/deploy/ci
  | "research"    // web/file search
  | "writing"     // documentation/content
  | "analysis"    // data/code analysis
  | "general"     // other

export type Complexity = "trivial" | "simple" | "medium" | "complex" | "very_complex"
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical"
export type Scope = "single_file" | "multi_file" | "module" | "project" | "unknown"

export interface PlanStep {
  id: string
  description: string
  tool?: string        // suggested tool
  dependsOn: string[]  // step IDs this depends on
  status: "pending" | "in_progress" | "done" | "failed" | "skipped"
  estimatedTokens?: number
}

export interface Plan {
  id: string
  task: string
  steps: PlanStep[]
  executionOrder: string[]  // topologically sorted step IDs
  estimatedTotalTokens: number
  estimatedDuration: string
  createdAt: number
}

export interface TaskIntelligence {
  intent: IntentType
  intentConfidence: number
  category: TaskCategory
  complexity: Complexity
  risk: RiskLevel
  scope: Scope
  acceptanceCriteria: string[]
  estimatedSteps: number
  estimatedTokens: number
  estimatedDuration: string
  requiresTools: boolean
  requiresMemory: boolean
  requiresKnowledge: boolean
  requiresBrowser: boolean
  requiresGit: boolean
}

// ============ 1. INTENT CLASSIFICATION ============
const INTENT_PATTERNS: { type: IntentType; patterns: RegExp[]; weight: number }[] = [
  { type: "create", patterns: [/\b(انشئ|أنشئ|create|generate|build|make|اكتب|أنشئ|أضف|add)\b/i], weight: 1.0 },
  { type: "modify", patterns: [/\b(عدّل|عدل|modify|change|update|edit|refactor|غير|تحديث|تعديل)\b/i], weight: 1.0 },
  { type: "debug", patterns: [/\b(صلح|أصلح|اصلح|fix|debug|error|bug|crash|خطأ|مشكلة|فشل|fail)\b/i], weight: 1.0 },
  { type: "research", patterns: [/\b(ابحث|بحث|research|search|find|investigate|استكشف|دور)\b/i], weight: 1.0 },
  { type: "plan", patterns: [/\b(خطط|خطة|plan|strategy|approach|تصميم|design)\b/i], weight: 0.9 },
  { type: "review", patterns: [/\b(راجع|مراجعة|review|analyze|فحص|check|audit)\b/i], weight: 0.9 },
  { type: "test", patterns: [/\b(اختبر|اختبار|test|spec|coverage|قياس)\b/i], weight: 1.0 },
  { type: "deploy", patterns: [/\b(انشر|deploy|build|release|docker|ci\/cd|تثبيت)\b/i], weight: 1.0 },
  { type: "learn", patterns: [/\b(اشرح|learn|understand|how|why|what|ما|كيف|لماذا|لما)\b/i], weight: 0.8 },
  { type: "automate", patterns: [/\b(أتمتة|automate|schedule|cron|trigger|جدول)\b/i], weight: 1.0 },
  { type: "chat", patterns: [/\b(hello|hi|مرحبا|السلام|صباح|مساء|شكرا|thanks)\b/i], weight: 0.5 },
]

export function classifyIntent(message: string): { intent: IntentType; confidence: number } {
  const text = message.toLowerCase().trim()
  const scores: { type: IntentType; score: number }[] = []

  for (const { type, patterns, weight } of INTENT_PATTERNS) {
    let score = 0
    for (const pattern of patterns) {
      const matches = text.match(pattern)
      if (matches) score += matches.length * weight
    }
    if (score > 0) scores.push({ type, score })
  }

  if (scores.length === 0) return { intent: "chat", confidence: 0.3 }

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  const total = scores.reduce((sum, s) => sum + s.score, 0)
  const confidence = Math.min(1, top.score / Math.max(total, 1))

  return { intent: top.type, confidence: Math.round(confidence * 100) / 100 }
}

// ============ 2. TASK CLASSIFICATION ============
export function classifyTask(message: string, intent: IntentType): TaskCategory {
  const text = message.toLowerCase()

  if (/\b(architecture|design|pattern|structure|بنية|هيكل|معماري)\b/i.test(text)) return "architecture"
  if (/\b(deploy|build|ci|docker|release|انشر|تثبيت)\b/i.test(text)) return "devops"
  if (/\b(research|search|find|investigate|ابحث|بحث)\b/i.test(text)) return "research"
  if (/\b(document|write|blog|article|اكتب|مقال|توثيق)\b/i.test(text)) return "writing"
  if (/\b(analyze|data|statistics|metric|حلل|بيانات|إحصاء)\b/i.test(text)) return "analysis"
  if (intent === "create" || intent === "modify" || intent === "debug" || intent === "test") return "coding"
  return "general"
}

// ============ 3. COMPLEXITY ESTIMATION ============
export function estimateComplexity(message: string, intent: IntentType): Complexity {
  const text = message.toLowerCase()
  let score = 0

  // Word count
  const words = text.split(/\s+/).length
  if (words > 100) score += 2
  else if (words > 50) score += 1

  // Multiple actions
  const actionCount = (text.match(/\b(and|ثم|و|بعد ذلك|also)\b/gi) || []).length
  score += Math.min(actionCount, 3)

  // File mentions
  const fileCount = (text.match(/\b(\w+\.(js|ts|tsx|jsx|py|css|html))\b/gi) || []).length
  score += Math.min(fileCount, 3)

  // Complexity keywords
  if (/\b(complete|full|entire|whole|all|كامل|كاملة|كله)\b/i.test(text)) score += 2
  if (/\b(integrate|migration|refactor|integration|ترحيل|دمج)\b/i.test(text)) score += 2
  if (/\b(simple|quick|small|بسيط|سريع|صغير)\b/i.test(text)) score -= 1

  // Intent-based baseline
  if (intent === "chat" || intent === "learn") score = Math.max(0, score - 2)
  if (intent === "deploy" || intent === "automate") score += 1

  if (score <= 0) return "trivial"
  if (score <= 2) return "simple"
  if (score <= 4) return "medium"
  if (score <= 6) return "complex"
  return "very_complex"
}

// ============ 4. RISK ESTIMATION ============
export function estimateRisk(message: string, complexity: Complexity): RiskLevel {
  const text = message.toLowerCase()

  // Critical: destructive operations
  if (/\b(delete|drop|truncate|rm\s+-rf|wipe|destroy|احذف|حذف|مسح)\b/i.test(text)) return "critical"

  // High: production-affecting
  if (/\b(production|live|deploy|migration|database|schema|إنتاج|قاعدة بيانات)\b/i.test(text)) return "high"

  // Medium: complex changes
  if (complexity === "complex" || complexity === "very_complex") return "medium"
  if (/\b(refactor|restructure|rename|هيكلة|إعادة تسمية)\b/i.test(text)) return "medium"

  // Low: simple modifications
  if (complexity === "simple" || complexity === "medium") return "low"

  // None: read-only or chat
  return "none"
}

// ============ 5. SCOPE ESTIMATION ============
export function estimateScope(message: string): Scope {
  const text = message.toLowerCase()

  // Count file mentions
  const files = text.match(/\b(\w+\.(js|ts|tsx|jsx|py|css|html|json))\b/gi) || []
  if (files.length === 1) return "single_file"
  if (files.length > 1 && files.length <= 5) return "multi_file"

  // Module-level
  if (/\b(module|component|feature|وحدة|مكون|ميزة)\b/i.test(text)) return "module"

  // Project-level
  if (/\b(project|entire|whole|all|مشروع|كامل|كله)\b/i.test(text)) return "project"

  return "unknown"
}

// ============ 6. ACCEPTANCE CRITERIA EXTRACTION ============
export function extractAcceptanceCriteria(message: string): string[] {
  const text = message.trim()
  const criteria: string[] = []

  // Pattern 1: "تأكد أن..." / "make sure..." / "ensure..."
  const ensurePattern = /(?:تأكد أن|تأكد من|make sure|ensure|verify|تحقق من|تأكد)\s+(.+?)(?=[،,.]|\n|$)/gi
  let match: RegExpExecArray | null
  while ((match = ensurePattern.exec(text)) !== null) {
    criteria.push(match[1].trim())
  }

  // Pattern 2: "يجب أن..." / "should..." / "must..."
  const mustPattern = /(?:يجب أن|ينبغي|should|must|need to)\s+(.+?)(?=[،,.]|\n|$)/gi
  while ((match = mustPattern.exec(text)) !== null) {
    criteria.push(match[1].trim())
  }

  // Pattern 3: Numbered list "1. ... 2. ..."
  const numberedPattern = /\d+[.):]\s+(.+?)(?=\n|$)/g
  while ((match = numberedPattern.exec(text)) !== null) {
    criteria.push(match[1].trim())
  }

  // Pattern 4: "بدون أخطاء" / "no errors" / "passes"
  if (/\b(بدون أخطاء|no errors|passes|ينجح|نجاح|without bugs)\b/i.test(text)) {
    criteria.push("لا أخطاء في الكود")
  }
  if (/\b(اختبارات|tests|test pass)\b/i.test(text)) {
    criteria.push("الاختبارات تنجح")
  }

  // Deduplicate
  return [...new Set(criteria)].slice(0, 10)
}

// ============ 7. TASK DECOMPOSITION ============
export function decomposeTask(
  task: string,
  complexity: Complexity,
  intent: IntentType,
  scope: Scope
): string[] {
  const steps: string[] = []

  // Always start with understanding
  if (complexity !== "trivial") {
    steps.push(`اقرأ الملفات ذات الصلة لفهم السياق`)
  }

  // Intent-specific steps
  switch (intent) {
    case "create":
      steps.push(`أنشئ الملفات المطلوبة`)
      steps.push(`أضف المحتوى الأساسي`)
      break
    case "modify":
      steps.push(`اقرأ الكود الحالي`)
      steps.push(`عدّل الكود بالتغييرات المطلوبة`)
      break
    case "debug":
      steps.push(`اقرأ رسالة الخطأ`)
      steps.push(`حدد سبب المشكلة`)
      steps.push(`أصلح الخطأ`)
      break
    case "research":
      steps.push(`ابحث في المصادر`)
      steps.push(`استخرج المعلومات`)
      steps.push(`اكتب التقرير`)
      break
    case "test":
      steps.push(`اقرأ الكود المراد اختباره`)
      steps.push(`اكتب الاختبارات`)
      break
    case "review":
      steps.push(`اقرأ الكود`)
      steps.push(`حلل الجودة والأمان والأداء`)
      steps.push(`اكتب التوصيات`)
      break
    case "deploy":
      steps.push(`تحقق من جاهزية المشروع`)
      steps.push(`نفّذ البناء/النشر`)
      break
    default:
      steps.push(`نفّذ المهمة`)
  }

  // Verification steps (for non-trivial tasks)
  if (complexity !== "trivial" && intent !== "chat" && intent !== "learn") {
    steps.push(`شغّل الفحص (lint/typecheck)`)
    if (intent === "test" || intent === "debug" || intent === "create") {
      steps.push(`شغّل الاختبارات`)
    }
  }

  // Git checkpoint for risky tasks
  if (complexity === "complex" || complexity === "very_complex") {
    steps.push(`احفظ نقطة استرجاع (git checkpoint)`)
  }

  return steps
}

// ============ 8. PLAN GENERATION ============
export function generatePlan(task: string, intelligence: TaskIntelligence): Plan {
  const stepDescriptions = decomposeTask(task, intelligence.complexity, intelligence.intent, intelligence.scope)

  const steps: PlanStep[] = stepDescriptions.map((desc, i) => ({
    id: `step_${i + 1}`,
    description: desc,
    dependsOn: i > 0 ? [`step_${i}`] : [],
    status: "pending",
    estimatedTokens: Math.ceil(desc.length / 3.5) + 500, // desc + LLM response
  }))

  // Execution order = sequential (topological sort)
  const executionOrder = steps.map(s => s.id)

  const estimatedTotalTokens = steps.reduce((sum, s) => sum + (s.estimatedTokens || 0), 0)
  const stepCount = steps.length

  let estimatedDuration = "ثوانٍ"
  if (stepCount > 5) estimatedDuration = "دقائق"
  if (stepCount > 10) estimatedDuration = "10+ دقائق"

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    task,
    steps,
    executionOrder,
    estimatedTotalTokens,
    estimatedDuration,
    createdAt: Date.now(),
  }
}

// ============ 9. PLAN VALIDATION ============
export function validatePlan(plan: Plan): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  // Check for cycles
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function hasCycle(stepId: string): boolean {
    if (recursionStack.has(stepId)) return true
    if (visited.has(stepId)) return false

    visited.add(stepId)
    recursionStack.add(stepId)

    const step = plan.steps.find(s => s.id === stepId)
    if (step) {
      for (const dep of step.dependsOn) {
        if (hasCycle(dep)) return true
      }
    }

    recursionStack.delete(stepId)
    return false
  }

  for (const step of plan.steps) {
    if (hasCycle(step.id)) {
      issues.push(`دورة مكتشفة في الخطوة ${step.id}`)
    }
  }

  // Check for missing dependencies
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!plan.steps.find(s => s.id === dep)) {
        issues.push(`الخطوة ${step.id} تعتمد على ${dep} غير الموجود`)
      }
    }
  }

  // Check for empty plan
  if (plan.steps.length === 0) {
    issues.push("الخطة فارغة")
  }

  return { valid: issues.length === 0, issues }
}

// ============ 10. PLAN REPAIR ============
export function repairPlan(plan: Plan, failedStepId: string, error: string): Plan {
  const steps = [...plan.steps]
  const failedIdx = steps.findIndex(s => s.id === failedStepId)

  if (failedIdx < 0) return plan

  // Mark failed step
  steps[failedIdx] = { ...steps[failedIdx], status: "failed" }

  // Insert a recovery step after the failed one
  const recoveryStep: PlanStep = {
    id: `recovery_${Date.now()}`,
    description: `حل بديل بعد فشل "${steps[failedIdx].description}": ${error.slice(0, 100)}`,
    dependsOn: [],
    status: "pending",
    estimatedTokens: 500,
  }

  steps.splice(failedIdx + 1, 0, recoveryStep)

  // Update dependencies: steps after the failed one now depend on recovery
  for (let i = failedIdx + 2; i < steps.length; i++) {
    if (steps[i].dependsOn.includes(failedStepId)) {
      steps[i].dependsOn = steps[i].dependsOn.map(d =>
        d === failedStepId ? recoveryStep.id : d
      )
    }
  }

  // Rebuild execution order
  const executionOrder = steps.map(s => s.id)

  return { ...plan, steps, executionOrder }
}

// ============ 11. PLAN REPLANNING ============
export function replanPlan(plan: Plan, newTask: string, intelligence: TaskIntelligence): Plan {
  // Generate a new plan but preserve completed steps
  const newPlan = generatePlan(newTask, intelligence)

  // Mark already-completed steps from old plan
  const completedDescs = new Set(
    plan.steps.filter(s => s.status === "done").map(s => s.description)
  )

  newPlan.steps = newPlan.steps.map(step => {
    if (completedDescs.has(step.description)) {
      return { ...step, status: "done" }
    }
    return step
  })

  return newPlan
}

// ============ FULL ANALYSIS ============
export function analyzeTask(message: string): TaskIntelligence {
  const { intent, confidence } = classifyIntent(message)
  const category = classifyTask(message, intent)
  const complexity = estimateComplexity(message, intent)
  const risk = estimateRisk(message, complexity)
  const scope = estimateScope(message)
  const acceptanceCriteria = extractAcceptanceCriteria(message)

  const stepEstimates: Record<Complexity, number> = {
    trivial: 1, simple: 2, medium: 4, complex: 7, very_complex: 12,
  }
  const estimatedSteps = stepEstimates[complexity]
  const estimatedTokens = estimatedSteps * 1500 // ~1500 tokens per step

  const durationEstimates: Record<Complexity, string> = {
    trivial: "ثوانٍ", simple: "أقل من دقيقة", medium: "1-3 دقائق", complex: "3-10 دقائق", very_complex: "10+ دقائق",
  }

  // Determine required capabilities
  const requiresTools = intent !== "chat" && intent !== "learn"
  const requiresMemory = /\b(تذكر|ذكر|سابق|previous|remember|memory|ذاكرة)\b/i.test(message)
  const requiresKnowledge = category === "research" || /\b(مستند|وثيقة|document|knowledge|معرفة)\b/i.test(message)
  const requiresBrowser = intent === "research"
  const requiresGit = risk === "high" || risk === "critical" || complexity === "complex" || complexity === "very_complex"

  return {
    intent,
    intentConfidence: confidence,
    category,
    complexity,
    risk,
    scope,
    acceptanceCriteria,
    estimatedSteps,
    estimatedTokens,
    estimatedDuration: durationEstimates[complexity],
    requiresTools,
    requiresMemory,
    requiresKnowledge,
    requiresBrowser,
    requiresGit,
  }
}
