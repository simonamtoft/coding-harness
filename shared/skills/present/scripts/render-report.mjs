import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function fail(message, code = 1) {
  console.error(`render-report: ${message}`);
  process.exit(code);
}

const arguments_ = process.argv.slice(2);
const captureAll = arguments_.includes("--all");
const positional = arguments_.filter((argument) => argument !== "--all");
const reportPath = positional[0] ? resolve(positional[0]) : fail("usage: node render-report.mjs <report.html> [capture-directory] [--all]");
const captureDirectory = resolve(positional[1] ?? `${process.env.TMPDIR || "/tmp"}/agent-final-captures`);
const requireFromRepository = createRequire(resolve(process.cwd(), "package.json"));

let modulePath;
for (const packageName of ["@playwright/test", "playwright"]) {
  try {
    modulePath = requireFromRepository.resolve(packageName);
    break;
  } catch {}
}
if (!modulePath) fail("Playwright is not available in the active repository", 2);

let playwright;
try {
  const imported = await import(pathToFileURL(modulePath).href);
  playwright = imported.chromium ? imported : imported.default;
} catch (error) {
  fail(`cannot load Playwright from the active repository: ${error.message}`, 2);
}
if (!playwright?.chromium) fail("the resolved Playwright package does not export chromium", 2);

mkdirSync(captureDirectory, { recursive: true });
let browser;
try {
  browser = await playwright.chromium.launch();
} catch (error) {
  fail(`Chromium is unavailable: ${error.message}`, 2);
}

const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(reportPath).href);
await page.waitForTimeout(250);

const issues = await page.evaluate(() => {
  const found = [];
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    found.push(`page overflow: ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
  }
  const selectors = ".card,.visual-example,.terminal,.concept-diff,.graph,.hero h1,.hero p";
  for (const element of document.querySelectorAll(selectors)) {
    const overflow = getComputedStyle(element).overflowX;
    if (element.scrollWidth > element.clientWidth + 2 && overflow === "visible") {
      found.push(`clipped ${element.className || element.tagName}: ${element.scrollWidth} > ${element.clientWidth}`);
    }
  }
  for (const svg of document.querySelectorAll("svg")) {
    const viewBox = svg.viewBox?.baseVal;
    if (!viewBox) continue;
    for (const text of svg.querySelectorAll("text")) {
      let box;
      try { box = text.getBBox(); } catch { continue; }
      const tolerance = 1;
      if (box.x < viewBox.x - tolerance || box.y < viewBox.y - tolerance ||
          box.x + box.width > viewBox.x + viewBox.width + tolerance ||
          box.y + box.height > viewBox.y + viewBox.height + tolerance) {
        found.push(`SVG text outside viewBox: "${text.textContent.trim().slice(0, 50)}"`);
      }
    }
  }
  return found;
});

let captureCount = 0;
const hero = page.locator(".hero").first();
if (await hero.count()) {
  await hero.screenshot({ path: resolve(captureDirectory, "01-hero.png") });
  captureCount += 1;
}

const sections = page.locator(".section[id]");
let skippedSections = 0;
for (let index = 0; index < await sections.count(); index += 1) {
  const section = sections.nth(index);
  const visuallyDense = await section.locator(".visual-example,.graph,.chart,.terminal,.concept-diff,.data-table,.metric,.decision,.feature-split").count();
  if (!captureAll && !visuallyDense) {
    skippedSections += 1;
    continue;
  }
  const id = await section.getAttribute("id");
  const safeId = (id || `section-${index + 1}`).replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  await section.screenshot({ path: resolve(captureDirectory, `${String(captureCount + 1).padStart(2, "0")}-${safeId}.png`) });
  captureCount += 1;
}

await browser.close();
console.log(`report: ${basename(reportPath)}`);
console.log(`captures: ${captureDirectory} (${captureCount} images)`);
if (skippedSections) console.log(`skipped prose-only sections: ${skippedSections} (use --all to capture them)`);
if (issues.length) {
  for (const issue of issues) console.error(`✗ ${issue}`);
  process.exit(1);
}
console.log("✓ no page, component, or SVG-boundary clipping detected");
