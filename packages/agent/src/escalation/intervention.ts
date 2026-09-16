import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Page } from "playwright";
import type { EvidenceLogger } from "../log/logger.js";

// ---------------------------------------------------------------------------
// Human-in-the-loop escalation & handoff.
//
// Control-transfer model: the browser this run drives is launched headed
// (a real, visible OS window), not headless. "Taking control of the live
// session" therefore means the operator uses that same window with their own
// mouse/keyboard -- there is no second session, no re-navigation, nothing to
// hand off at the network layer. Automation's side of the handoff is just:
// stop issuing Playwright commands against `page`, and don't resume issuing
// them until the operator signals resume. That single rule is what makes the
// pause/resume boundary real rather than cosmetic.
//
// This is the minimal-but-real version the brief scopes for (3.6): a full
// co-browsing console is out of scope, so the "operator surface" here is a
// terminal prompt plus the already-visible browser window, standing in for
// what a real operator console would present. What's real is the mechanism:
// automation genuinely stops touching the page, a person can genuinely act
// on it, and resume genuinely hands control back to automation on the same
// `page` object with no new session created.
//
// What's captured across the handoff: a before/after screenshot and URL, and
// the reason/context that triggered escalation, all written into the same
// run's evidence trail. What's NOT captured: a step-by-step diff of the
// operator's individual clicks -- doing that faithfully needs real operator
// instrumentation (event recording in the browser), which is exactly the
// piece this project mocks. Documented as a cut, not hidden.
// ---------------------------------------------------------------------------

export interface InterventionRequest {
  runId: string;
  reason: string;
  capability: string;
  currentStep: string;
  url: string;
  screenshotPath: string;
  requestedAt: string;
}

export type InterventionOutcome = "resumed" | "abandoned";

export async function requestIntervention(params: {
  page: Page;
  logger: EvidenceLogger;
  runId: string;
  capability: string;
  currentStep: string;
  reason: string;
}): Promise<InterventionOutcome> {
  const { page, logger, runId, capability, currentStep, reason } = params;

  const beforeScreenshot = logger.screenshotPath("escalation_before");
  await page.screenshot({ path: beforeScreenshot }).catch(() => {});

  const request: InterventionRequest = {
    runId,
    reason,
    capability,
    currentStep,
    url: page.url(),
    screenshotPath: beforeScreenshot,
    requestedAt: new Date().toISOString(),
  };
  logger.log("intervention_requested", { ...request });

  // eslint-disable-next-line no-console
  console.log("\n=== HUMAN INTERVENTION REQUESTED ===");
  console.log(`Capability : ${capability}`);
  console.log(`Step       : ${currentStep}`);
  console.log(`Reason     : ${reason}`);
  console.log(`Current URL: ${page.url()}`);
  console.log("The browser window is live -- take over with your mouse/keyboard.");
  console.log("When you have finished (or want to abandon the run), type here.");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let answer = "";
  while (answer !== "resume" && answer !== "abandon") {
    answer = (await rl.question('Type "resume" to hand control back to automation, or "abandon" to stop the run: ')).trim().toLowerCase();
  }
  rl.close();

  const afterScreenshot = logger.screenshotPath("escalation_after");
  await page.screenshot({ path: afterScreenshot }).catch(() => {});

  logger.log("intervention_resolved", {
    outcome: answer,
    urlAfter: page.url(),
    screenshotAfter: afterScreenshot,
  });

  return answer === "resume" ? "resumed" : "abandoned";
}
