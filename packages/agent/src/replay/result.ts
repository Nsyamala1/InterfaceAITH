// ---------------------------------------------------------------------------
// Replay result contract. Three shapes, deliberately not collapsed into one
// "success: boolean" -- this is the distinction the brief calls out as the
// most common design mistake to get wrong:
//   success         - the goal was achieved; outputs are populated.
//   business_outcome- a legitimate, expected answer that isn't success
//                      (e.g. "no such member"). Not an error. The caller
//                      needs to know, but nothing is broken.
//   hard_failure    - something the artifact's known-outcome taxonomy did
//                      not anticipate. Debuggable detail included; this is
//                      the case that should page a human / trigger escalation.
// ---------------------------------------------------------------------------

export interface ReplaySuccess {
  status: "success";
  outputs: Record<string, string | number | boolean>;
  stepsExecuted: number;
}

export interface ReplayBusinessOutcome {
  status: "business_outcome";
  code: string;
  description: string;
  outputs: Record<string, string | number | boolean>;
  stepsExecuted: number;
}

export interface ReplayHardFailure {
  status: "hard_failure";
  step: string;
  expected: string;
  observed: string;
  message: string;
  screenshotPath?: string;
  stepsExecuted: number;
}

export type ReplayResult = ReplaySuccess | ReplayBusinessOutcome | ReplayHardFailure;
