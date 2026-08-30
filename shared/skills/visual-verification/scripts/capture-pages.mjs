import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const usage = "usage: node capture-pages.mjs --base <url> --out <dir> [--routes /,/about] [--viewport 1280x900,390x844] [--wait <selector>] [--prefix <name>] [--full-page]";

function fail(message, code = 1) {
  console.error(`capture-pages: ${message}`);
  process.exit(code);
}

const options = { routes: "/", viewport: "1280x900", prefix: "capture" };
const flags = new Set();
for (let index = 0; index < process.argv.length - 2; index += 1) {
  const argument = process.argv[index + 2];
  if (!argument.startsWith("--")) continue;
  const name = argument.slice(2);
  if (name === "full-page") {
    flags.add(name);
    continue;
  }
  const value = process.argv[index + 3];
  if (!value || value.startsWith("--")) fail(`missing value for --${name}\n${usage}`);
  options[name] = value;
}
if (!options.base || !options.out) fail(usage);

let base;
try {
  base = new URL(options.base.endsWith("/") ? options.base : `${options.base}/`);
} catch {
  fail(`invalid --base URL: ${options.base}`);
}
if (base.protocol !== "http:" && base.protocol !== "https:") {
  fail(`--base must be an http or https URL, not ${base.protocol}; this captures a served app, not local files`);
}

const outputDirectory = resolve(options.out);
const routes = options.routes.split(",").map((route) => route.trim()).filter(Boolean);
const viewports = options.viewport.split(",").map((size) => {
  const [width, height] = size.trim().split("x").map(Number);
  if (!width || !height) fail(`invalid viewport: ${size}`);
  return { width, height };
});

const requireFromRepository = createRequire(resolve(process.cwd(), "package.json"));
let modulePath;
for (const packageName of ["@playwright/test", "playwright"]) {
  try {
    modulePath = requireFromRepository.resolve(packageName);
    break;
  } catch {}
}
if (!modulePath) fail("Playwright is not installed in this repository; add it before capturing", 2);

const imported = await import(pathToFileURL(modulePath).href);
const playwright = imported.chromium ? imported : imported.default;
if (!playwright?.chromium) fail("the resolved Playwright package does not export chromium", 2);

mkdirSync(outputDirectory, { recursive: true });

let browser;
try {
  browser = await playwright.chromium.launch();
} catch (error) {
  fail(`managed Chromium is unavailable (${error.message}); run: npx playwright install chromium`, 2);
}

const slug = (route) => route.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "-") || "index";

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport });
  for (const route of routes) {
    const url = new URL(route, base).href;
    try {
      await page.goto(url, { waitUntil: "load" });
    } catch (error) {
      await browser.close();
      fail(`cannot load ${url} (${error.message}); is the server running?`, 3);
    }
    try {
      await page.waitForLoadState("networkidle", { timeout: 5000 });
    } catch {}
    if (options.wait) {
      try {
        await page.waitForSelector(options.wait, { state: "visible", timeout: 10_000 });
      } catch (error) {
        await browser.close();
        fail(`${url}: never became ready (${options.wait}): ${error.message}`, 4);
      }
    }
    await page.evaluate(() => document.fonts?.ready);
    const path = `${outputDirectory}/${options.prefix}-${slug(route)}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path, fullPage: flags.has("full-page") });
    console.log(path);
  }
  await page.close();
}

await browser.close();
