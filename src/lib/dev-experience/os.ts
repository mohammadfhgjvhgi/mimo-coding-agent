// Developer Experience OS — 13 operations (spec section 28, features 393-405).
//
// All operations are deterministic — they read from filesystem + package.json.
// No LLM calls. All data persisted to DB (DevProjectTemplate, DevConstitution).
//
// 13 operations:
//   1.  projectTemplates       — list/get/create reusable project scaffolds
//   2.  projectScaffolding      — create a new project from a template
//   3.  frameworkDetection      — detect framework from package.json/deps
//   4.  packageManagerDetection — detect npm/bun/pnpm/yarn/pip/poetry
//   5.  testFrameworkDetection  — detect Jest/Vitest/Pytest/Mocha
//   6.  commandDiscovery        — discover dev/build/test/lint commands
//   7.  projectConstitution     — list/add/remove project rules
//   8.  repositoryProfile       — generate a profile (framework, deps, tools)
//   9.  projectInstructions     — list/add project-specific instructions
//   10. criticalFiles           — list/add protected files (no auto-edit)
//   11. dangerousOperations     — list/add forbidden ops
//   12. definitionOfDoneTemplates — list/add DoD templates
//   13. engineeringRunbooks     — list/add step-by-step runbooks

import { db } from "@/lib/db"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "@/lib/tools/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DExResult<T> {
  ok: boolean
  data?: T
  error?: string
  message?: string
}

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  framework: string
  language: string
  packageManager: string
  testFramework: string
  files: Record<string, string>
  commands: Record<string, string>
  builtin: boolean
}

export interface FrameworkInfo {
  name: string
  version: string | null
  confidence: number // 0-100
  reason: string
}

export interface PackageManagerInfo {
  name: string // "bun" | "npm" | "pnpm" | "yarn" | "pip" | "poetry" | "unknown"
  version: string | null
  lockFile: string | null
  reason: string
}

export interface TestFrameworkInfo {
  name: string // "vitest" | "jest" | "pytest" | "mocha" | "unknown"
  version: string | null
  configFiles: string[]
  reason: string
}

export interface CommandInfo {
  name: string
  command: string
  source: string // "package.json" | "Makefile" | "pyproject.toml" | "inferred"
}

export interface RepositoryProfile {
  framework: FrameworkInfo
  packageManager: PackageManagerInfo
  testFramework: TestFrameworkInfo
  commands: CommandInfo[]
  languages: Array<{ name: string; percentage: number }>
  totalFiles: number
  totalLines: number
  gitRepo: boolean
}

export interface ConstitutionRule {
  id: string
  type: string
  title: string
  content: string
  severity: string
  enabled: boolean
  builtin: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPackageJson(): any | null {
  try {
    const pkgPath = path.join(WORKSPACE_ROOT, "package.json")
    if (!existsSync(pkgPath)) return null
    return JSON.parse(readFileSync(pkgPath, "utf8"))
  } catch {
    return null
  }
}

function readPyprojectToml(): string | null {
  try {
    const p = path.join(WORKSPACE_ROOT, "pyproject.toml")
    if (!existsSync(p)) return null
    return readFileSync(p, "utf8")
  } catch {
    return null
  }
}

function hasFile(filename: string): boolean {
  return existsSync(path.join(WORKSPACE_ROOT, filename))
}

// ---------------------------------------------------------------------------
// 1. Project Templates (393)
// ---------------------------------------------------------------------------

const BUILTIN_TEMPLATES: Array<Omit<ProjectTemplate, "id">> = [
  {
    name: "nextjs-typescript",
    description: "Next.js 16 + TypeScript + Tailwind + Prisma",
    framework: "nextjs",
    language: "typescript",
    packageManager: "bun",
    testFramework: "vitest",
    files: {
      "package.json": JSON.stringify({
        name: "new-project",
        version: "0.1.0",
        scripts: { dev: "next dev", build: "next build", start: "next start", lint: "eslint .", test: "vitest" },
        dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: { typescript: "^5.0.0", "@types/react": "^19.0.0", vitest: "^2.0.0" },
      }, null, 2),
      "tsconfig.json": JSON.stringify({
        compiler: { target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], module: "esnext", jsx: "preserve", strict: true, moduleResolution: "bundler" },
      }, null, 2),
    },
    commands: { dev: "bun run dev", build: "bun run build", test: "bun run test", lint: "bun run lint" },
    builtin: true,
  },
  {
    name: "express-typescript",
    description: "Express.js + TypeScript API",
    framework: "express",
    language: "typescript",
    packageManager: "npm",
    testFramework: "jest",
    files: {
      "package.json": JSON.stringify({
        name: "api",
        scripts: { dev: "ts-node-dev src/index.ts", build: "tsc", start: "node dist/index.js", test: "jest" },
      }, null, 2),
    },
    commands: { dev: "npm run dev", build: "npm run build", test: "npm test" },
    builtin: true,
  },
  {
    name: "fastapi-python",
    description: "FastAPI + Python + Uvicorn",
    framework: "fastapi",
    language: "python",
    packageManager: "poetry",
    testFramework: "pytest",
    files: {
      "pyproject.toml": "[tool.poetry]\nname = \"api\"\nversion = \"0.1.0\"\n\n[tool.poetry.dependencies]\npython = \"^3.11\"\nfastapi = \"^0.100.0\"\nuvicorn = \"^0.23.0\"\n\n[tool.poetry.dev-dependencies]\npytest = \"^7.0.0\"\n",
    },
    commands: { dev: "uvicorn main:app --reload", test: "pytest" },
    builtin: true,
  },
  {
    name: "react-vite",
    description: "React 19 + Vite + TypeScript",
    framework: "react",
    language: "typescript",
    packageManager: "pnpm",
    testFramework: "vitest",
    files: {
      "package.json": JSON.stringify({
        name: "react-app",
        scripts: { dev: "vite", build: "vite build", test: "vitest" },
      }, null, 2),
    },
    commands: { dev: "pnpm dev", build: "pnpm build", test: "pnpm test" },
    builtin: true,
  },
]

export async function listProjectTemplates(): Promise<DExResult<ProjectTemplate[]>> {
  try {
    // Ensure builtin templates exist in DB
    for (const t of BUILTIN_TEMPLATES) {
      const existing = await db.devProjectTemplate.findUnique({ where: { name: t.name } })
      if (!existing) {
        await db.devProjectTemplate.create({
          data: {
            name: t.name,
            description: t.description,
            framework: t.framework,
            language: t.language,
            packageManager: t.packageManager,
            testFramework: t.testFramework,
            files: JSON.stringify(t.files),
            commands: JSON.stringify(t.commands),
            builtin: true,
          },
        })
      }
    }

    const templates = await db.devProjectTemplate.findMany({ orderBy: { name: "asc" } })
    return {
      ok: true,
      data: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        framework: t.framework,
        language: t.language,
        packageManager: t.packageManager,
        testFramework: t.testFramework,
        files: JSON.parse(t.files),
        commands: JSON.parse(t.commands),
        builtin: t.builtin,
      })),
    }
  } catch (e) {
    return { ok: false, error: "list_templates_failed", message: String(e) }
  }
}

export async function createProjectTemplate(opts: {
  name: string
  description: string
  framework: string
  language: string
  packageManager: string
  testFramework: string
  files: Record<string, string>
  commands: Record<string, string>
}): Promise<DExResult<{ id: string }>> {
  try {
    const created = await db.devProjectTemplate.create({
      data: {
        name: opts.name,
        description: opts.description,
        framework: opts.framework,
        language: opts.language,
        packageManager: opts.packageManager,
        testFramework: opts.testFramework,
        files: JSON.stringify(opts.files),
        commands: JSON.stringify(opts.commands),
        builtin: false,
      },
    })
    return { ok: true, data: { id: created.id } }
  } catch (e) {
    return { ok: false, error: "create_template_failed", message: String(e) }
  }
}

export async function deleteProjectTemplate(id: string): Promise<DExResult<{ deleted: boolean }>> {
  try {
    const existing = await db.devProjectTemplate.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "القالب غير موجود" }
    if (existing.builtin) return { ok: false, error: "builtin", message: "❌ لا يمكن حذف قالب مدمج" }
    await db.devProjectTemplate.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 2. Project Scaffolding (394)
// ---------------------------------------------------------------------------

export async function projectScaffolding(opts: {
  templateName: string
  targetPath?: string // default: WORKSPACE_ROOT/<name>
  projectName?: string
}): Promise<DExResult<{ created: string[]; targetPath: string }>> {
  try {
    const template = await db.devProjectTemplate.findUnique({ where: { name: opts.templateName } })
    if (!template) return { ok: false, error: "not_found", message: `❌ القالب ${opts.templateName} غير موجود` }

    const targetPath = opts.targetPath ?? path.join(WORKSPACE_ROOT, opts.projectName ?? opts.templateName)
    const files = JSON.parse(template.files) as Record<string, string>

    // Create directory structure
    mkdirSync(targetPath, { recursive: true })

    const created: string[] = []
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(targetPath, filePath)
      const dir = path.dirname(fullPath)
      mkdirSync(dir, { recursive: true })
      writeFileSync(fullPath, content, "utf8")
      created.push(filePath)
    }

    return {
      ok: true,
      data: {
        created,
        targetPath,
      },
    }
  } catch (e) {
    return { ok: false, error: "scaffold_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 3. Framework Detection (395)
// ---------------------------------------------------------------------------

const FRAMEWORK_SIGNATURES: Array<{ name: string; deps: string[]; files: string[]; confidence: number }> = [
  { name: "nextjs", deps: ["next"], files: ["next.config.ts", "next.config.js", "next.config.mjs"], confidence: 95 },
  { name: "react", deps: ["react", "react-dom"], files: ["vite.config.ts"], confidence: 80 },
  { name: "vue", deps: ["vue"], files: ["vite.config.ts"], confidence: 80 },
  { name: "express", deps: ["express"], files: [], confidence: 75 },
  { name: "fastify", deps: ["fastify"], files: [], confidence: 75 },
  { name: "nest", deps: ["@nestjs/core"], files: [], confidence: 85 },
  { name: "fastapi", deps: [], files: ["main.py"], confidence: 60 },
  { name: "django", deps: [], files: ["manage.py"], confidence: 90 },
  { name: "flask", deps: [], files: ["app.py", "wsgi.py"], confidence: 60 },
  { name: "svelte", deps: ["svelte"], files: ["svelte.config.js"], confidence: 85 },
  { name: "astro", deps: ["astro"], files: ["astro.config.mjs"], confidence: 90 },
  { name: "remix", deps: ["@remix-run/react"], files: [], confidence: 85 },
]

export function frameworkDetection(): DExResult<FrameworkInfo> {
  try {
    const pkg = readPackageJson()
    const allDeps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {}

    for (const sig of FRAMEWORK_SIGNATURES) {
      // Check deps first (highest confidence)
      const depMatch = sig.deps.find(d => allDeps[d])
      if (depMatch) {
        return {
          ok: true,
          data: {
            name: sig.name,
            version: allDeps[depMatch] ?? null,
            confidence: sig.confidence,
            reason: `Dependency "${depMatch}" found in package.json`,
          },
        }
      }
      // Check files
      const fileMatch = sig.files.find(f => hasFile(f))
      if (fileMatch) {
        return {
          ok: true,
          data: {
            name: sig.name,
            version: null,
            confidence: sig.confidence - 10,
            reason: `Config file "${fileMatch}" found`,
          },
        }
      }
    }

    // Python detection
    if (readPyprojectToml()) {
      const pyproject = readPyprojectToml()!
      if (pyproject.includes("fastapi")) return { ok: true, data: { name: "fastapi", version: null, confidence: 70, reason: "fastapi in pyproject.toml" } }
      if (pyproject.includes("django")) return { ok: true, data: { name: "django", version: null, confidence: 90, reason: "django in pyproject.toml" } }
      if (pyproject.includes("flask")) return { ok: true, data: { name: "flask", version: null, confidence: 70, reason: "flask in pyproject.toml" } }
    }

    return { ok: true, data: { name: "unknown", version: null, confidence: 0, reason: "No framework detected" } }
  } catch (e) {
    return { ok: false, error: "framework_detection_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 4. Package Manager Detection (396)
// ---------------------------------------------------------------------------

export function packageManagerDetection(): DExResult<PackageManagerInfo> {
  try {
    // Check lock files (most reliable)
    if (hasFile("bun.lockb") || hasFile("bun.lock")) {
      return { ok: true, data: { name: "bun", version: null, lockFile: "bun.lockb", reason: "bun.lockb found" } }
    }
    if (hasFile("pnpm-lock.yaml")) {
      return { ok: true, data: { name: "pnpm", version: null, lockFile: "pnpm-lock.yaml", reason: "pnpm-lock.yaml found" } }
    }
    if (hasFile("yarn.lock")) {
      return { ok: true, data: { name: "yarn", version: null, lockFile: "yarn.lock", reason: "yarn.lock found" } }
    }
    if (hasFile("package-lock.json")) {
      return { ok: true, data: { name: "npm", version: null, lockFile: "package-lock.json", reason: "package-lock.json found" } }
    }

    // Python
    if (hasFile("poetry.lock")) {
      return { ok: true, data: { name: "poetry", version: null, lockFile: "poetry.lock", reason: "poetry.lock found" } }
    }
    if (hasFile("Pipfile.lock")) {
      return { ok: true, data: { name: "pipenv", version: null, lockFile: "Pipfile.lock", reason: "Pipfile.lock found" } }
    }
    if (hasFile("requirements.txt") || hasFile("pyproject.toml")) {
      return { ok: true, data: { name: "pip", version: null, lockFile: "requirements.txt", reason: "requirements.txt or pyproject.toml found" } }
    }

    // Fallback: check package.json scripts for hints
    const pkg = readPackageJson()
    if (pkg?.packageManager) {
      const pm = pkg.packageManager.split("@")[0]
      return { ok: true, data: { name: pm, version: pkg.packageManager.split("@")[1] ?? null, lockFile: null, reason: "package.json#packageManager field" } }
    }

    return { ok: true, data: { name: "unknown", version: null, lockFile: null, reason: "No package manager detected" } }
  } catch (e) {
    return { ok: false, error: "pm_detection_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 5. Test Framework Detection (397)
// ---------------------------------------------------------------------------

export function testFrameworkDetection(): DExResult<TestFrameworkInfo> {
  try {
    const pkg = readPackageJson()
    const allDeps = pkg ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {}

    // Check deps
    if (allDeps["vitest"]) return { ok: true, data: { name: "vitest", version: allDeps["vitest"], configFiles: getConfigFiles(["vitest.config.ts", "vitest.config.js", "vite.config.ts"]), reason: "vitest in dependencies" } }
    if (allDeps["jest"]) return { ok: true, data: { name: "jest", version: allDeps["jest"], configFiles: getConfigFiles(["jest.config.ts", "jest.config.js", "jest.config.json"]), reason: "jest in dependencies" } }
    if (allDeps["mocha"]) return { ok: true, data: { name: "mocha", version: allDeps["mocha"], configFiles: getConfigFiles([".mocharc.yml", ".mocharc.json"]), reason: "mocha in dependencies" } }
    if (allDeps["@playwright/test"]) return { ok: true, data: { name: "playwright", version: allDeps["@playwright/test"], configFiles: getConfigFiles(["playwright.config.ts"]), reason: "@playwright/test in dependencies" } }

    // Python
    const pyproject = readPyprojectToml()
    if (pyproject) {
      if (pyproject.includes("pytest")) return { ok: true, data: { name: "pytest", version: null, configFiles: getConfigFiles(["pytest.ini", "setup.cfg", "pyproject.toml"]), reason: "pytest in pyproject.toml" } }
      if (pyproject.includes("unittest")) return { ok: true, data: { name: "unittest", version: null, configFiles: [], reason: "unittest in pyproject.toml" } }
    }

    // Check for test scripts
    if (pkg?.scripts?.test) {
      const testScript = pkg.scripts.test
      if (testScript.includes("vitest")) return { ok: true, data: { name: "vitest", version: null, configFiles: [], reason: "vitest in test script" } }
      if (testScript.includes("jest")) return { ok: true, data: { name: "jest", version: null, configFiles: [], reason: "jest in test script" } }
    }

    return { ok: true, data: { name: "unknown", version: null, configFiles: [], reason: "No test framework detected" } }
  } catch (e) {
    return { ok: false, error: "test_detection_failed", message: String(e) }
  }
}

function getConfigFiles(candidates: string[]): string[] {
  return candidates.filter(f => hasFile(f))
}

// ---------------------------------------------------------------------------
// 6. Command Discovery (398)
// ---------------------------------------------------------------------------

export function commandDiscovery(): DExResult<CommandInfo[]> {
  try {
    const commands: CommandInfo[] = []
    const pkg = readPackageJson()

    // From package.json scripts
    if (pkg?.scripts) {
      for (const [name, cmd] of Object.entries(pkg.scripts)) {
        commands.push({ name, command: cmd as string, source: "package.json" })
      }
    }

    // From pyproject.toml
    const pyproject = readPyprojectToml()
    if (pyproject) {
      // Look for [tool.poetry.scripts]
      const scriptsMatch = pyproject.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(?=\n\[|$)/)
      if (scriptsMatch) {
        const lines = scriptsMatch[1].split("\n").filter(l => l.includes("="))
        for (const line of lines) {
          const [name, cmd] = line.split("=").map(s => s.trim())
          if (name && cmd) commands.push({ name, command: cmd, source: "pyproject.toml" })
        }
      }
    }

    // From Makefile
    if (hasFile("Makefile")) {
      try {
        const makefile = readFileSync(path.join(WORKSPACE_ROOT, "Makefile"), "utf8")
        const lines = makefile.split("\n")
        for (const line of lines) {
          const match = line.match(/^([a-zA-Z_-]+):\s*.*/)
          if (match && !match[1].startsWith(".") && !["phony"].includes(match[1].toLowerCase())) {
            commands.push({ name: match[1], command: `make ${match[1]}`, source: "Makefile" })
          }
        }
      } catch {}
    }

    // Inferred commands
    const fw = frameworkDetection()
    if (fw.ok && fw.data) {
      const pm = packageManagerDetection()
      const pmName = pm.ok ? pm.data.name : "npm"
      const pmCmd = pmName === "bun" ? "bun run" : pmName === "pnpm" ? "pnpm" : pmName === "yarn" ? "yarn" : "npm run"

      if (fw.data.name === "nextjs" && !commands.find(c => c.name === "dev")) {
        commands.push({ name: "dev", command: `${pmCmd} dev`, source: "inferred" })
      }
      if (fw.data.name === "fastapi" && !commands.find(c => c.name === "dev")) {
        commands.push({ name: "dev", command: "uvicorn main:app --reload", source: "inferred" })
      }
      if (fw.data.name === "django" && !commands.find(c => c.name === "dev")) {
        commands.push({ name: "dev", command: "python manage.py runserver", source: "inferred" })
      }
    }

    return { ok: true, data: commands }
  } catch (e) {
    return { ok: false, error: "command_discovery_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 7. Project Constitution (399) — list/add/remove rules
// ---------------------------------------------------------------------------

const BUILTIN_CONSTITUTION: Array<{ type: string; title: string; content: string; severity: string }> = [
  { type: "critical_file", title: "package.json", content: "Never delete or break package.json — it defines all dependencies", severity: "critical" },
  { type: "critical_file", title: "prisma/schema.prisma", content: "Never delete Prisma schema — all DB models live here", severity: "critical" },
  { type: "critical_file", title: ".env", content: "Never read or expose .env contents without permission", severity: "critical" },
  { type: "dangerous_op", title: "rm -rf /", content: "Never run rm -rf on root or system directories", severity: "critical" },
  { type: "dangerous_op", title: "git push --force to main", content: "Never force-push to main/master branch", severity: "high" },
  { type: "dangerous_op", title: "DROP DATABASE", content: "Never execute DROP DATABASE or DROP TABLE without explicit approval", severity: "critical" },
  { type: "instruction", title: "Test before commit", content: "Always run tests before committing changes", severity: "medium" },
  { type: "instruction", title: "Type-safe code", content: "Avoid 'any' type — use proper TypeScript types", severity: "medium" },
  { type: "definition_of_done", title: "Feature DoD", content: "1. Code written\n2. Tests added\n3. Lint passes\n4. Type-check passes\n5. Documentation updated", severity: "medium" },
  { type: "runbook", title: "Deploy runbook", content: "1. Run tests\n2. Build project\n3. Run linter\n4. Commit changes\n5. Push to remote\n6. Trigger CI/CD", severity: "medium" },
]

async function ensureBuiltinConstitution(): Promise<void> {
  for (const rule of BUILTIN_CONSTITUTION) {
    const existing = await db.devConstitution.findFirst({ where: { type: rule.type, title: rule.title } })
    if (!existing) {
      await db.devConstitution.create({
        data: {
          type: rule.type,
          title: rule.title,
          content: rule.content,
          severity: rule.severity,
          enabled: true,
          builtin: true,
        },
      })
    }
  }
}

export async function listConstitution(type?: string): Promise<DExResult<ConstitutionRule[]>> {
  try {
    await ensureBuiltinConstitution()
    const where: any = type ? { type } : {}
    const rules = await db.devConstitution.findMany({ where, orderBy: [{ severity: "desc" }, { createdAt: "asc" }] })
    return {
      ok: true,
      data: rules.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content,
        severity: r.severity,
        enabled: r.enabled,
        builtin: r.builtin,
      })),
    }
  } catch (e) {
    return { ok: false, error: "list_constitution_failed", message: String(e) }
  }
}

export async function addConstitution(opts: {
  type: string
  title: string
  content: string
  severity?: string
}): Promise<DExResult<{ id: string }>> {
  try {
    const created = await db.devConstitution.create({
      data: {
        type: opts.type,
        title: opts.title,
        content: opts.content,
        severity: opts.severity ?? "medium",
        enabled: true,
        builtin: false,
      },
    })
    return { ok: true, data: { id: created.id } }
  } catch (e) {
    return { ok: false, error: "add_constitution_failed", message: String(e) }
  }
}

export async function deleteConstitution(id: string): Promise<DExResult<{ deleted: boolean }>> {
  try {
    const existing = await db.devConstitution.findUnique({ where: { id } })
    if (!existing) return { ok: false, error: "not_found", message: "القاعدة غير موجودة" }
    if (existing.builtin) return { ok: false, error: "builtin", message: "❌ لا يمكن حذف قاعدة مدمجة" }
    await db.devConstitution.delete({ where: { id } })
    return { ok: true, data: { deleted: true } }
  } catch (e) {
    return { ok: false, error: "delete_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 8. Repository Profile (400)
// ---------------------------------------------------------------------------

export async function repositoryProfile(): Promise<DExResult<RepositoryProfile>> {
  try {
    const fw = frameworkDetection()
    const pm = packageManagerDetection()
    const tf = testFrameworkDetection()
    const cmds = commandDiscovery()

    // Language stats from file scan
    const { scanFiles } = await import("@/lib/code-intel/graphs/repo-scanner")
    const files = scanFiles()
    const totalFiles = files.length
    const totalLines = files.reduce((s, f) => s + f.lines, 0)
    const langStats: Record<string, number> = {}
    for (const f of files) {
      langStats[f.language] = (langStats[f.language] ?? 0) + f.lines
    }
    const languages = Object.entries(langStats)
      .map(([name, lines]) => ({ name, percentage: totalLines > 0 ? Math.round((lines / totalLines) * 100) : 0 }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 10)

    const gitRepo = hasFile(".git")

    return {
      ok: true,
      data: {
        framework: fw.ok ? fw.data : { name: "unknown", version: null, confidence: 0, reason: "detection failed" },
        packageManager: pm.ok ? pm.data : { name: "unknown", version: null, lockFile: null, reason: "detection failed" },
        testFramework: tf.ok ? tf.data : { name: "unknown", version: null, configFiles: [], reason: "detection failed" },
        commands: cmds.ok ? cmds.data : [],
        languages,
        totalFiles,
        totalLines,
        gitRepo,
      },
    }
  } catch (e) {
    return { ok: false, error: "profile_failed", message: String(e) }
  }
}

// ---------------------------------------------------------------------------
// 9-13. Constitution subtypes (401-405) — all go through listConstitution/addConstitution
// ---------------------------------------------------------------------------

export async function projectInstructions(): Promise<DExResult<ConstitutionRule[]>> {
  return listConstitution("instruction")
}

export async function criticalFiles(): Promise<DExResult<ConstitutionRule[]>> {
  return listConstitution("critical_file")
}

export async function dangerousOperations(): Promise<DExResult<ConstitutionRule[]>> {
  return listConstitution("dangerous_op")
}

export async function definitionOfDoneTemplates(): Promise<DExResult<ConstitutionRule[]>> {
  return listConstitution("definition_of_done")
}

export async function engineeringRunbooks(): Promise<DExResult<ConstitutionRule[]>> {
  return listConstitution("runbook")
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export async function dexSnapshot(): Promise<DExResult<{
  totalTemplates: number
  totalConstitutionRules: number
  byType: Record<string, number>
  bySeverity: Record<string, number>
  detectedFramework: string
  detectedPackageManager: string
  detectedTestFramework: string
  totalCommands: number
}>> {
  try {
    const [templates, constitution] = await Promise.all([
      db.devProjectTemplate.count(),
      db.devConstitution.findMany(),
    ])

    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const r of constitution) {
      byType[r.type] = (byType[r.type] ?? 0) + 1
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1
    }

    const fw = frameworkDetection()
    const pm = packageManagerDetection()
    const tf = testFrameworkDetection()
    const cmds = commandDiscovery()

    return {
      ok: true,
      data: {
        totalTemplates: templates,
        totalConstitutionRules: constitution.length,
        byType,
        bySeverity,
        detectedFramework: fw.ok ? fw.data.name : "unknown",
        detectedPackageManager: pm.ok ? pm.data.name : "unknown",
        detectedTestFramework: tf.ok ? tf.data.name : "unknown",
        totalCommands: cmds.ok ? cmds.data.length : 0,
      },
    }
  } catch (e) {
    return { ok: false, error: "snapshot_failed", message: String(e) }
  }
}
