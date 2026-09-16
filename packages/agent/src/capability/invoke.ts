import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { loadCapability } from "./catalog.js";
import { replayArtifact } from "../replay/engine.js";
import type { ReplayResult } from "../replay/result.js";
import { EvidenceLogger } from "../log/logger.js";
import { defaultAllowlist } from "../safety/allowlist.js";
import { requestIntervention } from "../escalation/intervention.js";

// ---------------------------------------------------------------------------
// The one function an agent-facing surface actually needs: "call this
// capability, by name, with these args." Everything it needs -- browser
// lifecycle, deterministic replay, safety gating, evidence, escalation on
// stuck -- is the same machinery replay/engine.ts and cli/replay.ts already
// use; this is a typed front door onto it, addressed by capability name
// instead of an artifact file path. This is what cli/capabilities.ts's
// `--invoke` calls, and it's exactly the call an AI agent's tool-use runtime
// would make after discovering the capability via toolSchema.ts.
// ---------------------------------------------------------------------------

export interface InvokeOptions {
  artifactsDir: string;
  evidenceRoot: string;
  name: string;
  params: Record<string, string | number | boolean>;
  approvedForUnattendedReplay?: boolean;
  headless?: boolean;
}

export async function invokeCapability(opts: InvokeOptions): Promise<ReplayResult> {
  const artifact = loadCapability(opts.artifactsDir, opts.name);
  const runId = `invoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const logger = new EvidenceLogger(opts.evidenceRoot, runId);
  logger.log("run_started", {
    kind: "invoke",
    capability: opts.name,
    version: artifact.version,
    params: opts.params,
  });

  const browser = await chromium.launch({ headless: opts.headless ?? false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(artifact.target.baseUrl, { waitUntil: "domcontentloaded" });

  try {
    const result = await replayArtifact({
      page,
      artifact,
      params: opts.params,
      allowlist: defaultAllowlist,
      logger,
      approvedForUnattendedReplay: opts.approvedForUnattendedReplay,
      onStuck: async ({ step, message, screenshotPath }) => {
        const outcome = await requestIntervention({
          page,
          logger,
          runId,
          capability: artifact.name,
          currentStep: step,
          reason: `${message} (screenshot: ${screenshotPath})`,
        });
        return outcome === "resumed" ? "resumed" : "abandon";
      },
    });
    logger.log("run_result", result as unknown as Record<string, unknown>);
    return result;
  } finally {
    await browser.close();
  }
}
