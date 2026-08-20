import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error("usage: node validate-report.mjs <report.html>");
  process.exit(1);
}

const reportPath = process.argv[2] ? resolve(process.argv[2]) : usage();
let html;
try {
  html = readFileSync(reportPath, "utf8");
} catch (error) {
  console.error(`validate-report: ${error.message}`);
  process.exit(1);
}

const errors = [];
const placeholders = [...html.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]);
if (placeholders.length) errors.push(`unresolved placeholders: ${[...new Set(placeholders)].join(", ")}`);

const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`duplicate ids: ${duplicateIds.join(", ")}`);

const localTargets = [...html.matchAll(/<a\b[^>]*\shref=["']#([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
for (const target of [...new Set(localTargets)]) {
  if (!ids.includes(target)) errors.push(`local link has no target: #${target}`);
}

const navMatch = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
const navTargets = navMatch
  ? [...navMatch[1].matchAll(/href=["']#([^"']+)["']/gi)].map((match) => match[1])
  : [];
const majorIds = [...html.matchAll(/<(?:header|section)\b([^>]*)>/gi)].flatMap((match) => {
  const attributes = match[1];
  const id = attributes.match(/\bid=["']([^"']+)["']/i)?.[1];
  const classes = attributes.match(/\bclass=["']([^"']+)["']/i)?.[1].split(/\s+/) ?? [];
  return id && (classes.includes("hero") || classes.includes("section")) ? [id] : [];
});
for (const id of majorIds) {
  if (!navTargets.includes(id)) errors.push(`major section missing from index: #${id}`);
}
for (const id of navTargets) {
  if (!majorIds.includes(id)) errors.push(`index target is not a major section: #${id}`);
}

const runtimePatterns = [
  /<(?:script|img|source|video|audio|iframe)\b[^>]*\bsrc=["']https?:\/\//gi,
  /<link\b[^>]*\bhref=["']https?:\/\//gi,
  /@import\s+(?:url\()?\s*["']?https?:\/\//gi,
  /url\(\s*["']?https?:\/\//gi,
];
if (runtimePatterns.some((pattern) => pattern.test(html))) {
  errors.push("external runtime dependency found");
}

if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) errors.push("missing viewport metadata");
if (!/<main\b/i.test(html)) errors.push("missing main report region");

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
console.log(`✓ ${reportPath}`);
console.log(`  ${majorIds.length} major sections · ${navTargets.length} index items · ${ids.length} ids`);
