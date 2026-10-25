import { Rng } from '../core/rng';

export const CELL = 2; // 每格 2m（GDD §3.2.1）

export type RoomType = 'start' | 'exit' | 'combat' | 'core' | 'treasure' | 'shop' | 'boss' | 'pillar';

export interface Room {
  id: number;
  x: number; // 格坐标（左上）
  y: number;
  w: number;
  h: number;
  cx: number; // 中心（格）
  cy: number;
  type: RoomType;
}

export interface Level {
  w: number;
  h: number;
  grid: Uint8Array; // 1 = 可走，0 = 实心
  rooms: Room[];
  start: Room;
  exit: Room;
  cores: Room[];
  seed: number;
}

export function roomWorldCenter(r: Room): { x: number; z: number } {
  return { x: (r.x + r.w / 2) * CELL, z: (r.y + r.h / 2) * CELL };
}

export function generateFloor(seed: number, roomCount = 11): Level {
  const W = 56;
  const H = 56;
  const rng = new Rng(seed);
  const grid = new Uint8Array(W * H);
  const rooms: Room[] = [];

  const overlaps = (x: number, y: number, w: number, h: number) =>
    rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && y < r.y + r.h + 1 && y + h + 1 > r.y);

  let guard = 0;
  while (rooms.length < roomCount && guard++ < 600) {
    const w = rng.int(5, 9);
    const h = rng.int(5, 9);
    const x = rng.int(2, W - w - 3);
    const y = rng.int(2, H - h - 3);
    if (overlaps(x, y, w, h)) continue;
    rooms.push({
      id: rooms.length,
      x,
      y,
      w,
      h,
      cx: Math.floor(x + w / 2),
      cy: Math.floor(y + h / 2),
      type: 'combat',
    });
  }

  const carve = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[y * W + x] = 1;
  };
  const carveRect = (x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) carve(i, j);
  };

  for (const r of rooms) carveRect(r.x, r.y, r.w, r.h);

  // 走廊：2 格宽，L 形（GDD §3.2.2）
  const corridor = (a: Room, b: Room) => {
    const x1 = a.cx;
    const y1 = a.cy;
    const x2 = b.cx;
    const y2 = b.cy;
    if (rng.chance(0.5)) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        carve(x, y1);
        carve(x, y1 + 1);
      }
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        carve(x2, y);
        carve(x2 + 1, y);
      }
    } else {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        carve(x1, y);
        carve(x1 + 1, y);
      }
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        carve(x, y2);
        carve(x, y2 + 1);
      }
    }
  };

  // MST（Prim）+ 18–25% 回路（GDD §3.2.2）
  const edges = new Set<string>();
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const inTree = new Set<number>([0]);
  const dist2 = (a: Room, b: Room) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < rooms.length; j++) {
        if (inTree.has(j)) continue;
        const d = dist2(rooms[i], rooms[j]);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    edges.add(key(best[0], best[1]));
    inTree.add(best[1]);
    corridor(rooms[best[0]], rooms[best[1]]);
  }
  const extra = Math.max(2, Math.floor(rooms.length * 0.22));
  let added = 0;
  let tries = 0;
  while (added < extra && tries++ < 200) {
    const a = rng.int(0, rooms.length - 1);
    const b = rng.int(0, rooms.length - 1);
    if (a === b) continue;
    const k = key(a, b);
    if (edges.has(k)) continue;
    if (dist2(rooms[a], rooms[b]) > 400) continue; // 只连不太远的房间
    edges.add(k);
    corridor(rooms[a], rooms[b]);
    added++;
  }

  // 房间角色分配
  const start = rooms[0];
  start.type = 'start';
  let exit = rooms[1];
  let far = -1;
  for (const r of rooms) {
    if (r === start) continue;
    const d = (r.cx - start.cx) ** 2 + (r.cy - start.cy) ** 2;
    if (d > far) {
      far = d;
      exit = r;
    }
  }
  exit.type = 'exit';
  const rest = rooms.filter((r) => r !== start && r !== exit);
  const shuffled = rng.shuffle(rest);
  const cores: Room[] = [];
  for (const r of shuffled) {
    if (cores.length >= 2) break;
    if (cores.some((c) => (c.cx - r.cx) ** 2 + (c.cy - r.cy) ** 2 < 64)) continue;
    r.type = 'core';
    cores.push(r);
  }
  // 保证 2 个核心
  for (const r of shuffled) {
    if (cores.length >= 2) break;
    if (r.type === 'combat') {
      r.type = 'core';
      cores.push(r);
    }
  }
  const remain = shuffled.filter((r) => r.type === 'combat');
  if (remain[0]) remain[0].type = 'treasure';
  if (remain[1]) remain[1].type = 'shop';

  return { w: W, h: H, grid, rooms, start, exit, cores, seed };
}

/** Boss 关：单一竞技场（直径约 30m）+ 4 根柱子 */
export function generateArena(seed: number): Level {
  const W = 30;
  const H = 30;
  const grid = new Uint8Array(W * H);
  const r = new Rng(seed);
  const cx = W / 2;
  const cy = H / 2;
  const radius = 12;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius) grid[y * W + x] = 1;
    }
  }
  const pillars: { x: number; y: number }[] = [
    { x: Math.round(cx - 5), y: Math.round(cy - 5) },
    { x: Math.round(cx + 5), y: Math.round(cy - 5) },
    { x: Math.round(cx - 5), y: Math.round(cy + 5) },
    { x: Math.round(cx + 5), y: Math.round(cy + 5) },
  ];
  for (const p of pillars) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) grid[(p.y + j) * W + (p.x + i)] = 0;
  }
  const room: Room = {
    id: 0,
    x: 3,
    y: 3,
    w: W - 6,
    h: H - 6,
    cx: Math.round(cx),
    cy: Math.round(cy),
    type: 'boss',
  };
  void r;
  return { w: W, h: H, grid, rooms: [room], start: room, exit: room, cores: [], seed };
}

export function isSolid(level: Level, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= level.w || cy >= level.h) return true;
  return level.grid[cy * level.w + cx] === 0;
}

export function solidAtWorld(level: Level, x: number, z: number): boolean {
  return isSolid(level, Math.floor(x / CELL), Math.floor(z / CELL));
}

export function roomAt(level: Level, x: number, z: number): Room | null {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(z / CELL);
  for (const r of level.rooms) {
    if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return r;
  }
  return null;
}
