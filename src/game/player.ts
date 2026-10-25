import * as THREE from 'three';
import { InputState } from '../core/input';
import { Level, solidAtWorld } from '../world/gen';
import { makeWeapon, WeaponInstance } from './weapons';

const EYE_HEIGHT = 1.62;
const RADIUS = 0.34;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  hp = 100;
  maxHp = 100;
  armor = 60;
  maxArmor = 60;

  slots: (WeaponInstance | null)[] = [makeWeapon('sidearm'), makeWeapon('crowbar')];
  current = 0;

  fireTimer = 0;
  reloadTimer = 0;
  reloadTotal = 0;
  skillCd = [0, 0];

  dashTimer = 0;
  dashCd = 0;
  invuln = 0;

  recoil = 0;
  bobPhase = 0;
  shake = 0;
  muzzle = 0;
  hurtFlash = 0;
  hitAngle = 0;
  hitLife = 0;

  scrap = 0;
  kills = 0;
  dead = false;

  private grounded = true;
  private switchLock = 0;

  get weapon(): WeaponInstance | null {
    return this.slots[this.current];
  }

  spawnAt(x: number, z: number, yaw = 0): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE_HEIGHT + this.bobOffset(), this.pos.z);
  }

  bobOffset(): number {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.5 || !this.grounded) return 0;
    return Math.sin(this.bobPhase * 2) * 0.035;
  }

  update(dt: number, input: InputState, level: Level): void {
    if (this.dead) return;

    // 视角
    const sens = 0.0022;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

    // 切换武器
    if (this.switchLock > 0) this.switchLock -= dt;
    if (this.switchLock <= 0) {
      if (input.switchCycle) this.switchTo((this.current + 1) % this.slots.length);
      if (input.switchTo >= 0) this.switchTo(input.switchTo);
    }

    // 计时器
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.skillCd = this.skillCd.map((c) => Math.max(0, c - dt));
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.shake = Math.max(0, this.shake - dt * 4);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    this.hitLife = Math.max(0, this.hitLife - dt);

    // 换弹
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    } else if (input.reloadPressed) {
      this.startReload();
    }

    // 移动
    const wish = new THREE.Vector3();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (input.forward) wish.add(fwd);
    if (input.back) wish.sub(fwd);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    // 冲刺
    if (input.dashPressed && this.dashCd <= 0 && wish.lengthSq() > 0) {
      this.dashTimer = 0.18;
      this.dashCd = 1.2;
      this.invuln = 0.18;
      this.vel.x = wish.x * 9.0;
      this.vel.z = wish.z * 9.0;
    }
    this.dashTimer = Math.max(0, this.dashTimer - dt);

    const speed = this.dashTimer > 0 ? 9.0 : 5.2;
    const targetX = wish.x * speed;
    const targetZ = wish.z * speed;
    const accel = this.grounded ? 18 : 6;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (targetX - this.vel.x) * k;
    this.vel.z += (targetZ - this.vel.z) * k;

    // 跳跃与重力
    if (input.jumpPressed && this.grounded) {
      this.vel.y = 7.0;
      this.grounded = false;
    }
    this.vel.y -= 22 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }

    // 水平位移 + 碰撞
    const dx = this.vel.x * dt;
    const dz = this.vel.z * dt;
    if (!this.blocked(level, this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    else this.vel.x = 0;
    if (!this.blocked(level, this.pos.x, this.pos.z + dz)) this.pos.z += dz;
    else this.vel.z = 0;

    // 行走摆动
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.bobPhase += dt * (planar > 0.6 ? 7 + planar * 0.6 : 1.2);
  }

  private blocked(level: Level, x: number, z: number): boolean {
    return (
      solidAtWorld(level, x - RADIUS, z - RADIUS) ||
      solidAtWorld(level, x + RADIUS, z - RADIUS) ||
      solidAtWorld(level, x - RADIUS, z + RADIUS) ||
      solidAtWorld(level, x + RADIUS, z + RADIUS)
    );
  }

  switchTo(idx: number): void {
    if (idx === this.current || idx < 0 || idx >= this.slots.length) return;
    if (!this.slots[idx]) return;
    this.current = idx;
    this.reloadTimer = 0;
    this.switchLock = 0.45;
    this.fireTimer = Math.max(this.fireTimer, 0.35);
  }

  startReload(): void {
    const w = this.weapon;
    if (!w || w.def.kind === 'melee') return;
    if (this.reloadTimer > 0) return;
    if (w.ammo >= w.def.mag || w.reserve <= 0) return;
    this.reloadTimer = w.def.reload;
    this.reloadTotal = w.def.reload;
  }

  private finishReload(): void {
    const w = this.weapon;
    if (!w) return;
    const need = w.def.mag - w.ammo;
    const take = Math.min(need, w.reserve);
    w.ammo += take;
    w.reserve -= take;
  }

  canFire(): boolean {
    const w = this.weapon;
    if (!w || this.dead) return false;
    if (this.reloadTimer > 0 || this.fireTimer > 0) return false;
    if (w.def.kind !== 'melee' && w.ammo <= 0) return false;
    return true;
  }

  consumeShot(): void {
    const w = this.weapon;
    if (!w) return;
    this.fireTimer = 60 / w.def.rpm;
    if (w.def.kind !== 'melee') w.ammo--;
    this.recoil = Math.min(1.4, this.recoil + 0.45);
    this.muzzle = 0.06;
  }

  takeDamage(amount: number, fromX?: number, fromZ?: number): void {
    if (this.dead || this.invuln > 0) return;
    if (fromX !== undefined && fromZ !== undefined) {
      const dx = fromX - this.pos.x;
      const dz = fromZ - this.pos.z;
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      this.hitAngle = Math.atan2(dx * rightX + dz * rightZ, dx * fwdX + dz * fwdZ);
      this.hitLife = 1.1;
    }
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest);
      this.armor -= absorbed;
      rest -= absorbed;
    }
    if (rest > 0) this.hp -= rest;
    // 受击后短暂无敌，防止弹幕/多敌同帧叠加秒杀
    this.invuln = Math.max(this.invuln, 0.45);
    this.hurtFlash = 1;
    this.shake = Math.max(this.shake, 0.6);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  addArmor(n: number): void {
    this.armor = Math.min(this.maxArmor, this.armor + n);
  }

  refillAmmo(ratio = 0.5): void {
    for (const s of this.slots) {
      if (!s || s.def.kind === 'melee') continue;
      s.reserve = Math.min(s.maxReserve, s.reserve + Math.round(s.maxReserve * ratio));
    }
  }

  /** 进入新一层：把弹匣补满（优先消耗备弹） */
  topUpMagazines(): void {
    for (const s of this.slots) {
      if (!s || s.def.kind === 'melee') continue;
      const need = s.def.mag - s.ammo;
      const take = Math.min(need, s.reserve);
      s.ammo += take;
      s.reserve -= take;
    }
  }
}
