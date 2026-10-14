import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const reportPath = "reports/mutation/mutation.html";
const html = await readFile(reportPath, "utf8");
const marker = "app.report = ";
const start = html.indexOf(marker) + marker.length;
if (start < marker.length) throw new Error(`No embedded mutation report found in ${reportPath}`);

let depth = 0;
let inString = false;
let escaped = false;
let end = start;
for (; end < html.length; end += 1) {
  const character = html[end];
  if (inString) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === "\"") inString = false;
  } else if (character === "\"") inString = true;
  else if (character === "{") depth += 1;
  else if (character === "}") {
    depth -= 1;
    if (depth === 0) { end += 1; break; }
  }
}

const report = runInNewContext(`(${html.slice(start, end)})`);
const totals = new Map();
for (const [file, data] of Object.entries(report.files)) {
  const survivors = data.mutants.filter((mutant) => mutant.status === "Survived");
  if (!survivors.length) continue;
  for (const mutant of survivors) totals.set(mutant.mutatorName, (totals.get(mutant.mutatorName) ?? 0) + 1);
  console.log(`${file}: ${survivors.length} survived`);
  for (const mutant of survivors) console.log(`  line ${mutant.location.start.line} ${mutant.mutatorName} -> ${mutant.replacement}`);
}
console.log("Survivors by mutation type:");
for (const [name, count] of totals) console.log(`  ${name}: ${count}`);
