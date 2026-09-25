const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')

const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '41190', '--strictPort'], { stdio: 'ignore' })
async function main() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Vite failed to start')
    try { if ((await fetch('http://127.0.0.1:41190/examples/budget.html')).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(existsSync('examples/budget.css'), 'missing separate stylesheet')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    await page.goto('http://127.0.0.1:41190/')
    await page.getByRole('link', { name: /budget/i }).click()
    await page.getByText('$19.75', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Food' }).click()
    await page.getByText('$12.50', { exact: true }).waitFor()
    assert.equal(await page.getByText(/Travel.*\$7\.25/).count(), 0)
    await page.getByRole('button', { name: /all|reset/i }).click()
    await page.getByText('$19.75', { exact: true }).waitFor()
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => server.kill('SIGTERM'))
