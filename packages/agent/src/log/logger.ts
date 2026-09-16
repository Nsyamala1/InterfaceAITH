import fs from "node:fs";
import path from "node:path";
import { redactText } from "../safety/redact.js";

// ---------------------------------------------------------------------------
// Structured evidence logger. Every run (discovery or replay) gets its own
// directory under evidence/<runId>/ with:
//   log.jsonl        - one JSON object per line, append-only, chronological
//   screenshots/*.png - captured on every step and, always, on failure
// ---------------------------------------------------------------------------

export interface LogEvent {
  ts: string;
  runId: string;
  kind: string; // e.g. "step_started", "step_result", "checkpoint_failed", "escalation"
  [key: string]: unknown;
}

export class EvidenceLogger {
  readonly runDir: string;
  readonly screenshotsDir: string;
  private readonly logPath: string;

  constructor(evidenceRoot: string, runId: string) {
    this.runDir = path.join(evidenceRoot, runId);
    this.screenshotsDir = path.join(this.runDir, "screenshots");
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    this.logPath = path.join(this.runDir, "log.jsonl");
  }

  log(kind: string, fields: Record<string, unknown> = {}): void {
    const event: LogEvent = {
      ts: new Date().toISOString(),
      runId: path.basename(this.runDir),
      kind,
      ...redactFields(fields),
    };
    fs.appendFileSync(this.logPath, JSON.stringify(event) + "\n");
  }

  screenshotPath(label: string): string {
    const safe = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.screenshotsDir, `${Date.now()}_${safe}.png`);
  }
}

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/password|secret|token/i.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      out[k] = redactText(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
