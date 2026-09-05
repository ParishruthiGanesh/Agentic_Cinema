/** Case/whitespace-insensitive phrase containment with word boundaries where sensible. */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const h = normalize(haystack);
  const p = normalize(phrase);
  if (!p) return false;
  return h.includes(p);
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findPhrase(haystack: string, phrases: string[]): string | undefined {
  return phrases.find((p) => containsPhrase(haystack, p));
}

export function truncate(s: string, max = 200): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
