const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')

const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '41188', '--strictPort'], { stdio: 'ignore' })
async function main() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite failed to start')
    try { if ((await fetch('http://127.0.0.1:41188/examples/grid.html')).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await page.goto('http://127.0.0.1:41188/examples/grid.html')
    await page.getByRole('textbox', { name: 'Filter rows' }).fill('Jet')
    assert.equal(await page.locator('tbody tr').count(), 1)
    assert.match(await page.locator('tbody').innerText(), /Jet Li/)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server.kill('SIGTERM'))
