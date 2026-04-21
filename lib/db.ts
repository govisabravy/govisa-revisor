import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";

const dbDir = path.join(process.cwd(), "data");
mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, "govisa-revisor.db");

let db: Database.Database | null = null;

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
  `);

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

export function saveReview(record: ReviewRecord): void {
  const d = getDb();
  const stmt = d.prepare(
    `INSERT INTO reviews (id, created_at, file_name, file_size, num_pages, client_name, forms_detected,
      total_findings, critical_count, high_count, medium_count, low_count,
      tier1_count, tier2_count, tier3_count,
      elapsed_ms, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens,
      estimated_cost_usd, report_json, debug_json)
     VALUES (@id, @created_at, @file_name, @file_size, @num_pages, @client_name, @forms_detected,
      @total_findings, @critical_count, @high_count, @medium_count, @low_count,
      @tier1_count, @tier2_count, @tier3_count,
      @elapsed_ms, @total_input_tokens, @total_output_tokens, @total_cache_creation_tokens, @total_cache_read_tokens,
      @estimated_cost_usd, @report_json, @debug_json)`
  );
  stmt.run({
    ...record,
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

export function listReviews(limit = 50): Array<{
  id: string;
  created_at: string;
  file_name: string;
  client_name: string | null;
  total_findings: number;
  critical_count: number;
  high_count: number;
  elapsed_ms: number;
  estimated_cost_usd: number;
}> {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id, created_at, file_name, client_name, total_findings, critical_count, high_count,
              elapsed_ms, estimated_cost_usd
       FROM reviews ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as any[];
  return rows;
}

export function getReview(id: string): { report: any; debug: any; meta: any } | null {
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
