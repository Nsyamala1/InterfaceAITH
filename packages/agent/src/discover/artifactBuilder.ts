import { randomUUID } from "node:crypto";
import type {
  CapabilityArtifact,
  ArtifactParameter,
  ArtifactOutput,
  ArtifactStep,
  LocatorSpec,
} from "../artifact/schema.js";
import type { InteractiveElement } from "../surface/perceive.js";
import type { DiscoveryTranscript } from "./transcript.js";
import { meridianTellerConsoleKnownOutcomes } from "../artifact/appProfiles.js";
import { classifyRisk, defaultAllowlist } from "../safety/allowlist.js";

export function locatorFromElement(el: InteractiveElement | undefined): LocatorSpec {
  if (!el || !el.name) {
    return {
      primary: { by: "css", css: el ? `${el.tag}:nth-of-type(${el.index + 1})` : "body" },
      fallbacks: [],
      reasoning:
        "No accessible name was available on this element (no label/aria-label/visible text), so structural CSS is the only option. Flagged as the least robust locator in this artifact.",
    };
  }

  // Data cells (role "cell", from a <td>) are the odd case: the accessible
  // "name" Playwright/ARIA reports for them is the cell's own dynamic VALUE
  // (e.g. "$8452.13"), not a stable identifier. Anchoring the locator on
  // that value would only ever find *that* balance again -- worthless for a
  // capability meant to run against a different member each time. Anchor
  // on the row's label cell instead (e.g. "Savings"), which reads the same
  // on every member's page, plus the column position within that row.
  if (el.role === "cell" && el.rowLabel && typeof el.cellIndex === "number") {
    const css = `tr:has-text(${JSON.stringify(el.rowLabel)}) >> td:nth-child(${el.cellIndex + 1})`;
    return {
      primary: { by: "css", css },
      fallbacks: [{ by: "role", role: el.role, name: el.name }],
      reasoning: `Data cell: its own text ("${el.name}") is the value being read, not a stable name, so it can't anchor the locator. Anchored instead on the row's label cell ("${el.rowLabel}") plus column position -- true for any record, not just the one open at discovery time. The exact role+value match from discovery is kept only as a last-resort fallback.`,
    };
  }

  return {
    primary: { by: "role", role: el.role, name: el.name },
    fallbacks: [
      { by: "text", text: el.name },
      { by: "css", css: `${el.tag}:nth-of-type(${el.index + 1})` },
    ],
    reasoning: `Role+accessible-name ("${el.role}"/"${el.name}") comes from real semantics (label association or visible button/link text), so it survives markup/CSS changes and requires no test IDs. Text-match and structural CSS are kept as fallbacks in case the element's role changes but its copy doesn't (or vice versa).`,
  };
}

export function buildArtifact(
  transcript: DiscoveryTranscript,
  opts: { name: string; description: string; version?: number }
): CapabilityArtifact {
  const parameters: ArtifactParameter[] = [];
  const outputs: ArtifactOutput[] = [];
  const seenParams = new Set<string>();
  const seenOutputs = new Set<string>();
  let sawIrreversible = false;

  const steps: ArtifactStep[] = transcript.entries.map((entry, i) => {
    const stepId = `step-${i + 1}`;
    let action = entry.action;

    if ((action.type === "type" || action.type === "select") && entry.isParam && entry.paramName) {
      if (!seenParams.has(entry.paramName)) {
        seenParams.add(entry.paramName);
        parameters.push({
          name: entry.paramName,
          type: "string",
          required: true,
          description: `Value for "${entry.targetElement?.name ?? entry.paramName}", supplied by the caller.`,
          example: action.value,
        });
      }
      action = { ...action, paramRef: entry.paramName, value: undefined };
    }

    if (action.type === "extract") {
      if (!seenOutputs.has(action.outputRef)) {
        seenOutputs.add(action.outputRef);
        outputs.push({
          name: action.outputRef,
          type: "string",
          description: entry.outputDescription ?? action.outputRef,
        });
      }
    }

    if (action.type === "navigate") {
      try {
        const path = new URL(action.url, transcript.baseUrl).pathname;
        if (classifyRisk(path, defaultAllowlist) === "irreversible") sawIrreversible = true;
      } catch {
        /* ignore */
      }
    }

    return {
      id: stepId,
      description: entry.reasoning,
      action,
      checkpoint: undefined,
    };
  });

  const escapedPath = canonicalizeSuccessPath(
    new URL(transcript.finalUrl, transcript.baseUrl).pathname,
    parameters
  );

  const now = new Date().toISOString();

  return {
    schemaVersion: "1.0",
    id: randomUUID(),
    name: opts.name,
    description: opts.description,
    version: opts.version ?? 1,
    createdAt: now,
    target: { appId: transcript.appId, surface: "web", baseUrl: transcript.baseUrl },
    parameters,
    outputs,
    steps,
    knownOutcomes: meridianTellerConsoleKnownOutcomes,
    successCheckpoint: { kind: "urlMatches", urlPattern: `^${escapedPath}$`, timeoutMs: 5000 },
    policy: {
      riskLevel: sawIrreversible ? "irreversible" : "safe",
      requiresApprovalToReplayUnattended: sawIrreversible,
    },
    discoveredFrom: { runId: transcript.runId, model: transcript.model, discoveredAt: now },
  };
}

// The raw final-URL path (e.g. "/members/12345") contains the literal
// parameter VALUE seen during this one discovery run. Baked in as-is, the
// success checkpoint could only ever verify success for that exact member
// again -- any other member_id would execute every step correctly and
// still be reported as a hard failure because the URL "didn't match".
// Replace each declared parameter's discovered literal value with a
// wildcard before regex-escaping the rest, so the pattern generalizes to
// whatever value the caller actually supplies at replay time.
function canonicalizeSuccessPath(rawPath: string, parameters: ArtifactParameter[]): string {
  const PARAM_MARKER = "@@PARAM@@";
  let path = rawPath;
  for (const p of parameters) {
    if (p.example) path = path.split(p.example).join(PARAM_MARKER);
  }
  return path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .split(PARAM_MARKER)
    .join("[^/]+");
}
