# Repository Guidelines

- Repo: https://github.com/openclaw/openclaw
- In chat replies, file references are repo-root relative (example: `src/telegram/index.ts:80`); never absolute paths or `~/...`.
- Do not edit `CODEOWNERS`-protected paths unless a listed owner explicitly asked or is reviewing with you — restricted surfaces, not drive-by cleanup.

## Operating Principle: More Context, Less Control

This file ships intent, invariants, and repo geography. It does not try to enumerate every procedure.

- Prefer stating **why** a boundary exists over listing every "don't do X" that follows — agents should derive the prohibitions from the invariant.
- When a rule can live in a scoped `AGENTS.md`, keep it there; root points, doesn't duplicate.
- Keep a rule here only if it's load-bearing and non-obvious (past incident, surprising default, third-party contract).
- If tempted to add a procedural rule, first check whether tightening an invariant or scoped guide would imply it.

## Repo Map

- `src/` = core (CLI in `src/cli`, commands in `src/commands`, web provider in `src/provider-web.ts`, infra in `src/infra`, media in `src/media`). Tests colocated as `*.test.ts`; e2e `*.e2e.test.ts`. Built output: `dist/`.
- Bundled workspace plugin tree = bundled plugins and the nearest reference surface for third-party plugin authors.
- Installers served from `https://openclaw.ai/*` live in sibling repo `../openclaw.ai` (`public/install.sh`, `public/install-cli.sh`, `public/install.ps1`).

Key boundaries — **scoped `AGENTS.md` owns the detail**:

| Boundary                                                                | Scoped guide                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Plugin/extension contract                                               | `extensions/AGENTS.md`                                       |
| Public Plugin SDK                                                       | `src/plugin-sdk/AGENTS.md`                                   |
| Channel internals, hot-path                                             | `src/channels/AGENTS.md`                                     |
| Plugin loading, registry, manifest, providers                           | `src/plugins/AGENTS.md`                                      |
| Typed gateway protocol                                                  | `src/gateway/protocol/AGENTS.md`                             |
| Shared test helpers                                                     | `test/helpers/AGENTS.md` + `test/helpers/channels/AGENTS.md` |
| Mintlify docs, i18n                                                     | `docs/AGENTS.md`                                             |
| Control UI i18n                                                         | `ui/AGENTS.md`                                               |
| Script runner, local-check lock, test/lint wrappers, missing-deps retry | `scripts/AGENTS.md`                                          |

Terminology: "plugin" / "plugins" in docs, UI, changelogs, contributor guidance. The workspace tree keeps "extension" in internal package layout to avoid rename churn.

Channels: when refactoring shared logic (routing, allowlists, pairing, command gating, onboarding, docs), consider **all** built-in + plugin channels (core: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/channels`, `src/routing`; plugin channels: Matrix, Zalo, ZaloUser, Voice Call, …). Adding channels/plugins/apps/docs → update `.github/labeler.yml` + matching GitHub labels.

## Architecture Invariants

Design intent — scoped guides apply these to concrete code.

- **Core is extension-agnostic.** Adding a bundled or third-party extension must not require unrelated core edits. Extension-owned compatibility (legacy repairs, detection, onboarding, auth, provider defaults) lives in plugin-owned contracts; prefer `openclaw doctor --fix` over startup/load-time migrations.
- **Plugin seams are versioned contracts.** Third-party plugins depend on them; changes must be documented, backwards-compatible, and additive where possible. Vendor-owned tools/settings live in the owning plugin — don't add provider-specific config to core `tools.*`.
- **Config contract stays aligned.** Exported types, zod schema, help/labels, generated metadata, baselines, and user-facing gateway payloads move together. Retired legacy keys come out of all public surfaces; compat only through `legacy.migrations.*` / config ingest / `openclaw doctor --fix`. `hooks.internal.entries` = canonical; `hooks.internal.handlers` = compat input only.
- **Gateway protocol changes are contract changes.** Additive evolution preferred; incompatible changes require explicit versioning, docs, and client/codegen follow-through.
- **Extension test coverage lives with the owning plugin.** Core tests reach bundled plugins only via `src/plugin-sdk/<id>.ts` facades, the plugin's `api.ts`, or `src/test-utils/bundled-plugin-public-surface.ts`. Shared helpers under `test/helpers/**` follow the same boundary — no `extensions/**` hardcoded imports, no plugin-local deep mocks kept there "because multiple tests use them."

Architecture direction (transitional compatibility acknowledged):

- Manifest-first control plane (discovery, validation, enablement, setup hints, activation planning are metadata-driven).
- Runtime execution stays separate — narrow targeted loaders, not broad registry materialization.
- Host loads plugins; plugins don't load host internals.

Plugin packaging anchors (load-bearing; agents get bitten otherwise):

- Install runs `npm install --omit=dev` in the plugin dir — runtime deps must live in `dependencies`.
- Avoid `workspace:*` in `dependencies` (npm install breaks). Put `openclaw` in `devDependencies` / `peerDependencies` — runtime resolves `openclaw/plugin-sdk` via jiti alias.
- Extension production code imports only `openclaw/plugin-sdk/*` plus local `api.ts` / `runtime-api.ts`; no deep-imports into core `src/**` or another extension's `src/**`.
- Bundled plugin id stays aligned across `openclaw.plugin.json:id`, workspace folder name, and package name (`@openclaw/<id>` or approved suffix). `openclaw.install.npmSpec` = package name; `openclaw.channel.id` = plugin id when present. Exceptions covered by the repo invariant test.

## Build, Test, Dev

- Node **22+**. `pnpm install` (also `bun install` — keep lockfile + Bun patching in sync). Prefer Bun for TS execution (`bun <file.ts>` / `bunx`). Run CLI: `pnpm openclaw …` or `pnpm dev`. Node runs built `dist/*`.
- Commands: `pnpm build` (type-check + build), `pnpm tsgo` (TS only), `pnpm check` (lint+format), `pnpm format[:fix]` (oxfmt), `pnpm test`. Mac packaging: `scripts/package-mac-app.sh`.
- Pre-commit: `prek install`. `FAST_COMMIT=1` skips the hook's `pnpm format`+`pnpm check` — use only when you've verified the touched surface another way.
- `scripts/AGENTS.md` owns wrapper/lock, missing-deps retry, local-check env knobs (`OPENCLAW_LOCAL_CHECK*`).

Gates:

- **Local loop**: `pnpm check` + any scoped test you actually need.
- **Landing bar for `main`**: `pnpm check` + `pnpm test`. **Hard gate**: `pnpm build` MUST pass when the change can affect build output, packaging, lazy-loading/module boundaries, or published surfaces.
- **CI**: `check`, `check-additional` (architecture/boundary guards — intentionally kept out of the local loop), `build-smoke`.
- Fast-commit mode: `--no-verify` ok for intermediate commits when equivalent checks already ran locally; still validate before final landing.
- Don't land with failing format/lint/type/build/test caused by or plausibly related to the change. Scoped tests don't permit ignoring plausibly related failures.
- If unrelated failures exist on latest `origin/main`, state that, report scoped tests you ran, and ask before broadening scope.
- `pnpm tsgo` triage: group failures by coherent surface/module/type contract; open the source-of-truth type first. Check `origin/main` before broad cleanup — some debt may already be fixed upstream.

Drift checks — commit the `.sha256` after gen:

- Config schema: `pnpm config:docs:gen` / `pnpm config:docs:check`.
- Plugin SDK API: `pnpm plugin-sdk:api:gen` / `pnpm plugin-sdk:api:check`.
- Baselines under `docs/.generated/` (`.sha256` tracked; JSON baselines gitignored, regenerated locally).

## Prompt Cache Stability

- Treat prompt-cache stability as correctness/perf-critical.
- Code assembling model/tool payloads from maps, sets, registries, plugin lists, MCP catalogs, filesystem, or network results must produce deterministic ordering before building the request.
- Don't rewrite older transcript/history bytes on every turn unless intentionally invalidating the cached prefix. Legacy cleanup/pruning/normalization/migration should preserve recent prompt bytes.
- When truncation is needed, mutate newest/tail content first so the cached prefix stays byte-identical.
- Cache-sensitive changes need a regression test proving turn-to-turn prefix stability — helper-local tests alone aren't enough.

## Coding Style (non-obvious guardrails)

TypeScript ESM, strict. Oxlint/Oxfmt. Schema (zod) at external boundaries (config, webhooks, CLI/JSON, persisted JSON, 3rd-party APIs). **OpenClaw** in headings; `openclaw` for CLI/paths/config keys. American English.

Incident-anchored guardrails (keep):

- **No prototype mutation** for sharing class behavior (`applyPrototypeMixins`, `Class.prototype.x = …`, exporting prototype for merges). Use inheritance/composition. If truly needed, stop and get approval. In tests, prefer per-instance stubs unless the test documents why.
- **Dynamic import boundary**: don't mix `await import("x")` with static `import … from "x"` for the same module in production paths. Lazy loading = dedicated `*.runtime.ts` boundary. After lazy/module-boundary refactors, check `pnpm build` for `[INEFFECTIVE_DYNAMIC_IMPORT]`.
- **Circular deps**: keep `pnpm check:import-cycles` + `pnpm check:madge-import-cycles` green.
- **Silent-branching sentinels**: avoid `?? 0` / empty-string / magic-string sentinels that change runtime meaning. New runtime control flow shouldn't branch on `error: string` / `reason: string` when a closed code union would do. Prefer `Result<T, E>` + discriminated unions where shape changes behavior.
- **Extension package imports**: don't self-import via `openclaw/plugin-sdk/<self>`; route through local `./api.ts` / `./runtime-api.ts`. Don't use relative imports that resolve outside the package root. `openclaw/plugin-sdk/<subpath>` is the only public cross-package contract — add a public subpath before reaching into `src/plugin-sdk/**` by relative path.
- **No `@ts-nocheck`** / broad lint suppressions without an explaining comment. Don't disable `no-explicit-any` — use real types, `unknown`, or a narrow adapter.

## Testing

- Vitest + V8 coverage (70% lines/branches/functions/statements). `*.test.ts` colocated; `*.e2e.test.ts` for e2e.
- Example model constants: prefer `sonnet-4.6`, `gpt-5.4`; update older Anthropic/GPT examples when you touch those tests.
- Clean up timers, env, globals, mocks, sockets, temp dirs, module state so `--isolate=false` stays green.
- **Agents MUST NOT modify baseline/inventory/ignore/snapshot/expected-failure files to silence failing checks without explicit approval.**
- **Test perf: import-dominated test time is a boundary bug.** Put expensive runtime fallback (snapshots, migration, installs, bootstrap) behind `*.runtime.ts` seams and mock the seam, not the broad `plugin-sdk/*` barrel. Detailed recipes (static vs `beforeAll` imports, `importOriginal` use, narrow runtime subpaths): `docs/help/testing.md`.
- Local debug + pool/worker knobs + live tests (`OPENCLAW_LIVE_TEST`, `LIVE`, `OPENCLAW_VITEST_POOL`, `OPENCLAW_VITEST_MAX_WORKERS`, Docker variants): `docs/help/testing.md`.

Changelog: user-facing only. Append to the end of the active version's `### Changes` / `### Fixes`. At most one contributor mention per line (prefer `Thanks @author`). Pure test-only changes skip entries unless they alter user-facing behavior.

## Release / PR / Git

- Releases + advisories: `$openclaw-release-maintainer`, `$openclaw-ghsa-maintainer`. **Publish always requires explicit approval.** Don't bump version numbers without operator consent.
- PRs: `$openclaw-pr-maintainer` (triage, review, close, search, land; auto-close labels, bug-fix evidence, GitHub comment/search footguns). Landing any PR follows `~/.codex/prompts/landpr.md`.
- Commits: `scripts/committer "<msg>" <file…>` — concise, action-oriented (`CLI: add verbose flag to send`); group related changes; avoid bundling unrelated refactors.
- Git: **no merge commits on `main`** — rebase. `git update-ref -d refs/heads/<branch>` when `-d/-D` is policy-blocked. Bulk PR close/reopen >5 needs explicit confirm with exact count + scope.
- **Beta release**: with a beta Git tag (`vYYYY.M.D-beta.N`), publish npm with matching beta suffix; plain versions on `--tag beta` get consumed/blocked.

## Security & Config

- Web provider creds: `~/.openclaw/credentials/` (rerun `openclaw login` if logged out).
- Pi sessions: `~/.openclaw/sessions/` (base dir not configurable). Session logs: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`.
- Env vars: `~/.profile`.
- Never commit real phone numbers, videos, or live configs — obvious placeholders only.
- Release flow: private [maintainer docs](https://github.com/openclaw/maintainers/blob/main/release/README.md); public policy: `docs/reference/RELEASING.md`. Signing/notary credentials are managed outside the repo.
- Mobile pairing: `ws://` allowed for private LAN (RFC 1918, link-local, mDNS `.local`, loopback); `wss://` required for Tailscale/public. **Out of scope**: reports treating cleartext `ws://` pairing over private LAN as a vulnerability without a trust-boundary bypass beyond passive same-LAN observation.
- `@buape/carbon` version edits are owner-only — don't change pins unless you are Shadow (`@thewilloftheshadow`) as verified by gh.
- Patched deps (`pnpm.patchedDependencies`): exact version (no `^`/`~`). Patching / overrides / vendored changes need explicit approval.

## Platform Notes

- Legacy config/service warnings → `openclaw doctor` (see `docs/gateway/doctor.md`).
- Skills: `$openclaw-parallels-smoke` (Parallels across macOS/Windows/Linux guests); `.agents/skills/parallels-discord-roundtrip/SKILL.md` for macOS Discord roundtrip.
- **macOS gateway**: menubar app only — no separate LaunchAgent. Restart via the OpenClaw Mac app or `scripts/restart-mac.sh`. Verify/kill: `launchctl print gui/$UID | grep openclaw`. Debug via the app, not ad-hoc tmux; kill temporary tunnels before handoff. Don't rebuild the macOS app over SSH.
- Never edit `node_modules` (updates overwrite). Local-only `.agents` ignores: `.git/info/exclude`.
- Adding a new `AGENTS.md` → also add a `CLAUDE.md` symlink.
- CLI UI: `src/cli/progress.ts` for progress, `src/terminal/table.ts` for status (`status --all` read-only, `status --deep` probes), `src/terminal/palette.ts` for colors — don't hand-roll.
- SwiftUI (iOS/macOS): prefer `Observation` (`@Observable`, `@Bindable`) over `ObservableObject`/`@StateObject`; migrate when touching related code.
- Connection providers: adding one = update every UI surface + onboarding/overview docs + status/config forms.
- A2UI bundle hash (`src/canvas-host/a2ui/.bundle.hash`) auto-regenerates via `pnpm canvas:a2ui:bundle`; commit as a separate commit.
- "Restart iOS/Android apps" = rebuild + relaunch; verify connected real devices before reaching for simulators.
- **Version bump locations** (for "bump version everywhere", **except** `appcast.xml` which is Sparkle-release-only): `package.json`, `apps/android/app/build.gradle.kts` (versionName+versionCode), `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist` (CFBundleShortVersionString+CFBundleVersion), `apps/macos/Sources/OpenClaw/Resources/Info.plist`, `docs/install/updating.md`, Peekaboo Xcode projects/Info.plists (MARKETING_VERSION+CURRENT_PROJECT_VERSION).
- When asked to open a "session" file, open Pi session logs (`~/.openclaw/agents/<id>/sessions/*.jsonl`) — use the `agent=<id>` from the Runtime line, not `sessions.json`. SSH via Tailscale for remote logs.

## Runbooks

- **exe.dev VMs**: `ssh exe.dev` → `ssh vm-name`. Update: `sudo npm i -g openclaw@latest`. Discord token: raw only, no `DISCORD_BOT_TOKEN=` prefix. Config: `openclaw config set gateway.mode=local`. Gateway restart: `pkill -9 -f openclaw-gateway || true; nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &`. Verify: `openclaw channels status --probe`, `ss -ltnp | rg 18789`, `tail -n 120 /tmp/openclaw-gateway.log`.
- **Signal / fly update**: `fly ssh console -a flawd-bot -C "bash -lc 'cd /data/clawd/openclaw && git pull --rebase origin main'"` then `fly machines restart e825232f34d058 -a flawd-bot`.
- **macOS unified logs**: `./scripts/clawlog.sh` (expects passwordless sudo for `/usr/bin/log`).
- **iOS Team ID**: `security find-identity -p codesigning -v` → Apple Development (…) TEAMID. Fallback: `defaults read com.apple.dt.Xcode IDEProvisioningTeamIdentifiers`.
- **Voice wake**: command stays `openclaw-mac agent --message "${text}" --thinking low` (`VoiceWakeForwarder` shell-escapes — no extra quotes). Ensure launchd PATH includes standard system paths + your pnpm bin (`$HOME/Library/pnpm`).

## Collaboration / Safety

- GitHub issue/PR: print the full URL at the end of the task.
- High-confidence answers only: verify in code, don't guess.
- Bug investigations: read relevant npm dep source + local code before concluding.
- **Multi-agent safety** — assume others may be working; keep unrelated WIP untouched:
  - No `git stash` (incl. `pull --rebase --autostash`), no worktree changes, no branch switches, no cross-cutting state changes — unless explicitly requested.
  - "Push" may `pull --rebase` (never discard others'). "Commit" = your changes only. "Commit all" = everything in grouped chunks.
  - Same-file coexistence is fine when safe; focus reports on your edits; avoid guard-rail disclaimers unless truly blocked. End with a brief "other files present" note only if relevant.
- Lint/format churn: formatting-only diffs auto-resolve; fold into the commit if commit/push was already requested; ask only for semantic changes.
- Tool schemas (google-antigravity): no `Type.Union` / `anyOf` / `oneOf` / `allOf`. Use `stringEnum` / `optionalStringEnum` and `Type.Optional(...)` instead of `... | null`. Top-level `{ type: "object", properties }`. Avoid raw `format` property names (reserved by some validators).
- External messaging surfaces (WhatsApp, Telegram): final replies only — no streaming/partial. Internal UIs/control channel OK.
- `openclaw message send` with `!`: use heredoc to avoid Bash escaping.
