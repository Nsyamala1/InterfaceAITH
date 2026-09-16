import type { InteractiveElement } from "../surface/perceive.js";
import type { ArtifactAction } from "../artifact/schema.js";

// ---------------------------------------------------------------------------
// The raw discovery transcript: one entry per executed browser action, plus
// enough context (which element it targeted, whether the model flagged it as
// a reusable parameter/output) to synthesize an artifact afterward. This is
// intentionally a different, narrower shape than the LLM chat history --
// the chat history (reasoning tokens, retries, dead ends) is logged as
// evidence for debugging, but the artifact is built only from this
// structured transcript, per requirement 3.2 ("decoupled from the raw model
// transcript").
// ---------------------------------------------------------------------------

export interface TranscriptEntry {
  stepIndex: number;
  action: ArtifactAction;
  targetElement?: InteractiveElement; // the element the action's LocatorSpec was derived from
  reasoning: string;
  isParam?: boolean;
  paramName?: string;
  outputDescription?: string;
}

export interface DiscoveryTranscript {
  runId: string;
  goal: string;
  appId: string;
  baseUrl: string;
  model: string;
  entries: TranscriptEntry[];
  successCheckpointDescription: string;
  finalUrl: string;
}
