import type { Page } from "playwright";
import type { ArtifactAction, LocatorSpec } from "../artifact/schema.js";
import { resolveLocator } from "./locate.js";
import { assertActionTypeAllowed, assertUrlAllowed, type AllowlistConfig } from "../safety/allowlist.js";
import type { EvidenceLogger } from "../log/logger.js";

// ---------------------------------------------------------------------------
// The shared action executor: given an ArtifactAction (the same closed
// vocabulary used in recorded steps), do it against a live Playwright page.
// Used verbatim by both discovery (each LLM-chosen action is executed and
// recorded through here) and replay (each saved step's action is replayed
// through here) -- there is exactly one code path that touches the browser.
//
// Native dialogs (e.g. the sub-account confirm() prompt) are handled by a
// page-level listener installed by the caller (see discover/agentLoop.ts and
// replay/engine.ts); this module just executes the action that may trigger one.
// ---------------------------------------------------------------------------

export interface ActionContext {
  page: Page;
  allowlist: AllowlistConfig;
  logger: EvidenceLogger;
  params: Record<string, string | number | boolean>;
  outputs: Record<string, string | number | boolean>;
}

// Route canonicalization: navigate URLs may contain {{param_name}} placeholders
// (e.g. "/members/{{member_id}}/sub-accounts/new"), filled in from the
// artifact's declared parameters at replay time. This is what lets a
// discovery run against one concrete member ID produce an artifact that
// replays against any member ID -- and is the same mechanism that would let
// a tenant-specific base path be swapped in without re-recording (see
// REPORT.md "Heterogeneity & multi-tenant").
function interpolate(template: string, params: Record<string, string | number | boolean>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in params)) throw new Error(`Missing parameter "${key}" referenced in navigate URL template.`);
    return String(params[key]);
  });
}

// resolveLocator already computes *which* strategy resolved a target
// (primary vs. a specific fallback) -- every call site was discarding that.
// Logging it here, keyed by stepId, is what a multi-run stability check
// (replay/stability.ts) aggregates into a per-step fallback-usage signal:
// a step that increasingly resolves via its CSS fallback instead of its
// primary role/name locator is drifting, well before it ever hard-fails.
async function resolveAndLog(
  ctx: ActionContext,
  target: LocatorSpec,
  actionType: string,
  stepId: string | undefined,
  timeoutMs?: number
) {
  const resolved = await resolveLocator(ctx.page, target, timeoutMs);
  if (stepId) {
    ctx.logger.log("locator_resolved", {
      stepId,
      actionType,
      usedStrategy: resolved.usedStrategy,
      usedFallbackIndex: resolved.usedFallbackIndex,
    });
  }
  return resolved;
}

export async function executeAction(
  action: ArtifactAction,
  ctx: ActionContext,
  stepId?: string
): Promise<void> {
  assertActionTypeAllowed(action.type, ctx.allowlist);

  switch (action.type) {
    case "navigate": {
      const resolvedPath = interpolate(action.url, ctx.params);
      const url = new URL(resolvedPath, ctx.page.url()).toString();
      assertUrlAllowed(url, ctx.allowlist);
      await ctx.page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    }
    case "click": {
      const { locator } = await resolveAndLog(ctx, action.target, action.type, stepId);
      await locator.click();
      return;
    }
    case "type": {
      const { locator } = await resolveAndLog(ctx, action.target, action.type, stepId);
      const value = action.paramRef ? String(ctx.params[action.paramRef] ?? "") : action.value ?? "";
      await locator.fill(value);
      return;
    }
    case "select": {
      const { locator } = await resolveAndLog(ctx, action.target, action.type, stepId);
      const value = action.paramRef ? String(ctx.params[action.paramRef] ?? "") : action.value ?? "";
      await locator.selectOption(value);
      return;
    }
    case "extract": {
      const { locator } = await resolveAndLog(ctx, action.target, action.type, stepId);
      const text = (await locator.textContent())?.trim() ?? "";
      ctx.outputs[action.outputRef] = text;
      return;
    }
    case "waitFor": {
      const { locator } = await resolveAndLog(ctx, action.target, action.type, stepId, action.timeoutMs);
      await locator.waitFor({ state: "visible", timeout: action.timeoutMs });
      return;
    }
  }
}
