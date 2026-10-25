import * as THREE from 'three';
import { buildSprites, EnemySpriteDef, SpriteSet } from './art';
import { WeaponId } from './weapons';

/**
 * 美术替换入口（GDD §1.2.5）。
 *
 * 文件放在 public/art/ 下，文件名写进 public/art/manifest.json 即生效；
 * manifest 留空/缺项时自动回退到程序化占位图，不会报错。
 *
 * 约定尺寸：
 *   敌人   sprites/rat.png 32×24 · pump.png 24×40 · steam.png 24×26
 *          精灵表：行 = 方向（行 0 正面、行数/2 背面），列 = 动画帧
 *   特效   sprites/orb.png 10×10 · fireOrb.png 10×10 · spark.png 6×6 · lamp.png 16×16
 *   武器   weapons/<id>.png 128×96；多帧为横向帧条（128×N）
 *   UI     ui/skill.png 12×12
 *   世界   textures/floor.png / wall.png / ceiling.png，各 32×32，一格贴 2m
 *
 * 示例：
 *   "rat": { "src": "sprites/rat_sheet.png", "dirs": 8, "frames": 4, "fps": 8 }
 *   "sidearm": { "src": "weapons/sidearm_sheet.png", "frames": 4 }
 */
export interface SpriteEntry {
  src: string;
  dirs?: number;
  frames?: number;
  fps?: number;
}

export interface WeaponEntry {
  src: string;
  frames?: number;
}

export interface ArtManifest {
  sprites?: Partial<Record<'rat' | 'pump' | 'steam' | 'orb' | 'fireOrb' | 'spark' | 'lamp', string | SpriteEntry>>;
  weapons?: Partial<Record<WeaponId, string | WeaponEntry>>;
  world?: Partial<Record<'floor' | 'wall' | 'ceiling', string>>;
  ui?: Partial<Record<'skill', string>>;
}

export interface WorldTextures {
  floor?: THREE.Texture;
  wall?: THREE.Texture;
  ceiling?: THREE.Texture;
}

export interface WeaponArt {
  img: CanvasImageSource;
  /** 横向帧数：1 = 单帧 */
  frames: number;
}

export interface ArtAssets {
  sprites: SpriteSet;
  weapons: Partial<Record<WeaponId, WeaponArt>>;
  world: WorldTextures;
  skillIcon?: CanvasImageSource;
  /** 实际被替换的资源名，便于排查 */
  replaced: string[];
}

const BASE = '/art/';
const ENEMY_KEYS = new Set(['rat', 'pump', 'steam']);

async function loadManifest(): Promise<ArtManifest> {
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return {};
    return (await res.json()) as ArtManifest;
  } catch {
    return {};
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function imageTexture(img: HTMLImageElement): THREE.Texture {
  const t = new THREE.Texture(img);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function toEntry(v: string | SpriteEntry | WeaponEntry): Required<WeaponEntry & SpriteEntry> {
  if (typeof v === 'string') return { src: v, dirs: 1, frames: 1, fps: 8 };
  return {
    src: v.src,
    dirs: (v as SpriteEntry).dirs ?? 1,
    frames: (v as SpriteEntry).frames ?? 1,
    fps: (v as SpriteEntry).fps ?? 8,
  };
}

export async function loadArt(): Promise<ArtAssets> {
  const sprites = buildSprites();
  const manifest = await loadManifest();
  const replaced: string[] = [];
  const weapons: Partial<Record<WeaponId, WeaponArt>> = {};
  const world: WorldTextures = {};
  let skillIcon: CanvasImageSource | undefined;

  const jobs: Promise<void>[] = [];

  for (const [key, raw] of Object.entries(manifest.sprites ?? {})) {
    if (!raw) continue;
    const entry = toEntry(raw);
    jobs.push(
      (async () => {
        const img = await loadImage(BASE + entry.src);
        if (!img) return;
        const tex = imageTexture(img);
        if (ENEMY_KEYS.has(key)) {
          const k = key as 'rat' | 'pump' | 'steam';
          sprites[k].texture.dispose();
          const def: EnemySpriteDef = {
            texture: tex,
            dirs: Math.max(1, entry.dirs),
            frames: Math.max(1, entry.frames),
            fps: Math.max(1, entry.fps),
          };
          sprites[k] = def;
          replaced.push(`sprite:${key}(${def.dirs}向×${def.frames}帧)`);
        } else {
          const k = key as 'orb' | 'fireOrb' | 'spark' | 'lamp';
          sprites[k].dispose();
          sprites[k] = tex;
          replaced.push(`sprite:${key}`);
        }
      })(),
    );
  }

  for (const [key, raw] of Object.entries(manifest.weapons ?? {})) {
    if (!raw) continue;
    const entry = toEntry(raw);
    jobs.push(
      (async () => {
        const img = await loadImage(BASE + entry.src);
        if (!img) return;
        weapons[key as WeaponId] = { img, frames: Math.max(1, entry.frames) };
        replaced.push(`weapon:${key}(${entry.frames}帧)`);
      })(),
    );
  }

  for (const [key, raw] of Object.entries(manifest.world ?? {})) {
    if (!raw) continue;
    jobs.push(
      (async () => {
        const img = await loadImage(BASE + raw);
        if (!img) return;
        world[key as keyof WorldTextures] = imageTexture(img);
        replaced.push(`world:${key}`);
      })(),
    );
  }

  if (manifest.ui?.skill) {
    jobs.push(
      (async () => {
        const img = await loadImage(BASE + manifest.ui!.skill!);
        if (!img) return;
        skillIcon = img;
        replaced.push('ui:skill');
      })(),
    );
  }

  await Promise.all(jobs);
  return { sprites, weapons, world, skillIcon, replaced };
}
