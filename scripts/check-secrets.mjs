#!/usr/bin/env node
// Fails if a tracked file contains what looks like a real credential. Runs in CI and `pnpm test`.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
const patterns = [
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "filled GEMINI_API_KEY in tracked env file", re: /^GEMINI_API_KEY=\S+/m, only: /\.env/ },
  { name: "filled CLICKHOUSE_PASSWORD in tracked env file", re: /^CLICKHOUSE_PASSWORD=\S+/m, only: /\.env/ },
  { name: "private key block", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];
let bad = 0;
for (const f of files) {
  if (/pnpm-lock\.yaml$|\.(png|jpg|svg|ico|woff2?)$/.test(f)) continue;
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const p of patterns) {
    if (p.only && !p.only.test(f)) continue;
    if (p.re.test(text)) { console.error(`✘ ${p.name} in ${f}`); bad++; }
  }
}
if (bad) { console.error(`${bad} potential secret(s) in tracked files. Move them to a git-ignored .env and rotate them.`); process.exit(1); }
console.log(`✔ no secrets in ${files.length} tracked files`);
