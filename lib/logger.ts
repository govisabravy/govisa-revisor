import { appendFileSync, mkdirSync } from "fs";
import path from "path";

const logDir = path.join(process.cwd(), "logs");
mkdirSync(logDir, { recursive: true });

function file(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return path.join(logDir, `${yyyy}-${mm}-${dd}.jsonl`);
}

export function logEvent(event: Record<string, any>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  try {
    appendFileSync(file(), line);
  } catch {}
  if (process.env.LOG_STDOUT === "true") {
    process.stdout.write(line);
  }
}
