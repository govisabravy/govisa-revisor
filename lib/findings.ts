import crypto from "node:crypto";
import type { Finding } from "./schemas/forms";

export function findingHash(f: {
  rule_id?: string;
  subject_id?: string | null;
  field: string;
  form?: string | null;
}): string {
  const parts = [
    f.rule_id ?? `LEGACY:${f.field}|${f.form ?? ""}`,
    f.subject_id ?? "",
    f.field,
    f.form ?? ""
  ].join("||");
  return crypto.createHash("sha1").update(parts).digest("hex");
}

export type FindingWithHash = Finding & { _hash: string };

export function enrichFindingsWithHash(findings: Finding[]): FindingWithHash[] {
  return findings.map((f) => ({ ...f, _hash: findingHash(f) }));
}
