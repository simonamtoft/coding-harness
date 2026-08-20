import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(`assemble-report: ${message}`);
  process.exit(1);
}

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function requiredString(object, field, context) {
  if (typeof object?.[field] !== "string" || !object[field].trim()) {
    fail(`${context}.${field} must be a non-empty string`);
  }
  return object[field];
}

function renderSimpleReport(manifest) {
  if (!Array.isArray(manifest.sections)) fail("sections must be an array in a simple manifest");
  const outcome = manifest.outcome;
  const outcomeHtml = `<header class="hero" id="outcome">
  <span class="section-label">${escapeHtml(requiredString(outcome, "label", "outcome"))}</span>
  <h1>${escapeHtml(requiredString(outcome, "title", "outcome"))}</h1>
  <p>${escapeHtml(requiredString(outcome, "summary", "outcome"))}</p>
</header>`;
  const nav = [`<a href="#outcome">${escapeHtml(outcome.label)}</a>`];
  const seenIds = new Set(["outcome"]);
  const sections = manifest.sections.map((section, index) => {
    const context = `sections[${index}]`;
    const type = requiredString(section, "type", context);
    const id = requiredString(section, "id", context);
    const label = requiredString(section, "label", context);
    const title = requiredString(section, "title", context);
    if (!/^[A-Za-z][\w:.-]*$/.test(id)) fail(`${context}.id is not a valid HTML id`);
    if (seenIds.has(id)) fail(`duplicate simple-report section id: ${id}`);
    seenIds.add(id);
    nav.push(`<a href="#${escapeHtml(id)}">${escapeHtml(section.navLabel || label)}</a>`);
    const sectionHead = `<div class="section-head"><div><span class="section-label">${escapeHtml(label)}</span><h2>${escapeHtml(title)}</h2></div>${section.context ? `<p>${escapeHtml(section.context)}</p>` : ""}</div>`;

    if (type === "prose") {
      if (!Array.isArray(section.paragraphs) || !section.paragraphs.length || section.paragraphs.some((item) => typeof item !== "string")) {
        fail(`${context}.paragraphs must be a non-empty string array`);
      }
      const paragraphs = section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
      return `<section class="section" id="${escapeHtml(id)}">${sectionHead}<div class="card"><div class="prose">${paragraphs}</div></div></section>`;
    }

    if (type === "verification") {
      if (!Array.isArray(section.items) || !section.items.length || section.items.length > 4) {
        fail(`${context}.items must contain one to four metrics`);
      }
      const span = section.items.length === 1 ? 12 : section.items.length === 2 ? 6 : section.items.length === 3 ? 4 : 3;
      const toneColors = { good: "var(--green)", warn: "var(--amber)", bad: "var(--red)", info: "var(--blue)" };
      const items = section.items.map((item, itemIndex) => {
        const itemContext = `${context}.items[${itemIndex}]`;
        const tone = item.tone ?? "info";
        if (!(tone in toneColors)) fail(`${itemContext}.tone must be good, warn, bad, or info`);
        return `<div class="card span-${span}"><span class="card-label">${escapeHtml(requiredString(item, "label", itemContext))}</span><div class="metric" style="color:${toneColors[tone]}">${escapeHtml(requiredString(item, "value", itemContext))}</div><p class="metric-sub">${escapeHtml(requiredString(item, "summary", itemContext))}</p></div>`;
      }).join("\n");
      return `<section class="section" id="${escapeHtml(id)}">${sectionHead}<div class="grid">${items}</div></section>`;
    }

    if (type === "limitations") {
      if (!Array.isArray(section.items) || !section.items.length) fail(`${context}.items must be non-empty`);
      const items = section.items.map((item, itemIndex) => {
        const itemContext = `${context}.items[${itemIndex}]`;
        return `<div class="status"><i style="background:var(--amber-soft);color:var(--amber)">!</i><div><strong>${escapeHtml(requiredString(item, "title", itemContext))}</strong><small>${escapeHtml(requiredString(item, "effect", itemContext))}</small></div></div>`;
      }).join("\n");
      return `<section class="section" id="${escapeHtml(id)}">${sectionHead}<div class="card"><div class="status-list">${items}</div></div></section>`;
    }

    fail(`${context}.type is unsupported: ${type}`);
  });
  return { nav: nav.join("\n"), sections: [outcomeHtml, ...sections].join("\n") };
}

const manifestFlag = process.argv.indexOf("--manifest");
if (manifestFlag === -1 || !process.argv[manifestFlag + 1]) {
  fail("usage: node assemble-report.mjs --manifest <manifest.json>");
}

const manifestPath = resolve(process.argv[manifestFlag + 1]);
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`cannot read manifest ${manifestPath}: ${error.message}`);
}

for (const field of ["title", "subtitle", "footer", "outputFile"]) requiredString(manifest, field, "manifest");
const resolveFromManifest = (path) => resolve(dirname(manifestPath), path);
let content;
if (manifest.outcome || manifest.sections) {
  content = renderSimpleReport(manifest);
} else {
  for (const field of ["navFile", "sectionsFile"]) requiredString(manifest, field, "manifest");
  try {
    content = {
      nav: readFileSync(resolveFromManifest(manifest.navFile), "utf8"),
      sections: readFileSync(resolveFromManifest(manifest.sectionsFile), "utf8"),
    };
  } catch (error) {
    fail(error.message);
  }
}

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = resolve(skillDirectory, "assets/report-template.html");
let html;
try {
  html = readFileSync(templatePath, "utf8")
    .replaceAll("{{REPORT_TITLE}}", escapeHtml(manifest.title))
    .replaceAll("{{REPORT_SUBTITLE}}", escapeHtml(manifest.subtitle))
    .replaceAll("{{REPORT_FOOTER}}", escapeHtml(manifest.footer))
    .replace("{{NAV_LINKS}}", content.nav)
    .replace("{{REPORT_SECTIONS}}", content.sections);
} catch (error) {
  fail(error.message);
}

const placeholders = [...html.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]);
if (placeholders.length) fail(`unresolved placeholders: ${[...new Set(placeholders)].join(", ")}`);

const outputPath = resolveFromManifest(manifest.outputFile);
writeFileSync(outputPath, html);
console.log(outputPath);
