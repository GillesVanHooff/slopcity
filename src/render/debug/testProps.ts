/**
 * Debug-only scenery (enabled with `?debug` in the URL): a handful of blocks and trees
 * near the map centre so scale, lighting and shadows can be judged before real content
 * exists. Not part of the game world; never touches sim state.
 */

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { Rng } from '../../core/rng';
import type { World } from '../../sim/world';

export function createTestProps(world: World): { group: Group; dispose(): void } {
  const group = new Group();
  group.name = 'debug-test-props';
  const rng = new Rng(1234);
  const cx = Math.floor(world.grid.width / 2);
  const cz = Math.floor(world.grid.height / 2);

  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const trunk = new CylinderGeometry(0.06, 0.08, 0.35, 6);
  trunk.translate(0, 0.175, 0);
  const crown = new ConeGeometry(0.32, 0.9, 7);
  crown.translate(0, 0.75, 0);

  const wall = [0xe8e2d0, 0xd9c7a8, 0xc5d0d8, 0xe3b9a0].map(
    (c) => new MeshLambertMaterial({ color: c, flatShading: true }),
  );
  const bark = new MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true });
  const leaves = new MeshLambertMaterial({ color: 0x3f7a3a, flatShading: true });

  // A small block of "buildings" on a 2-tile rhythm, leaving gaps where streets would go.
  for (let dz = -4; dz <= 4; dz += 2) {
    for (let dx = -4; dx <= 4; dx += 2) {
      if (rng.chance(0.25)) continue;
      const m = new Mesh(box, rng.pick(wall));
      const h = rng.range(0.6, 3.5);
      m.scale.set(0.84, h, 0.84);
      m.position.set(cx + dx + 0.5, 0, cz + dz + 0.5);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // A little grove next to it.
  for (let i = 0; i < 40; i++) {
    const x = cx + 7 + rng.int(0, 7);
    const z = cz - 4 + rng.int(0, 8);
    const tree = new Group();
    const t = new Mesh(trunk, bark);
    const c = new Mesh(crown, leaves);
    t.castShadow = c.castShadow = true;
    tree.add(t, c);
    tree.position.set(x + rng.range(0.25, 0.75), 0, z + rng.range(0.25, 0.75));
    tree.scale.setScalar(rng.range(0.8, 1.3));
    tree.rotation.y = rng.range(0, Math.PI * 2);
    group.add(tree);
  }

  return {
    group,
    dispose() {
      box.dispose();
      trunk.dispose();
      crown.dispose();
      bark.dispose();
      leaves.dispose();
      for (const m of wall) m.dispose();
      group.clear();
    },
  };
}
