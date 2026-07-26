# AGENTS.md

This file provides guidance to Code Agent when working with code in this repository.

## What this repository is

This is a tutorial repository, not an application. It contains:

- `README.md` + `chapters/` — a Chinese-language tutorial (split into one file per chapter) teaching programmers who are new to AI agents how to understand, use, and extend **Pi Agent** (`@earendil-works/pi-coding-agent`, an open-source, provider-agnostic coding-agent CLI). The tutorial has four parts:
  1. **Foundations** (Ch 1–4): Agent Loop concepts → installing/using `pi` CLI → daily usage with hands-on exercises
  2. **Hands-on Extensions** (Ch 5, 5b, 5c, 5d): three extension mechanisms overview → creating your first Prompt Template → first Skill → first Extension (two mini-labs: custom tool + event interception)
  3. **Practical Examples** (Ch 6a, 6b, 6c, 6d): graded examples from single-role subagent (~60 lines) → safe coder extension (~80 lines) → multi-role team (~230 lines) → SDK embedding (~50 lines)
  4. **Going Further** (Ch 7, 7b, Appendix): extension directions with code snippets → design patterns extracted from official 50+ examples → FAQ + framework comparison + official examples index

- `examples/level-3-multi-role/` — the tutorial's Level-3 payload: a runnable Pi Extension implementing a multi-role agent team (PM → Coder → Reviewer). This corresponds to Ch6c.

- `examples/` — additional runnable example code for the new chapters:
  - `level-0-prompt-template/` — Prompt Template examples (Ch 5b)
  - `level-0-skill/` — Skill example (Ch 5c)
  - `level-1-single-subagent/` — single-role subagent extension (Ch 6a)
  - `level-2-safe-coder/` — safe coder extension (Ch 6b)
  - `level-4-sdk-ci-reviewer/` — SDK CI review script (Ch 6d)

There is no build system, package manager lockfile, test suite, or CI in this repo — `package.json` files only declare `peerDependencies`/`dependencies` so the extensions can be installed as Pi packages; they are not meant to be `npm install`ed and run standalone.

## Working in this repo

- **There are no build/lint/test commands to run here.** Don't invent `npm run build`/`npm test` invocations — they don't exist. The only way to exercise extensions is inside an actual Pi CLI session (`pi`, then `/trust`, then the relevant command), which requires the real `@earendil-works/pi-coding-agent` package and a model API key/subscription — not available in this repo's sandbox.
- **Ad-hoc syntax/type checking**: if you need to verify TypeScript changes to any `.pi/extensions/*/index.ts` without the real Pi packages installed, stub the three imports (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox`) as minimal `.d.ts` files in a scratch `node_modules/` and run `tsc --noEmit` with `moduleResolution: "bundler"` against a copy of the file. This only catches syntax errors and gross type mistakes (the stubs are `any`-typed), not real API mismatches — treat a clean stub-check as "doesn't have typos," not "verified against the real SDK."
- **Keep `chapters/06c-multi-role-team.md` and `examples/level-3-multi-role/.pi/extensions/multi-role/index.ts` in sync.** That chapter's §6.3 embeds the extension's full source verbatim inside a fenced code block, and §6.1/§6.4/§6.5 (same file) plus §7 (`chapters/07-extending.md`) narrate specific behaviors of that code (the structured `submit_review` verdict, the `MAX_CODER_DELEGATIONS` circuit breaker, abort-signal wiring). If you change the extension's logic, update the corresponding prose and the embedded code block together — don't let them drift.
- **Similarly keep `examples/level-1-single-subagent/.pi/extensions/single-reviewer/index.ts` in sync with `chapters/06a-single-subagent.md`**, and `examples/level-2-safe-coder/.pi/extensions/safe-coder/index.ts` with `chapters/06b-safe-coder.md`, and `examples/level-4-sdk-ci-reviewer/ci-review.ts` with `chapters/06d-sdk-embed.md` — each chapter embeds its code verbatim.
- All prose in the tutorial (`README.md` and `chapters/*.md`) is Chinese; match that when editing.

## Chapter file naming convention

- `01` through `04` — foundations
- `05` — extensions overview; `05b`, `05c`, `05d` — hands-on chapters for the three mechanisms
- `06a` — single subagent; `06b` — safe coder; `06c` — multi-role team (was `06-multi-role-team.md`); `06d` — SDK embed
- `07` — going further; `07b` — design patterns reference
- `08` — appendix

## Architecture of the example extensions

### `examples/level-3-multi-role/.pi/extensions/multi-role/index.ts` (Ch6c, Level-3)

A single Pi Extension (default-exported factory receiving `ExtensionAPI`) that adds:
- **A `delegate` tool** — spins up role-specific `createAgentSession()` calls with `systemPromptOverride` and `tools` allowlists (`ROLES` map: `pm`, `coder`, `reviewer`).
- **A `/team <requirement>` command** — sends the Leader an instruction describing the pm → coder → reviewer → (loop on rejection) → approved workflow.
- **Role tool allowlists as safety boundary**: `pm` and `reviewer` only get read-only tools; only `coder` gets `write`/`edit`/`bash`.
- **Structured reviewer verdicts** via `submit_review({ verdict, comments })` custom tool injected only into reviewer sessions, captured via closure.
- **Circuit breaker**: module-scoped `coderDelegationCount` caps coder delegations (`MAX_CODER_DELEGATIONS`, 4), reset at each `/team` invocation.
- **Abort-signal propagation**: tool `execute`'s `signal` argument wired to `session.abort()`.
- Shared `ModelRuntime` memoized in a module-level promise.

### `examples/level-1-single-subagent/.pi/extensions/single-reviewer/index.ts` (Ch6a, Level-1)

Simplified version of the above — one reviewer role only, no orchestration loop, no circuit breaker, no structured verdict tool. Pure text output. Same `createAgentSession` + `subscribe` + `dispose` + abort signal pattern.

### `examples/level-2-safe-coder/.pi/extensions/safe-coder/index.ts` (Ch6b, Level-2)

No sub-agents. Uses `pi.on("tool_call")` to intercept `write`/`edit` (path protection) and `bash` (dangerous command confirmation). Uses `pi.appendEntry` for state persistence with `session_start`/`session_tree` reconstruction. `/safe` command toggles safe mode.

### `examples/level-4-sdk-ci-reviewer/ci-review.ts` (Ch6d, Level-4)

Not a Pi Extension — a standalone Node.js script using the SDK directly. Creates a read-only `createAgentSession`, subscribes to events, prompts with a git diff, outputs a review report, and exits with appropriate CI exit codes.
