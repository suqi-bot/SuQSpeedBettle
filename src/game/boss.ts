import * as THREE from 'three';
import { hex, PALETTE } from './palette';

export interface BossHooks {
  slam(damage: number): void;
  ring(count: number, damage: number): void;
  summon(count: number): void;
}

/** 章1 Boss：总泵·铁喉（原型简化版，三阶段） */
export class Boss {
  hp = 2800;
  maxHp = 2800;
  alive = true;
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private core: THREE.Mesh;
  private coreMat: THREE.MeshBasicMaterial;
  private cd = 2.2;
  private windup = 0;
  private pending: 'slam' | 'ring' | 'summon' = 'slam';
  private t = 0;
  private phase = 1;

  constructor(x: number, z: number) {
    this.pos.set(x, 0, z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.1, 0.5, 10),
      new THREE.MeshBasicMaterial({ color: hex(PALETTE[7]) }),
    );
    base.position.y = 0.25;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 2.4, 2.8),
      new THREE.MeshBasicMaterial({ color: hex(PALETTE[16]) }),
    );
    body.position.y = 1.7;
    const belly = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.0, 1.4),
      new THREE.MeshBasicMaterial({ color: hex(PALETTE[14]) }),
    );
    belly.position.y = 1.1;
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, 1.6, 6),
      new THREE.MeshBasicMaterial({ color: hex(PALETTE[8]) }),
    );
    stack.position.set(1.0, 3.4, 0);
    this.coreMat = new THREE.MeshBasicMaterial({ color: hex(PALETTE[19]) });
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), this.coreMat);
    this.core.position.set(0, 1.9, 1.55);
    this.group.add(base, body, belly, stack, this.core);
    this.group.position.copy(this.pos);
  }

  update(dt: number, playerPos: THREE.Vector3, hooks: BossHooks): void {
    if (!this.alive) return;
    this.t += dt;
    this.phase = this.hp / this.maxHp < 0.33 ? 3 : this.hp / this.maxHp < 0.66 ? 2 : 1;

    // 缓慢转向玩家 + 核心上下浮动
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const targetYaw = Math.atan2(dx, dz);
    this.group.rotation.y += (targetYaw - this.group.rotation.y) * Math.min(1, dt * 1.2);
    this.core.position.y = 1.9 + Math.sin(this.t * 3) * 0.12;
    this.core.rotation.y += dt * 2;

    if (this.windup > 0) {
      this.windup -= dt;
      const k = 1 + Math.sin(this.t * 30) * 0.15;
      this.coreMat.color.setHex(this.windup > 0.25 ? hex(PALETTE[27]) : hex(PALETTE[19]));
      this.group.scale.setScalar(k);
      if (this.windup <= 0) {
        this.group.scale.setScalar(1);
        this.coreMat.color.setHex(hex(PALETTE[19]));
        this.execute(playerPos, hooks);
      }
      return;
    }

    this.cd -= dt;
    if (this.cd <= 0) {
      const speedUp = this.phase === 3 ? 0.62 : this.phase === 2 ? 0.8 : 1;
      this.pending = this.phase === 1 ? (Math.random() < 0.65 ? 'slam' : 'ring') : Math.random() < 0.45 ? 'slam' : Math.random() < 0.75 ? 'ring' : 'summon';
      this.windup = 0.85 * speedUp;
      this.cd = (this.phase === 3 ? 1.7 : 2.6) * speedUp + this.windup;
    }
  }

  private execute(playerPos: THREE.Vector3, hooks: BossHooks): void {
    if (this.pending === 'slam') {
      const d = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
      if (d < 6.5) hooks.slam(28);
    } else if (this.pending === 'ring') {
      hooks.ring(this.phase === 1 ? 8 : this.phase === 2 ? 10 : 12, 10);
    } else {
      hooks.summon(this.phase === 3 ? 3 : 2);
    }
  }

  damage(n: number, weak: boolean): boolean {
    if (!this.alive) return false;
    this.hp -= n * (weak ? 1.6 : 1);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
