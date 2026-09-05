import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DocumentStore, StoredDocument } from "./documentStore.js";

/** SQLite-backed document store using Node's built-in `node:sqlite` (no native build step). */
export class SqliteDocumentStore implements DocumentStore {
  private db: DatabaseSync;

  constructor(filePath: string) {
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        project_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection, project_id);
      CREATE TABLE IF NOT EXISTS events (
        project_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        ts TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (project_id, seq)
      );
    `);
  }

  get<T>(collection: string, projectId: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT data FROM documents WHERE project_id = ? AND collection = ? AND id = ?")
      .get(projectId, collection, id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  list<T>(collection: string, projectId: string): T[] {
    const rows = this.db
      .prepare("SELECT data FROM documents WHERE project_id = ? AND collection = ? ORDER BY updated_at ASC, id ASC")
      .all(projectId, collection) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as T);
  }
  listAll<T>(collection: string): StoredDocument<T>[] {
    const rows = this.db
      .prepare(
        "SELECT project_id, collection, id, data, updated_at FROM documents WHERE collection = ? ORDER BY updated_at DESC",
      )
      .all(collection) as Array<{ project_id: string; collection: string; id: string; data: string; updated_at: string }>;
    return rows.map((r) => ({
      projectId: r.project_id,
      collection: r.collection,
      id: r.id,
      data: JSON.parse(r.data) as T,
      updatedAt: r.updated_at,
    }));
  }
  put<T>(collection: string, projectId: string, id: string, data: T): void {
    this.db
      .prepare(
        `INSERT INTO documents (project_id, collection, id, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(projectId, collection, id, JSON.stringify(data), new Date().toISOString());
  }
  putMany<T>(collection: string, projectId: string, docs: Array<{ id: string; data: T }>): void {
    this.db.exec("BEGIN");
    try {
      for (const d of docs) this.put(collection, projectId, d.id, d.data);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  delete(collection: string, projectId: string, id: string): void {
    this.db
      .prepare("DELETE FROM documents WHERE project_id = ? AND collection = ? AND id = ?")
      .run(projectId, collection, id);
  }
  deleteCollection(collection: string, projectId: string): void {
    this.db.prepare("DELETE FROM documents WHERE project_id = ? AND collection = ?").run(projectId, collection);
  }
  deleteProject(projectId: string): void {
    this.db.prepare("DELETE FROM documents WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM events WHERE project_id = ?").run(projectId);
  }
  appendEvent(projectId: string, event: Record<string, unknown>): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE project_id = ?")
        .get(projectId) as { m: number };
      const seq = Number(row.m) + 1;
      const ts = (event.ts as string) ?? new Date().toISOString();
      this.db
        .prepare("INSERT INTO events (project_id, seq, ts, data) VALUES (?, ?, ?, ?)")
        .run(projectId, seq, ts, JSON.stringify({ ...event, seq }));
      this.db.exec("COMMIT");
      return seq;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  listEvents(projectId: string, afterSeq = 0, limit = 1000): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare("SELECT data FROM events WHERE project_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
      .all(projectId, afterSeq, limit) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Record<string, unknown>);
  }
  close(): void {
    this.db.close();
  }
}
