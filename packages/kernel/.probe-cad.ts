import { TEMPLATES, buildDesign } from '@pave/schema'
import { createKernel } from './src/index'
const k = createKernel()
for (const id of ['halo', 'iced-trophy', 'oval-pave']) {
  const d = buildDesign(TEMPLATES.find((t) => t.id === id)!.spec)
  const e = await k.evaluate(d, { detail: 'production' })
  const counts = new Map<string, number>()
  for (const x of e.diagnostics) counts.set(`${x.level} ${x.code} ${x.nodeId} :: ${x.message.slice(0, 90)}${x.fix ? ' [fix]' : ''}`, (counts.get(`${x.level} ${x.code} ${x.nodeId} :: ${x.message.slice(0, 90)}${x.fix ? ' [fix]' : ''}`) ?? 0) + 1)
  console.log(id, e.ms.toFixed(0), 'ms'); for (const [k2, n] of counts) console.log('  ', n, k2)
}
