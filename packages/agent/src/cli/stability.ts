import path from "node:path";
import fs from "node:fs";
import { CapabilityArtifactSchema } from "../artifact/schema.js";
import { runStabilityCheck } from "../replay/stability.js";

// Usage:
//   npm run stability -- --artifact ../../artifacts/lookup_member_savings_balance.v1.json \
//     --params '{"member_id":"12345"}' --n 5

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
  const n = Number(arg("--n", "5"));
  const approve = process.argv.includes("--approve-unattended");

  const raw = JSON.parse(fs.readFileSync(path.resolve(artifactPath), "utf-8"));
  const artifact = CapabilityArtifactSchema.parse(raw);
  const evidenceRoot = path.resolve(process.cwd(), "..", "..", "evidence");

  const report = await runStabilityCheck({
    artifact,
    params: JSON.parse(paramsJson),
    n,
    evidenceRoot,
    headless: process.env.HEADLESS === "true",
    approvedForUnattendedReplay: approve,
  });

  console.log(JSON.stringify(report, null, 2));

  const summaryPath = path.join(evidenceRoot, `stability-summary-${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  console.error(`\nSummary written to ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
