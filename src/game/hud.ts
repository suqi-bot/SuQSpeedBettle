import { makeWeaponSprite } from './art';
import type { WeaponArt } from './assets';

export interface HudSnapshot {
  state: 'menu' | 'playing' | 'dead' | 'victory';
  locked: boolean;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  ammo: number;
  reserve: number;
  weaponName: string;
  weaponId: string;
  rarityColor: string;
  skillName: string;
  skillCd: number;
  skillCdMax: number;
  floor: number;
  floors: number;
  isBossFloor: boolean;
  cores: number;
  coresNeeded: number;
  message: string;
  messageLife: number;
  prompt: string;
  kills: number;
  scrap: number;
  bossHp: number | null;
  bossMax: number;
  bossName: string;
  hurt: number;
  hitAngle: number;
  hitLife: number;
  crosshairSpread: number;
  hitMarker: number;
  bobPhase: number;
  recoil: number;
  muzzle: boolean;
  timeSec: number;
  seed: number;
  rooms: { x: number; y: number; w: number; h: number; type: string }[];
  levelW: number;
  levelH: number;
  playerCell: { x: number; y: number };
  floaters: { text: string; life: number; dx: number; dy: number }[];
  reloadProgress: number;
  reloading: boolean;
}

const INK = '#e8e4d8';
const DIM = '#7a7c7f';
const TEAL = '#49c6c0';
const AMBER = '#e0b14a';
const RED = '#c4433c';
const DARK = '#0b0e12';

function t(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = INK, size = 9, align: CanvasTextAlign = 'left') {
  ctx.font = `${size}px "Microsoft YaHei", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(s, Math.round(x), Math.round(y));
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  private weaponSprites = new Map<string, WeaponArt>();

  constructor(
    private canvas: HTMLCanvasElement,
    private weaponImages: Partial<Record<string, WeaponArt>> = {},
    private skillIcon?: CanvasImageSource,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  private weaponSprite(id: string): WeaponArt {
    let c = this.weaponSprites.get(id);
    if (!c) {
      c = this.weaponImages[id] ?? { img: makeWeaponSprite(id), frames: 1 };
      this.weaponSprites.set(id, c);
    }
    return c;
  }

  draw(s: HudSnapshot): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 384, 216);
    ctx.imageSmoothingEnabled = false;

    if (s.state === 'menu') {
      this.drawMenu(ctx);
      return;
    }

    this.drawWeapon(ctx, s);
    this.drawCrosshair(ctx, s);
    this.drawVitals(ctx, s);
    this.drawAmmo(ctx, s);
    this.drawSkill(ctx, s);
    this.drawTop(ctx, s);
    this.drawMinimap(ctx, s);
    this.drawMessages(ctx, s);
    this.drawFloaters(ctx, s);

    if (s.bossHp !== null) this.drawBossBar(ctx, s);
    if (s.hurt > 0) this.drawHurt(ctx, s.hurt);
    if (s.hitLife > 0) this.drawHitDirection(ctx, s);
    if (!s.locked) this.drawPaused(ctx);

    if (s.state === 'dead') this.drawEnd(ctx, s, false);
    if (s.state === 'victory') this.drawEnd(ctx, s, true);
  }

  private drawMenu(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = DARK;
    ctx.fillRect(0, 0, 384, 216);
    // 装饰
    ctx.fillStyle = '#1b222a';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % 384;
      const h = 6 + ((i * 37) % 26);
      ctx.fillRect(x, 216 - h, 3, h);
    }
    t(ctx, '灰烬回响', 192, 58, INK, 22, 'center');
    t(ctx, 'A S H E N   E C H O', 192, 86, TEAL, 8, 'center');
    t(ctx, '第一人称像素 Roguelike · 垂直切片', 192, 102, DIM, 8, 'center');
    t(ctx, '点击进入 · WASD 移动 · 左键射击 · 右键武器技能', 192, 140, INK, 8, 'center');
    t(ctx, 'Shift 冲刺   Space 跳跃   R 换弹   E 交互   1/2 切枪', 192, 156, DIM, 8, 'center');
    t(ctx, '目标：收集 2 个共振核心 → 启动下行井 → 深入地底', 192, 176, AMBER, 8, 'center');
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const art = this.weaponSprite(s.weaponId);
    const img = art.img as HTMLImageElement | HTMLCanvasElement;
    const frames = Math.max(1, art.frames);
    const sw = img.width / frames;
    const sh = img.height;
    const bobX = Math.sin(s.bobPhase) * 3;
    const bobY = Math.abs(Math.cos(s.bobPhase)) * 2;
    const rec = s.recoil * 6;
    const x = 384 - 132 + bobX;
    const y = 216 - 92 + bobY - rec;

    // 帧选择：换弹按进度跳帧；开火循环后段帧；待机用第 0 帧
    let frame = 0;
    if (frames > 1) {
      if (s.reloading) frame = Math.min(frames - 1, Math.floor(s.reloadProgress * frames));
      else if (s.muzzle) frame = 1 + (Math.floor(performance.now() / 55) % Math.max(1, frames - 1));
    }
    ctx.drawImage(img, frame * sw, 0, sw, sh, Math.round(x), Math.round(y), sw, sh);

    if (s.muzzle) {
      ctx.fillStyle = 'rgba(224,177,74,0.9)';
      const mx = x + 22;
      const my = y + 44;
      ctx.fillRect(mx - 6, my - 2, 12, 4);
      ctx.fillRect(mx - 2, my - 6, 4, 12);
      ctx.fillStyle = '#e8e4d8';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const cx = 192;
    const cy = 108;
    const gap = 3 + s.crosshairSpread * 8;
    ctx.fillStyle = s.hitMarker > 0 ? '#ffffff' : 'rgba(232,228,216,0.9)';
    ctx.fillRect(cx - gap - 4, cy, 4, 1);
    ctx.fillRect(cx + gap, cy, 4, 1);
    ctx.fillRect(cx, cy - gap - 4, 1, 4);
    ctx.fillRect(cx, cy + gap, 1, 4);
    ctx.fillRect(cx, cy, 1, 1);
    if (s.hitMarker > 0) {
      ctx.fillStyle = '#c4433c';
      ctx.fillRect(cx - 5, cy - 5, 2, 2);
      ctx.fillRect(cx + 4, cy - 5, 2, 2);
      ctx.fillRect(cx - 5, cy + 4, 2, 2);
      ctx.fillRect(cx + 4, cy + 4, 2, 2);
    }
  }

  private drawVitals(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const x = 10;
    const y = 188;
    // 护甲
    ctx.fillStyle = '#2b3f44';
    ctx.fillRect(x, y - 6, 92, 3);
    ctx.fillStyle = TEAL;
    ctx.fillRect(x, y - 6, Math.round((s.armor / s.maxArmor) * 92), 3);
    // 生命分段
    const segs = 10;
    const segW = 9;
    for (let i = 0; i < segs; i++) {
      const on = s.hp > (i / segs) * s.maxHp;
      ctx.fillStyle = on ? (s.hp / s.maxHp < 0.3 ? RED : '#c9cbc2') : '#23282e';
      ctx.fillRect(x + i * (segW + 1), y, segW, 7);
    }
    t(ctx, `${Math.ceil(s.hp)}`, x + 96, y - 3, INK, 9);
    t(ctx, `甲 ${Math.ceil(s.armor)}`, x, y - 17, TEAL, 8);
  }

  private drawAmmo(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const x = 374;
    const y = 180;
    if (s.weaponId === 'crowbar') {
      t(ctx, '∞', x, y, INK, 18, 'right');
      t(ctx, '近战', x - 26, y + 4, DIM, 8, 'right');
    } else {
      t(ctx, `${s.ammo}`, x, y - 2, s.ammo === 0 ? RED : INK, 18, 'right');
      t(ctx, `/ ${s.reserve}`, x, y + 18, DIM, 8, 'right');
      if (s.reloading) {
        const w = 60;
        ctx.fillStyle = '#23282e';
        ctx.fillRect(x - w, y + 30, w, 2);
        ctx.fillStyle = AMBER;
        ctx.fillRect(x - w, y + 30, Math.round(w * s.reloadProgress), 2);
      }
    }
    t(ctx, s.weaponName, x, y - 16, s.rarityColor, 8, 'right');
  }

  private drawSkill(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const x = 10;
    const y = 146;
    const ready = s.skillCd <= 0;
    ctx.fillStyle = ready ? '#1f3a3d' : '#12171c';
    ctx.fillRect(x, y, 12, 12);
    ctx.strokeStyle = ready ? TEAL : '#3a3f44';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 11, 11);
    // 图标
    if (this.skillIcon) {
      ctx.globalAlpha = ready ? 1 : 0.45;
      ctx.drawImage(this.skillIcon, x + 1, y + 1, 10, 10);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = ready ? '#bfe9e3' : '#5d6165';
      ctx.fillRect(x + 4, y + 2, 4, 2);
      ctx.fillRect(x + 3, y + 4, 6, 4);
      ctx.fillRect(x + 4, y + 8, 4, 1);
    }
    if (!ready) {
      const p = s.skillCd / Math.max(0.001, s.skillCdMax);
      ctx.fillStyle = 'rgba(11,14,18,0.75)';
      ctx.fillRect(x, y, 12, Math.ceil(12 * p));
    }
    t(ctx, s.skillName, x + 15, y + 2, ready ? INK : DIM, 8);
  }

  private drawTop(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    if (s.isBossFloor) {
      t(ctx, 'F4 泵心', 10, 8, INK, 10);
      t(ctx, '终结目标：击破总泵·铁喉', 10, 21, RED, 8);
      t(ctx, `废料 ${s.scrap}`, 10, 32, DIM, 8);
      return;
    }
    t(ctx, `F${s.floor} 锈泵层`, 10, 8, INK, 10);
    t(ctx, `共振核心 ${s.cores}/${s.coresNeeded}`, 10, 21, s.cores >= s.coresNeeded ? AMBER : DIM, 8);
    t(ctx, `废料 ${s.scrap}`, 10, 32, DIM, 8);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const bx = 316;
    const by = 10;
    const bw = 58;
    const bh = 58;
    ctx.fillStyle = 'rgba(11,14,18,0.7)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.strokeStyle = '#23282e';
    ctx.strokeRect(bx - 2.5, by - 2.5, bw + 5, bh + 5);

    const sx = bw / (s.levelW * 2);
    const sy = bh / (s.levelH * 2);
    for (const r of s.rooms) {
      const color =
        r.type === 'exit' ? TEAL : r.type === 'core' ? AMBER : r.type === 'boss' ? RED : '#2b3a40';
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.round(bx + r.x * 2 * sx),
        Math.round(by + r.y * 2 * sy),
        Math.max(2, Math.round(r.w * 2 * sx)),
        Math.max(2, Math.round(r.h * 2 * sy)),
      );
    }
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(
      Math.round(bx + s.playerCell.x * 2 * sx) - 1,
      Math.round(by + s.playerCell.y * 2 * sy) - 1,
      2,
      2,
    );
  }

  private drawMessages(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    if (s.state === 'dead' || s.state === 'victory') return;
    if (s.prompt) {
      const w = Math.max(80, s.prompt.length * 8 + 12);
      ctx.fillStyle = 'rgba(11,14,18,0.75)';
      ctx.fillRect(192 - w / 2, 150, w, 14);
      t(ctx, s.prompt, 192, 153, INK, 8, 'center');
    }
    if (s.messageLife > 0) {
      t(ctx, s.message, 192, 168, AMBER, 9, 'center');
    }
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    for (const f of s.floaters) {
      const a = Math.max(0, Math.min(1, f.life * 2));
      ctx.globalAlpha = a;
      t(ctx, f.text, 192 + f.dx, 96 + f.dy, '#e0b14a', 8, 'center');
      ctx.globalAlpha = 1;
    }
  }

  private drawBossBar(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const w = 220;
    const x = (384 - w) / 2;
    const y = 8;
    ctx.fillStyle = 'rgba(11,14,18,0.8)';
    ctx.fillRect(x - 2, y - 2, w + 4, 10);
    ctx.fillStyle = '#3a1414';
    ctx.fillRect(x, y, w, 6);
    const p = Math.max(0, (s.bossHp ?? 0) / s.bossMax);
    ctx.fillStyle = RED;
    ctx.fillRect(x, y, Math.round(w * p), 6);
    t(ctx, s.bossName, 192, y + 10, INK, 8, 'center');
  }

  private drawHitDirection(ctx: CanvasRenderingContext2D, s: HudSnapshot): void {
    const a = Math.min(1, s.hitLife * 2);
    const x = 192 + Math.sin(s.hitAngle) * 168;
    const y = 108 - Math.cos(s.hitAngle) * 84;
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = RED;
    const cx = Math.max(6, Math.min(378, x));
    const cy = Math.max(6, Math.min(210, y));
    ctx.fillRect(Math.round(cx) - 4, Math.round(cy) - 1, 8, 3);
    ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 4, 3, 8);
    ctx.globalAlpha = 1;
  }

  private drawHurt(ctx: CanvasRenderingContext2D, amount: number): void {
    const a = Math.min(0.5, amount * 0.5);
    ctx.fillStyle = `rgba(196,67,60,${a * 0.35})`;
    ctx.fillRect(0, 0, 384, 216);
    ctx.strokeStyle = `rgba(196,67,60,${a})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 382, 214);
  }

  private drawPaused(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(5,7,10,0.72)';
    ctx.fillRect(0, 0, 384, 216);
    t(ctx, '已暂停', 192, 88, INK, 14, 'center');
    t(ctx, '点击画面继续', 192, 110, DIM, 9, 'center');
  }

  private drawEnd(ctx: CanvasRenderingContext2D, s: HudSnapshot, win: boolean): void {
    ctx.fillStyle = win ? '#08100f' : '#120606';
    ctx.fillRect(0, 0, 384, 216);
    t(ctx, win ? '深潜完成' : '你被井吞没了', 192, 62, win ? TEAL : RED, 18, 'center');
    const mm = Math.floor(s.timeSec / 60);
    const ss = Math.floor(s.timeSec % 60).toString().padStart(2, '0');
    t(ctx, `用时 ${mm}:${ss}`, 192, 96, INK, 9, 'center');
    t(ctx, `击杀 ${s.kills}`, 192, 110, INK, 9, 'center');
    t(ctx, `抵达 F${s.floor}`, 192, 124, INK, 9, 'center');
    t(ctx, `种子 ${s.seed}`, 192, 138, DIM, 8, 'center');
    t(ctx, '点击返回标题', 192, 170, DIM, 8, 'center');
  }
}
