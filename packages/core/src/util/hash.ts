import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, len = 12): string {
  return sha256(input).slice(0, len);
}

let counter = 0;
/** Sortable unique id: timestamp + counter + short random. */
export function newId(prefix = "id"): string {
  counter = (counter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, "0")}${rand}`;
}
