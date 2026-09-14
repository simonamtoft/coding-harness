import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const usage = "usage: node capture-scenario.mjs --base <url> --out <dir> --scenario <module.mjs> [--viewport 1280x900] [--media screen|print] [--reduced-motion no-preference|reduce]";

export class CaptureScenarioError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

function requireValue(arguments_, index, name) {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new CaptureScenarioError(`missing value for --${name}\n${usage}`);
  return value;
}

function parseViewport(value) {
  const [width, height] = value.split("x").map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new CaptureScenarioError(`invalid viewport: ${value}`);
  }
  return { width, height };
}

export function parseArguments(arguments_) {
  const options = { viewport: "1280x900", media: "screen", reducedMotion: "no-preference" };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) throw new CaptureScenarioError(`unexpected argument: ${argument}\n${usage}`);
    const name = argument.slice(2);
    if (!["base", "out", "scenario", "viewport", "media", "reduced-motion"].includes(name)) {
      throw new CaptureScenarioError(`unknown option: --${name}\n${usage}`);
    }
    const value = requireValue(arguments_, index, name);
    options[name === "reduced-motion" ? "reducedMotion" : name] = value;
    index += 1;
  }
  if (!options.base || !options.out || !options.scenario) throw new CaptureScenarioError(usage);

  let baseURL;
  try {
    baseURL = new URL(options.base.endsWith("/") ? options.base : `${options.base}/`).href;
  } catch {
    throw new CaptureScenarioError(`invalid --base URL: ${options.base}`);
  }
  if (!baseURL.startsWith("http://") && !baseURL.startsWith("https://")) {
    throw new CaptureScenarioError("--base must be an http or https URL; this captures a served app, not local files");
  }
  if (!["screen", "print"].includes(options.media)) throw new CaptureScenarioError(`invalid media: ${options.media}`);
  if (!["no-preference", "reduce"].includes(options.reducedMotion)) {
    throw new CaptureScenarioError(`invalid reduced motion: ${options.reducedMotion}`);
  }

  return {
    baseURL,
    outputDirectory: resolve(options.out),
    scenarioPath: resolve(options.scenario),
    viewport: parseViewport(options.viewport),
    media: options.media,
    reducedMotion: options.reducedMotion,
  };
}

export async function resolvePlaywright() {
  const requireFromRepository = createRequire(resolve(process.cwd(), "package.json"));
  for (const packageName of ["@playwright/test", "playwright"]) {
    try {
      const modulePath = requireFromRepository.resolve(packageName);
      const imported = await import(pathToFileURL(modulePath).href);
      const playwright = imported.chromium ? imported : imported.default;
      if (playwright?.chromium) return playwright;
    } catch {}
  }
  throw new CaptureScenarioError("Playwright is not installed in this repository; add it before capturing", 2);
}

function capturePath(outputDirectory, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new CaptureScenarioError(`invalid capture name: ${name}; use letters, numbers, dots, underscores, or hyphens`);
  }
  return resolve(outputDirectory, `${name}.png`);
}

export async function runScenario(options, playwright, scenario) {
  mkdirSync(options.outputDirectory, { recursive: true });
  let browser;
  try {
    browser = await playwright.chromium.launch();
    const page = await browser.newPage({ viewport: options.viewport });
    await page.emulateMedia({ media: options.media, reducedMotion: options.reducedMotion });
    const captures = [];
    const names = new Set();
    const capture = async (name, captureOptions = {}) => {
      if (names.has(name)) throw new CaptureScenarioError(`duplicate capture name: ${name}`);
      const path = capturePath(options.outputDirectory, name);
      const viewport = captureOptions.viewport ? parseViewport(captureOptions.viewport) : options.viewport;
      const media = captureOptions.media ?? options.media;
      const reducedMotion = captureOptions.reducedMotion ?? options.reducedMotion;
      if (!["screen", "print"].includes(media) || !["no-preference", "reduce"].includes(reducedMotion)) {
        throw new CaptureScenarioError(`invalid capture options for ${name}`);
      }
      await page.setViewportSize(viewport);
      await page.emulateMedia({ media, reducedMotion });
      await page.evaluate(() => document.fonts?.ready);
      await page.screenshot({ path, fullPage: captureOptions.fullPage === true });
      names.add(name);
      captures.push({
        name,
        path,
        url: page.url(),
        viewport: page.viewportSize(),
        media,
        reducedMotion,
        fullPage: captureOptions.fullPage === true,
      });
      console.log(path);
      return path;
    };

    await scenario({ page, capture, baseURL: options.baseURL, outputDirectory: options.outputDirectory });
    const manifestPath = resolve(options.outputDirectory, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify({ baseURL: options.baseURL, captures }, null, 2)}\n`);
    console.log(manifestPath);
    return { captures, manifestPath };
  } finally {
    await browser?.close();
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const imported = await import(pathToFileURL(options.scenarioPath).href);
    if (typeof imported.default !== "function") throw new CaptureScenarioError("scenario module must default-export an async function");
    await runScenario(options, await resolvePlaywright(), imported.default);
  } catch (error) {
    const code = error instanceof CaptureScenarioError ? error.code : 1;
    console.error(`capture-scenario: ${error.message}`);
    process.exitCode = code;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
