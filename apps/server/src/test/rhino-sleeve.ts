import { readRhino3dm } from '@pave/kernel/rhino-import'
import { makeCappedPrismFixture } from '../../../../packages/kernel/test-fixtures/capped-prism'
import { putAsset } from '../assets/assets'
import type { Client, TestServer } from './harness'

/** Import the synthetic sleeve through the same paired native and measured assets as Studio. */
export async function createRhinoSleeve(server: TestServer, api: Client, scale = 1) {
  const { objects } = await readRhino3dm(await makeCappedPrismFixture())
  const part = objects[0]!
  if (!part.native) throw Error('Fixture should contain a closed Rhino solid')
  const ctx = await server.runtime.context(server.runtime.local!)
  const mesh = await putAsset(ctx, {
    name: 'Sleeve.stl',
    kind: 'mesh',
    mime: 'model/stl',
    bytes: part.bytes,
  })
  const native = await putAsset(ctx, {
    name: 'Sleeve.3dm',
    kind: 'mesh',
    mime: 'model/vnd.3dm',
    bytes: part.native.bytes,
  })
  const { id } = await api.call('pieces.create', { title: 'Sleeve end-face test', kind: 'other' })
  await api.call('design.apply', {
    pieceId: id,
    label: 'Imported sleeve',
    ops: [
      {
        t: 'add',
        node: {
          kind: 'meshBody',
          id: 'sleeve',
          name: 'Sleeve',
          source: {
            type: 'asset',
            assetId: mesh.id,
            nativeAssetId: native.id,
            nativeMeshAssetId: mesh.id,
            rhinoObjectId: part.native.objectId,
          },
          keepSourcePlacement: true,
          transform: { position: [4, 5, 6], rotation: [90, 0, 0], scale },
        },
      },
    ],
  })
  return { pieceId: id, nodeId: 'sleeve' }
}
