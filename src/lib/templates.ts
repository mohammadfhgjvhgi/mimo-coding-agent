// ===================================================================
// MiMo AI — Prompt templates & example cards for onboarding
// ===================================================================
// Inspired by bolt.diy, Dify, LobeChat onboarding patterns.
// Each template is a clickable card that injects its prompt into the chat.

export interface PromptTemplate {
  id: string;
  category: "build" | "debug" | "research" | "plan" | "refactor" | "test";
  icon: string; // lucide icon name
  title: { ar: string; en: string };
  description: { ar: string; en: string };
  prompt: string; // the actual prompt sent to the model
  autonomous?: boolean; // whether to enable autonomous mode
  gradient: string; // tailwind gradient classes for the icon badge
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "build-landing",
    category: "build",
    icon: "Layout",
    title: { ar: "صفحة هبوط", en: "Landing Page" },
    description: {
      ar: "صفحة هبوط احترافية لشركة ناشئة مع Hero ومميزات وCTA",
      en: "Professional startup landing page with Hero, features, and CTA",
    },
    prompt:
      "Build a modern, responsive landing page for a SaaS startup called 'Nebula'. Include a hero section with a headline and CTA button, a features grid (3 columns), a pricing table (3 tiers), testimonials section, and a footer. Use Tailwind CSS, smooth scroll, and subtle animations. Make it fully responsive and dark-mode compatible.",
    gradient: "from-violet-500 to-fuchsia-500",
  },
  {
    id: "build-dashboard",
    category: "build",
    icon: "LayoutDashboard",
    title: { ar: "لوحة تحكم", en: "Dashboard" },
    description: {
      ar: "لوحة تحكم بيانات مع رسوم بيانية وKPIs",
      en: "Analytics dashboard with charts and KPIs",
    },
    prompt:
      "Build an analytics dashboard for a web app. Include: 4 KPI cards (Revenue, Users, Conversion, Churn), a line chart showing revenue over 30 days, a bar chart for user signups by source, a donut chart for traffic sources, and a recent-activity table. Use recharts for charts, shadcn/ui for cards, and make it fully responsive.",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    id: "build-api",
    category: "build",
    icon: "Server",
    title: { ar: "REST API", en: "REST API" },
    description: {
      ar: "API كامل مع CRUD ومصادقة ووثائق",
      en: "Full CRUD API with auth and docs",
    },
    prompt:
      "Design and build a REST API for a task management app using Next.js API routes and Prisma. Include: User model with email/password auth, Project model, Task model with status (todo/doing/done) and assignee, endpoints for CRUD on all models, input validation with zod, error handling, and an OpenAPI-style documentation page.",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    id: "debug-error",
    category: "debug",
    icon: "Bug",
    title: { ar: "تصحيح خطأ", en: "Debug Error" },
    description: {
      ar: "ساعدني في تشخيص وإصلاح خطأ في الكود",
      en: "Help me diagnose and fix a code error",
    },
    prompt:
      "I'm getting a Prisma error: 'Relation does not exist' when I query my database. Here's my schema and the query I'm running. Can you help me diagnose the root cause and fix it? Please explain what went wrong and provide the corrected code.",
    gradient: "from-rose-500 to-orange-500",
  },
  {
    id: "research-arch",
    category: "research",
    icon: "Search",
    title: { ar: "بحث معماري", en: "Architecture Research" },
    description: {
      ar: "ابحث عن أحدث أنماط معمارية للـ AI agents",
      en: "Research modern AI agent architecture patterns",
    },
    prompt:
      "Research the latest (2024-2025) multi-agent AI architecture patterns. Cover: Tree-of-Thought, ReAct, Plan-and-Execute, Debate patterns, GraphRAG, and MCP protocol. For each, explain the core idea, when to use it, and give a minimal code example. Conclude with a recommendation for building a coding-assistant agent system.",
    gradient: "from-amber-500 to-yellow-500",
  },
  {
    id: "plan-feature",
    category: "plan",
    icon: "ClipboardList",
    title: { ar: "تخطيط ميزة", en: "Plan a Feature" },
    description: {
      ar: "خطط لميزة تعاون فوري مع وثائق ADR",
      en: "Plan a real-time collaboration feature with ADR",
    },
    prompt:
      "Plan a real-time collaboration feature for a document editor (like Google Docs cursors + presence). Produce: (1) technical architecture diagram (describe it), (2) WebSocket event schema, (3) conflict resolution strategy (CRDT vs OT), (4) database schema changes, (5) a step-by-step implementation plan, and (6) an Architecture Decision Record (ADR) documenting the choices.",
    autonomous: true,
    gradient: "from-indigo-500 to-purple-500",
  },
  {
    id: "refactor-legacy",
    category: "refactor",
    icon: "Recycle",
    title: { ar: "إعادة هيكلة", en: "Refactor Code" },
    description: {
      ar: "أعد هيكلة كود JavaScript إلى TypeScript",
      en: "Refactor JavaScript code to TypeScript",
    },
    prompt:
      "Help me refactor a legacy JavaScript codebase to TypeScript. I have a set of utility functions and a React component. Please: (1) add proper type definitions, (2) fix any type errors, (3) improve the code structure where needed, (4) add JSDoc comments for public APIs, and (5) explain the changes you made.",
    gradient: "from-cyan-500 to-sky-500",
  },
  {
    id: "test-coverage",
    category: "test",
    icon: "ShieldCheck",
    title: { ar: "اختبارات", en: "Add Tests" },
    description: {
      ar: "اكتب اختبارات وحدة شاملة لدالة معينة",
      en: "Write comprehensive unit tests",
    },
    prompt:
      "Write comprehensive unit tests for a function I'll provide. Cover: happy path, edge cases (empty input, null, extreme values), error cases, and boundary conditions. Use vitest. Include both positive and negative assertions, and explain your test strategy.",
    gradient: "from-green-500 to-emerald-500",
  },
];

export interface TemplateCategory {
  id: PromptTemplate["category"];
  label: { ar: string; en: string };
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: "build", label: { ar: "بناء", en: "Build" } },
  { id: "debug", label: { ar: "تصحيح", en: "Debug" } },
  { id: "research", label: { ar: "بحث", en: "Research" } },
  { id: "plan", label: { ar: "تخطيط", en: "Plan" } },
  { id: "refactor", label: { ar: "هيكلة", en: "Refactor" } },
  { id: "test", label: { ar: "اختبار", en: "Test" } },
];

// Capability badges shown in the hero
export const CAPABILITIES = [
  { value: 12, label: { ar: "وكيل", en: "Agents" } },
  { value: 18, label: { ar: "أداة", en: "Tools" } },
  { value: 69, label: { ar: "مهارة", en: "Skills" } },
];
