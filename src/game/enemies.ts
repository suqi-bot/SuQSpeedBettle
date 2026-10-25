import * as THREE from 'three';
import { Level, solidAtWorld } from '../world/gen';
import { EnemySpriteDef, SpriteSet } from './art';

export type EnemyKind = 'rat' | 'pump' | 'steam';

interface EnemyDef {
  hp: number;
  damage: number;
  speed: number;
  attackCd: number;
  height: number;
  width: number;
}

const DEFS: Record<EnemyKind, EnemyDef> = {
  rat: { hp: 60, damage: 10, speed: 4.6, attackCd: 1.1, height: 1.0, width: 1.4 },
  pump: { hp: 80, damage: 8, speed: 3.0, attackCd: 2.2, height: 1.9, width: 1.05 },
  steam: { hp: 70, damage: 20, speed: 3.4, attackCd: 1.2, height: 1.4, width: 1.05 },
};

export interface EnemyHooks {
  melee(amount: number, fromX: number, fromZ: number): void;
  projectile(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, speed: number): void;
}

export class Enemy {
  kind: EnemyKind;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive = true;
  hitFlash = 0;
  roomId = -1;
  readonly def: EnemyDef;
  readonly sprite: THREE.Sprite;
  readonly radius: number;
  private cd = 0.6;
  private material: THREE.SpriteMaterial;
  private baseColor = new THREE.Color(0xffffff);
  private art: EnemySpriteDef;
  private tex: THREE.Texture;
  private animT = Math.random() * 2;
  private facing = 0;
  private strafeDir = 1;
  private strafeTimer = 1.5;

  constructor(kind: EnemyKind, x: number, z: number, sprites: SpriteSet) {
    this.kind = kind;
    this.def = DEFS[kind];
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.radius = kind === 'rat' ? 0.55 : 0.45;
    const def = kind === 'rat' ? sprites.rat : kind === 'pump' ? sprites.pump : sprites.steam;
    this.art = def;
    this.tex = def.texture.clone();
    this.tex.needsUpdate = true;
    this.tex.repeat.set(1 / def.frames, 1 / def.dirs);
    this.tex.offset.set(0, 1 - 1 / def.dirs);
    this.material = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: true });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(this.def.width, this.def.height, 1);
    this.sprite.center.set(0.5, 0);
    this.pos = new THREE.Vector3(x, 0, z);
    this.syncSprite();
  }

  private syncSprite(): void {
    this.sprite.position.set(this.pos.x, this.pos.y, this.pos.z);
  }

  damage(n: number): boolean {
    if (!this.alive) return false;
    this.hp -= n;
    this.hitFlash = 0.1;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  update(dt: number, playerPos: THREE.Vector3, level: Level, hooks: EnemyHooks, engaged = true): void {
    if (!this.alive) return;
    this.cd -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.material.color.copy(this.hitFlash > 0 ? new THREE.Color(0xffffff) : this.baseColor);

    if (!engaged) {
      this.updateSprite(dt, playerPos, false);
      this.syncSprite();
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    if (dist > 26) {
      this.updateSprite(dt, playerPos, false);
      this.syncSprite();
      return;
    }
    toPlayer.normalize();

    if (!this.hasLOS(level, playerPos)) {
      this.updateSprite(dt, playerPos, false);
      this.syncSprite();
      return;
    }

    let moveDir = new THREE.Vector3();
    if (this.kind === 'rat' || this.kind === 'steam') {
      // 近身就不再推挤玩家；保持 1.5m 的攻击距离
      if (dist > 1.5) moveDir.copy(toPlayer);
      if (dist < 1.9 && this.cd <= 0) {
        this.cd = this.def.attackCd;
        if (this.kind === 'steam') {
          this.alive = false;
          this.explodeFx = true;
        }
        hooks.melee(this.def.damage, this.pos.x, this.pos.z);
      }
    } else {
      // 泵工：维持 6–11m，并在射程内左右横移（让侧面精灵行有意义）
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 1.6 + Math.random() * 2.2;
        this.strafeDir *= -1;
      }
      if (dist > 11) moveDir.copy(toPlayer);
      else if (dist < 6) moveDir.copy(toPlayer).multiplyScalar(-1);
      else moveDir.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this.strafeDir);
      if (this.cd <= 0 && dist < 16) {
        this.cd = this.def.attackCd;
        this.facing = Math.atan2(toPlayer.x, toPlayer.z);
        const origin = new THREE.Vector3(this.pos.x, 1.1, this.pos.z);
        const dir = new THREE.Vector3(playerPos.x - origin.x, 0.15, playerPos.z - origin.z).normalize();
        hooks.projectile(origin, dir, this.def.damage, 13);
      }
    }

    if (moveDir.lengthSq() > 0) {
      const speed = this.def.speed;
      this.facing = Math.atan2(moveDir.x, moveDir.z);
      const nx = this.pos.x + moveDir.x * speed * dt;
      const nz = this.pos.z + moveDir.z * speed * dt;
      if (!solidAtWorld(level, nx, this.pos.z)) this.pos.x = nx;
      if (!solidAtWorld(level, this.pos.x, nz)) this.pos.z = nz;
    }
    this.updateSprite(dt, playerPos, moveDir.lengthSq() > 0);
    this.syncSprite();
  }

  explodeFx = false;

  /** 根据朝向与相机方向选择精灵表的方向行，并播放动画帧（仅在移动时迈步） */
  private updateSprite(dt: number, viewPos: THREE.Vector3, moving: boolean): void {
    const art = this.art;
    if (moving) this.animT += dt;
    else this.animT = 0;
    if (art.dirs <= 1 && art.frames <= 1) return;
    const toCam = Math.atan2(viewPos.x - this.pos.x, viewPos.z - this.pos.z);
    let rel = toCam - this.facing;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    let dir = Math.round((rel / (Math.PI * 2)) * art.dirs);
    dir = ((dir % art.dirs) + art.dirs) % art.dirs;
    const frame = art.frames > 1 ? Math.floor(this.animT * art.fps) % art.frames : 0;
    this.tex.offset.set(frame / art.frames, 1 - (dir + 1) / art.dirs);
  }

  private hasLOS(level: Level, target: THREE.Vector3): boolean {
    const from = new THREE.Vector3(this.pos.x, 1.0, this.pos.z);
    const to = new THREE.Vector3(target.x, 1.4, target.z);
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    let t = 0.6;
    while (t < dist) {
      const x = from.x + dir.x * t;
      const z = from.z + dir.z * t;
      if (solidAtWorld(level, x, z)) return false;
      t += 0.6;
    }
    return true;
  }
}
