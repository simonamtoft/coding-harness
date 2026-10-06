const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')

const PORT = 41192
const BASE = `http://127.0.0.1:${PORT}`
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })

const texts = (page, list) => page.$$eval(`#${list} li`, (items) => items.map((li) => li.textContent.trim()))

// Tags the current keyed elements, then after `change` reports whether every surviving key kept its element.
async function reusesKeyedElements(page, list, survivors, change) {
  await page.$$eval(`#${list} li`, (items) => items.forEach((li) => { li.probeTag = li.dataset.id }))
  await page.evaluate(change)
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
  const tags = await page.$$eval(`#${list} li`, (items) => items.map((li) => [li.dataset.id, li.probeTag ?? null]))
  return survivors.every((id) => tags.some(([key, tag]) => key === id && tag === id))
}

async function main() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite failed to start')
    try { if ((await fetch(`${BASE}/probe-tests/iterables.html`)).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(`${BASE}/probe-tests/iterables.html`)
    await page.waitForFunction(() => window.probeState)
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))

    assert.deepEqual(await texts(page, 'map'), ['0:tea=3', '1:coffee=4'], 'Map entries')
    assert.deepEqual(await texts(page, 'set'), ['0:red', '1:green'], 'Set values')
    assert.deepEqual(await texts(page, 'string'), ['0:a', '1:b', '2:c'], 'string characters')
    assert.deepEqual(await texts(page, 'generator'), ['0:3', '1:2', '2:1'], 'generator values')
    assert.deepEqual(await texts(page, 'object'), ['0:x=1', '1:y=2'], 'plain object behavior is unchanged')
    assert.deepEqual(await texts(page, 'array'), ['0:p', '1:q'], 'array behavior is unchanged')
    assert.deepEqual(await texts(page, 'range'), ['1', '2', '3'], 'number range behavior is unchanged')

    assert.ok(await reusesKeyedElements(page, 'map', ['coffee'], () => {
      const prices = window.probeState.prices
      prices.set('juice', 5)
      prices.delete('tea')
      prices.set('coffee', 6)
    }), 'Map updates must reuse keyed elements')
    assert.deepEqual(await texts(page, 'map'), ['0:coffee=6', '1:juice=5'], 'Map after set/delete')

    assert.ok(await reusesKeyedElements(page, 'set', ['green'], () => {
      const tags = window.probeState.tags
      tags.add('blue')
      tags.delete('red')
    }), 'Set updates must reuse keyed elements')
    assert.deepEqual(await texts(page, 'set'), ['0:green', '1:blue'], 'Set after add/delete')

    await page.evaluate(() => { window.probeState.word = 'hi' })
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
    assert.deepEqual(await texts(page, 'string'), ['0:h', '1:i'], 'string after change')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server.kill('SIGTERM'))
