import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "usage: node build-report.mjs <spec.json>";

function fail(message) {
  console.error(`build-report: ${message}`);
  process.exit(1);
}

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isWithin = (root, path) => {
  const distance = relative(root, path);
  return distance === "" || (!distance.startsWith(`..${sep}`) && distance !== ".." && !isAbsolute(distance));
};
const real = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

// Input boundary: the presenter runs in arbitrary repositories under the sandbox allowlist (SBX-40),
// so the spec may only read images from the session workspace or repository, run Git on the
// repository it was started in, and write inside the session workspace.
const SECRET_NAME = /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_[a-z0-9]+|credentials(\.json)?|[^/]*\.(pem|key|p12|pfx))$/i;
const IMAGE_SIGNATURES = {
  ".png": [0x89, 0x50, 0x4e, 0x47],
  ".jpg": [0xff, 0xd8, 0xff],
  ".jpeg": [0xff, 0xd8, 0xff],
  ".gif": [0x47, 0x49, 0x46, 0x38],
  ".webp": [0x52, 0x49, 0x46, 0x46],
};
const MIME = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp" };
const IMAGE_WARN_BYTES = 1_500_000;
const TEXT_LIMITS = { title: 70, summary: 160, changeTitle: 60, note: 140, chip: 40 };
const KINDS = new Set(["diff", "image", "terminal", "steps", "diagram"]);
const CHECK_ICONS = { pass: "✓", fail: "✗", skip: "–" };
const DIFF_CONTEXT_LINES = 1;
const STACK_DIAGRAMS_WIDER_THAN_PX = 900;

const specArgument = process.argv[2] ?? fail(usage);
let spec;
try {
  spec = JSON.parse(readFileSync(resolve(specArgument), "utf8"));
} catch (error) {
  fail(`cannot read spec: ${error.message}`);
}

const sessionRoot = real(process.env.PI_SESSION_TMPDIR || process.env.TMPDIR || "/tmp") ?? fail("session temporary directory is missing");
let repoRoot;
try {
  repoRoot = real(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
} catch {
  repoRoot = undefined;
}

function requireString(value, where) {
  if (typeof value !== "string" || !value.trim()) fail(`${where} must be a non-empty string`);
  return value;
}

function validateSpec() {
  requireString(spec.title, "title");
  const outputParent = real(dirname(resolve(requireString(spec.out, "out"))));
  if (!outputParent || !isWithin(sessionRoot, outputParent)) fail(`out must be inside the session temporary directory ${sessionRoot}`);
  if (!Array.isArray(spec.changes) || !spec.changes.length) fail("changes must be a non-empty array");
  if (spec.ref !== undefined && spec.base !== undefined) fail("set ref or base, not both");
  for (const field of ["ref", "base"]) {
    if (spec[field] !== undefined && (!/^[\w./~^@{}-]+$/.test(spec[field]) || String(spec[field]).startsWith("-"))) fail(`${field} is not a plain Git revision`);
  }
  for (const [index, check] of (spec.checks ?? []).entries()) {
    requireString(check.name, `checks[${index}].name`);
    if (!(check.status in CHECK_ICONS)) fail(`checks[${index}].status must be pass, fail, or skip`);
  }
  spec.changes.forEach((change, index) => {
    const where = `changes[${index}]`;
    if (!KINDS.has(change.kind)) fail(`${where}.kind must be one of ${[...KINDS].join(", ")}`);
    requireString(change.title, `${where}.title`);
    if (change.kind === "diff") {
      requireString(change.file, `${where}.file`);
      if (spec.ref === undefined && spec.base === undefined) fail(`${where} is a diff, so the spec needs ref or base`);
      if (change.hunks !== undefined && (!Array.isArray(change.hunks) || !change.hunks.every((h) => Number.isInteger(h) && h > 0))) fail(`${where}.hunks must be positive integers`);
    } else if (change.after === undefined) {
      fail(`${where}.after is required`);
    }
  });

  const tooLong = [];
  const limit = (value, max, where) => {
    if (typeof value === "string" && value.length > max) tooLong.push(`${where}: ${value.length}/${max} chars`);
  };
  limit(spec.title, TEXT_LIMITS.title, "title");
  limit(spec.summary, TEXT_LIMITS.summary, "summary");
  spec.changes.forEach((change, index) => {
    limit(change.title, TEXT_LIMITS.changeTitle, `changes[${index}].title`);
    limit(change.note, TEXT_LIMITS.note, `changes[${index}].note`);
  });
  (spec.checks ?? []).forEach((check, index) => limit(check.name, TEXT_LIMITS.chip, `checks[${index}].name`));
  (spec.caveats ?? []).forEach((caveat, index) => limit(caveat, TEXT_LIMITS.chip, `caveats[${index}]`));
  if (tooLong.length) fail(`text over limit; cut words instead of adding sections:\n  ${tooLong.join("\n  ")}`);
}

function repoFile(file, where) {
  if (!repoRoot) fail(`${where}: the working directory is not inside a Git repository`);
  if (isAbsolute(file) || SECRET_NAME.test(file)) fail(`${where}: ${file} must be a repository-relative, non-secret path`);
  if (!isWithin(repoRoot, resolve(repoRoot, file))) fail(`${where}: ${file} is outside the repository`);
  return file;
}

function imageDataUri(path, where) {
  const resolved = real(resolve(path));
  if (!resolved) fail(`${where}: ${path} does not exist`);
  if (!(isWithin(sessionRoot, resolved) || (repoRoot && isWithin(repoRoot, resolved))) || SECRET_NAME.test(resolved)) {
    fail(`${where}: images must come from the session temporary directory or the repository`);
  }
  const extension = extname(resolved).toLowerCase();
  const signature = IMAGE_SIGNATURES[extension] ?? fail(`${where}: ${basename(resolved)} is not a png, jpeg, gif, or webp file`);
  const bytes = readFileSync(resolved);
  if (!signature.every((byte, index) => bytes[index] === byte)) fail(`${where}: ${basename(resolved)} is not a valid ${extension.slice(1)} image`);
  if (bytes.length > IMAGE_WARN_BYTES) console.error(`build-report: warning: ${basename(resolved)} is ${(bytes.length / 1e6).toFixed(1)} MB; capture at deviceScaleFactor 1 or as jpeg`);
  return `data:image/${MIME[extension]};base64,${bytes.toString("base64")}`;
}

function diffHunks(file, selected) {
  const args = spec.ref ? ["show", "--format=", "--no-color", spec.ref, "--", file] : ["diff", "--no-color", spec.base, "--", file];
  let text;
  try {
    text = execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    fail(`git ${args[0]} failed for ${file}: ${error.message}`);
  }
  const hunks = [];
  let current;
  for (const line of text.split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (header) {
      current = { a: Number(header[1]), b: Number(header[2]), lines: [] };
      hunks.push(current);
    } else if (current && /^[ +-]/.test(line)) {
      current.lines.push(line);
    }
  }
  if (!hunks.length) fail(`no diff for ${file} at ${spec.ref ?? spec.base}`);
  const chosen = selected ? selected.map((n) => hunks[n - 1] ?? fail(`${file} has no hunk ${n} (it has ${hunks.length})`)) : hunks;
  return chosen.map(trimContext);
}

/** Keeps changed lines plus DIFF_CONTEXT_LINES around them, and the shared leading tab indent removed. */
function trimContext(hunk) {
  const lines = hunk.lines;
  const changed = lines.map((line) => line[0] !== " ");
  const near = lines.map((_, i) => changed.slice(Math.max(0, i - DIFF_CONTEXT_LINES), i + DIFF_CONTEXT_LINES + 1).some(Boolean));
  const rows = [];
  let a = hunk.a;
  let b = hunk.b;
  let skipped = false;
  lines.forEach((line, i) => {
    if (near[i]) {
      if (skipped && rows.length) rows.push({ gap: true });
      rows.push({ line, a, b });
      skipped = false;
    } else {
      skipped = true;
    }
    if (line[0] !== "+") a += 1;
    if (line[0] !== "-") b += 1;
  });
  const indents = lines.filter((line) => line.slice(1).trim()).map((line) => line.slice(1).match(/^\t*/)[0].length);
  return { rows, dedent: indents.length ? Math.min(...indents) : 0 };
}

function intraline(before, after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix += 1;
  const mark = (text, cls) => {
    const middle = text.slice(prefix, text.length - suffix);
    return esc(text.slice(0, prefix)) + (middle ? `<mark class="${cls}">${esc(middle)}</mark>` : "") + esc(text.slice(text.length - suffix));
  };
  return [mark(before, "del"), mark(after, "ins")];
}

function diffTable(hunks) {
  const rows = [];
  const gap = `<tr class="gap"><td colspan="4">⋯</td></tr>`;
  const cell = (number, cls, html, extra = "") => `<td class="n${extra}">${number ?? ""}</td><td class="${cls}${extra}">${html}</td>`;
  hunks.forEach((hunk, index) => {
    if (index > 0) rows.push(gap);
    const strip = (line) => line.slice(1).replace(new RegExp(`^\\t{${hunk.dedent}}`), "");
    const all = hunk.rows;
    let i = 0;
    while (i < all.length) {
      const row = all[i];
      if (row.gap) {
        rows.push(gap);
        i += 1;
        continue;
      }
      if (row.line[0] === " ") {
        const text = esc(strip(row.line));
        rows.push(`<tr class="ctx">${cell(row.a, "", text)}${cell(row.b, "", text, " dup")}</tr>`);
        i += 1;
        continue;
      }
      const removed = [];
      const added = [];
      while (i < all.length && !all[i].gap && all[i].line[0] === "-") removed.push(all[i++]);
      while (i < all.length && !all[i].gap && all[i].line[0] === "+") added.push(all[i++]);
      for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
        const before = removed[k] && strip(removed[k].line);
        const after = added[k] && strip(added[k].line);
        const [beforeHtml, afterHtml] = removed[k] && added[k] ? intraline(before, after) : [removed[k] ? esc(before) : "", added[k] ? esc(after) : ""];
        rows.push(`<tr>${removed[k] ? cell(removed[k].a, "rm", beforeHtml) : cell(undefined, "empty", "", " e")}${added[k] ? cell(added[k].b, "add", afterHtml) : cell(undefined, "empty", "", " e")}</tr>`);
      }
    }
  });
  return `<div class="diff"><div class="diff-head"><span class="tag before">Before</span><span class="tag after">After</span></div><table><colgroup><col class="cn"><col><col class="cn"><col></colgroup>${rows.join("")}</table></div>`;
}

const HIGHLIGHT_CLASSES = [
  "classDef added fill:#ecfdf3,stroke:#067647,stroke-width:2px,color:#054f31",
  "classDef removed fill:#fef3f2,stroke:#b42318,stroke-width:2px,stroke-dasharray:5 4,color:#7a271a",
].join("\n");
const withHighlightClasses = (source) => (/^\s*(flowchart|graph)\b/.test(source) ? `${source.trimEnd()}\n${HIGHLIGHT_CLASSES}` : source);

async function loadPlaywright() {
  try {
    const imported = await import("playwright");
    return imported.chromium ? imported : imported.default;
  } catch {
    fail(`Playwright is not installed for the present skill; run link.sh --packages (or bun install in ${skillDirectory})`);
  }
}

async function renderDiagrams(sources) {
  const svgs = new Map();
  if (!sources.length) return svgs;
  const mermaidPath = resolve(skillDirectory, "node_modules/mermaid/dist/mermaid.min.js");
  if (!existsSync(mermaidPath)) fail(`mermaid is not installed for the present skill; run link.sh --packages (or bun install in ${skillDirectory})`);
  const { chromium } = await loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    fail(`Chromium is unavailable: ${error.message.split("\n")[0]}`);
  }
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: readFileSync(mermaidPath, "utf8") });
    const rendered = await page.evaluate(async (list) => {
      globalThis.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        themeVariables: {
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          fontSize: "14px",
          primaryColor: "#ffffff",
          primaryBorderColor: "#9ca3af",
          primaryTextColor: "#16181d",
          lineColor: "#6b7280",
          secondaryColor: "#f3f4f6",
          tertiaryColor: "#f9fafb",
          actorBkg: "#ffffff",
          actorBorder: "#9ca3af",
          signalColor: "#374151",
          signalTextColor: "#16181d",
          noteBkgColor: "#fffaeb",
          noteBorderColor: "#fedf89",
          clusterBkg: "#f9fafb",
          clusterBorder: "#d1d5db",
        },
        flowchart: { curve: "basis", padding: 12 },
        sequence: { mirrorActors: false, actorMargin: 60 },
      });
      const output = [];
      for (const [index, source] of list.entries()) {
        try {
          output.push({ svg: (await globalThis.mermaid.render(`mmd${index}`, source)).svg });
        } catch (error) {
          output.push({ error: String(error?.message ?? error).split("\n").slice(0, 3).join(" ") });
        }
      }
      return output;
    }, sources.map(withHighlightClasses));
    rendered.forEach((result, index) => {
      if (result.error) fail(`Mermaid could not render diagram ${index + 1}: ${result.error}`);
      svgs.set(sources[index], result.svg);
    });
  } finally {
    await browser.close();
  }
  return svgs;
}

const viewBoxWidth = (svg) => Number(svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)?.[1] ?? 600);

function panes(change, render, extraPairClass = "") {
  const pane = (side, inner) => `<div class="pane ${side}"><span class="tag">${side === "before" ? "Before" : "After"}</span>${inner}</div>`;
  if (change.before === undefined) return `<div class="pane solo">${render(change.after, "after")}</div>`;
  return `<div class="pair${extraPairClass}">${pane("before", render(change.before, "before"))}${pane("after", render(change.after, "after"))}</div>`;
}

function renderChange(change, index, diagrams) {
  const where = `changes[${index}]`;
  let body;
  if (change.kind === "diff") {
    body = diffTable(diffHunks(repoFile(change.file, where), change.hunks));
  } else if (change.kind === "image") {
    body = panes(change, (path, side) => `<img src="${imageDataUri(path, `${where}.${side}`)}" alt="${side}: ${esc(change.title)}">`);
  } else if (change.kind === "terminal") {
    body = panes(change, (text) => `<pre class="term">${esc(text)}</pre>`);
  } else if (change.kind === "steps") {
    const list = (items) => `<ol class="steps">${items.map((item) => `<li${item?.new ? ' class="new"' : ""}>${esc(item?.text ?? item)}</li>`).join("")}</ol>`;
    body = panes(change, list);
  } else {
    const widest = Math.max(...[change.before, change.after].filter(Boolean).map((source) => viewBoxWidth(diagrams.get(source))));
    const figure = (source) => {
      const svg = diagrams.get(source);
      const width = viewBoxWidth(svg);
      return `<div class="mmd"><div style="width:${((width / widest) * 100).toFixed(2)}%;max-width:${Math.round(width * 1.2)}px;--w:${Math.round(width)}px">${svg}</div></div>`;
    };
    body = panes(change, figure, widest > STACK_DIAGRAMS_WIDER_THAN_PX ? " stack" : "");
  }
  const file = change.file ? `<code>${esc(change.file)}</code>` : "";
  const note = change.note ? `<p class="note">${esc(change.note)}</p>` : "";
  return `<section class="change" id="c${index + 1}"><header><span class="num">${index + 1}</span><h2>${esc(change.title)}</h2>${file}</header>${note}${body}</section>`;
}

validateSpec();
const diagramSources = spec.changes.filter((change) => change.kind === "diagram").flatMap((change) => [change.before, change.after]).filter(Boolean);
diagramSources.forEach((source, index) => requireString(source, `diagram source ${index + 1}`));
const diagrams = await renderDiagrams(diagramSources);

const chips = [
  ...(spec.checks ?? []).map((check) => `<span class="chip ${check.status}">${CHECK_ICONS[check.status]} ${esc(check.name)}</span>`),
  ...(spec.caveats ?? []).map((caveat) => `<span class="chip warn">! ${esc(caveat)}</span>`),
].join("");
const css = readFileSync(resolve(skillDirectory, "assets/report.css"), "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(spec.title)}</title><style>${css}</style></head>
<body><main>
<header class="top">${spec.meta ? `<div class="meta">${esc(spec.meta)}</div>` : ""}<h1>${esc(spec.title)}</h1>${spec.summary ? `<p>${esc(spec.summary)}</p>` : ""}${chips ? `<div class="chips">${chips}</div>` : ""}</header>
${spec.changes.map((change, index) => renderChange(change, index, diagrams)).join("\n")}
</main></body></html>
`;
const outputPath = resolve(spec.out);
writeFileSync(outputPath, html);
const size = statSync(outputPath).size;
console.log(outputPath);
if (size > 4_000_000) console.error(`build-report: warning: report is ${(size / 1e6).toFixed(1)} MB`);
