import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";

const dbDir = path.join(process.cwd(), "data");
mkdirSync(dbDir, { recursive: true });

// DB path resolution priority:
// 1. AUTH_DB_PATH (override explícito — útil pra testes)
// 2. NODE_ENV=production → prod.db (no Coolify)
// 3. NODE_ENV=development OU undefined → dev.db (local)
// 4. fallback legado govisa-revisor.db
function resolveDbName(): string {
  if (process.env.AUTH_DB_PATH) return process.env.AUTH_DB_PATH;
  if (process.env.NODE_ENV === "production") return "prod.db";
  if (process.env.NODE_ENV === "development") return "dev.db";
  return "govisa-revisor.db";
}
const dbPath = path.join(dbDir, resolveDbName());
if (!process.env.GOVISA_DB_QUIET) {
  // eslint-disable-next-line no-console
  console.log(
    `[db] usando ${dbPath} (NODE_ENV=${process.env.NODE_ENV ?? "unset"})`
  );
}

let db: Database.Database | null = null;

function hasColumn(d: Database.Database, table: string, col: string): boolean {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some((r) => r.name === col);
}

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER,
      num_pages INTEGER,
      client_name TEXT,
      forms_detected TEXT,
      total_findings INTEGER,
      critical_count INTEGER,
      high_count INTEGER,
      medium_count INTEGER,
      low_count INTEGER,
      tier1_count INTEGER,
      tier2_count INTEGER,
      tier3_count INTEGER,
      elapsed_ms INTEGER,
      total_input_tokens INTEGER,
      total_output_tokens INTEGER,
      total_cache_creation_tokens INTEGER,
      total_cache_read_tokens INTEGER,
      estimated_cost_usd REAL,
      report_json TEXT,
      debug_json TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      operation TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      duration_ms INTEGER,
      attempts INTEGER,
      had_pdf INTEGER,
      ok INTEGER,
      error TEXT,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_review ON usage_events(review_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      must_change_password INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      user_id TEXT,
      email_attempted TEXT,
      ip TEXT,
      user_agent TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_login_events_type ON login_events(event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      target_user_id TEXT,
      metadata TEXT,
      ip TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at DESC);

    CREATE TABLE IF NOT EXISTS finding_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      finding_hash TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      subject_id TEXT,
      user_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('correct','incorrect')),
      error_type TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(review_id, finding_hash, user_id),
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_rule ON finding_feedback(rule_id, verdict);
    CREATE INDEX IF NOT EXISTS idx_feedback_review ON finding_feedback(review_id);

    CREATE TABLE IF NOT EXISTS missing_finding_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      suggested_severity TEXT,
      suggested_rule_id TEXT,
      subject_id TEXT,
      form TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_missing_review ON missing_finding_reports(review_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_missing_status ON missing_finding_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_missing_user ON missing_finding_reports(user_id, created_at DESC);
  `);

  if (!hasColumn(db, "reviews", "user_id")) {
    db.exec(`ALTER TABLE reviews ADD COLUMN user_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id, created_at DESC)`);

  if (!hasColumn(db, "reviews", "case_type")) {
    db.exec(`ALTER TABLE reviews ADD COLUMN case_type TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_case_type ON reviews(case_type)`);

  return db;
}

export interface ReviewRecord {
  id: string;
  created_at: string;
  file_name: string;
  file_size?: number | null;
  num_pages?: number | null;
  client_name?: string | null;
  forms_detected: string[];
  total_findings: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  tier1_count: number;
  tier2_count: number;
  tier3_count: number;
  elapsed_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  estimated_cost_usd: number;
  report_json: string;
  debug_json: string;
  user_id?: string | null;
  case_type?: string | null;
}

export interface UsageEventRecord {
  review_id: string;
  operation: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  duration_ms: number;
  attempts: number;
  had_pdf: boolean;
  ok: boolean;
  error?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: "admin" | "user";
  must_change_password: number;
  active: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export function saveReview(record: ReviewRecord): void {
  const d = getDb();
  const stmt = d.prepare(
    `INSERT INTO reviews (id, created_at, file_name, file_size, num_pages, client_name, forms_detected,
      total_findings, critical_count, high_count, medium_count, low_count,
      tier1_count, tier2_count, tier3_count,
      elapsed_ms, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens,
      estimated_cost_usd, report_json, debug_json, user_id, case_type)
     VALUES (@id, @created_at, @file_name, @file_size, @num_pages, @client_name, @forms_detected,
      @total_findings, @critical_count, @high_count, @medium_count, @low_count,
      @tier1_count, @tier2_count, @tier3_count,
      @elapsed_ms, @total_input_tokens, @total_output_tokens, @total_cache_creation_tokens, @total_cache_read_tokens,
      @estimated_cost_usd, @report_json, @debug_json, @user_id, @case_type)`
  );
  stmt.run({
    ...record,
    user_id: record.user_id ?? null,
    case_type: record.case_type ?? null,
    forms_detected: JSON.stringify(record.forms_detected)
  });
}

export function saveUsageEvents(events: UsageEventRecord[]): void {
  if (events.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(
    `INSERT INTO usage_events
      (review_id, created_at, operation, model, input_tokens, output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens, duration_ms, attempts, had_pdf, ok, error)
     VALUES (@review_id, @created_at, @operation, @model, @input_tokens, @output_tokens,
       @cache_creation_input_tokens, @cache_read_input_tokens, @duration_ms, @attempts, @had_pdf, @ok, @error)`
  );
  const createdAt = new Date().toISOString();
  const tx = d.transaction((items: UsageEventRecord[]) => {
    for (const e of items) {
      stmt.run({
        review_id: e.review_id,
        created_at: createdAt,
        operation: e.operation,
        model: e.model,
        input_tokens: e.input_tokens,
        output_tokens: e.output_tokens,
        cache_creation_input_tokens: e.cache_creation_input_tokens,
        cache_read_input_tokens: e.cache_read_input_tokens,
        duration_ms: e.duration_ms,
        attempts: e.attempts,
        had_pdf: e.had_pdf ? 1 : 0,
        ok: e.ok ? 1 : 0,
        error: e.error ?? null
      });
    }
  });
  tx(events);
}

export function listReviews(opts: { userId?: string | null; limit?: number } = {}): Array<{
  id: string;
  created_at: string;
  file_name: string;
  client_name: string | null;
  total_findings: number;
  critical_count: number;
  high_count: number;
  elapsed_ms: number;
  estimated_cost_usd: number;
  user_id: string | null;
  case_type: string | null;
}> {
  const d = getDb();
  const limit = opts.limit ?? 50;
  const rows = opts.userId
    ? (d
        .prepare(
          `SELECT id, created_at, file_name, client_name, total_findings, critical_count, high_count,
                  elapsed_ms, estimated_cost_usd, user_id, case_type
           FROM reviews WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(opts.userId, limit) as any[])
    : (d
        .prepare(
          `SELECT id, created_at, file_name, client_name, total_findings, critical_count, high_count,
                  elapsed_ms, estimated_cost_usd, user_id, case_type
           FROM reviews ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit) as any[]);
  return rows;
}

export function getReview(
  id: string
): { report: any; debug: any; meta: any } | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as any;
  if (!row) return null;
  const events = d
    .prepare(`SELECT * FROM usage_events WHERE review_id = ? ORDER BY id ASC`)
    .all(id) as any[];
  return {
    report: JSON.parse(row.report_json),
    debug: JSON.parse(row.debug_json),
    meta: {
      ...row,
      forms_detected: JSON.parse(row.forms_detected),
      usage_events: events
    }
  };
}

export function createUser(input: {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  role: "admin" | "user";
  must_change_password?: boolean;
}): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, must_change_password, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    input.id,
    input.email.toLowerCase().trim(),
    input.password_hash,
    input.name,
    input.role,
    input.must_change_password === false ? 0 : 1,
    now,
    now
  );
}

export function getUserByEmail(email: string): UserRecord | null {
  const d = getDb();
  const row = d
    .prepare(`SELECT * FROM users WHERE email = ? AND active = 1`)
    .get(email.toLowerCase().trim()) as any;
  return row ?? null;
}

export function getUserByEmailIncludingInactive(email: string): UserRecord | null {
  const d = getDb();
  const row = d
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim()) as any;
  return row ?? null;
}

export function getUserById(id: string): UserRecord | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as any;
  return row ?? null;
}

export function listUsers(): UserRecord[] {
  const d = getDb();
  return d.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as any[];
}

export function updateUser(
  id: string,
  patch: Partial<{
    email: string;
    name: string | null;
    role: "admin" | "user";
    active: number;
    must_change_password: number;
    password_hash: string;
    last_login_at: string;
  }>
): void {
  const d = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  fields.push(`updated_at = ?`);
  values.push(new Date().toISOString());
  values.push(id);
  d.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteUser(id: string): void {
  const d = getDb();
  d.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  );
}

export function countUsers(): number {
  const d = getDb();
  const r = d.prepare(`SELECT COUNT(*) as c FROM users WHERE active = 1`).get() as any;
  return r.c ?? 0;
}

export function getDatabase(): Database.Database {
  return getDb();
}

export type LoginEventType =
  | "login_ok"
  | "login_fail"
  | "logout"
  | "password_change"
  | "rate_limited";

export interface LoginEventInput {
  event_type: LoginEventType;
  user_id?: string | null;
  email_attempted?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, any> | null;
}

export function recordLoginEvent(input: LoginEventInput): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO login_events (created_at, event_type, user_id, email_attempted, ip, user_agent, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    input.event_type,
    input.user_id ?? null,
    input.email_attempted ? input.email_attempted.toLowerCase().trim() : null,
    input.ip ?? null,
    input.user_agent ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null
  );
}

export interface LoginEventRow {
  id: number;
  created_at: string;
  event_type: LoginEventType;
  user_id: string | null;
  email_attempted: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: any;
}

export function listLoginEvents(opts: {
  userId?: string;
  eventType?: LoginEventType;
  limit?: number;
} = {}): LoginEventRow[] {
  const d = getDb();
  const limit = opts.limit ?? 100;
  const conds: string[] = [];
  const values: any[] = [];
  if (opts.userId) {
    conds.push("user_id = ?");
    values.push(opts.userId);
  }
  if (opts.eventType) {
    conds.push("event_type = ?");
    values.push(opts.eventType);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  values.push(limit);
  const rows = d
    .prepare(`SELECT * FROM login_events ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as any[];
  return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

export type AdminAuditAction =
  | "user_created"
  | "user_role_changed"
  | "user_activated"
  | "user_deactivated"
  | "user_email_changed"
  | "user_name_changed"
  | "password_reset_by_admin";

export interface AdminAuditInput {
  action: AdminAuditAction;
  actor_user_id: string;
  target_user_id?: string | null;
  metadata?: Record<string, any> | null;
  ip?: string | null;
  user_agent?: string | null;
}

export function recordAdminAudit(input: AdminAuditInput): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO admin_audit (created_at, action, actor_user_id, target_user_id, metadata, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    input.action,
    input.actor_user_id,
    input.target_user_id ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.ip ?? null,
    input.user_agent ?? null
  );
}

export interface AdminAuditRow {
  id: number;
  created_at: string;
  action: AdminAuditAction;
  actor_user_id: string;
  target_user_id: string | null;
  metadata: any;
  ip: string | null;
  user_agent: string | null;
}

export function listAdminAudit(opts: {
  actorUserId?: string;
  targetUserId?: string;
  limit?: number;
} = {}): AdminAuditRow[] {
  const d = getDb();
  const limit = opts.limit ?? 100;
  const conds: string[] = [];
  const values: any[] = [];
  if (opts.actorUserId) {
    conds.push("actor_user_id = ?");
    values.push(opts.actorUserId);
  }
  if (opts.targetUserId) {
    conds.push("target_user_id = ?");
    values.push(opts.targetUserId);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  values.push(limit);
  const rows = d
    .prepare(`SELECT * FROM admin_audit ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as any[];
  return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
}

export interface FindingFeedbackRow {
  finding_hash: string;
  rule_id: string;
  subject_id: string | null;
  user_id: string;
  verdict: "correct" | "incorrect";
  error_type: string | null;
  note: string | null;
  created_at: string;
}

export function upsertFindingFeedback(input: {
  review_id: string;
  finding_hash: string;
  rule_id: string;
  subject_id?: string | null;
  user_id: string;
  verdict: "correct" | "incorrect";
  error_type?: string | null;
  note?: string | null;
}): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO finding_feedback
       (review_id, finding_hash, rule_id, subject_id, user_id, verdict, error_type, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(review_id, finding_hash, user_id) DO UPDATE SET
       verdict = excluded.verdict,
       error_type = excluded.error_type,
       note = excluded.note,
       rule_id = excluded.rule_id,
       subject_id = excluded.subject_id,
       created_at = excluded.created_at`
  ).run(
    input.review_id,
    input.finding_hash,
    input.rule_id,
    input.subject_id ?? null,
    input.user_id,
    input.verdict,
    input.error_type ?? null,
    input.note ?? null,
    now
  );
}

export function listFindingFeedback(reviewId: string): FindingFeedbackRow[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT finding_hash, rule_id, subject_id, user_id, verdict, error_type, note, created_at
       FROM finding_feedback
       WHERE review_id = ?
       ORDER BY created_at DESC`
    )
    .all(reviewId) as any[];
  return rows;
}

export function aggregateFeedbackByRuleId(opts: { since?: string } = {}): Array<{
  rule_id: string;
  total: number;
  correct: number;
  incorrect: number;
  rate_incorrect: number;
}> {
  const d = getDb();
  const conds: string[] = [];
  const values: any[] = [];
  if (opts.since) {
    conds.push("created_at >= ?");
    values.push(opts.since);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = d
    .prepare(
      `SELECT rule_id,
              COUNT(*) AS total,
              SUM(CASE WHEN verdict = 'correct' THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN verdict = 'incorrect' THEN 1 ELSE 0 END) AS incorrect
       FROM finding_feedback
       ${where}
       GROUP BY rule_id
       ORDER BY incorrect DESC, total DESC`
    )
    .all(...values) as any[];
  return rows.map((r) => {
    const total = Number(r.total ?? 0);
    const correct = Number(r.correct ?? 0);
    const incorrect = Number(r.incorrect ?? 0);
    return {
      rule_id: r.rule_id,
      total,
      correct,
      incorrect,
      rate_incorrect: total > 0 ? incorrect / total : 0
    };
  });
}

// ===========================================================================
// Missing finding reports — usuário aponta erros que o sistema NÃO detectou
// (vira dataset de calibração de RECALL)
// ===========================================================================

export interface MissingFindingReportRow {
  id: number;
  review_id: string;
  user_id: string;
  title: string;
  description: string;
  suggested_severity: string | null;
  suggested_rule_id: string | null;
  subject_id: string | null;
  form: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function insertMissingFindingReport(input: {
  review_id: string;
  user_id: string;
  title: string;
  description: string;
  suggested_severity?: string | null;
  suggested_rule_id?: string | null;
  subject_id?: string | null;
  form?: string | null;
}): number {
  const d = getDb();
  const now = new Date().toISOString();
  const r = d
    .prepare(
      `INSERT INTO missing_finding_reports
        (review_id, user_id, title, description, suggested_severity,
         suggested_rule_id, subject_id, form, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(
      input.review_id,
      input.user_id,
      input.title,
      input.description,
      input.suggested_severity ?? null,
      input.suggested_rule_id ?? null,
      input.subject_id ?? null,
      input.form ?? null,
      now,
      now
    );
  return Number(r.lastInsertRowid);
}

export function listMissingFindingReports(
  reviewId: string
): MissingFindingReportRow[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT id, review_id, user_id, title, description, suggested_severity,
              suggested_rule_id, subject_id, form, status, created_at, updated_at
       FROM missing_finding_reports
       WHERE review_id = ?
       ORDER BY created_at DESC`
    )
    .all(reviewId) as MissingFindingReportRow[];
}

export function listAllMissingFindingReports(opts: {
  status?: string;
  since?: string;
  limit?: number;
} = {}): Array<MissingFindingReportRow & { client_name: string | null }> {
  const d = getDb();
  const conds: string[] = [];
  const values: any[] = [];
  if (opts.status) {
    conds.push("m.status = ?");
    values.push(opts.status);
  }
  if (opts.since) {
    conds.push("m.created_at >= ?");
    values.push(opts.since);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 500);
  return d
    .prepare(
      `SELECT m.*, r.client_name
       FROM missing_finding_reports m
       LEFT JOIN reviews r ON r.id = m.review_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT ${limit}`
    )
    .all(...values) as Array<MissingFindingReportRow & { client_name: string | null }>;
}

export function updateMissingFindingReportStatus(
  id: number,
  status: "open" | "triaged" | "resolved" | "wont_fix"
): boolean {
  const d = getDb();
  const r = d
    .prepare(
      `UPDATE missing_finding_reports SET status = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, new Date().toISOString(), id);
  return r.changes > 0;
}
