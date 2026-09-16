import path from "node:path";
import { config as loadEnv } from "dotenv";

// Every CLI entry point needs the repo-root .env loaded before it reads
// process.env -- npm workspace scripts run with cwd set to the package
// directory, not the repo root, so a bare `dotenv/config` import would look
// in the wrong place. Import this module first, for its side effect, in
// every file under cli/.
loadEnv({ path: path.resolve(process.cwd(), "..", "..", ".env") });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example).`);
  return value;
}
