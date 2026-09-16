import "../env.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";
import { runDiscovery } from "../discover/agentLoop.js";
import { buildArtifact } from "../discover/artifactBuilder.js";
import { EvidenceLogger } from "../log/logger.js";
import { defaultAllowlist } from "../safety/allowlist.js";
import { CapabilityArtifactSchema } from "../artifact/schema.js";

// Usage:
//   npm run discover -- --goal "look up member 12345 and read their current savings balance" \
//     --name lookup_member_savings_balance --target http://localhost:3000

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required argument ${flag}`);
  }
  return process.argv[i + 1];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Discovery requires a real LLM call.");
  }

  const goal = arg("--goal");
  const name = arg("--name");
  const baseUrl = arg("--target", "http://localhost:3000");
  const appId = arg("--app-id", "meridian-teller-console");
  const description = arg("--description", goal);

  const runId = `discover-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const evidenceRoot = path.resolve(process.cwd(), "..", "..", "evidence");
  const logger = new EvidenceLogger(evidenceRoot, runId);
  logger.log("run_started", { kind: "discovery", goal, baseUrl, appId });

  const browser = await chromium.launch({ headless: process.env.HEADLESS === "true" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const result = await runDiscovery({
      page,
      goal,
      appId,
      baseUrl,
      allowlist: defaultAllowlist,
      logger,
      runId,
    });

    if (!result.success) {
      logger.log("run_result", { status: "failed" });
      console.error("Discovery run did not complete successfully. See evidence log for detail.");
      process.exitCode = 1;
      return;
    }

    const artifact = buildArtifact(result.transcript, { name, description });
    const validated = CapabilityArtifactSchema.parse(artifact);

    const artifactsDir = path.resolve(process.cwd(), "..", "..", "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    const outPath = path.join(artifactsDir, `${name}.v${validated.version}.json`);
    fs.writeFileSync(outPath, JSON.stringify(validated, null, 2));

    logger.log("run_result", { status: "success", artifactPath: outPath });
    console.log(`Discovery succeeded. Artifact written to ${outPath}`);
    console.log(`Evidence written to ${logger.runDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
