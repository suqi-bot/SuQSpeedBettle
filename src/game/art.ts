import * as THREE from 'three';

const HEX = {
  void: '#0b0e12',
  dark: '#12171c',
  wall: '#1b222a',
  tealDark: '#1f3a3d',
  teal: '#49c6c0',
  tealLight: '#bfe9e3',
  iron: '#4a4e52',
  ironLight: '#8f9596',
  bone: '#e8e4d8',
  rustDark: '#7a3a22',
  rust: '#a8552b',
  rustLight: '#d97c3a',
  amber: '#e0b14a',
  danger: '#c4433c',
  red: '#7a2a26',
  mud: '#3a4a34',
};

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function P(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function textureFromCanvas(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* 敌人贴图（8 方向简化为单张 billboard，GDD §1.2.1）                    */
/* ------------------------------------------------------------------ */

function makeRat(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(32, 24);
  // 躯干
  P(ctx, 6, 10, 18, 8, HEX.rustDark);
  P(ctx, 8, 8, 14, 4, HEX.rust);
  P(ctx, 10, 7, 8, 2, HEX.rustLight);
  // 头
  P(ctx, 2, 11, 8, 6, HEX.rust);
  P(ctx, 2, 15, 4, 3, HEX.rustDark);
  // 眼
  P(ctx, 4, 12, 2, 2, HEX.tealLight);
  // 腿
  P(ctx, 7, 18, 3, 4, HEX.dark);
  P(ctx, 14, 18, 3, 4, HEX.dark);
  P(ctx, 20, 18, 3, 4, HEX.dark);
  // 尾巴
  P(ctx, 24, 12, 6, 2, HEX.rustDark);
  P(ctx, 29, 9, 2, 4, HEX.rustDark);
  // 背部铆钉
  P(ctx, 12, 9, 2, 1, HEX.ironLight);
  P(ctx, 17, 9, 2, 1, HEX.ironLight);
  return c;
}

function makePumpWorker(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(24, 40);
  // 腿
  P(ctx, 7, 30, 4, 9, HEX.dark);
  P(ctx, 13, 30, 4, 9, HEX.dark);
  P(ctx, 6, 38, 6, 2, HEX.iron);
  P(ctx, 12, 38, 6, 2, HEX.iron);
  // 躯干
  P(ctx, 5, 14, 14, 17, HEX.iron);
  P(ctx, 7, 16, 10, 6, HEX.rust);
  // 压力罐
  P(ctx, 16, 15, 5, 9, HEX.tealDark);
  P(ctx, 17, 16, 3, 7, HEX.teal);
  // 手臂
  P(ctx, 2, 17, 4, 10, HEX.iron);
  P(ctx, 18, 20, 4, 10, HEX.iron);
  // 头 + 面罩
  P(ctx, 7, 5, 10, 9, HEX.rustDark);
  P(ctx, 8, 7, 8, 3, HEX.tealLight);
  P(ctx, 9, 8, 6, 1, HEX.teal);
  // 扳手
  P(ctx, 19, 28, 2, 9, HEX.ironLight);
  P(ctx, 17, 35, 6, 3, HEX.ironLight);
  return c;
}

function makeSteamBag(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(24, 26);
  P(ctx, 4, 6, 16, 16, HEX.mud);
  P(ctx, 6, 4, 12, 4, HEX.mud);
  P(ctx, 3, 10, 18, 10, HEX.mud);
  // 铆钉
  for (let i = 0; i < 4; i++) P(ctx, 6 + i * 4, 12, 2, 2, HEX.ironLight);
  // 核心
  P(ctx, 9, 13, 6, 6, HEX.danger);
  P(ctx, 10, 14, 4, 4, HEX.rustLight);
  // 脚
  P(ctx, 5, 22, 4, 3, HEX.dark);
  P(ctx, 15, 22, 4, 3, HEX.dark);
  return c;
}

function makeOrb(color: string, size = 10): HTMLCanvasElement {
  const [c, ctx] = canvas2d(size, size);
  P(ctx, 3, 1, 4, 8, color);
  P(ctx, 1, 3, 8, 4, color);
  P(ctx, 3, 3, 4, 4, HEX.bone);
  return c;
}

function makeLamp(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(16, 16);
  ctx.fillStyle = 'rgba(224,177,74,0.16)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = 'rgba(224,177,74,0.35)';
  ctx.fillRect(2, 2, 12, 12);
  ctx.fillStyle = '#e0b14a';
  ctx.fillRect(5, 5, 6, 6);
  ctx.fillStyle = '#e8e4d8';
  ctx.fillRect(6, 6, 4, 4);
  return c;
}

export interface EnemySpriteDef {
  texture: THREE.Texture;
  /** 精灵表行数：1 = 单方向，8 = 八方向（行 0 = 正面，行数/2 = 背面） */
  dirs: number;
  /** 精灵表列数（帧数） */
  frames: number;
  /** 播放帧率 */
  fps: number;
}

export interface SpriteSet {
  rat: EnemySpriteDef;
  pump: EnemySpriteDef;
  steam: EnemySpriteDef;
  orb: THREE.Texture;
  fireOrb: THREE.Texture;
  spark: THREE.Texture;
  lamp: THREE.Texture;
}

function single(tex: THREE.Texture): EnemySpriteDef {
  return { texture: tex, dirs: 1, frames: 1, fps: 1 };
}

export function buildSprites(): SpriteSet {
  return {
    rat: single(textureFromCanvas(makeRat())),
    pump: single(textureFromCanvas(makePumpWorker())),
    steam: single(textureFromCanvas(makeSteamBag())),
    orb: textureFromCanvas(makeOrb(HEX.teal)),
    fireOrb: textureFromCanvas(makeOrb(HEX.rustLight)),
    spark: textureFromCanvas(makeOrb(HEX.amber, 6)),
    lamp: textureFromCanvas(makeLamp()),
  };
}

/* ------------------------------------------------------------------ */
/* 第一人称武器精灵（GDD §1.2.5：纯 2D，128×96）                        */
/* ------------------------------------------------------------------ */

export function makeWeaponSprite(id: string): HTMLCanvasElement {
  const [c, ctx] = canvas2d(128, 96);

  // 手（所有武器共用）
  const hand = () => {
    P(ctx, 84, 66, 26, 30, '#2a2f35');
    P(ctx, 86, 68, 22, 12, '#3b4249');
    P(ctx, 88, 72, 18, 4, HEX.rustDark);
  };

  if (id === 'crowbar') {
    // 撬棍：右下斜向
    for (let i = 0; i < 52; i++) {
      P(ctx, 70 - i * 0.9, 26 + i * 0.95, 5, 5, i % 7 === 0 ? HEX.ironLight : HEX.iron);
    }
    P(ctx, 20, 20, 8, 8, HEX.ironLight);
    P(ctx, 14, 26, 10, 6, HEX.ironLight);
    P(ctx, 12, 30, 8, 4, HEX.iron);
    hand();
  } else if (id === 'sidearm') {
    P(ctx, 52, 44, 46, 14, HEX.iron); // 枪身
    P(ctx, 54, 40, 40, 5, HEX.ironLight); // 滑套
    P(ctx, 92, 46, 12, 8, HEX.dark); // 枪口
    P(ctx, 58, 58, 14, 22, HEX.iron); // 握把
    P(ctx, 58, 58, 14, 6, HEX.rust);
    P(ctx, 60, 64, 10, 14, '#23282e');
    P(ctx, 50, 50, 4, 4, HEX.teal); // 准星
    hand();
  } else if (id === 'shotgun') {
    P(ctx, 24, 46, 78, 12, HEX.iron); // 枪管
    P(ctx, 26, 42, 70, 5, HEX.ironLight);
    P(ctx, 40, 56, 30, 10, HEX.rustDark); // 泵
    P(ctx, 42, 58, 26, 4, HEX.rust);
    P(ctx, 76, 56, 18, 22, HEX.iron); // 机匣
    P(ctx, 78, 60, 12, 5, HEX.dark);
    P(ctx, 94, 48, 10, 10, HEX.dark); // 枪口
    hand();
  } else if (id === 'carbine') {
    P(ctx, 30, 44, 70, 12, HEX.iron);
    P(ctx, 32, 40, 60, 5, HEX.ironLight);
    P(ctx, 36, 54, 22, 6, HEX.rustDark); // 护木
    P(ctx, 62, 56, 12, 20, HEX.dark); // 弹匣
    P(ctx, 64, 58, 8, 14, HEX.iron);
    P(ctx, 74, 56, 14, 20, HEX.iron); // 握把
    P(ctx, 92, 46, 12, 8, HEX.dark); // 枪口
    P(ctx, 54, 38, 10, 3, HEX.teal); // 导轨
    hand();
  } else if (id === 'laser') {
    P(ctx, 40, 46, 62, 14, HEX.iron);
    P(ctx, 42, 42, 50, 5, HEX.ironLight);
    P(ctx, 48, 58, 12, 18, HEX.dark);
    P(ctx, 96, 48, 14, 10, HEX.tealDark);
    P(ctx, 100, 50, 8, 6, HEX.teal);
    hand();
  } else {
    // 通用步枪
    P(ctx, 34, 44, 66, 12, HEX.iron);
    P(ctx, 36, 40, 58, 5, HEX.ironLight);
    P(ctx, 92, 46, 12, 8, HEX.dark);
    hand();
  }
  return c;
}

export function makeMuzzleFlash(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(24, 24);
  P(ctx, 10, 2, 4, 20, HEX.amber);
  P(ctx, 2, 10, 20, 4, HEX.amber);
  P(ctx, 7, 7, 10, 10, HEX.bone);
  P(ctx, 5, 5, 14, 14, 'rgba(255,220,140,0.35)');
  return c;
}

export function makeSkillIcon(): HTMLCanvasElement {
  const [c, ctx] = canvas2d(12, 12);
  P(ctx, 1, 1, 10, 10, '#12171c');
  P(ctx, 2, 2, 8, 8, '#1f3a3d');
  P(ctx, 4, 3, 4, 2, HEX.tealLight);
  P(ctx, 3, 5, 6, 4, HEX.teal);
  P(ctx, 4, 9, 4, 1, HEX.tealDark);
  return c;
}
