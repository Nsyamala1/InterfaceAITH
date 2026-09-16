import type { Page } from "playwright";
import type { CapabilityArtifact } from "../artifact/schema.js";
import { executeAction } from "../surface/act.js";
import { evaluateCheckpoint } from "../surface/checkpoint.js";
import type { AllowlistConfig } from "../safety/allowlist.js";
import { classifyRisk } from "../safety/allowlist.js";
import type { EvidenceLogger } from "../log/logger.js";
import type { ReplayResult } from "./result.js";

export interface ReplayOptions {
  page: Page;
  artifact: CapabilityArtifact;
  params: Record<string, string | number | boolean>;
  allowlist: AllowlistConfig;
  logger: EvidenceLogger;
  approvedForUnattendedReplay?: boolean;
  // Bounded, policy-checked recovery for the "reauthenticate" known-outcome
  // action (e.g. session/timeout expiry). Optional: if omitted, a matched
  // SESSION_EXPIRED-style outcome falls through to escalation instead of
  // silently retrying forever.
  reauthenticate?: (page: Page) => Promise<void>;
  // Called when replay hits a hard failure it cannot classify or recover
  // from, before returning the failure result -- the escalation seam.
  onStuck?: (info: { step: string; message: string; screenshotPath: string }) => Promise<"resumed" | "abandon">;
}

type StepOutcome =
  | { kind: "ok" }
  | { kind: "retry" } // recovered (reauthenticated or human fixed state); redo this same step
  | { kind: "terminal"; result: ReplayResult };

function validateParams(artifact: CapabilityArtifact, params: Record<string, unknown>): void {
  for (const p of artifact.parameters) {
    if (p.required && !(p.name in params)) {
      throw new Error(`Missing required parameter: ${p.name}`);
    }
  }
}

export async function replayArtifact(opts: ReplayOptions): Promise<ReplayResult> {
  const { page, artifact, params, allowlist, logger } = opts;

  validateParams(artifact, params);

  if (artifact.policy.requiresApprovalToReplayUnattended && !opts.approvedForUnattendedReplay) {
    return {
      status: "hard_failure",
      step: "policy_gate",
      expected: "artifact approved for unattended replay",
      observed: "artifact is unapproved and marked requiresApprovalToReplayUnattended",
      message: `Artifact "${artifact.name}" v${artifact.version} is not approved for unattended replay.`,
      stepsExecuted: 0,
    };
  }

  const outputs: Record<string, string | number | boolean> = {};
  const ctx = { page, allowlist, logger, params, outputs };

  // Auto-accept native dialogs (e.g. the sub-account confirm() prompt) but
  // log every occurrence -- this is the "unexpected confirmation dialog"
  // runtime condition called out in the brief, handled as a recoverable
  // condition rather than something that hangs the run.
  page.on("dialog", async (dialog) => {
    logger.log("dialog_handled", { message: dialog.message(), dialogType: dialog.type() });
    await dialog.accept();
  });

  let stepsExecuted = 0;
  const MAX_RETRIES_PER_STEP = 2;

  for (const step of artifact.steps) {
    logger.log("step_started", { stepId: step.id, description: step.description, action: step.action.type });

    if (step.action.type === "navigate") {
      try {
        const interpolated = step.action.url.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ""));
        if (classifyRisk(new URL(interpolated, page.url()).pathname, allowlist) === "irreversible") {
          logger.log("irreversible_step", { stepId: step.id });
        }
      } catch {
        /* best-effort logging only */
      }
    }

    let attempts = 0;
    for (;;) {
      attempts += 1;
      const outcome = await runStep(step, ctx, opts, stepsExecuted);
      if (outcome.kind === "ok") break;
      if (outcome.kind === "terminal") return outcome.result;
      // "retry": recovered, redo this step -- but bounded, never open-ended.
      if (attempts > MAX_RETRIES_PER_STEP) {
        const screenshotPath = logger.screenshotPath(`retry_exhausted_${step.id}`);
        await page.screenshot({ path: screenshotPath }).catch(() => {});
        return {
          status: "hard_failure",
          step: step.id,
          expected: step.description,
          observed: `step still failing after ${MAX_RETRIES_PER_STEP} recovery attempts`,
          message: `Exceeded max recovery attempts (${MAX_RETRIES_PER_STEP}) for step ${step.id}.`,
          screenshotPath,
          stepsExecuted,
        };
      }
    }

    stepsExecuted += 1;
    logger.log("step_result", { stepId: step.id, ok: true });
  }

  const finalOk = await evaluateCheckpoint(page, artifact.successCheckpoint);
  if (!finalOk) {
    const screenshotPath = logger.screenshotPath("success_checkpoint_failed");
    await page.screenshot({ path: screenshotPath });
    return {
      status: "hard_failure",
      step: "successCheckpoint",
      expected: JSON.stringify(artifact.successCheckpoint),
      observed: `url=${page.url()}`,
      message: "All steps executed but the artifact's success checkpoint was not satisfied.",
      screenshotPath,
      stepsExecuted,
    };
  }

  logger.log("run_result", { status: "success", outputs });
  return { status: "success", outputs, stepsExecuted };
}

async function runStep(
  step: CapabilityArtifact["steps"][number],
  ctx: { page: Page; allowlist: AllowlistConfig; logger: EvidenceLogger; params: Record<string, unknown>; outputs: Record<string, unknown> },
  opts: ReplayOptions,
  stepsExecuted: number
): Promise<StepOutcome> {
  try {
    await executeAction(step.action, ctx as never, step.id);
  } catch (err) {
    return handleFailure(step.id, step.description, err, opts, stepsExecuted);
  }

  if (step.checkpoint) {
    const ok = await evaluateCheckpoint(ctx.page, step.checkpoint);
    if (!ok) {
      return handleFailure(step.id, step.description, new Error("step checkpoint not satisfied"), opts, stepsExecuted);
    }
  }

  return { kind: "ok" };
}

async function handleFailure(
  stepId: string,
  stepDescription: string,
  err: unknown,
  opts: ReplayOptions,
  stepsExecuted: number
): Promise<StepOutcome> {
  const { page, artifact, logger } = opts;
  const message = err instanceof Error ? err.message : String(err);

  for (const outcome of artifact.knownOutcomes) {
    const matches = await evaluateCheckpoint(page, outcome.detection);
    if (!matches) continue;

    logger.log("known_outcome_matched", { stepId, code: outcome.code, category: outcome.category });

    if (outcome.category === "business") {
      return {
        kind: "terminal",
        result: {
          status: "business_outcome",
          code: outcome.code,
          description: outcome.description,
          outputs: opts.params as Record<string, string | number | boolean>,
          stepsExecuted,
        },
      };
    }

    if (outcome.category === "recoverable" && outcome.recovery?.action === "reauthenticate" && opts.reauthenticate) {
      logger.log("recovery_attempted", { stepId, action: "reauthenticate" });
      await opts.reauthenticate(page);
      return { kind: "retry" };
    }

    if (outcome.category === "recoverable") {
      // Declared recoverable, but this replay wasn't given a handler for it
      // (e.g. no `reauthenticate` callback supplied). Don't pretend to
      // recover -- fall through to escalation like any other stuck state.
      logger.log("recovery_unavailable", { stepId, code: outcome.code });
    }

    if (outcome.category === "hard_failure") break;
  }

  const screenshotPath = logger.screenshotPath(`failure_${stepId}`);
  await page.screenshot({ path: screenshotPath }).catch(() => {});
  logger.log("hard_failure", { stepId, message, screenshotPath });

  if (opts.onStuck) {
    const decision = await opts.onStuck({ step: stepId, message, screenshotPath });
    if (decision === "resumed") {
      logger.log("resumed_after_escalation", { stepId });
      return { kind: "retry" };
    }
  }

  return {
    kind: "terminal",
    result: {
      status: "hard_failure",
      step: stepId,
      expected: stepDescription,
      observed: message,
      message,
      screenshotPath,
      stepsExecuted,
    },
  };
}
