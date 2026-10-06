const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { createServer } = require('node:net')
const assert = require('node:assert/strict')

let BASE
let server

// A port chosen at run time, so an agent cannot learn it from earlier feedback and occupy it.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

// Ready only when this verification copy is served: probe-tests/ never exists in the agent's copy.
async function startVite() {
  const port = await freePort()
  BASE = `http://127.0.0.1:${port}`
  server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite failed to start')
    try { if ((await fetch(`${BASE}/probe-tests/keyed.html`)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not start')
}
const artifact = process.env.PROBE_ARTIFACT_DIR
const viewports = JSON.parse(process.env.PROBE_VIEWPORTS)

// Rows by data-id, plus each row's DOM identity tag and checkbox state, so a fix that re-creates
// rows (losing per-row state) or drops the key fails as well as one that misorders them.
const rows = (page) => page.$$eval('.playlist li', (items) => items.map((li) => ({
  id: Number(li.dataset.id),
  title: li.querySelector('.title').textContent.trim(),
  tag: li.probeTag ?? null,
  keep: li.querySelector('input[type=checkbox]').checked,
})))

const TITLES = { 1: 'Paper Kites', 2: 'Quiet Engines', 3: 'Harbour', 4: 'Morning Light', 5: 'Northbound' }

async function expectOrder(page, step, ids) {
  const current = await rows(page)
  assert.deepEqual(current.map((row) => row.id), ids, `${step}: row order`)
  for (const row of current) {
    assert.equal(row.title, TITLES[row.id], `${step}: title of track ${row.id}`)
    assert.equal(row.tag, `track-${row.id}`, `${step}: track ${row.id} must keep its original row element`)
    assert.equal(row.keep, row.id === 4, `${step}: Keep checkbox must stay with its track`)
  }
  assert.match(await page.locator('.summary').innerText(), /5 tracks, 25:26 total/, `${step}: summary`)
}

async function playlist(page) {
  await page.goto(`${BASE}/examples/playlist.html`)
  await page.locator('.playlist li').first().waitFor()
  await page.$$eval('.playlist li', (items) => items.forEach((li) => { li.probeTag = `track-${li.dataset.id}` }))
  await page.locator('.playlist li[data-id="4"] input[type=checkbox]').check()
  await expectOrder(page, 'initial', [1, 2, 3, 4, 5])

  await page.getByRole('button', { name: 'Sort by length' }).click()
  await expectOrder(page, 'sort by length', [4, 5, 1, 2, 3])
  await page.getByRole('button', { name: 'Original order' }).click()
  await expectOrder(page, 'original order after sorting', [1, 2, 3, 4, 5])
  await page.getByRole('button', { name: 'Sort by title' }).click()
  await expectOrder(page, 'sort by title', [3, 4, 5, 1, 2])
  await page.locator('.playlist li[data-id="2"]').getByRole('button', { name: 'Move to top' }).click()
  await expectOrder(page, 'move Quiet Engines to top', [2, 3, 4, 5, 1])
  await page.getByRole('button', { name: 'Sort by length' }).click()
  await expectOrder(page, 'sort by length again', [4, 5, 1, 2, 3])
}

async function keyedPermutations(page) {
  await page.goto(`${BASE}/probe-tests/keyed.html`)
  await page.waitForFunction(() => window.probeState)
  let seed = 20261006
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let round = 0; round < 300; round++) {
    const size = 1 + Math.floor(random() * 8)
    const before = Array.from({ length: size }, (_, i) => i).filter(() => random() < 0.8)
    const after = Array.from({ length: size }, (_, i) => i).filter(() => random() < 0.8).sort(() => random() - 0.5)
    const result = await page.evaluate(async ([before, after]) => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
      window.probeState.items = before
      await tick()
      const elements = new Map([...document.querySelectorAll('#keyed li')].map((li) => [Number(li.dataset.id), li]))
      window.probeState.items = after
      await tick()
      const items = [...document.querySelectorAll('#keyed li')]
      return {
        order: items.map((li) => Number(li.textContent)),
        reused: items.every((li) => !elements.has(Number(li.dataset.id)) || elements.get(Number(li.dataset.id)) === li),
      }
    }, [before, after])
    assert.deepEqual(result.order, after, `keyed list ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    assert.ok(result.reused, `keyed list ${JSON.stringify(before)} -> ${JSON.stringify(after)} must reuse kept elements`)
  }
}

async function main() {
  await startVite()
  const browser = await chromium.launch()
  try {
    // The demo flow runs in every supplied viewport and ends on a screenshot for human review.
    for (const [name, options] of Object.entries(viewports)) {
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(5000)
        page.on('pageerror', (error) => console.error('browser error:', error.message))
        await playlist(page)
        assert.equal(await page.evaluate(() => innerWidth), options.viewport.width, `${name}: viewport not applied`)
        mkdirSync(artifact, { recursive: true })
        await page.screenshot({ path: join(artifact, `${name}.png`), fullPage: true })
      } finally {
        await context.close()
      }
    }
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await keyedPermutations(page)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server?.kill('SIGTERM'))
