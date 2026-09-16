import "../env.js";
import path from "node:path";
import { listCapabilities } from "../capability/catalog.js";
import { toToolDefinition } from "../capability/toolSchema.js";
import { invokeCapability } from "../capability/invoke.js";

// Usage:
//   npm run capabilities -- --list
//   npm run capabilities -- --invoke lookup_member_savings_balance \
//     --params '{"member_id":"12345"}'
//   npm run capabilities -- --invoke open_member_sub_account \
//     --params '{"member_id":"12345","account_type":"savings","initial_deposit":"100"}' \
//     --approve-unattended

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const artifactsDir = path.resolve(process.cwd(), "..", "..", "artifacts");
  const evidenceRoot = path.resolve(process.cwd(), "..", "..", "evidence");

  if (process.argv.includes("--list")) {
    // The catalog an AI agent's tool-use runtime would be handed: one
    // callable tool definition per saved capability, derived straight from
    // each artifact's own declared parameters/outputs (toolSchema.ts).
    const tools = listCapabilities(artifactsDir).map(toToolDefinition);
    console.log(JSON.stringify(tools, null, 2));
    return;
  }

  const invokeName = arg("--invoke");
  if (invokeName) {
    const paramsJson = arg("--params", "{}")!;
    const approve = process.argv.includes("--approve-unattended");
    const result = await invokeCapability({
      artifactsDir,
      evidenceRoot,
      name: invokeName,
      params: JSON.parse(paramsJson),
      approvedForUnattendedReplay: approve,
      headless: process.env.HEADLESS === "true",
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "hard_failure") process.exitCode = 2;
    return;
  }

  console.error('Usage: --list | --invoke <name> --params \'<json>\' [--approve-unattended]');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
