import * as THREE from 'three';
import { PixelPipeline } from '../core/pixel';
import { Input } from '../core/input';
import { Player } from './player';
import { Enemy, EnemyKind, EnemyHooks } from './enemies';
import { Boss } from './boss';
import { buildLevel, createChest, createCoreProp, createExitGate, createShop, createSupply, LevelVisuals } from '../world/build';
import { generateArena, generateFloor, Level, roomAt, roomWorldCenter, solidAtWorld } from '../world/gen';
import { SpriteSet } from './art';
import { makeWeapon, RARITY, WeaponId, weaponDisplayName } from './weapons';
import { Hud, HudSnapshot } from './hud';
import { ArtAssets } from './assets';

interface Prop {
  kind: 'core' | 'exit' | 'chest' | 'shop' | 'supply';
  group: THREE.Group;
  x: number;
  z: number;
  used: boolean;
}

interface Projectile {
  sprite: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dmg: number;
  life: number;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

const FLOORS = 3;
const CORES_NEEDED = 2;

export class Game {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pipeline: PixelPipeline;
  private input: Input;
  private hud: Hud;
  private player = new Player();
  private sprites: SpriteSet;

  private level!: Level;
  private visuals: LevelVisuals | null = null;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private tracers: Tracer[] = [];
  private props: Prop[] = [];
  private boss: Boss | null = null;
  private bossBar = { hp: 0, max: 1 };
  private lamps: THREE.Sprite[] = [];

  private floor = 1;
  private cores = 0;
  private seed = 1;
  private state: 'menu' | 'playing' | 'dead' | 'victory' = 'menu';
  private timeSec = 0;
  private message = '';
  private messageLife = 0;
  private prompt = '';
  private hitMarker = 0;
  private floaters: { text: string; life: number; dx: number; dy: number }[] = [];
  private skillCdMax = [0, 0];
  private exitChannel = 0;
  private lastHurt = 0;
  private enemyHooks: EnemyHooks;

  constructor(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer, private art: ArtAssets) {
    this.camera = new THREE.PerspectiveCamera(82, 16 / 9, 0.05, 90);
    this.camera.rotation.order = 'YXZ';
    this.pipeline = new PixelPipeline(renderer);
    this.input = new Input(canvas);
    this.hud = new Hud(document.getElementById('hud') as HTMLCanvasElement, art.weapons, art.skillIcon);
    this.sprites = art.sprites;

    this.scene.background = new THREE.Color(0x0b0e12);
    this.scene.fog = new THREE.Fog(0x0b0e12, 9, 38);

    this.enemyHooks = {
      melee: (amount: number, fromX: number, fromZ: number) => {
        if (this.state !== 'playing') return;
        this.player.takeDamage(amount, fromX, fromZ);
        this.lastHurt = 1;
      },
      projectile: (origin: THREE.Vector3, dir: THREE.Vector3, damage: number, speed: number) =>
        this.spawnProjectile(origin, dir, damage, speed, this.sprites.orb),
    };

    canvas.addEventListener('mousedown', () => {
      if (this.state === 'menu') this.startRun();
      else if (this.state === 'dead' || this.state === 'victory') {
        this.state = 'menu';
        document.exitPointerLock();
      }
    });

    this.updateHud(0);

    // 开发期流程测试用（生产构建会被 tree-shake）
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__game = {
        toCore: () => {
          const c = this.props.find((p) => p.kind === 'core' && !p.used);
          if (c) this.player.spawnAt(c.x, c.z + 2.1, 0);
        },
        toExit: () => {
          const e = this.props.find((p) => p.kind === 'exit');
          if (e) this.player.spawnAt(e.x, e.z + 2.1, 0);
        },
        giveCores: () => {
          this.cores = CORES_NEEDED;
        },
        heal: () => {
          this.player.hp = this.player.maxHp;
          this.player.armor = this.player.maxArmor;
        },
        info: () => ({
          state: this.state,
          floor: this.floor,
          cores: this.cores,
          hp: this.player.hp,
          armor: this.player.armor,
          enemies: this.enemies.length,
          bossHp: this.boss?.hp ?? -1,
          pos: { x: this.player.pos.x, z: this.player.pos.z },
        }),
        killAll: () => {
          for (const e of this.enemies) {
            e.alive = false;
            e.sprite.removeFromParent();
          }
          this.enemies = [];
        },
      };
    }
  }

  startRun(seed = Math.floor(Math.random() * 1e9)): void {
    this.seed = seed;
    this.player = new Player();
    this.player.pos.set(0, 0, 0);
    this.floor = 1;
    this.cores = 0;
    this.timeSec = 0;
    this.state = 'playing';
    this.skillCdMax = [0, 0];
    this.loadFloor();
  }

  private disposeLevel(): void {
    if (this.visuals) {
      this.scene.remove(this.visuals.group);
      this.visuals.dispose();
      this.visuals = null;
    }
    for (const e of this.enemies) e.sprite.removeFromParent();
    this.enemies = [];
    for (const p of this.projectiles) p.sprite.removeFromParent();
    this.projectiles = [];
    for (const tr of this.tracers) tr.line.removeFromParent();
    this.tracers = [];
    for (const p of this.props) p.group.removeFromParent();
    this.props = [];
    for (const l of this.lamps) l.removeFromParent();
    this.lamps = [];
    if (this.boss) {
      this.boss.dispose();
      this.boss = null;
    }
  }

  private loadFloor(): void {
    this.disposeLevel();
    const isBoss = this.floor > FLOORS;
    this.level = isBoss ? generateArena(this.seed + 999) : generateFloor(this.seed + this.floor * 137);
    this.visuals = buildLevel(this.level, this.art.world);
    this.scene.add(this.visuals.group);
    this.addLamps();

    const startW = roomWorldCenter(this.level.start);
    if (isBoss) {
      // Boss 场：玩家从南侧入场，Boss 在中心
      this.player.spawnAt(startW.x, startW.z + 14, 0);
    } else {
      this.player.spawnAt(startW.x, startW.z, 0);
    }
    this.player.armor = Math.min(this.player.maxArmor, this.player.armor + this.player.maxArmor * 0.3);
    this.player.heal(10);
    this.player.refillAmmo(0.35);
    this.player.topUpMagazines();

    this.cores = 0;
    this.exitChannel = 0;

    if (isBoss) {
      const c = roomWorldCenter(this.level.rooms[0]);
      this.boss = new Boss(c.x, c.z);
      this.bossBar = { hp: this.boss.maxHp, max: this.boss.maxHp };
      this.scene.add(this.boss.group);
      // Boss 场：入场补齐弹药/护甲 + 3 个一次性补给点
      this.player.refillAmmo(1);
      this.player.topUpMagazines();
      this.player.armor = this.player.maxArmor;
      const spots: [number, number][] = [
        [8, 0],
        [-8, 0],
        [0, 8],
      ];
      for (const [ox, oz] of spots) {
        const g = createSupply();
        const x = c.x + ox;
        const z = c.z + oz;
        g.position.set(x, 0, z);
        this.scene.add(g);
        this.props.push({ kind: 'supply', group: g, x, z, used: false });
      }
      this.addMessage('总泵·铁喉 —— 它醒了', 3.2);
      return;
    }

    this.placeProps();
    this.spawnEnemiesForFloor();
    this.addMessage(isBoss ? '' : `F${this.floor} · 锈泵层`, 2.2);
  }

  private placeProps(): void {
    const add = (kind: Prop['kind'], group: THREE.Group, x: number, z: number) => {
      group.position.set(x, 0, z);
      this.scene.add(group);
      this.props.push({ kind, group, x, z, used: false });
    };

    for (const r of this.level.rooms) {
      const c = roomWorldCenter(r);
      if (r.type === 'core') add('core', createCoreProp(), c.x, c.z);
      if (r.type === 'exit') add('exit', createExitGate(), c.x, c.z);
      if (r.type === 'treasure') add('chest', createChest(), c.x, c.z);
      if (r.type === 'shop') add('shop', createShop(), c.x, c.z);
    }
    // 额外宝箱：2 个随机战斗房
    const combat = this.level.rooms.filter((r) => r.type === 'combat');
    for (let i = 0; i < Math.min(2, combat.length); i++) {
      const c = roomWorldCenter(combat[i]);
      add('chest', createChest(), c.x + 1.5, c.z - 1.2);
    }
  }

  /** 房间顶部的暖光灯（提供色板高光、阅读空间纵深） */
  private addLamps(): void {
    for (const r of this.level.rooms) {
      const c = roomWorldCenter(r);
      const mat = new THREE.SpriteMaterial({
        map: this.sprites.lamp,
        color: 0xe0b14a,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(c.x, 2.5, c.z);
      s.scale.setScalar(2.0);
      this.scene.add(s);
      this.lamps.push(s);
    }
  }

  private spawnEnemiesForFloor(): void {
    const counts: Record<string, number> = {
      combat: 2,
      core: 1,
      treasure: 0,
      exit: 1,
      shop: 0,
      start: 0,
    };
    for (const r of this.level.rooms) {
      const n = counts[r.type] ?? 0;
      for (let i = 0; i < n; i++) {
        const kind: EnemyKind = Math.random() < 0.55 ? 'rat' : Math.random() < 0.65 ? 'pump' : 'steam';
        const x = (r.x + 1 + Math.random() * (r.w - 2)) * 2;
        const z = (r.y + 1 + Math.random() * (r.h - 2)) * 2;
        if (solidAtWorld(this.level, x, z)) continue;
        this.spawnEnemy(kind, x, z, r.id);
      }
    }
  }

  private spawnEnemy(kind: EnemyKind, x: number, z: number, roomId = -1): void {
    const e = new Enemy(kind, x, z, this.sprites);
    e.roomId = roomId;
    this.enemies.push(e);
    this.scene.add(e.sprite);
  }

  private spawnProjectile(origin: THREE.Vector3, dir: THREE.Vector3, damage: number, speed: number, tex: THREE.Texture): void {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.4);
    sprite.position.copy(origin);
    this.scene.add(sprite);
    this.projectiles.push({ sprite, pos: origin.clone(), vel: dir.clone().multiplyScalar(speed), dmg: damage, life: 6 });
  }

  update(dt: number): void {
    this.input.poll();
    this.visuals?.group.updateMatrixWorld();
    if (this.state === 'playing' && this.input.state.locked) {
      this.timeSec += dt;
      this.player.update(dt, this.input.state, this.level);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateTracers(dt);
      this.handleCombat();
      this.handleInteraction(dt);
      this.updateBoss(dt);
      this.updateProps(dt);
      this.updateCamera();
      if (this.player.dead) {
        this.state = 'dead';
        document.exitPointerLock();
      }
    } else {
      this.updateCamera();
    }

    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.lastHurt = Math.max(0, this.lastHurt - dt * 2);
    for (const f of this.floaters) {
      f.life -= dt;
      f.dy -= dt * 18;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    if (this.messageLife > 0) this.messageLife -= dt;

    this.pipeline.render(this.scene, this.camera);
    this.updateHud(dt);
    this.input.flush();
  }

  private updateCamera(): void {
    const eye = this.player.eye;
    const shake = this.player.shake;
    const rx = shake > 0 ? (Math.random() - 0.5) * shake * 0.06 : 0;
    const ry = shake > 0 ? (Math.random() - 0.5) * shake * 0.06 : 0;
    this.camera.position.set(eye.x + rx, eye.y + ry, eye.z);
    this.camera.rotation.set(this.player.pitch + this.player.recoil * 0.02, this.player.yaw, 0);
  }

  private updateEnemies(dt: number): void {
    const pp = new THREE.Vector3(this.player.pos.x, 1.3, this.player.pos.z);
    const playerRoom = roomAt(this.level, this.player.pos.x, this.player.pos.z);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const distToPlayer = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
      // 跨房间不主动索敌：同房间，或已贴到 8m 内才激活
      const engaged = e.roomId < 0 || (playerRoom !== null && e.roomId === playerRoom.id) || distToPlayer < 8;
      e.update(dt, pp, this.level, this.enemyHooks, engaged);
      // 反重叠：敌人不能站进玩家身体里（否则会“隐身”贴脸）
      const dx = e.pos.x - this.player.pos.x;
      const dz = e.pos.z - this.player.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = e.radius + 0.45;
      if (d > 0.001 && d < minD) {
        e.pos.x += (dx / d) * (minD - d);
        e.pos.z += (dz / d) * (minD - d);
      }
      if (e.explodeFx) {
        e.explodeFx = false;
        this.explosion(e.pos, 8);
        e.sprite.removeFromParent();
      }
    }
    this.enemies = this.enemies.filter((e) => {
      if (!e.alive) {
        if (e.sprite.parent) e.sprite.removeFromParent();
        return false;
      }
      return true;
    });
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.sprite.position.copy(p.pos);
      if (solidAtWorld(this.level, p.pos.x, p.pos.z)) p.life = 0;
      const dx = p.pos.x - this.player.pos.x;
      const dz = p.pos.z - this.player.pos.z;
      if (Math.hypot(dx, dz) < 0.55 && p.pos.y > 0.2 && p.pos.y < 2.0) {
        this.player.takeDamage(p.dmg, p.pos.x, p.pos.z);
        this.lastHurt = 1;
        p.life = 0;
      }
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (p.life <= 0) {
        p.sprite.removeFromParent();
        return false;
      }
      return true;
    });
  }

  private updateTracers(dt: number): void {
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => {
      if (t.life <= 0) {
        t.line.removeFromParent();
        return false;
      }
      return true;
    });
  }

  private handleCombat(): void {
    const input = this.input.state;
    const w = this.player.weapon;
    if (!w) return;

    if (input.skillPressed && this.player.skillCd[this.player.current] <= 0) {
      this.useSkill();
    }

    const wantFire = w.def.auto ? input.fire : input.firePressed;
    if (wantFire && this.player.canFire()) {
      this.player.consumeShot();
      if (w.def.kind === 'melee') this.meleeSwing(w.def.range, w.damage, 0.6);
      else this.fireBullets(w.def.pellets, w.damage, w.def.spread, w.def.range);
    }

    // 空仓自动提示
    if (input.firePressed && w.def.kind !== 'melee' && w.ammo <= 0 && this.player.reloadTimer <= 0) {
      this.player.startReload();
      if (w.reserve <= 0) this.addMessage('弹药耗尽', 1.2);
    }
  }

  private fireBullets(pellets: number, damage: number, spread: number, range: number): void {
    const origin = this.camera.position.clone();
    for (let i = 0; i < pellets; i++) {
      const dir = this.rayDirection(spread);
      this.castRay(origin, dir, range, damage);
    }
    this.player.shake = Math.max(this.player.shake, 0.35);
  }

  private rayDirection(spread: number): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (spread > 0) {
      const a = (Math.random() - 0.5) * spread * 2;
      const b = (Math.random() - 0.5) * spread * 2;
      dir.x += a;
      dir.y += b;
      dir.normalize();
    }
    return dir;
  }

  private castRay(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number): void {
    let wallT = range;
    for (let t = 0.2; t < range; t += 0.3) {
      if (solidAtWorld(this.level, origin.x + dir.x * t, origin.z + dir.z * t)) {
        wallT = t;
        break;
      }
    }

    let bestT = wallT;
    let hitEnemy: Enemy | null = null;
    let hitBoss: Boss | null = null;
    let weak = false;

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const center = new THREE.Vector3(e.pos.x, e.def.height * 0.45, e.pos.z);
      const to = center.clone().sub(origin);
      const proj = to.dot(dir);
      if (proj < 0.2 || proj > bestT) continue;
      const closest = origin.clone().addScaledVector(dir, proj);
      if (closest.distanceTo(center) < e.radius + 0.2) {
        bestT = proj;
        hitEnemy = e;
      }
    }

    if (this.boss && this.boss.alive) {
      const coreWorld = new THREE.Vector3();
      this.boss.group.getWorldPosition(coreWorld);
      const toCore = coreWorld.clone().setY(1.9).sub(origin);
      const proj = toCore.dot(dir);
      if (proj > 0.2 && proj < bestT) {
        const closest = origin.clone().addScaledVector(dir, proj);
        if (closest.distanceTo(coreWorld.clone().setY(1.9)) < 1.9) {
          bestT = proj;
          hitBoss = this.boss;
          weak = closest.distanceTo(coreWorld.clone().setY(1.9)) < 0.85;
          hitEnemy = null;
        }
      }
    }

    const end = origin.clone().addScaledVector(dir, bestT);
    this.addTracer(origin, end);

    if (hitEnemy) {
      const died = hitEnemy.damage(damage);
      this.hitMarker = 0.12;
      this.addFloater(`${Math.round(damage)}`);
      if (died) this.onKill(hitEnemy);
    } else if (hitBoss) {
      const died = hitBoss.damage(damage, weak);
      this.bossBar.hp = hitBoss.hp;
      this.hitMarker = 0.12;
      this.addFloater(`${Math.round(damage * (weak ? 1.6 : 1))}`);
      if (died) this.onBossKill();
    } else if (bestT < range) {
      this.addSpark(end);
    }
  }

  private meleeSwing(range: number, damage: number, dotMin: number): void {
    const origin = this.camera.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    let hitAny = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
      const d = to.length();
      if (d > range + e.radius) continue;
      if (to.normalize().dot(fwd) < dotMin) continue;
      hitAny = true;
      const died = e.damage(damage);
      e.pos.addScaledVector(fwd, 0.6);
      this.addFloater(`${Math.round(damage)}`);
      if (died) this.onKill(e);
    }
    if (this.boss && this.boss.alive) {
      const to = new THREE.Vector3(this.boss.pos.x - origin.x, 0, this.boss.pos.z - origin.z);
      if (to.length() < range + 1.8 && to.normalize().dot(fwd) > dotMin) {
        hitAny = true;
        const died = this.boss.damage(damage, false);
        this.bossBar.hp = this.boss.hp;
        if (died) this.onBossKill();
      }
    }
    if (hitAny) this.hitMarker = 0.12;
  }

  private useSkill(): void {
    const w = this.player.weapon;
    if (!w) return;
    const idx = this.player.current;
    const cd = w.def.skill.cd;
    const origin = this.camera.position.clone();

    if (w.def.id === 'crowbar') {
      this.meleeSwing(3.0, 80, 0.35);
      this.addMessage('撬击', 0.8);
    } else if (w.def.id === 'sidearm') {
      if (w.ammo <= 0 && w.reserve <= 0) return;
      const n = Math.min(3, w.ammo + w.reserve);
      for (let i = 0; i < n; i++) this.castRay(origin, this.rayDirection(0.02), w.def.range, 22 * (w.damage / w.def.damage));
      w.ammo = Math.max(0, w.ammo - n);
      this.player.muzzle = 0.07;
      this.addMessage('三连点射', 0.8);
    } else if (w.def.id === 'shotgun') {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize();
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
        const d = to.length();
        if (d > 3.6 + e.radius) continue;
        if (to.normalize().dot(fwd) < 0.35) continue;
        const died = e.damage(35);
        e.pos.addScaledVector(fwd, 1.4);
        if (died) this.onKill(e);
      }
      this.player.muzzle = 0.08;
      this.player.shake = 0.6;
      this.addMessage('破门弹', 0.8);
    } else if (w.def.id === 'carbine') {
      const n = Math.min(5, w.ammo + w.reserve);
      for (let i = 0; i < n; i++) this.castRay(origin, this.rayDirection(0.004), w.def.range, 24 * (w.damage / w.def.damage));
      w.ammo = Math.max(0, w.ammo - n);
      this.player.muzzle = 0.08;
      this.addMessage('短点射', 0.8);
    }

    this.player.skillCd[idx] = cd;
    this.skillCdMax[idx] = cd;
  }

  private explosion(center: THREE.Vector3, radius: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - center.x, e.pos.z - center.z);
      if (d < radius) {
        const died = e.damage(30);
        if (died) this.onKill(e);
      }
    }
    const pd = Math.hypot(this.player.pos.x - center.x, this.player.pos.z - center.z);
    if (pd < radius) this.player.takeDamage(18, center.x, center.z);
    this.addFloater('BOOM');
  }

  private onKill(e: Enemy): void {
    this.player.kills++;
    this.player.scrap += 8;
    this.addFloater('+8');
    e.sprite.removeFromParent();
  }

  private onBossKill(): void {
    this.player.kills++;
    this.state = 'victory';
    document.exitPointerLock();
    this.addMessage('铁喉停摆 —— 深潜完成', 5);
  }

  private updateBoss(dt: number): void {
    if (!this.boss || !this.boss.alive) return;
    const pp = new THREE.Vector3(this.player.pos.x, 1.3, this.player.pos.z);
    this.boss.update(dt, pp, {
      slam: (damage) => {
        const d = Math.hypot(this.player.pos.x - this.boss!.pos.x, this.player.pos.z - this.boss!.pos.z);
        if (d < 6.5) {
          this.player.takeDamage(damage, this.boss!.pos.x, this.boss!.pos.z);
          this.lastHurt = 1;
        }
        this.player.shake = 1;
      },
      ring: (count, damage) => {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
          const dir = new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)).normalize();
          const origin = new THREE.Vector3(this.boss!.pos.x + dir.x * 2.4, 1.4, this.boss!.pos.z + dir.z * 2.4);
          this.spawnProjectile(origin, dir, damage, 8.5, this.sprites.fireOrb);
        }
      },
      summon: (count) => {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawnEnemy('rat', this.boss!.pos.x + Math.cos(a) * 4, this.boss!.pos.z + Math.sin(a) * 4);
        }
      },
    });
  }

  private updateProps(dt: number): void {
    for (const p of this.props) {
      if (p.kind === 'core' && !p.used) {
        const core = p.group.userData.core as THREE.Mesh | undefined;
        if (core) core.rotation.y += dt * 1.5;
        p.group.position.y = Math.sin(performance.now() * 0.002) * 0.05;
      }
      if (p.kind === 'exit') {
        const inner = p.group.userData.inner as THREE.Mesh | undefined;
        if (inner) {
          const mat = inner.material as THREE.MeshBasicMaterial;
          mat.opacity = this.cores >= CORES_NEEDED ? 0.35 + Math.sin(performance.now() * 0.006) * 0.12 : 0.1;
        }
      }
    }
  }

  private handleInteraction(dt: number): void {
    let near: Prop | null = null;
    let bestD = 2.6;
    for (const p of this.props) {
      if (p.used) continue;
      const d = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z);
      if (d < bestD) {
        bestD = d;
        near = p;
      }
    }

    this.prompt = '';
    if (near) {
      if (near.kind === 'core') this.prompt = '按 E 回收共振核心';
      if (near.kind === 'chest') this.prompt = '按 E 开启补给箱';
      if (near.kind === 'shop') this.prompt = `按 E 修复 40 HP（60 废料，现有 ${this.player.scrap}）`;
      if (near.kind === 'supply') this.prompt = '按 E 取用补给（弹药 + 护甲）';
      if (near.kind === 'exit') {
        this.prompt =
          this.cores >= CORES_NEEDED ? '按 E 启动下行井' : `下行井需要 ${CORES_NEEDED} 个共振核心（${this.cores}/${CORES_NEEDED}）`;
      }
    }

    if (near && this.input.state.interactPressed) {
      if (near.kind === 'core') {
        near.used = true;
        near.group.removeFromParent();
        this.cores++;
        this.addMessage(`共振核心 ${this.cores}/${CORES_NEEDED}`, 1.6);
        this.addFloater('CORE');
      } else if (near.kind === 'chest') {
        near.used = true;
        const lid = near.group.userData.lid as THREE.Mesh | undefined;
        if (lid) lid.rotation.x = -0.9;
        this.giveWeapon();
      } else if (near.kind === 'shop') {
        if (this.player.scrap >= 60) {
          this.player.scrap -= 60;
          this.player.heal(40);
          this.addMessage('修复完成 +40 HP', 1.4);
        } else {
          this.addMessage('废料不足（需要 60）', 1.4);
        }
      } else if (near.kind === 'supply') {
        near.used = true;
        near.group.removeFromParent();
        this.player.refillAmmo(0.6);
        this.player.heal(30);
        this.player.addArmor(30);
        this.addMessage('补给：弹药 +60% / +30 HP / +30 护甲', 1.8);
      }
    }

    // 出口蓄力
    if (near && near.kind === 'exit' && this.cores >= CORES_NEEDED) {
      if (this.input.state.interactPressed || this.exitChannel > 0) {
        this.exitChannel += dt;
        this.addMessage(`启动中 ${Math.min(100, Math.round((this.exitChannel / 1.2) * 100))}%`, 0.2);
        if (this.exitChannel >= 1.2) {
          this.exitChannel = 0;
          this.nextFloor();
        }
      }
    } else {
      this.exitChannel = 0;
    }
  }

  private giveWeapon(): void {
    const pool: WeaponId[] = ['shotgun', 'carbine', 'sidearm'];
    const id = pool[Math.floor(Math.random() * pool.length)];
    const roll = Math.random();
    const rarity = roll > 0.93 ? 3 : roll > 0.72 ? 2 : roll > 0.28 ? 1 : 0;
    const w = makeWeapon(id, rarity);
    this.player.slots[0] = w;
    this.player.current = 0;
    this.player.switchTo(0);
    this.player.refillAmmo(0.25);
    this.addMessage(`获得 ${weaponDisplayName(w)}`, 2.2);
  }

  private nextFloor(): void {
    this.floor++;
    this.loadFloor();
    if (this.floor > FLOORS) this.addMessage('总泵·铁喉 —— 它醒了', 3);
  }

  private addMessage(msg: string, life = 1.6): void {
    this.message = msg;
    this.messageLife = life;
  }

  private addFloater(text: string): void {
    this.floaters.push({
      text,
      life: 0.6,
      dx: (Math.random() - 0.5) * 20,
      dy: -6 + (Math.random() - 0.5) * 8,
    });
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xe0b14a, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.055 });
  }

  private addSpark(pos: THREE.Vector3): void {
    const mat = new THREE.SpriteMaterial({ map: this.sprites.spark, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.setScalar(0.35);
    this.scene.add(s);
    setTimeout(() => s.removeFromParent(), 70);
  }

  private updateHud(dt: number): void {
    const p = this.player;
    const w = p.weapon;
    const rooms = this.level ? this.level.rooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, type: r.type })) : [];
    const levelW = this.level ? this.level.w : 1;
    const levelH = this.level ? this.level.h : 1;
    const spread = w ? (w.def.spread * 40 + Math.hypot(p.vel.x, p.vel.z) * 0.02) : 0.2;
    const snap: HudSnapshot = {
      state: this.state,
      locked: this.input.state.locked,
      hp: p.hp,
      maxHp: p.maxHp,
      armor: p.armor,
      maxArmor: p.maxArmor,
      ammo: w ? w.ammo : 0,
      reserve: w ? w.reserve : 0,
      weaponName: w ? weaponDisplayName(w) : '',
      weaponId: w ? w.def.id : 'sidearm',
      rarityColor: w ? `#${RARITY[w.rarityIdx].color.toString(16).padStart(6, '0')}` : '#e8e4d8',
      skillName: w ? w.def.skill.name : '',
      skillCd: p.skillCd[p.current],
      skillCdMax: this.skillCdMax[p.current] || 1,
      floor: Math.min(this.floor, FLOORS + 1),
      floors: FLOORS,
      isBossFloor: this.floor > FLOORS,
      cores: this.cores,
      coresNeeded: this.floor > FLOORS ? 0 : CORES_NEEDED,
      message: this.message,
      messageLife: this.messageLife,
      prompt: this.prompt,
      kills: p.kills,
      scrap: p.scrap,
      bossHp: this.boss && this.boss.alive ? this.boss.hp : null,
      bossMax: this.bossBar.max,
      bossName: '总泵·铁喉',
      hurt: p.hurtFlash,
      hitAngle: p.hitAngle,
      hitLife: p.hitLife,
      crosshairSpread: spread,
      hitMarker: this.hitMarker,
      bobPhase: p.bobPhase,
      recoil: p.recoil,
      muzzle: p.muzzle > 0,
      timeSec: this.timeSec,
      seed: this.seed,
      rooms,
      levelW,
      levelH,
      playerCell: { x: Math.floor(p.pos.x / 2), y: Math.floor(p.pos.z / 2) },
      floaters: this.floaters,
      reloadProgress: p.reloadTimer > 0 ? 1 - p.reloadTimer / Math.max(0.001, p.reloadTotal) : 0,
      reloading: p.reloadTimer > 0,
    };
    this.hud.draw(snap);
    void dt;
  }
}
