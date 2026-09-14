import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CaptureScenarioError, parseArguments, runScenario } from "./capture-scenario.mjs";

function fakePlaywright() {
  const state = { closed: false, screenshots: [], media: [], viewport: null };
  const page = {
    async emulateMedia(settings) { state.media.push(settings); },
    async setViewportSize(viewport) { state.viewport = viewport; },
    async evaluate() {},
    async screenshot({ path, fullPage }) {
      state.screenshots.push({ path, fullPage });
      await writeFile(path, "png");
    },
    url() { return "http://example.test/deck"; },
    viewportSize() { return state.viewport; },
  };
  return {
    state,
    chromium: {
      async launch() {
        return {
          async newPage({ viewport }) {
            state.viewport = viewport;
            return page;
          },
          async close() { state.closed = true; },
        };
      },
    },
  };
}

test("parseArguments requires a served app and scenario module", () => {
  assert.throws(() => parseArguments(["--base", "file:///slides", "--out", "out", "--scenario", "deck.mjs"]), CaptureScenarioError);
  assert.throws(() => parseArguments(["--base", "http://example.test", "--out", "out"]), CaptureScenarioError);
  assert.deepEqual(
    parseArguments(["--base", "http://example.test", "--out", "out", "--scenario", "deck.mjs", "--viewport", "390x844"]),
    {
      baseURL: "http://example.test/",
      outputDirectory: join(process.cwd(), "out"),
      scenarioPath: join(process.cwd(), "deck.mjs"),
      viewport: { width: 390, height: 844 },
      media: "screen",
      reducedMotion: "no-preference",
    },
  );
});

test("runScenario writes named captures and a manifest", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "capture-scenario-"));
  const playwright = fakePlaywright();
  try {
    const result = await runScenario({
      baseURL: "http://example.test/",
      outputDirectory,
      viewport: { width: 1280, height: 900 },
      media: "screen",
      reducedMotion: "no-preference",
    }, playwright, async ({ capture }) => {
      await capture("live", { fullPage: true });
      await capture("print", { viewport: "390x844", media: "print", reducedMotion: "reduce" });
      await capture("live-again");
    });

    assert.equal(playwright.state.closed, true);
    assert.equal(result.captures.length, 3);
    assert.deepEqual(playwright.state.screenshots.map(({ fullPage }) => fullPage), [true, false, false]);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.deepEqual(manifest.captures.map(({ name, media, reducedMotion, viewport }) => ({ name, media, reducedMotion, viewport })), [
      { name: "live", media: "screen", reducedMotion: "no-preference", viewport: { width: 1280, height: 900 } },
      { name: "print", media: "print", reducedMotion: "reduce", viewport: { width: 390, height: 844 } },
      { name: "live-again", media: "screen", reducedMotion: "no-preference", viewport: { width: 1280, height: 900 } },
    ]);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("runScenario closes the browser when a scenario fails", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "capture-scenario-"));
  const playwright = fakePlaywright();
  try {
    await assert.rejects(
      runScenario({ baseURL: "http://example.test/", outputDirectory, viewport: { width: 1280, height: 900 }, media: "screen", reducedMotion: "no-preference" }, playwright, async () => {
        throw new Error("scenario failed");
      }),
      /scenario failed/,
    );
    assert.equal(playwright.state.closed, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
