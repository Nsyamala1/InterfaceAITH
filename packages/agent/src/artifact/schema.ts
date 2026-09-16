import { z } from "zod";

// ---------------------------------------------------------------------------
// Locator: how a step finds the control it acts on.
//
// `primary` is tried first; `fallbacks` are tried in order if it fails. Every
// locator carries `reasoning` so a human reviewer can judge robustness without
// re-deriving it -- this is the field the brief explicitly asks for ("how each
// target element/control is identified, with your reasoning about robustness").
//
// Strategy preference, most to least stable on a legacy no-test-id surface:
//   role   - ARIA role + accessible name (from <label>, button text, etc.).
//            Survives markup/CSS rewrites; breaks only if visible copy changes.
//   label  - form field associated <label> text. Same stability profile as role.
//   text   - exact visible text content of a link/button/cell.
//   css    - structural CSS selector. Last resort: brittle under markup changes,
//            but sometimes the only option on a legacy table layout.
// ---------------------------------------------------------------------------
const LocatorStrategySchema = z.enum(["role", "label", "text", "css"]);

const LocatorRefSchema = z.object({
  by: LocatorStrategySchema,
  // For "role": the ARIA role, e.g. "button", "textbox", "link", "combobox".
  role: z.string().optional(),
  // For "role"/"label": the accessible name / label text.
  name: z.string().optional(),
  // For "text": exact or substring visible text to match.
  text: z.string().optional(),
  // For "css": a CSS selector, used only when no accessible strategy exists.
  css: z.string().optional(),
});

const LocatorSpecSchema = z.object({
  primary: LocatorRefSchema,
  fallbacks: z.array(LocatorRefSchema).default([]),
  reasoning: z.string(),
});
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

// ---------------------------------------------------------------------------
// Actions a replayed step can perform. Kept to a small, closed set so the
// replay engine can execute every action type deterministically -- there is
// no "do whatever the model decides" step in replay.
// ---------------------------------------------------------------------------
const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({ type: z.literal("click"), target: LocatorSpecSchema }),
  z.object({
    type: z.literal("type"),
    target: LocatorSpecSchema,
    // Either a literal value or a reference to a declared input parameter.
    value: z.string().optional(),
    paramRef: z.string().optional(),
  }),
  z.object({
    type: z.literal("select"),
    target: LocatorSpecSchema,
    value: z.string().optional(),
    paramRef: z.string().optional(),
  }),
  z.object({
    type: z.literal("extract"),
    target: LocatorSpecSchema,
    // Name of the declared output this step's text content is written to.
    outputRef: z.string(),
  }),
  z.object({
    type: z.literal("waitFor"),
    target: LocatorSpecSchema,
    timeoutMs: z.number().default(5000),
  }),
]);
export type ArtifactAction = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Checkpoint: an assertion that the step (or the whole run) actually reached
// the expected state, rather than assuming the previous action worked.
// ---------------------------------------------------------------------------
const CheckpointSchema = z.object({
  kind: z.enum(["urlMatches", "elementVisible", "elementNotVisible", "textContains"]),
  urlPattern: z.string().optional(),
  target: LocatorSpecSchema.optional(),
  text: z.string().optional(),
  timeoutMs: z.number().default(5000),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

const StepSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: ActionSchema,
  // Verified after the action executes. If it fails, this step is a hard
  // failure unless a knownOutcome's detection matches first (see below).
  checkpoint: CheckpointSchema.optional(),
});
export type ArtifactStep = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------
// Known outcomes: the artifact's declared error taxonomy. Checked, in order,
// whenever a step's checkpoint fails or an action errors. This is what lets
// replay tell "no such member" (a legitimate answer) apart from "the button
// moved" (a bug) apart from "the network died" (retry).
// ---------------------------------------------------------------------------
const KnownOutcomeSchema = z.object({
  code: z.string(), // e.g. "MEMBER_NOT_FOUND"
  category: z.enum(["business", "recoverable", "hard_failure"]),
  description: z.string(),
  // How to recognize this outcome occurred, checked against current page state.
  detection: CheckpointSchema,
  // For category "recoverable" only: what replay should do before giving up.
  recovery: z
    .object({
      action: z.enum(["retry_step", "reauthenticate", "dismiss_dialog"]),
      maxAttempts: z.number().default(1),
    })
    .optional(),
});
export type KnownOutcome = z.infer<typeof KnownOutcomeSchema>;

const ParameterSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean().default(true),
  description: z.string(),
  example: z.string().optional(),
});
export type ArtifactParameter = z.infer<typeof ParameterSchema>;

const OutputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string(),
});
export type ArtifactOutput = z.infer<typeof OutputSchema>;

// ---------------------------------------------------------------------------
// Policy: the capability's own declared risk level and the action types it
// is permitted to perform. Cross-checked against the global allowlist
// (see safety/allowlist.ts) at both record time and replay time.
// ---------------------------------------------------------------------------
const PolicySchema = z.object({
  riskLevel: z.enum(["safe", "sensitive", "irreversible"]),
  requiresApprovalToReplayUnattended: z.boolean().default(false),
});

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  name: z.string(), // stable machine name, e.g. "lookup_member_savings_balance"
  description: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(), // ISO 8601
  target: z.object({
    appId: z.string(), // logical app identity, stable across tenants/instances
    surface: z.enum(["web", "legacy-web", "desktop"]).default("web"),
    baseUrl: z.string(),
  }),
  parameters: z.array(ParameterSchema),
  outputs: z.array(OutputSchema),
  steps: z.array(StepSchema),
  knownOutcomes: z.array(KnownOutcomeSchema),
  successCheckpoint: CheckpointSchema,
  policy: PolicySchema,
  // Provenance: which discovery run produced this artifact, kept separate
  // from the artifact body itself (requirement: decoupled from raw transcript).
  discoveredFrom: z.object({
    runId: z.string(),
    model: z.string(),
    discoveredAt: z.string(),
  }),
});
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;

export function parseArtifact(json: unknown): CapabilityArtifact {
  return CapabilityArtifactSchema.parse(json);
}
