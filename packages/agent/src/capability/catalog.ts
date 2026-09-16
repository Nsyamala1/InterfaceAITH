import fs from "node:fs";
import path from "node:path";
import { CapabilityArtifactSchema, type CapabilityArtifact } from "../artifact/schema.js";

// ---------------------------------------------------------------------------
// The agent-facing side of "the artifact becomes a reusable capability."
// Everything downstream (replay engine, safety, evidence) already exists;
// this is the thin catalog/lookup layer that lets a caller address a
// capability by NAME instead of by file path -- which is what "an AI agent
// could discover and invoke by name" (brief, Section 8) actually requires.
// ---------------------------------------------------------------------------

export function listCapabilities(artifactsDir: string): CapabilityArtifact[] {
  const files = fs.readdirSync(artifactsDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(artifactsDir, f), "utf-8"));
    return CapabilityArtifactSchema.parse(raw);
  });
}

// Multiple versions of the same-named capability may exist on disk; a
// caller addressing by name gets the highest version, matching how a
// production agent would want "the current one" without pinning a file.
export function loadCapability(artifactsDir: string, name: string): CapabilityArtifact {
  const matches = listCapabilities(artifactsDir).filter((a) => a.name === name);
  if (matches.length === 0) {
    throw new Error(`No capability artifact named "${name}" found in ${artifactsDir}`);
  }
  return matches.reduce((best, candidate) => (candidate.version > best.version ? candidate : best));
}
