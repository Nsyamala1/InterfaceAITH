import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";
import { replayArtifact } from "../replay/engine.js";
import { CapabilityArtifactSchema } from "../artifact/schema.js";
import { EvidenceLogger } from "../log/logger.js";
import { defaultAllowlist } from "../safety/allowlist.js";
import { requestIntervention } from "../escalation/intervention.js";

// Usage:
//   npm run replay -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json \
//     --params '{"member_id":"12345"}'
//   npm run replay -- --artifact ... --params '{"member_id":"40404"}'   # business outcome: not found
//   npm run replay -- --artifact ... --params '{"member_id":"90001"}'  # business outcome: permission denied
//   npm run replay -- --artifact ... --params '{"member_id":"66666"}'  # recoverable: session expiry
//   npm run replay -- --artifact ... --escalate                        # force a hard failure into escalation, for demo

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[i + 1];
}

async function main() {
  const artifactPath = arg("--artifact");
  const paramsJson = arg("--params", "{}");
  const approve = process.argv.includes("--approve-unattended");
  const forceEscalate = process.argv.includes("--escalate");

  const raw = JSON.parse(fs.readFileSync(path.resolve(artifactPath), "utf-8"));
  const artifact = CapabilityArtifactSchema.parse(raw);
  const params = JSON.parse(paramsJson);

  const runId = `replay-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const evidenceRoot = path.resolve(process.cwd(), "..", "..", "evidence");
  const logger = new EvidenceLogger(evidenceRoot, runId);
  logger.log("run_started", { kind: "replay", artifactName: artifact.name, artifactVersion: artifact.version, params });

  const browser = await chromium.launch({ headless: process.env.HEADLESS === "true" });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(artifact.target.baseUrl, { waitUntil: "domcontentloaded" });

  try {
    const result = await replayArtifact({
      page,
      artifact,
      params,
      allowlist: defaultAllowlist,
      logger,
      approvedForUnattendedReplay: approve,
      reauthenticate: async (page) => {
        // Mock app's dummy auth: any non-empty credentials work. Standing in
        // for a real re-auth flow (e.g. refreshing a token, re-establishing
        // an SSO session) -- the point being demonstrated is that the engine
        // detects the session-expired condition and drives a bounded,
        // declared recovery step rather than treating it as a hard failure.
        await page.goto(artifact.target.baseUrl, { waitUntil: "domcontentloaded" });
        await page.getByLabel("Teller ID").fill("teller1");
        await page.getByLabel("Password").fill("demo-pass123");
        await page.getByRole("button", { name: "Log In" }).click();
      },
      onStuck: async ({ step, message, screenshotPath }) => {
        if (!forceEscalate && process.env.AUTO_ABANDON_ON_STUCK === "true") return "abandon";
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
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "hard_failure") process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
