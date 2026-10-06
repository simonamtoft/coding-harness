const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { createServer } = require('node:net')
const assert = require('node:assert/strict')

const artifact = process.env.PROBE_ARTIFACT_DIR
const viewports = JSON.parse(process.env.PROBE_VIEWPORTS)
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
    try { if ((await fetch(`${BASE}/probe-tests/chain.html`)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not start')
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)))

async function expectSummary(page, step, subtotal, shipping, total) {
  await settle(page)
  const text = async (selector) => (await page.locator(selector).innerText()).trim()
  assert.equal(await text('.summary .subtotal'), subtotal, `${step}: subtotal`)
  assert.equal(await text('.summary .shipping'), shipping, `${step}: shipping`)
  assert.equal(await text('.summary .total'), total, `${step}: total`)
}

async function setQuantity(page, id, qty) {
  await page.locator(`tr[data-id="${id}"] input`).fill(String(qty))
}

async function cart(page) {
  await page.goto(`${BASE}/examples/cart.html`)
  await page.locator('tr[data-id="beans"]').waitFor()
  await expectSummary(page, 'initial', '$21.00', '$5.95', '$26.95')
  await setQuantity(page, 'mug', 1)
  await expectSummary(page, 'add a travel mug', '$39.00', '$5.95', '$44.95')
  await setQuantity(page, 'beans', 2)
  await expectSummary(page, 'second bag of beans', '$51.50', 'Free', '$51.50')
  assert.equal((await page.locator('tr[data-id="beans"] .line').innerText()).trim(), '$25.00', 'beans line total')
  await setQuantity(page, 'filters', 0)
  await expectSummary(page, 'remove filters', '$43.00', '$5.95', '$48.95')
  await setQuantity(page, 'mug', 0)
  await setQuantity(page, 'beans', 0)
  await expectSummary(page, 'empty cart', '$0.00', 'Free', '$0.00')
  await setQuantity(page, 'beans', 4)
  await expectSummary(page, 'refill', '$50.00', 'Free', '$50.00')
}

// Effects that write state read by other effects must all settle by the next nextTick().
async function chainedEffects(page) {
  await page.goto(`${BASE}/probe-tests/chain.html`)
  await page.waitForFunction(() => window.probe)
  await settle(page)
  for (const a of [5, 7, -1]) {
    const shown = await page.evaluate(async (a) => {
      window.probe.state.a = a
      await window.probe.nextTick()
      return ['#a', '#c', '#d'].map((selector) => document.querySelector(selector).textContent.trim())
    }, a)
    assert.deepEqual(shown, [String(a), String(a * 2 + 1), String((a * 2 + 1) * 10)], `chained effects after a = ${a}`)
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
        await cart(page)
        assert.equal(await page.evaluate(() => innerWidth), options.viewport.width, `${name}: viewport not applied`)
        mkdirSync(artifact, { recursive: true })
        await page.screenshot({ path: join(artifact, `${name}.png`), fullPage: true })
      } finally {
        await context.close()
      }
    }
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await chainedEffects(page)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server?.kill('SIGTERM'))
