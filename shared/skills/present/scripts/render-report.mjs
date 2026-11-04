import { mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function fail(message, code = 1) {
  console.error(`render-report: ${message}`);
  process.exit(code);
}

const [reportArgument, captureArgument] = process.argv.slice(2);
if (!reportArgument || !captureArgument) fail("usage: node render-report.mjs <report.html> <capture-directory>");

// Same boundary as build-report: reports and captures live in the session workspace (SBX-40).
const sessionRoot = realpathSync(process.env.PI_SESSION_TMPDIR || process.env.TMPDIR || "/tmp");
const within = (path) => {
  const distance = relative(sessionRoot, path);
  return distance === "" || (!distance.startsWith(`..${sep}`) && distance !== ".." && !isAbsolute(distance));
};
const reportPath = realpathSync(resolve(reportArgument));
const captureDirectory = resolve(captureArgument);
mkdirSync(captureDirectory, { recursive: true });
if (!within(reportPath) || !within(realpathSync(captureDirectory))) fail(`report and captures must be inside ${sessionRoot}`);

let playwright;
try {
  const imported = await import("playwright");
  playwright = imported.chromium ? imported : imported.default;
} catch {
  fail(`Playwright is not installed for the present skill; run link.sh --packages (or bun install in ${resolve(dirname(fileURLToPath(import.meta.url)), "..")})`, 2);
}

let browser;
try {
  browser = await playwright.chromium.launch();
} catch (error) {
  fail(`Chromium is unavailable: ${error.message.split("\n")[0]}`, 2);
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const issues = [];
const written = [];
try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
    await page.goto(pathToFileURL(reportPath).href);
    const found = await page.evaluate(() => {
      const problems = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`page overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
      for (const element of document.querySelectorAll(".pane,.diff,.term,h1,.note")) {
        if (element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === "visible") {
          problems.push(`clipped ${element.className || element.tagName} in ${element.closest(".change")?.id ?? "header"}`);
        }
      }
      return problems;
    });
    issues.push(...found.map((issue) => `${viewport.name}: ${issue}`));
    const path = resolve(captureDirectory, `${viewport.name}.png`);
    await page.screenshot({ path, fullPage: true });
    written.push(path);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`report: ${basename(reportPath)}`);
for (const path of written) console.log(`capture: ${path}`);
if (issues.length) {
  for (const issue of issues) console.error(`✗ ${issue}`);
  process.exit(1);
}
console.log("✓ no page overflow or clipped content at desktop and mobile widths");
