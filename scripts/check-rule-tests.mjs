import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const rulesText = await readFile("docs/rules.md", "utf8");
const listedRuleIds = [...rulesText.matchAll(/^\| ([A-Z][A-Z0-9]*-\d+) \|/gm)].map((match) => match[1]);
const ruleIds = new Set(listedRuleIds);
const duplicateRuleIds = listedRuleIds.filter((id, index) => listedRuleIds.indexOf(id) !== index);
const discovered = new Set();
let testsWithoutExpect = false;
const testFiles = await readdir("src");

function hasExpect(node) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "expect") found = true;
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function isNamedCall(node, names) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  return ts.isIdentifier(expression) && names.has(expression.text);
}

async function visit(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) await visit(fullPath);
    else if (/\.(test|spec)\.tsx?$/.test(entry.name)) {
      const source = await readFile(fullPath, "utf8");
      const file = ts.createSourceFile(fullPath, source, ts.ScriptTarget.Latest, true);
      function scan(node) {
        if (isNamedCall(node, new Set(["describe", "it", "test"]))) {
          const title = node.arguments[0];
          if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
            const ids = [...title.text.matchAll(/\b([A-Z][A-Z0-9]*_\d+)\b/g)].map((match) => match[1].replace("_", "-"));
            for (const id of ids) discovered.add(id);
            if (isNamedCall(node, new Set(["it", "test"])) && ids.length > 0) {
              const body = node.arguments[1];
              if (!body || !hasExpect(body)) {
                console.error(`${fullPath}: test ${title.text} has a rule ID but no expect()`);
                testsWithoutExpect = true;
              }
            }
          }
        }
        ts.forEachChild(node, scan);
      }
      scan(file);
    }
  }
}

if (testFiles.length) await visit("src");
const missing = [...ruleIds].filter((id) => !discovered.has(id));
const unregistered = [...discovered].filter((id) => !ruleIds.has(id));
if (duplicateRuleIds.length || missing.length || unregistered.length || testsWithoutExpect) {
  if (duplicateRuleIds.length) console.error(`Duplicate rules in ledger: ${[...new Set(duplicateRuleIds)].join(", ")}`);
  if (missing.length) console.error(`Rules without tests: ${missing.join(", ")}`);
  if (unregistered.length) console.error(`Tests without rules: ${unregistered.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Rule/test IDs match (${ruleIds.size} rules).`);
}
