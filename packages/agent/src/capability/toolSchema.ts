import type { CapabilityArtifact } from "../artifact/schema.js";

// ---------------------------------------------------------------------------
// Projects a capability artifact into the same tool-definition shape used
// for the discovery agent's own tool-calling (see llm/tools.ts) -- i.e. what
// an LLM-based caller (the agent-facing product this system serves) would
// need to discover this capability and call it correctly. This is a pure
// projection of the artifact's own `parameters`/`outputs`/`description`
// fields: nothing here is authored separately from the artifact, so it can
// never drift out of sync with what replay actually accepts and returns.
// ---------------------------------------------------------------------------

export interface CapabilityToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export function toToolDefinition(artifact: CapabilityArtifact): CapabilityToolDefinition {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const p of artifact.parameters) {
    properties[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }

  const outputsDoc = artifact.outputs.length
    ? artifact.outputs.map((o) => `${o.name} (${o.type}): ${o.description}`).join("; ")
    : "no declared outputs";

  const riskNote =
    artifact.policy.riskLevel === "irreversible"
      ? " This action is irreversible and requires explicit unattended-replay approval."
      : "";

  return {
    name: artifact.name,
    description: `${artifact.description} Returns: ${outputsDoc}.${riskNote}`,
    input_schema: { type: "object", properties, required },
  };
}
