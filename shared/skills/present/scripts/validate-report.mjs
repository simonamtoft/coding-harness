import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reportPath = process.argv[2] ? resolve(process.argv[2]) : (console.error("usage: node validate-report.mjs <report.html>"), process.exit(1));
let html;
try {
  html = readFileSync(reportPath, "utf8");
} catch (error) {
  console.error(`validate-report: ${error.message}`);
  process.exit(1);
}

const errors = [];
if (/<script\b/i.test(html)) errors.push("report contains a script; reports are static");

const ids = [...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicateIds.length) errors.push(`duplicate ids: ${duplicateIds.join(", ")}`);

const runtimePatterns = [
  /<(?:img|source|video|audio|iframe|image|use)\b[^>]*\b(?:src|href|xlink:href)=["']https?:\/\//gi,
  /<link\b[^>]*\bhref=["']https?:\/\//gi,
  /@import\s+(?:url\()?\s*["']?https?:\/\//gi,
  /url\(\s*["']?https?:\/\//gi,
];
if (runtimePatterns.some((pattern) => pattern.test(html))) errors.push("external runtime dependency found");

if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) errors.push("missing viewport metadata");
if (!/<main\b/i.test(html)) errors.push("missing main report region");
const changes = (html.match(/<section class="change"/g) ?? []).length;
if (!changes) errors.push("report has no changes");

if (errors.length) {
  for (const error of errors) console.error(`✗ ${error}`);
  process.exit(1);
}
console.log(`✓ ${reportPath}`);
console.log(`  ${changes} changes · ${(html.length / 1e3).toFixed(0)} kB`);
