const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')

const port = 41187
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const artifact = process.env.PROBE_ARTIFACT_DIR
const viewports = JSON.parse(process.env.PROBE_VIEWPORTS)

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Vite exited before startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/examples/grid.html`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Vite did not start')
}

async function main() {
  await ready()
  const browser = await chromium.launch()
  try {
    for (const [name, options] of Object.entries(viewports)) {
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(5000)
        page.on('pageerror', (error) => console.error('browser error:', error.message))
        await page.goto(`http://127.0.0.1:${port}/examples/grid.html`)
        assert.equal(await page.evaluate(() => innerWidth), options.viewport.width, `${name}: missing responsive viewport`)
        const power = page.locator('th').filter({ hasText: /power/i })
        assert.equal(await page.locator('tbody tr').count(), 4, `grid failed to mount: ${await page.locator('body').innerText()}`)
        const control = await power.locator('button').count() ? power.locator('button').first() : power
        await control.focus()
        await page.keyboard.press('Enter')
        const firstSort = await power.getAttribute('aria-sort')
        assert.ok(['ascending', 'descending'].includes(firstSort), `missing sort state: ${firstSort}`)
        await control.focus()
        await page.keyboard.press('Space')
        assert.equal(await power.getAttribute('aria-sort'), firstSort === 'ascending' ? 'descending' : 'ascending')
        await power.click()
        assert.equal(await power.getAttribute('aria-sort'), firstSort)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal page overflow`)
        mkdirSync(artifact, { recursive: true })
        await page.screenshot({ path: join(artifact, `${name}.png`), fullPage: true })
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => {
  server.kill('SIGTERM')
})
