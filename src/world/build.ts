import * as THREE from 'three';
import { CELL, Level, Room, roomWorldCenter } from './gen';
import { hex, PALETTE } from '../game/palette';
import type { WorldTextures } from '../game/assets';

const C = {
  floor: hex(PALETTE[5]),
  floorAlt: hex(PALETTE[4]),
  floorCore: hex(PALETTE[5]),
  wall: hex(PALETTE[7]),
  wallAlt: hex(PALETTE[8]),
  wallDark: hex(PALETTE[7]),
  ceiling: hex(PALETTE[10]),
  rust: hex(PALETTE[16]),
  amber: hex(PALETTE[19]),
  teal: hex(PALETTE[25]),
  bone: hex(PALETTE[12]),
  danger: hex(PALETTE[27]),
  dark: hex(PALETTE[1]),
};

/** 顶亮、侧中、底暗的三段面着色（GDD §1.2.1 的 3 段 ramp） */
function shadedBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.normal;
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i);
    const k = ny > 0.5 ? 1.0 : ny > -0.5 ? 0.7 : 0.32;
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export interface LevelVisuals {
  group: THREE.Group;
  dispose(): void;
}

export function buildLevel(level: Level, world: WorldTextures = {}): LevelVisuals {
  const group = new THREE.Group();
  const boxGeo = shadedBox();

  const floors: { x: number; z: number; color: number }[] = [];
  const walls: { x: number; z: number; color: number }[] = [];
  const ceilings: { x: number; z: number; color: number }[] = [];

  const roomColor = (x: number, y: number): number => {
    let tint = C.floor;
    for (const r of level.rooms) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        if (r.type === 'core') tint = C.floorCore;
        if (r.type === 'exit') tint = C.floor;
        if (r.type === 'shop') tint = C.floor;
        if (r.type === 'treasure') tint = C.floorAlt;
        if (r.type === 'boss') tint = C.floorAlt;
        break;
      }
    }
    const k = 0.9 + hash2(x, y) * 0.2;
    const c = new THREE.Color(tint);
    c.multiplyScalar(k);
    return c.getHex();
  };

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const solid = level.grid[y * level.w + x] === 0;
      const wx = (x + 0.5) * CELL;
      const wz = (y + 0.5) * CELL;
      if (!solid) {
        floors.push({ x: wx, z: wz, color: roomColor(x, y) });
        ceilings.push({ x: wx, z: wz, color: C.ceiling });
      } else {
        // 只给贴着地板的实心格建墙，省实例
        let nearFloor = false;
        for (let dy = -1; dy <= 1 && !nearFloor; dy++) {
          for (let dx = -1; dx <= 1 && !nearFloor; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
            if (level.grid[ny * level.w + nx] === 1) nearFloor = true;
          }
        }
        if (nearFloor) {
          const h = hash2(x, y);
          const c = new THREE.Color(h > 0.5 ? C.wall : C.wallAlt);
          c.multiplyScalar(0.85 + h * 0.3);
          walls.push({ x: wx, z: wz, color: c.getHex() });
        }
      }
    }
  }

  const matFloor = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, map: world.floor ?? null });
  const matWall = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, map: world.wall ?? null });
  const matCeil = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, map: world.ceiling ?? null });
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  const floorMesh = new THREE.InstancedMesh(boxGeo, matFloor, floors.length);
  floors.forEach((f, i) => {
    dummy.position.set(f.x, -0.1, f.z);
    dummy.scale.set(CELL, 0.2, CELL);
    dummy.updateMatrix();
    floorMesh.setMatrixAt(i, dummy.matrix);
    floorMesh.setColorAt(i, col.setHex(f.color));
  });
  floorMesh.instanceMatrix.needsUpdate = true;
  if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
  group.add(floorMesh);

  const wallMesh = new THREE.InstancedMesh(boxGeo, matWall, walls.length);
  walls.forEach((w, i) => {
    dummy.position.set(w.x, 1.5, w.z);
    dummy.scale.set(CELL, 3.0, CELL);
    dummy.updateMatrix();
    wallMesh.setMatrixAt(i, dummy.matrix);
    wallMesh.setColorAt(i, col.setHex(w.color));
  });
  wallMesh.instanceMatrix.needsUpdate = true;
  if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
  group.add(wallMesh);

  const ceilMesh = new THREE.InstancedMesh(boxGeo, matCeil, ceilings.length);
  ceilings.forEach((c, i) => {
    dummy.position.set(c.x, 3.15, c.z);
    dummy.scale.set(CELL, 0.2, CELL);
    dummy.updateMatrix();
    ceilMesh.setMatrixAt(i, dummy.matrix);
    ceilMesh.setColorAt(i, col.setHex(c.color));
  });
  ceilMesh.instanceMatrix.needsUpdate = true;
  if (ceilMesh.instanceColor) ceilMesh.instanceColor.needsUpdate = true;
  group.add(ceilMesh);

  return {
    group,
    dispose() {
      boxGeo.dispose();
      matFloor.dispose();
      matWall.dispose();
      matCeil.dispose();
      floorMesh.dispose();
      wallMesh.dispose();
      ceilMesh.dispose();
    },
  };
}

export function createCoreProp(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.45, 8),
    new THREE.MeshBasicMaterial({ color: C.rust }),
  );
  base.position.y = 0.22;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.08, 4, 12),
    new THREE.MeshBasicMaterial({ color: C.amber }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.5;
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.34, 0),
    new THREE.MeshBasicMaterial({ color: C.amber }),
  );
  core.position.y = 1.35;
  core.name = 'core';
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: C.amber,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(2.2);
  glow.position.y = 1.35;
  g.add(base, ring, core, glow);
  g.userData.core = core;
  g.userData.ring = ring;
  return g;
}

export function createExitGate(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: C.teal });
  const dark = new THREE.MeshBasicMaterial({ color: C.dark });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), mat);
  left.position.set(-1.1, 1.3, 0);
  const right = left.clone();
  right.position.x = 1.1;
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 0.35), mat);
  top.position.y = 2.55;
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.2), new THREE.MeshBasicMaterial({
    color: C.teal,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  }));
  inner.position.y = 1.2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.4), dark);
  base.position.y = 0.06;
  g.add(left, right, top, inner, base);
  g.userData.inner = inner;
  return g;
}

export function createChest(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.55, 0.65),
    new THREE.MeshBasicMaterial({ color: C.rust }),
  );
  body.position.y = 0.28;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.18, 0.7),
    new THREE.MeshBasicMaterial({ color: C.amber }),
  );
  lid.position.y = 0.62;
  lid.name = 'lid';
  g.add(body, lid);
  return g;
}

export function createSupply(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.6, 0.65),
    new THREE.MeshBasicMaterial({ color: C.wallAlt }),
  );
  body.position.y = 0.3;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.1, 0.7),
    new THREE.MeshBasicMaterial({ color: C.teal }),
  );
  stripe.position.y = 0.64;
  const crossH = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: C.teal }),
  );
  crossH.position.set(0, 0.36, 0.34);
  const crossV = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.32, 0.05),
    new THREE.MeshBasicMaterial({ color: C.teal }),
  );
  crossV.position.set(0, 0.36, 0.34);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: C.teal,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.scale.setScalar(1.6);
  glow.position.y = 0.7;
  g.add(body, stripe, crossH, crossV, glow);
  return g;
}

export function createShop(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.6, 0.8),
    new THREE.MeshBasicMaterial({ color: C.wallAlt }),
  );
  body.position.y = 0.8;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.45),
    new THREE.MeshBasicMaterial({ color: C.teal }),
  );
  screen.position.set(0, 1.15, 0.41);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.12, 0.1, 0.82),
    new THREE.MeshBasicMaterial({ color: C.amber }),
  );
  stripe.position.y = 1.3;
  g.add(body, screen, stripe);
  return g;
}

export function worldOfRoom(r: Room): { x: number; z: number } {
  return roomWorldCenter(r);
}
