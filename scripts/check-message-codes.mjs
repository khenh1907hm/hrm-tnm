import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const messageSource = await readFile("src/messages.vi.ts", "utf8");
const messageCodes = new Set([...messageSource.matchAll(/\b([A-Z][A-Z0-9_]+):\s*"/g)].map((match) => match[1]));
const usedCodes = new Set();
// These are parsing, Unicode, and reminder-key tokens rather than user-facing issue codes.
const internalTokens = new Set(["CCCD", "NFD", "NFC", "EXPIRING_30", "EXPIRED", "HEAD"]);

async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) await visit(fullPath);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      const source = await readFile(fullPath, "utf8");
      for (const match of source.matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)) usedCodes.add(match[1]);
    }
  }
}

await visit("src");
const missing = [...usedCodes].filter((code) => !messageCodes.has(code) && !internalTokens.has(code));
const unused = [...messageCodes].filter((code) => !usedCodes.has(code));
if (missing.length || unused.length) {
  if (missing.length) console.error(`Codes without Vietnamese messages: ${missing.join(", ")}`);
  if (unused.length) console.error(`Unused Vietnamese messages: ${unused.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Message codes match (${messageCodes.size} codes).`);
}
