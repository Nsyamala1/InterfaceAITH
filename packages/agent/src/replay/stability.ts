import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import type { CapabilityArtifact } from "../artifact/schema.js";
import { replayArtifact } from "./engine.js";
import { EvidenceLogger } from "../log/logger.js";
import { defaultAllowlist } from "../safety/allowlist.js";

// ---------------------------------------------------------------------------
// Multi-run stability signal (brief, Section 8: "replay N times and report a
// stability/flakiness signal"). Two things are aggregated across N fresh
// replay runs:
//
//   1. Outcome distribution -- success / business outcome (by code) / hard
//      failure. A capability that's flaky shows up as a non-100% success
//      rate even when nothing about the artifact itself changed between runs.
//   2. Per-step locator strategy usage -- which fallback (if any) resolved
//      each step, aggregated from the "locator_resolved" events act.ts now
//      logs on every run (see surface/act.ts#resolveAndLog). A step that's
//      increasingly resolving via a fallback instead of its primary locator
//      is drifting, and this is the earliest signal of that -- well before
//      it ever hard-fails outright. This is also the signal REPORT.md's
//      "Heterogeneity & multi-tenant" section names as the natural way to
//      detect per-tenant drift without re-recording.
//
// Each run gets its own real evidence/<runId>/ directory like any other
// replay -- this reuses the exact same replay engine, not a separate
// simulation, so the signal reflects genuine runs against the live app.
// ---------------------------------------------------------------------------

export interface StepLocatorStats {
  stepId: string;
  primary: number;
  fallback: Record<number, number>; // fallbackIndex -> times that fallback resolved
}

export interface StabilityReport {
  n: number;
  successCount: number;
  businessOutcomeCounts: Record<string, number>;
  hardFailureCount: number;
  successRate: number;
  perStep: StepLocatorStats[];
  runs: Array<{ runId: string; status: string; detail?: string }>;
}

export interface StabilityOptions {
  artifact: CapabilityArtifact;
  params: Record<string, string | number | boolean>;
  n: number;
  evidenceRoot: string;
  headless?: boolean;
  approvedForUnattendedReplay?: boolean;
}

export async function runStabilityCheck(opts: StabilityOptions): Promise<StabilityReport> {
  const stepStats = new Map<string, StepLocatorStats>();
  for (const step of opts.artifact.steps) {
    stepStats.set(step.id, { stepId: step.id, primary: 0, fallback: {} });
  }

  const runs: StabilityReport["runs"] = [];
  let successCount = 0;
  const businessOutcomeCounts: Record<string, number> = {};
  let hardFailureCount = 0;

  for (let i = 0; i < opts.n; i++) {
    const runId = `stability-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const logger = new EvidenceLogger(opts.evidenceRoot, runId);
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(opts.artifact.target.baseUrl, { waitUntil: "domcontentloaded" });

    try {
      const result = await replayArtifact({
        page,
        artifact: opts.artifact,
        params: opts.params,
        allowlist: defaultAllowlist,
        logger,
        approvedForUnattendedReplay: opts.approvedForUnattendedReplay,
      });

      if (result.status === "success") {
        successCount++;
        runs.push({ runId, status: result.status });
      } else if (result.status === "business_outcome") {
        businessOutcomeCounts[result.code] = (businessOutcomeCounts[result.code] ?? 0) + 1;
        runs.push({ runId, status: result.status, detail: result.code });
      } else {
        hardFailureCount++;
        runs.push({ runId, status: result.status, detail: result.step });
      }
    } finally {
      await browser.close();
    }

    for (const event of readLocatorResolvedEvents(opts.evidenceRoot, runId)) {
      const stats = stepStats.get(event.stepId);
      if (!stats) continue;
      if (event.usedFallbackIndex === null || event.usedFallbackIndex === undefined) {
        stats.primary++;
      } else {
        stats.fallback[event.usedFallbackIndex] = (stats.fallback[event.usedFallbackIndex] ?? 0) + 1;
      }
    }
  }

  return {
    n: opts.n,
    successCount,
    businessOutcomeCounts,
    hardFailureCount,
    successRate: successCount / opts.n,
    perStep: Array.from(stepStats.values()),
    runs,
  };
}

function readLocatorResolvedEvents(
  evidenceRoot: string,
  runId: string
): Array<{ stepId: string; usedFallbackIndex: number | null | undefined }> {
  const logPath = path.join(evidenceRoot, runId, "log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.kind === "locator_resolved");
}
