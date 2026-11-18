import type { Container, RoomManifest } from '../src/core/types.ts';

const drawer = (id: string, x: number, size: [number, number, number] = [0.8, 0.2, 0.45]): Container => ({
  id,
  label: id,
  kind: 'drawer',
  box: { center: [x, 0.5, 0], size, yaw: 0 },
  joint: { type: 'prismatic', axis: [0, 0, 1], origin: [x, 0.5, 0.2], lower: 0, upper: 0.35, source: 'estimate' },
  approach: [x, 0.8],
});

export function testRoom(): RoomManifest {
  return {
    id: 'test-room',
    title: 'Test room',
    owner: null,
    capturedOn: null,
    status: 'placeholder',
    floor: [
      [-2, -1],
      [2, -1],
      [2, 2],
      [-2, 2],
    ],
    spawn: [0, 1.5],
    fixtures: [],
    containers: [
      drawer('near-small', 0.2, [0.4, 0.15, 0.4]),
      drawer('far-big', 1.8, [1.0, 0.4, 0.6]),
      {
        id: 'wardrobe',
        label: 'Wardrobe',
        kind: 'wardrobe',
        box: { center: [-1.5, 1, 0], size: [1, 2, 0.6], yaw: 0 },
        joint: { type: 'revolute', axis: [0, 1, 0], origin: [-2, 1, 0.3], lower: 0, upper: 1.6, source: 'estimate' },
        approach: [-1.5, 1],
      },
    ],
    provenance: [],
  };
}
