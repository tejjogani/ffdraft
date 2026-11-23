import { it } from 'vitest'
import { z } from 'zod'
import { describeFields, RenderSceneSchema } from './index'
it('x', () => {
  const js = z.toJSONSchema(RenderSceneSchema, { io: 'input' }) as any
  const titled: string[] = []
  const walk = (j: any, path: string) => {
    if (!j || typeof j !== 'object') return
    if (j.title && path) titled.push(path)
    for (const [k, v] of Object.entries(j.properties ?? {})) walk(v, path ? `${path}.${k}` : k)
    for (const v of j.anyOf ?? []) walk(v, path)
    for (const v of j.oneOf ?? []) walk(v, path)
    if (j.additionalProperties && typeof j.additionalProperties === 'object') walk(j.additionalProperties, path + '.*')
    if (j.items) walk(j.items, path + '[]')
  }
  walk(js, '')
  console.log(titled)
  const flat = (fs: any[], p = ''): string[] => fs.flatMap((f) => [p + f.key, ...flat(f.fields ?? [], p + f.key + '.'), ...(f.variants ?? []).flatMap((v: any) => flat(v.fields, p + f.key + '.'))])
  console.log(flat(describeFields(RenderSceneSchema)))
})
