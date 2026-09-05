/**
 * Minimal document-store abstraction. Every CineMemory artifact is a JSON document scoped by
 * project and collection. Backends: SQLite (node:sqlite) for the app, in-memory for tests.
 * A hackathon partner (e.g. ClickHouse, IBM Db2) can implement this interface to become the
 * system of record without touching agents or UI.
 */
export interface StoredDocument<T = unknown> {
  projectId: string;
  collection: string;
  id: string;
  data: T;
  updatedAt: string;
}

export interface DocumentStore {
  get<T>(collection: string, projectId: string, id: string): T | undefined;
  list<T>(collection: string, projectId: string): T[];
  listAll<T>(collection: string): StoredDocument<T>[];
  put<T>(collection: string, projectId: string, id: string, data: T): void;
  putMany<T>(collection: string, projectId: string, docs: Array<{ id: string; data: T }>): void;
  delete(collection: string, projectId: string, id: string): void;
  deleteCollection(collection: string, projectId: string): void;
  deleteProject(projectId: string): void;
  /** Append-only event log with a monotonically increasing sequence per project. */
  appendEvent(projectId: string, event: Record<string, unknown>): number;
  listEvents(projectId: string, afterSeq?: number, limit?: number): Array<Record<string, unknown>>;
  close(): void;
}

export class InMemoryDocumentStore implements DocumentStore {
  private docs = new Map<string, StoredDocument>();
  private events = new Map<string, Array<Record<string, unknown>>>();

  private key(collection: string, projectId: string, id: string) {
    return `${projectId} ${collection} ${id}`;
  }

  get<T>(collection: string, projectId: string, id: string): T | undefined {
    const d = this.docs.get(this.key(collection, projectId, id));
    return d ? structuredClone(d.data as T) : undefined;
  }
  list<T>(collection: string, projectId: string): T[] {
    const out: T[] = [];
    for (const d of this.docs.values()) {
      if (d.projectId === projectId && d.collection === collection) out.push(structuredClone(d.data as T));
    }
    return out;
  }
  listAll<T>(collection: string): StoredDocument<T>[] {
    const out: StoredDocument<T>[] = [];
    for (const d of this.docs.values()) if (d.collection === collection) out.push(structuredClone(d as StoredDocument<T>));
    return out;
  }
  put<T>(collection: string, projectId: string, id: string, data: T): void {
    this.docs.set(this.key(collection, projectId, id), {
      projectId,
      collection,
      id,
      data: structuredClone(data),
      updatedAt: new Date().toISOString(),
    });
  }
  putMany<T>(collection: string, projectId: string, docs: Array<{ id: string; data: T }>): void {
    for (const d of docs) this.put(collection, projectId, d.id, d.data);
  }
  delete(collection: string, projectId: string, id: string): void {
    this.docs.delete(this.key(collection, projectId, id));
  }
  deleteCollection(collection: string, projectId: string): void {
    for (const [k, d] of this.docs) if (d.projectId === projectId && d.collection === collection) this.docs.delete(k);
  }
  deleteProject(projectId: string): void {
    for (const [k, d] of this.docs) if (d.projectId === projectId) this.docs.delete(k);
    this.events.delete(projectId);
  }
  appendEvent(projectId: string, event: Record<string, unknown>): number {
    const list = this.events.get(projectId) ?? [];
    const seq = list.length + 1;
    list.push({ ...structuredClone(event), seq });
    this.events.set(projectId, list);
    return seq;
  }
  listEvents(projectId: string, afterSeq = 0, limit = 1000): Array<Record<string, unknown>> {
    return (this.events.get(projectId) ?? [])
      .filter((e) => (e.seq as number) > afterSeq)
      .slice(0, limit)
      .map((e) => structuredClone(e));
  }
  close(): void {}
}
