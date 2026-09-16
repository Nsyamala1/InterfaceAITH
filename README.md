# Computer-Use Automation System

An LLM ("computer use") agent that discovers how to complete a goal against a real web application, records the successful run as a typed, versioned, reusable **capability artifact**, and replays that artifact deterministically — without the model in the loop — on demand, with structured error handling and human escalation when it gets stuck.

Target surface: **Meridian Credit Union — Teller Console**, a small local legacy-style server-rendered banking app (`packages/mock-bank`) built specifically to exercise the interesting problems: no test IDs, table-based layout, session expiry, permission denial, validation errors, not-found records, and one irreversible action (opening a sub-account).

See [`REPORT.md`](./REPORT.md) for the design write-up (architecture, schema, determinism/error handling, multi-tenant story, escalation model, safety model, cuts).

## Setup

Requires Node 20+.

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Anthropic API key (only needed for **discovery** — replay never calls the model):

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY
```

`.env` variables:

| Variable | Required for | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | `discover` only | — (throws if unset) |
| `ANTHROPIC_MODEL` | `discover` only | `claude-sonnet-5` |
| `HEADLESS` | all commands | `false` (a visible browser window, so a human can actually see/take over the live session — see REPORT.md §5) |
| `TELLER_ID` / `TELLER_PASSWORD` | `discover`, `replay` (session-expiry recovery), `capabilities --invoke` | `teller1` / `demo-pass123` — throws if unset |

The mock-bank's login doesn't actually validate these against anything (any non-empty value works — see `packages/mock-bank/src/server.js`), so they aren't real secrets. They're still sourced from `.env` rather than hardcoded in source, matching how a real capability would source per-tenant teller credentials from a secrets store at run time rather than embedding a literal value.

## A note on evaluating this without an API key

No API key is committed here, and it shouldn't be — a key exposed in a public repo gets scraped and abused within minutes. That doesn't block evaluation, though:

- The discovery run is judged by its **evidence**, not by re-executing it. `evidence/discover-*/log.jsonl` (every model tool-call, reasoning, and action) plus 8 real screenshots of the live app *are* the proof it happened — per the assignment, that's the intended way to assess it ("we can't assess a description of it," not "re-run it yourself").
- **Replay needs no credentials at all.** `npm run mock-bank` + `npm run replay -- ...` reproduces the deterministic path live, with zero setup beyond Node — this is the part meant to be run directly.
- To re-run discovery itself, drop your own `ANTHROPIC_API_KEY` into `.env` (see Setup above) — same as any project that calls a paid API.

## Running without live services

- **Replay never touches the LLM or the network beyond the target app.** It only needs the mock-bank running locally — no API key required.
- **Discovery requires both** a running mock-bank and a real `ANTHROPIC_API_KEY` — per the assignment, the discovery run has to be genuinely LLM-driven, so there is no offline/mocked path for it.
- The target app itself is fully local (`packages/mock-bank`, in-memory data, no external calls), so nothing here depends on external services other than the Anthropic API for discovery.

## Demo path

**1. Start the target app** (leave running in its own terminal):

```bash
npm run mock-bank
```

This serves the Teller Console at `http://localhost:3000`. Login credentials come from `.env` (`TELLER_ID` / `TELLER_PASSWORD`, defaults above) — the mock app accepts any non-empty value, so these aren't real secrets, but they're still config, not hardcoded.

**2. Run the agent on a goal** (genuine LLM-driven discovery — opens a real, visible browser window):

```bash
npm run discover -- --goal "look up member 12345 and read their current savings balance" \
  --name lookup_member_savings_balance
```

On success this writes:
- `artifacts/lookup_member_savings_balance.v1.json` — the capability artifact
- `evidence/discover-<runId>/log.jsonl` + `screenshots/` — full evidence of the run

**3. Replay the resulting artifact deterministically** (no LLM call):

```bash
npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json \
  --params '{"member_id":"12345"}'
```
*(run from `packages/agent`; from the repo root use `npm run replay --workspace packages/agent -- --artifact ../../artifacts/... --params '...'`)*

This re-runs the same 7 steps with stable locators, verifies the success checkpoint, and returns:
```json
{ "status": "success", "outputs": { "savings_balance": "$8452.13" }, "stepsExecuted": 7 }
```

Try it against a different member to see the artifact generalize (not just replay the one recorded value):

```bash
npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json --params '{"member_id":"30500"}'
npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json --params '{"member_id":"40404"}'   # business outcome: not found
npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json --params '{"member_id":"90001"}'   # business outcome: permission denied
npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json --params '{"member_id":""}'       # hard failure -> human escalation demo
```

The last one (`member_id:""`) deliberately drives the flow to a state the artifact's known-outcome taxonomy doesn't cover, triggering escalation: the run pauses on the live browser session and prompts in the terminal —

```
=== HUMAN INTERVENTION REQUESTED ===
Type "resume" to hand control back to automation, or "abandon" to stop the run:
```

At that point you (or, non-interactively, `echo "resume" | npm run replay -- ...`) can drive the same live browser window by hand, then type `resume` to hand control back, or `abandon` to stop the run. See `evidence/replay-*` for a captured example of this trail (failure screenshot, escalation before/after screenshots, resolution).

**4. A second capability** — a multi-field form with an irreversible action, opening a new sub-account — is included as a hand-authored fixture artifact (`artifacts/open_member_sub_account.v1.json`), used to validate the replay engine's handling of parameterized forms, validation errors, and the unattended-replay approval gate for irreversible actions (see REPORT.md §7, "Cuts", for why this one wasn't also discovery-recorded):

```bash
# blocked: irreversible artifacts require explicit approval to replay unattended
npm run replay -- --artifact ../../artifacts/open_member_sub_account.v1.json \
  --params '{"member_id":"12345","account_type":"savings","initial_deposit":"100"}'

# approved
npm run replay -- --artifact ../../artifacts/open_member_sub_account.v1.json \
  --params '{"member_id":"12345","account_type":"savings","initial_deposit":"100"}' --approve-unattended

# business outcome: validation error
npm run replay -- --artifact ../../artifacts/open_member_sub_account.v1.json \
  --params '{"member_id":"12345","account_type":"savings","initial_deposit":"abc"}' --approve-unattended
```

## Stretch: agent-facing capability catalog

Saved artifacts are also addressable as a catalog of named, typed capabilities — the shape an AI agent's tool-use runtime would actually consume, not just a file path to replay:

```bash
# List every saved capability as a tool definition (name, description, typed input_schema)
npm run capabilities -- --list

# Invoke one by name (looks it up in the catalog, replays it deterministically)
npm run capabilities -- --invoke lookup_member_savings_balance --params '{"member_id":"12345"}'
```

`--list` projects each artifact's own `parameters`/`outputs`/`description` into a tool definition (`capability/toolSchema.ts`) — it can never drift from what replay actually accepts, since it's derived from the same artifact, not authored separately. `--invoke` (`capability/invoke.ts`) is a thin, typed front door onto the same replay engine, safety gating, and evidence logging as `npm run replay`, just addressed by capability name instead of a file path.

## Stretch: multi-run stability check

Replays the same artifact N times and reports a stability signal: outcome distribution across runs, plus — per step — how often each locator resolved via its primary strategy vs. a fallback (aggregated from `locator_resolved` events every run already logs to its evidence). A step that starts resolving via fallback instead of primary is drifting, well before it ever hard-fails outright.

```bash
npm run stability -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json \
  --params '{"member_id":"12345"}' --n 5
```

Real output from this repo's own `evidence/stability-summary-*.json`: 5/5 runs succeeded, and every one of the 7 steps resolved via its primary locator on every run (zero fallback usage) — a concrete, measured robustness signal, not just a design claim.

## Other commands

```bash
npm run operator   # read-only view of intervention requests captured in evidence/
npm run build       # typecheck (packages/agent)
```

## Repo layout

```
packages/
  agent/        # discovery loop, replay engine, artifact schema, safety, escalation, logging (TypeScript, Playwright)
  mock-bank/    # local legacy-style target app (Express, server-rendered, no test IDs)
artifacts/      # saved capability artifacts (the reusable output of discovery)
evidence/       # per-run structured logs + screenshots, for both discovery and replay runs
```
