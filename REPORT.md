# Design Report

## 1. Architecture

**Stack, briefly:** TypeScript/Node (strong typing on the artifact schema, the evaluation's focal point, plus first-class Playwright support). **Claude** (`claude-sonnet-5`) via the raw `@anthropic-ai/sdk`, not an agent framework — its native multi-modal tool-calling is exactly the computer-use primitive needed, and calling it directly keeps the ~200-line agent loop auditable. **Playwright** over Puppeteer/Selenium — `getByRole`/`getByLabel` locators are accessibility-tree-native, which is the entire robustness story for a no-test-ID surface (§2), and it handles headed mode + native dialogs cleanly (load-bearing for §5). **Target app**: a small custom local app (`packages/mock-bank`) rather than a public sandbox — built to be the "hostile" legacy surface the brief describes (table layout, no test IDs) *and* to script runtime errors (not-found, permission-denied, validation, session expiry, slow load) on demand, which a public site can't offer; also sidesteps any ToS/rate-limit risk.

Two packages, one process — no services, no queues, no database; the brief discourages premature scaling infrastructure, and a single process is enough to demonstrate the abstractions. Four seams, each a plain function boundary:

- **Perceive** (`surface/perceive.ts`) — the live page → a role/accessible-name element list + screenshot. DOM/accessibility-tree based, not coordinate-based, because that survives a surface with no clean DOM.
- **Decide** (`discover/agentLoop.ts`) — observe→decide→act against the Anthropic API, bounded to `MAX_STEPS`, with a closed action vocabulary (click/type/select/navigate/extract/wait) mirrored 1:1 with the artifact schema's action union.
- **Act** (`surface/act.ts`, `surface/locate.ts`) — executes one action against a resolved `LocatorSpec`. Shared, unmodified, between discovery and replay, so "recorded flow" and "replayed flow" can never silently diverge.
- **Record → Replay** (`artifactBuilder.ts` → `replay/engine.ts`) — the artifact is built only from a narrow, structured transcript (`discover/transcript.ts`), not the raw LLM chat history, per 3.2's "decoupled from the raw model transcript." Replay is then a deterministic function of `(artifact, params)` with the model nowhere in its call graph.

Deliberate trade-off: locators use a small closed vocabulary (`role`, `label`, `text`, `css`), not an open-ended selector DSL — bounds what replay must execute (simpler, auditable) at the cost of expressiveness. Right trade given the brief's "stable UI, real runtime errors" framing.

## 2. Artifact schema

`artifact/schema.ts` (Zod, versioned). Fields, and why:

- **`steps[]`** — each `LocatorSpec` carries `primary` + `fallbacks[]` + a **`reasoning` string**, since the brief explicitly asks for "how each target element is identified, with your reasoning about robustness." A reviewer or calling agent can read *why* a locator was trusted, not just what it is.
- **`parameters[]` / `outputs[]`** — typed, named, described — the artifact reads as a callable function signature, not a recorded macro, per 3.2's "agent-invocable capability."
- **`knownOutcomes[]`** — the artifact's own error taxonomy: `code`, `category` (`business`/`recoverable`/`hard_failure`), a `detection` checkpoint, and for recoverable outcomes a bounded `recovery` action. The single most important field here — see §3.
- **`successCheckpoint`** — an explicit assertion of goal state, not an assumption the last action worked.
- **`policy.riskLevel` / `requiresApprovalToReplayUnattended`** — the artifact declares its own risk; replay enforces it (§6).
- **`discoveredFrom`** — provenance, kept as metadata *about* the artifact rather than embedded in its executable content.

**Data-cell locators are a special case.** A table cell whose text is the value being read (e.g. a balance) can't use that text as its own identity — it's different per record. `locatorFromElement` anchors these instead on the row's stable label cell (e.g. `"Savings"`) plus column position. Found by actually replaying against a second member and getting the wrong balance back — the first version conflated "clickable control identity" with "data cell content."

## 3. Determinism & error handling

Replay is a pure function of `(artifact, params)` — no model call anywhere in `replay/engine.ts`. Determinism rests on three things:

1. **Stable locators** — role/accessible-name first, text/CSS as fallbacks, resolved identically in discovery and replay.
2. **Canonicalized checkpoints** — the success checkpoint's URL pattern replaces each parameter's *discovered literal value* with a wildcard before regex-escaping the rest. Without this, an artifact discovered against member `12345` reports a hard failure for every other member despite every step succeeding — a real bug, caught by replaying against member `30500` and getting a false failure.
3. **A closed, three-way result contract** (`replay/result.ts`): `success` / `business_outcome` (code + description, e.g. `MEMBER_NOT_FOUND` — a legitimate answer, not a crash) / `hard_failure` (step, expected, observed, screenshot). The glossary calls conflating outcome-vs-failure "the most common design mistake here"; as distinct discriminated shapes, conflating them is a type error, not a discipline problem.

`knownOutcomes[]` is checked, in order, whenever a checkpoint fails or an action throws: a `business` match returns immediately; a `recoverable` match with a handler (`reauthenticate`, for session expiry) retries the *same step*, bounded to 2 attempts, never open-ended; anything unmatched becomes a screenshotted `hard_failure`, offered to `onStuck` (§5) before surfacing. Native `confirm()` dialogs auto-accept and log, rather than hang the run.

Tested against real failures: `evidence/` has a genuine `MEMBER_NOT_FOUND`, `PERMISSION_DENIED`, and a genuine unresolvable-locator hard failure that escalated and was abandoned (§5) — not synthetic cases.

Secondary — UI drift: given "stable UI, real runtime errors" rather than fast-moving, the design leans on the fallback chain over active drift *detection*. A per-artifact staleness signal (replay N times, track fallback usage) is built as a stretch goal (§7) but not yet acted on.

## 4. Heterogeneity & multi-tenant

**Surface abstraction.** The seam is `surface/{perceive,locate,act}.ts` vs. `artifact/schema.ts` + `replay/engine.ts` — the schema/engine know nothing about DOM or Playwright; a `LocatorSpec` is `{by, role|label|text|css, reasoning}`. For a **legacy web app** (framesets, nested tables), `perceive.ts` needs looser heuristics and frame-walking, but the schema doesn't change. For a **desktop app**, `by` grows a `desktopAutomationId`/accessibility-API variant, `act.ts` gets an OS-automation implementation instead of Playwright, and `target.surface` (already `web | legacy-web | desktop`) selects which implementation replay loads — steps/parameters/outputs/known-outcomes stay the same shape. Risk: the closed locator vocabulary may need a genuinely different `by` variant for desktop, but the primary+fallbacks+reasoning pattern holds.

**Multi-tenant reuse.** `artifact/appProfiles.ts` keys the known-outcome taxonomy by **`appId`** (vendor-product identity), not by tenant — every tenant running the same product shares the profile without a re-record. A tenant-specific override would layer *on top of* it (branding, an extra field, a moved button), keyed by `(appId, tenantId)`, merged at replay time — not built (design-only per the brief), but the seam is there. **Drift detection**: `resolveLocator` already reports which strategy/fallback resolved; a tenant increasingly falling through to its CSS fallback is drifting and worth reviewing, without re-recording. This is now actually measured by the stability stretch goal (§7). **Canonicalization**: `canonicalizeSuccessPath` already substitutes parameter values in the success-checkpoint URL; extending the same substitution to `navigate` action URLs is the natural next step (§7).

## 5. Escalation & handoff

**Detecting stuck** happens the same way in both places: during discovery, the model can call a `stuck` tool; during replay, any `hard_failure` not resolved by `knownOutcomes[]` is offered to an `onStuck` callback before terminating.

**Control-transfer model.** The browser is launched **headed**, deliberately — so "taking control" isn't a metaphor: the operator uses the *same window*, cookies, DOM state, with their own mouse/keyboard. No second session, nothing to transfer over a network — automation's whole side of the handoff is "stop issuing Playwright commands, don't resume until told to." `escalation/intervention.ts`: before-screenshot + full context (`runId`, `capability`, `currentStep`, `reason`, `url`) → `intervention_requested` → blocks on a terminal prompt (`resume`/`abandon`) → after-screenshot → `intervention_resolved`. The caller resumes the same step on `"resumed"`, or returns terminal on `"abandon"`.

**Real vs. mocked**, per the brief's own scope note (3.6, co-browsing console out of scope): the *mechanism* — pause, live session exposed, resume signal, evidence across the boundary — is real and demonstrated (`evidence/replay-*`: a genuine forced hard failure, escalated, abandoned, before/after screenshots, full event log). The *operator surface* is a terminal prompt + the already-visible window; `cli/operator.ts` is a read-only view over the evidence trail, not a live console. Not captured: a click-by-click diff of the operator's manual actions — needs real browser-side instrumentation, mocked rather than built (§7).

## 6. Safety

Two mechanisms, code-enforced identically in discovery and replay:

- **Allowlist** (`safety/allowlist.ts`) — explicit origins/routes/action-types. `assertUrlAllowed` runs on every `navigate` *before* the browser follows it, and again post-navigation; violations throw rather than proceed. Refuse-before-acting, not log-after.
- **Risk classification** — `irreversibleRoutePatterns` marks specific routes (opening a sub-account); an artifact that touched one gets `riskLevel: "irreversible"` and `requiresApprovalToReplayUnattended: true` automatically. Replay enforces this as a hard gate *before* the first step, unless `approvedForUnattendedReplay: true` is explicit — demonstrated in `evidence/` (blocked, then approved). Block-by-default rather than a runtime prompt, which would defeat "no human in the replay loop" for the common safe case.
- **Redaction** (`safety/redact.ts`) — password/secret/token-named fields wholesale-replaced; any string scanned for 6+ digit runs and masked to the last 4. Applied unconditionally by `log/logger.ts` to every log event.
- **Credential sourcing** — teller login read from `.env` (`TELLER_ID`/`TELLER_PASSWORD`) in every entry point, never a literal in source — the mock app doesn't validate them, but the pattern matters: a real capability replaying against a different tenant sources that tenant's credentials from a secrets store at run time, never from the artifact or the code.

**Limits, honestly**: the allowlist is static and hand-authored, not learned or audited; redaction is pattern-based, not a general PII classifier, and could both over- and under-redact. A deliberate scope choice for a project this size, not an oversight.

## 7. Cuts

**Stretch goals implemented** — two, for depth over breadth:

- **Agent-facing capability interface** (`capability/{catalog,invoke,toolSchema}.ts`, `cli/capabilities.ts`) — saved artifacts addressable as a named catalog, not file paths. `--list` projects each artifact's `parameters`/`outputs`/`description` into a tool definition (same shape as the discovery agent's own tool-calling) — can't drift from what replay accepts, since it's read straight off the artifact. `--invoke <name>` is a thin, typed front door onto the same replay engine/safety/evidence `cli/replay.ts` uses. The most direct demonstration of the brief's own framing: "the artifact becomes a reusable capability the AI agents can invoke on demand."
- **Multi-run stability** (`replay/stability.ts`, `cli/stability.ts`) — replays N times, reports outcome distribution plus per-step primary-vs-fallback locator resolution, aggregated from `locator_resolved` evidence events (`surface/act.ts`) every run now logs. Real result: 5/5 successful runs, 7/7 steps resolved via primary locator every time — a measured signal, not a design claim, and exactly the drift signal named in §4.

**What's left out:**

- **A real operator console** — out of scope per the brief; a terminal prompt + the live window stand in. Next: a small web UI viewing the live page (CDP screencasting), recording the operator's actual clicks as evidence.
- **`open_member_sub_account` wasn't discovery-recorded** — a hand-authored fixture (`discoveredFrom.runId: "fixture-hand-authored-for-engine-validation"`), exercising the multi-field form, `VALIDATION_ERROR`, and the approval gate, all verified working. Only one genuine discovery run was required and delivered (`lookup_member_savings_balance` — see below); with more time this one would also be recorded.
- **Drift is measured, not gated on** — nothing currently blocks unattended replay based on the stability signal. Wiring it into `requiresApprovalToReplayUnattended` (the "Confidence & approval" stretch, not attempted) is the natural next step.
- **Route canonicalization** covers the success checkpoint only, not general `navigate` URLs — a small extension of the same substitution.
- **No automated tests** — correctness was validated by actually running the system repeatedly, not a unit-test suite. `replay/engine.ts`'s outcome-matching and `locate.ts`'s fallback chain are the two places most worth covering first.
- **Redaction isn't a general PII classifier** (§6, not fixed here).
- **The discovery LLM still sees the raw credential value** — sourcing it from `.env` (§6) keeps it out of source, but the model still types it into the form, so it's sent to the LLM provider as part of the conversation. A production version would auto-fill credential fields outside the model's turn entirely, so the value never enters the prompt.

**Why this matters**: the brief is explicit that "the discovery run has to be real... we can't assess a description of it." Actually running it surfaced three genuine bugs a description-only submission would never catch: a tooling crash in the perception layer, an unhandled multi-tool-call model response, and — most importantly — two correctness bugs where artifact-building baked a *discovered literal value* (a cell's text, a URL segment) into what was supposed to be a generalized locator/checkpoint. All three fixed and re-verified by replaying the corrected artifact against three different members with three different real balances, plus not-found, permission-denied, and forced-escalation cases.
