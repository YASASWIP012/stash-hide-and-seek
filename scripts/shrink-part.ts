// Shrink a Lux3D part mesh for the web. Articulation outputs flat-shaded triangles that share no
// vertices, so plain weld cannot merge them: drop normals, weld, simplify, then rebuild normals.
// usage: node --experimental-strip-types scripts/shrink-part.ts in.glb out.glb [ratio] [texture px]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, normals, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, ratio = '0.1', px = '512'] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: shrink-part.ts in.glb out.glb [ratio] [texture px]');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
}
await MeshoptSimplifier.ready;
await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: 0.003, lockBorder: false }),
  normals({ overwrite: true }),
  textureCompress({ encoder: sharp, resize: [Number(px), Number(px)] }),
  prune(),
);
await io.write(output, doc);
