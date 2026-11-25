// @ts-nocheck — a driver script, run with tsx; not part of the app's type graph.
/**
 * How the CAD view and the Render tab's live preview hold up on a light machine. Chromium with
 * software GL (SwiftShader) and the CPU slowed four times through the DevTools Protocol stands
 * in, pessimistically, for a 2023 MacBook Air; the window is Retina (device pixel ratio 2) and,
 * by default, the WebGL renderer string is the one Chrome reports on an M2, so the app treats
 * the machine as it would treat the Air.
 *
 * Frames are counted from outside the app (WebGL draw calls on the viewport's canvas, one frame
 * per task), so the same driver measures an old build and a new one:
 *
 *   first view   navigation to the CAD tab → the first frame that draws the piece
 *   orbit        frames per second while a mouse drag orbits for 3 s, and the slowest frames
 *   slider       an arrow-key step on "Width at top" → the first frame drawn with new geometry
 *   idle         frames and animation-frame callbacks in 3 s of doing nothing
 *   viewfinder   frames per second while a drag frames the Render tab's live preview
 *
 *   pnpm --filter @pave/studio build
 *   PORT=8801 PAVE_DATA_DIR=$(mktemp -d) PAVE_RENDER_NONE=1 tsx apps/server/src/main.ts
 *   tsx apps/studio/e2e/light.ts http://127.0.0.1:8801 <out.json> [m2|detected] [screens <dir> <light|dark>]
 *
 * `screens` also photographs the Performance setting and the reduced-quality indicator.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright') as typeof import('playwright')
const [BASE, OUT, GPU = 'm2', MODE = '', SHOTS = '', THEME = 'light'] = process.argv.slice(2)
const TEMPLATES = (process.env.LIGHT_TEMPLATES ?? 'solitaire,halo,oval-pave,eternity').split(',')
const THROTTLE = Number(process.env.LIGHT_THROTTLE ?? 4)
const M2 = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: THEME,
})
// A string, not a function: tsx would wrap a function's inner names in a helper the page lacks.
await ctx.addInitScript({
  content: `(() => {
    const spoof = ${JSON.stringify(GPU === 'm2' ? M2 : null)}
    const theme = ${JSON.stringify(THEME)}

    localStorage.setItem('pave:theme', JSON.stringify(theme))
    const S = { frames: [], uploads: 0, raf: 0, sends: [], evals: [] }
    // Kernel traffic, to split a slider step into the engine's share and the drawing's.
    const NativeWorker = window.Worker
    window.Worker = function (url, options) {
      const w = new NativeWorker(url, options)
      const post = w.postMessage.bind(w)
      w.postMessage = (m, t) => {
        if (m && m.type === 'evaluate' && m.detail !== 'production') S.sends.push(performance.now())
        return post(m, t)
      }
      w.addEventListener('message', (e) => {
        const d = e.data
        if (d && d.type === 'evaluated' && d.evaluation.detail === 'draft')
          S.evals.push({ t: performance.now(), ms: d.evaluation.ms })
      })
      return w
    }
    window.Worker.prototype = NativeWorker.prototype
    window.__light = S
    const kindOf = (canvas) => {
      if (!canvas?.closest) return null
      if (canvas.closest('.stage') && canvas.getAttribute('role') === 'application') return 'cad'
      if ((canvas.getAttribute('aria-label') ?? '').startsWith('Live preview')) return 'vf'
      return null
    }
    let current = null
    let pendingUpload = false
    const begin = (gl, kind) => {
      if (current) return current
      current = {
        kind,
        t: performance.now(),
        calls: 0,
        upload: pendingUpload,
        buffer: gl.drawingBufferWidth,
        css: gl.canvas.clientWidth,
      }
      pendingUpload = false
      S.frames.push(current)
      if (S.frames.length > 5000) S.frames.splice(0, 1000)
      queueMicrotask(() => {
        current = null
      })
      return current
    }
    for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of [
        'drawElements',
        'drawArrays',
        'drawElementsInstanced',
        'drawArraysInstanced',
      ]) {
        const orig = P[name]
        if (!orig) continue
        P[name] = function (...args) {
          const kind = kindOf(this.canvas)
          if (kind) begin(this, kind).calls++
          return orig.apply(this, args)
        }
      }
      const bufferData = P.bufferData
      P.bufferData = function (target, data, ...rest) {
        if (kindOf(this.canvas) && data && data.byteLength > 20_000) {
          S.uploads++
          if (current) current.upload = true
          else pendingUpload = true
        }
        return bufferData.call(this, target, data, ...rest)
      }
      if (spoof) {
        const getParameter = P.getParameter
        P.getParameter = function (p) {
          if (p === 37446) return spoof
          if (p === 37445) return 'Google Inc. (Apple)'
          return getParameter.call(this, p)
        }
      }
    }
    if (spoof) {
      // A real Air never reports a major performance caveat; SwiftShader does.
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, options) {
        if (options?.failIfMajorPerformanceCaveat) options = { ...options, failIfMajorPerformanceCaveat: false }
        return getContext.call(this, type, options)
      }
    }
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      S.raf++
      return raf(cb)
    }
  })()`,
})

// Experiment switch: no backdrop blur anywhere, to see what the glass costs a software compositor.
if (process.env.LIGHT_NOGLASS)
  await ctx.addInitScript({
    content: `addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important }'; document.head.append(s) })`,
  })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
const cdp = await ctx.newCDPSession(page)
const throttle = (rate: number) => cdp.send('Emulation.setCPUThrottlingRate', { rate })

const rpc = async (name: string, input: unknown) => {
  const r = await page.request.post(`${BASE}/api/rpc/${name}`, { data: input })
  if (!r.ok()) throw new Error(`${name}: ${r.status()} ${await r.text()}`)
  return r.json()
}
const frames = (kind: string, since = 0) =>
  page.evaluate(
    ([k, s]) => window.__light.frames.filter((f) => f.kind === k && f.t >= s),
    [kind, since],
  )
const now = () => page.evaluate(() => performance.now())
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null
}
const round = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d)

/** Waits until the canvas has drawn a frame with the piece (several draw calls). */
async function firstPieceFrame(kind: string, since: number, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const f = (await frames(kind, since)).find((x) => x.calls >= 3)
    if (f) return f
    await page.waitForTimeout(100)
  }
  throw new Error(`no ${kind} frame with the piece within ${timeoutMs} ms`)
}

/** Waits until nothing has been drawn for `quietMs`. */
async function settle(kind: string, quietMs = 1500, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const t = await now()
    const last = (await frames(kind, t - quietMs)).length
    if (last === 0) return
    await page.waitForTimeout(300)
  }
}

/** A steady drag across the element for `ms`, at about 60 moves a second. */
async function dragFor(selector: string, ms: number, dx = 600) {
  const box = await page.locator(selector).first().boundingBox()
  const x0 = box.x + box.width * 0.3
  const y = box.y + box.height * 0.55
  await page.mouse.move(x0, y)
  await page.mouse.down()
  const start = Date.now()
  let i = 0
  while (Date.now() - start < ms) {
    const k = (Date.now() - start) / ms
    await page.mouse.move(x0 + dx * k, y + 30 * Math.sin(k * 6))
    i++
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  return i
}

function motionStats(fs, t0: number, t1: number) {
  const inside = fs.filter((f) => f.t >= t0 && f.t <= t1)
  const gaps = inside.slice(1).map((f, i) => f.t - inside[i].t)
  return {
    fps: round(inside.length / ((t1 - t0) / 1000)),
    p95FrameMs: round(pct(gaps, 0.95)),
    worstFrameMs: round(gaps.length ? Math.max(...gaps) : null),
    pixelRatio: round(median(inside.map((f) => f.buffer / Math.max(1, f.css))), 2),
  }
}

const report: Record<string, unknown> = {
  conditions: {
    gl: 'SwiftShader',
    cpuThrottle: THROTTLE,
    deviceScaleFactor: 2,
    viewport: '1440x900',
    renderer: GPU === 'm2' ? M2 : 'as detected',
  },
  templates: {},
}

await page.goto(`${BASE}/`)
await page.locator('#main').waitFor()
const pieces = {}
for (const t of TEMPLATES)
  pieces[t] = (await rpc('pieces.create', { templateId: t, title: `Light ${t}` })).id

let cold = true
for (const t of TEMPLATES) {
  const out: Record<string, unknown> = {}
  report.templates[t] = out
  try {
    // A full page load straight into the CAD tab, timed from navigation start.
    await throttle(THROTTLE)
    const wall = Date.now()
    await page.goto(`${BASE}/pieces/${pieces[t]}/design`)
    await throttle(THROTTLE)
    const first = await firstPieceFrame('cad', 0)
    out.firstViewMs = Math.round(first.t)
    out.firstViewWallMs = Date.now() - wall
    out.coldEngine = cold
    cold = false
    await settle('cad', 2000)
    out.restPixelRatio = round(
      await page.evaluate(() => {
        const c = document.querySelector('.stage canvas[role=application]')
        return c.width / c.clientWidth
      }),
      2,
    )

    // Idle: nothing changes, so nothing should be drawn or scheduled.
    const idle0 = await page.evaluate(() => ({ t: performance.now(), raf: window.__light.raf }))
    await page.waitForTimeout(3000)
    const idle1 = await page.evaluate(() => ({ t: performance.now(), raf: window.__light.raf }))
    out.idleFrames = (await frames('cad', idle0.t)).length
    out.idleRafPerSecond = round((idle1.raf - idle0.raf) / ((idle1.t - idle0.t) / 1000))

    // Orbit.
    const o0 = await now()
    const moves = await dragFor('.stage canvas[role=application]', 3000)
    const o1 = await now()
    out.orbit = { ...motionStats(await frames('cad', o0), o0, o1), moves }
    await settle('cad', 1500)
    out.afterOrbitPixelRatio = round(
      await page.evaluate(() => {
        const c = document.querySelector('.stage canvas[role=application]')
        return c.width / c.clientWidth
      }),
      2,
    )

    // A slider step: arrow key on the band's "Width at top" → a frame with new geometry.
    await throttle(1)
    await page
      .getByRole('treeitem', { name: /Band|Shank/ })
      .first()
      .click()
    const field = page.getByRole('textbox', { name: 'Width at top' }).first()
    await field.waitFor({ timeout: 15_000 })
    await field.click()
    await settle('cad', 1500)
    await throttle(THROTTLE)
    const steps: number[] = []
    const parts: { toKernel: number; kernel: number; kernelSelf: number; toFrame: number }[] = []
    for (let i = 0; i < 5; i++) {
      const s0 = await now()
      await page.keyboard.press(i % 2 ? 'ArrowDown' : 'ArrowUp')
      const end = Date.now() + 30_000
      let hit = null
      while (!hit && Date.now() < end) {
        hit = (await frames('cad', s0)).find((f) => f.upload)
        if (!hit) await page.waitForTimeout(20)
      }
      if (hit) {
        steps.push(hit.t - s0)
        const k = await page.evaluate(
          (t) => ({
            send: window.__light.sends.find((x) => x >= t) ?? null,
            back: window.__light.evals.find((x) => x.t >= t) ?? null,
          }),
          s0,
        )
        if (k.send !== null && k.back)
          parts.push({
            toKernel: k.send - s0,
            kernel: k.back.t - k.send,
            kernelSelf: k.back.ms,
            toFrame: hit.t - k.back.t,
          })
      }
      await settle('cad', 1200)
    }
    out.sliderMs = {
      median: round(median(steps), 0),
      worst: round(Math.max(...steps), 0),
      n: steps.length,
      // Medians of each share: key press to the request, the engine (round trip, and its own
      // time), and the evaluation arriving to the frame that shows it.
      toKernel: round(median(parts.map((p) => p.toKernel)), 0),
      kernel: round(median(parts.map((p) => p.kernel)), 0),
      kernelSelf: round(median(parts.map((p) => p.kernelSelf)), 0),
      toFrame: round(median(parts.map((p) => p.toFrame)), 0),
    }
    await page.keyboard.press('Escape')
    await throttle(1)

    // The Render tab's live preview.
    const v0 = await now()
    await page.evaluate((url) => {
      history.pushState(null, '', url)
      dispatchEvent(new PopStateEvent('popstate'))
    }, `/pieces/${pieces[t]}/render`)
    await throttle(THROTTLE)
    const vf = await firstPieceFrame('vf', v0, 180_000)
    out.viewfinderFirstMs = Math.round(vf.t - v0)
    await settle('vf', 2000, 120_000)
    const d0 = await now()
    await dragFor('canvas[aria-label^="Live preview"]', 3000, 300)
    const d1 = await now()
    out.viewfinderDrag = motionStats(await frames('vf', d0), d0, d1)
    await throttle(1)
    // Let the release (a save and a full redraw) finish before the next template.
    await settle('vf', 2000, 120_000)
    out.heapMb = await page.evaluate(() =>
      performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    )
  } catch (e) {
    out.error = String(e?.message ?? e)
    await throttle(1)
  }
  console.log(t, JSON.stringify(out))
}

if (MODE === 'screens') {
  mkdirSync(SHOTS, { recursive: true })
  const shot = async (name: string, locator?) => {
    await page.waitForTimeout(600)
    await (locator ?? page).screenshot({ path: `${SHOTS}/${name}.${THEME}.png` })
    console.log('shot', name)
  }
  await throttle(1)
  await page.goto(`${BASE}/settings/general`)
  await page
    .getByRole('radiogroup', { name: 'Performance' })
    .or(page.getByLabel('Performance'))
    .first()
    .waitFor()
  await shot('01-setting')
  const t = TEMPLATES.includes('halo') ? 'halo' : TEMPLATES[0]
  await page.goto(`${BASE}/pieces/${pieces[t]}/design`)
  const since = await now()
  await firstPieceFrame('cad', since)
  await settle('cad', 2000)
  await throttle(THROTTLE)
  // The indicator shows while quality is reduced: during an orbit on a slow machine.
  const box = await page.locator('.stage canvas[role=application]').boundingBox()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await page.mouse.down()
  // Keep moving while the screenshot is taken, so it shows the light picture mid-orbit.
  let moving = true
  const orbit = (async () => {
    for (let i = 0; moving; i++) {
      await page.mouse.move(box.x + box.width * 0.3 + (i % 60) * 6, box.y + box.height * 0.5)
      await page.waitForTimeout(16)
    }
  })()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${SHOTS}/02-orbiting.${THEME}.png` })
  console.log('shot 02-orbiting')
  moving = false
  await orbit
  await page.mouse.up()
  await throttle(1)
  await page.waitForTimeout(2500)
  await shot('03-settled')
  const indicator = page.locator('[data-quality-indicator]')
  if (await indicator.count()) {
    await indicator.first().click()
    await shot('04-indicator-menu')
    await page.keyboard.press('Escape')
  }
  await page.goto(`${BASE}/pieces/${pieces[t]}/render`)
  await page.waitForTimeout(4000)
  await shot('05-render-tab')
}

report.at = new Date().toISOString()
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
await browser.close()
