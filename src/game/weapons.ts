export type WeaponId = 'crowbar' | 'sidearm' | 'shotgun' | 'carbine';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cn: string;
  kind: 'melee' | 'hitscan' | 'shotgun';
  damage: number;
  rpm: number;
  mag: number;
  reload: number;
  spread: number; // 弧度
  pellets: number;
  range: number;
  auto: boolean;
  knockback: number;
  skill: { name: string; cd: number; desc: string };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  crowbar: {
    id: 'crowbar',
    name: 'CROWBAR',
    cn: '撬棍',
    kind: 'melee',
    damage: 42,
    rpm: 109, // 0.55s
    mag: 0,
    reload: 0,
    spread: 0,
    pellets: 1,
    range: 2.4,
    auto: true,
    knockback: 4,
    skill: { name: '撬击', cd: 6, desc: '80 伤害 + 强击退' },
  },
  sidearm: {
    id: 'sidearm',
    name: 'SIDEARM',
    cn: '应急手枪',
    kind: 'hitscan',
    damage: 17,
    rpm: 400,
    mag: 12,
    reload: 1.1,
    spread: 0.008,
    pellets: 1,
    range: 40,
    auto: false,
    knockback: 0.6,
    skill: { name: '三连点射', cd: 5, desc: '3 发 × 22 伤害' },
  },
  shotgun: {
    id: 'shotgun',
    name: 'PUMP SHOTGUN',
    cn: '泵动霰弹',
    kind: 'shotgun',
    damage: 14,
    rpm: 72,
    mag: 6,
    reload: 2.6,
    spread: 0.09,
    pellets: 10,
    range: 16,
    auto: false,
    knockback: 1.4,
    skill: { name: '破门弹', cd: 7, desc: '锥形冲击 35 + 击退' },
  },
  carbine: {
    id: 'carbine',
    name: 'CARBINE',
    cn: '卡宾枪',
    kind: 'hitscan',
    damage: 18,
    rpm: 620,
    mag: 30,
    reload: 1.8,
    spread: 0.01,
    pellets: 1,
    range: 44,
    auto: true,
    knockback: 0.4,
    skill: { name: '短点射', cd: 8, desc: '5 发精准弹，零后坐' },
  },
};

export const RARITY = [
  { name: '粗制', color: 0x8f9596, mult: 0.85 },
  { name: '标准', color: 0xc9cbc2, mult: 1.0 },
  { name: '精制', color: 0x60753f, mult: 1.08 },
  { name: '稀有', color: 0x49c6c0, mult: 1.16 },
];

export interface WeaponInstance {
  def: WeaponDef;
  ammo: number;
  reserve: number;
  maxReserve: number;
  rarityIdx: number;
  damage: number;
}

export function makeWeapon(id: WeaponId, rarityIdx = 1): WeaponInstance {
  const def = WEAPONS[id];
  const rarity = RARITY[Math.min(RARITY.length - 1, rarityIdx)];
  const reserveBase: Record<WeaponId, number> = {
    crowbar: 0,
    sidearm: 96,
    shotgun: 36,
    carbine: 180,
  };
  return {
    def,
    ammo: def.mag,
    reserve: reserveBase[id],
    maxReserve: reserveBase[id],
    rarityIdx,
    damage: def.damage * rarity.mult,
  };
}

export function weaponDisplayName(w: WeaponInstance): string {
  const r = RARITY[w.rarityIdx];
  return `${r.name}·${w.def.cn}`;
}
