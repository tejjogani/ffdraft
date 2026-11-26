import sharp from 'sharp'
import { expect, it } from 'vitest'
import { modelImage } from './images'

it('sends an SVG logo as a PNG without altering the original asset', async () => {
  const bytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"><path d="M0 0H128V64Z"/></svg>',
  )
  const image = await modelImage(bytes, 'image/svg+xml')
  expect(image?.mediaType).toBe('image/png')
  expect(await sharp(Buffer.from(image!.data, 'base64')).metadata()).toMatchObject({
    format: 'png',
    width: 128,
    height: 64,
  })
})
