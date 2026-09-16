import fs from "node:fs";
import path from "node:path";

// Minimal mock "operator inbox": scans evidence/*/log.jsonl for intervention
// requests and shows which are still open (requested but not yet resolved).
// Stands in for a real operator console per the brief's scope note -- the
// actual control-transfer mechanism (escalation/intervention.ts) is real;
// this is just a read-only view of that mechanism's evidence trail.
//
// Usage: npm run operator

const evidenceRoot = path.resolve(process.cwd(), "..", "..", "evidence");

if (!fs.existsSync(evidenceRoot)) {
  console.log("No evidence directory yet -- run a discovery or replay first.");
  process.exit(0);
}

const runDirs = fs.readdirSync(evidenceRoot).filter((d) => fs.statSync(path.join(evidenceRoot, d)).isDirectory());

interface Row {
  runId: string;
  reason: string;
  capability: string;
  currentStep: string;
  requestedAt: string;
  resolved: boolean;
  outcome?: string;
}

const rows: Row[] = [];

for (const runId of runDirs) {
  const logPath = path.join(evidenceRoot, runId, "log.jsonl");
  if (!fs.existsSync(logPath)) continue;
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  let pending: Row | null = null;
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.kind === "intervention_requested") {
      pending = {
        runId,
        reason: event.reason,
        capability: event.capability,
        currentStep: event.currentStep,
        requestedAt: event.requestedAt,
        resolved: false,
      };
    }
    if (event.kind === "intervention_resolved" && pending) {
      pending.resolved = true;
      pending.outcome = event.outcome;
    }
  }
  if (pending) rows.push(pending);
}

if (rows.length === 0) {
  console.log("No intervention requests found in evidence/.");
} else {
  console.log("Intervention requests:\n");
  for (const r of rows) {
    console.log(`[${r.resolved ? "RESOLVED:" + r.outcome : "OPEN"}] run=${r.runId} capability=${r.capability} step=${r.currentStep}`);
    console.log(`  requested ${r.requestedAt}: ${r.reason}\n`);
  }
}
