import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { snapshotPage, type InteractiveElement } from "../surface/perceive.js";
import { executeAction } from "../surface/act.js";
import { tools } from "../llm/tools.js";
import { locatorFromElement } from "./artifactBuilder.js";
import type { ArtifactAction } from "../artifact/schema.js";
import type { AllowlistConfig } from "../safety/allowlist.js";
import { assertUrlAllowed, AllowlistViolation } from "../safety/allowlist.js";
import type { EvidenceLogger } from "../log/logger.js";
import { requestIntervention } from "../escalation/intervention.js";
import { redactTypedValue } from "../safety/redact.js";
import type { DiscoveryTranscript, TranscriptEntry } from "./transcript.js";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const MAX_STEPS = 20;

export interface DiscoveryOptions {
  page: Page;
  goal: string;
  appId: string;
  baseUrl: string;
  allowlist: AllowlistConfig;
  logger: EvidenceLogger;
  runId: string;
}

const SYSTEM_PROMPT = (goal: string, baseUrl: string) => `You are operating a real internal banking web application ("Meridian Credit Union - Teller Console") on behalf of a human operator, via the tools provided. You see the current page as a screenshot plus a list of interactive elements (role, accessible name, index).

Goal: ${goal}
Application base URL: ${baseUrl}

Rules:
- Call exactly one tool per turn.
- If you see a login page, log in with Teller ID "teller1" and Password "demo-pass123" (this is a dummy, non-production credential for a mock app -- it is fine to type it).
- Only interact with elements that are actually visible in the current observation; use their index.
- Use "extract" to record any value the goal asks you to read (e.g. a balance), naming the output clearly in snake_case.
- If a value you type or select came from the goal itself (e.g. a specific member ID), mark isParam=true and give it a stable paramName -- this becomes a reusable input of the resulting capability.
- Call "done" only once the current page clearly and visibly shows the completed outcome the goal describes. Give a concrete, checkable description of that state.
- If you hit an error, an unexpected page, or cannot tell how to proceed safely, call "stuck" with the reason rather than guessing repeatedly.
- Stay within the application's normal navigation; do not attempt to access URLs you have not seen linked from the app.`;

export interface DiscoveryRunResult {
  success: boolean;
  transcript: DiscoveryTranscript;
}

export async function runDiscovery(opts: DiscoveryOptions): Promise<DiscoveryRunResult> {
  const { page, goal, appId, baseUrl, allowlist, logger, runId } = opts;
  const anthropic = new Anthropic();

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  page.on("dialog", async (dialog) => {
    logger.log("dialog_handled", { message: dialog.message(), dialogType: dialog.type() });
    await dialog.accept();
  });

  const entries: TranscriptEntry[] = [];
  const messages: Anthropic.MessageParam[] = [];
  let lastSnapshot = await snapshotPage(page);

  for (let step = 0; step < MAX_STEPS; step++) {
    const screenshot = await page.screenshot();
    // Persist the same screenshot sent to the model, so the discovery run
    // leaves real visual evidence on disk -- not just a text log claiming
    // the model saw and acted on a given page.
    const screenshotPath = logger.screenshotPath(`step-${step}`);
    fs.writeFileSync(screenshotPath, screenshot);
    const snapshot = await snapshotPage(page);
    lastSnapshot = snapshot;

    const observationText = [
      `URL: ${snapshot.url}`,
      `Title: ${snapshot.title}`,
      `Visible text (truncated):\n${snapshot.visibleText.slice(0, 800)}`,
      `Interactive elements:`,
      ...snapshot.interactive.map((el) => `  [${el.index}] role=${el.role} name="${el.name}"`),
    ].join("\n");

    messages.push({
      role: "user",
      content: [
        { type: "text", text: observationText },
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshot.toString("base64") } },
      ],
    });

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT(goal, baseUrl),
      tools: tools as unknown as Anthropic.Tool[],
      tool_choice: { type: "auto" },
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const allToolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const toolUse = allToolUses[0];
    const reasoningText = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";

    if (!toolUse) {
      logger.log("model_no_tool_call", { reasoningText });
      break;
    }

    // The prompt asks for exactly one tool call per turn, but the model is
    // not mechanically constrained to that -- it can emit several tool_use
    // blocks in one response. The API requires every tool_use id to get a
    // matching tool_result in the very next message, so any block beyond
    // the first (which is the only one actually executed) still needs a
    // stub result or the next messages.create() call is rejected outright.
    const extraToolUses = allToolUses.slice(1);
    const extraResultBlocks = extraToolUses.map((tu) => ({
      type: "tool_result" as const,
      tool_use_id: tu.id,
      content: "Skipped: only one tool call is processed per turn.",
    }));
    if (extraToolUses.length > 0) {
      logger.log("extra_tool_calls_skipped", { count: extraToolUses.length, tools: extraToolUses.map((t) => t.name) });
    }

    logger.log("model_tool_call", { tool: toolUse.name, input: toolUse.input, reasoningText, screenshotPath });

    const input = toolUse.input as Record<string, unknown>;

    if (toolUse.name === "done") {
      logger.log("discovery_done", { summary: input.summary, successCheckpointDescription: input.successCheckpointDescription });
      return {
        success: true,
        transcript: {
          runId,
          goal,
          appId,
          baseUrl,
          model: DEFAULT_MODEL,
          entries,
          successCheckpointDescription: String(input.successCheckpointDescription ?? ""),
          finalUrl: page.url(),
        },
      };
    }

    if (toolUse.name === "stuck") {
      const outcome = await requestIntervention({
        page,
        logger,
        runId,
        capability: goal,
        currentStep: `discovery_step_${step}`,
        reason: String(input.reason ?? "model reported it was stuck"),
      });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: outcome === "resumed" ? "A human took over, made progress, and handed control back. Continue from the current page state." : "The run was abandoned by the human operator.",
          },
          ...extraResultBlocks,
        ],
      });
      if (outcome === "abandoned") {
        return { success: false, transcript: buildPartialTranscript() };
      }
      continue;
    }

    const targetElement = "index" in input ? snapshot.interactive[input.index as number] : undefined;
    let resultText = "OK";

    try {
      const action = toolCallToAction(toolUse.name, input, targetElement);
      if (action.type === "navigate") assertUrlAllowed(new URL(action.url, page.url()).toString(), allowlist);

      await executeAction(action, { page, allowlist, logger, params: {}, outputs: {} }, `discovery_step_${step}`);

      const postUrl = page.url();
      assertUrlAllowed(postUrl, allowlist);

      entries.push({
        stepIndex: step,
        action,
        targetElement,
        reasoning: String(input.reasoning ?? ""),
        isParam: Boolean(input.isParam),
        paramName: input.paramName ? String(input.paramName) : undefined,
        outputDescription: input.outputDescription ? String(input.outputDescription) : undefined,
      });

      logger.log("step_executed", {
        tool: toolUse.name,
        target: targetElement ? { role: targetElement.role, name: targetElement.name } : undefined,
        value: "value" in input ? redactTypedValue(targetElement?.name, String(input.value)) : undefined,
      });
    } catch (err) {
      const message = err instanceof AllowlistViolation ? `BLOCKED BY POLICY: ${err.message}` : err instanceof Error ? err.message : String(err);
      logger.log("step_error", { tool: toolUse.name, message });
      resultText = `Error: ${message}`;
    }

    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUse.id, content: resultText }, ...extraResultBlocks],
    });
  }

  logger.log("discovery_max_steps_exceeded", { maxSteps: MAX_STEPS });
  return { success: false, transcript: buildPartialTranscript() };

  function buildPartialTranscript(): DiscoveryTranscript {
    return {
      runId,
      goal,
      appId,
      baseUrl,
      model: DEFAULT_MODEL,
      entries,
      successCheckpointDescription: "",
      finalUrl: lastSnapshot.url,
    };
  }
}

function toolCallToAction(
  toolName: string,
  input: Record<string, unknown>,
  targetElement: InteractiveElement | undefined
): ArtifactAction {
  switch (toolName) {
    case "click":
      return { type: "click", target: locatorFromElement(targetElement) };
    case "type":
      return { type: "type", target: locatorFromElement(targetElement), value: String(input.value ?? "") };
    case "select":
      return { type: "select", target: locatorFromElement(targetElement), value: String(input.value ?? "") };
    case "extract":
      return { type: "extract", target: locatorFromElement(targetElement), outputRef: String(input.outputName ?? "output") };
    case "navigate":
      return { type: "navigate", url: String(input.url ?? "") };
    default:
      throw new Error(`Unsupported tool for action conversion: ${toolName}`);
  }
}
