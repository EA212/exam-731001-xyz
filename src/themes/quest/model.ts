import type { QuestQuestion, QuestState, Reward } from './types';

const NODE_SIZE = 5;

export function buildNodes(qs: QuestQuestion[]): QuestState['nodes'] {
  const out: QuestState['nodes'] = [];
  for (let i = 0; i < qs.length; i += NODE_SIZE) {
    const items = qs.slice(i, i + NODE_SIZE).map((_, k) => i + k);
    const scrolls = items.filter((k) => qs[k].kind === 'scroll').length;
    const kind = scrolls === items.length ? 'scroll' : i + NODE_SIZE >= qs.length ? 'boss' : scrolls ? 'lore' : 'quest';
    out.push({ id: out.length, kind, items, cleared: false });
  }
  return out;
}

export function initialState(questions: QuestQuestion[], brand: string): QuestState {
  return {
    phase: 'menu',
    questions,
    nodes: buildNodes(questions),
    nodeIndex: 0,
    itemIndex: 0,
    score: 0,
    coins: 0,
    keys: 0,
    lives: 3,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    answered: 0,
    chests: 0,
    relics: [],
    lore: [],
    muted: false,
    paused: false,
    variant: -1,
    brand,
  };
}

export function rarity(combo: number, accuracy: number): number {
  const c = Math.floor(combo / 3) + (accuracy >= 0.8 ? 1 : 0);
  return Math.max(0, Math.min(3, c));
}

const POOL: Array<{ kind: Reward['kind']; label: string; value: number }> = [
  { kind: 'coin', label: '星币', value: 60 },
  { kind: 'coin', label: '星币', value: 120 },
  { kind: 'key', label: '钥匙', value: 1 },
  { kind: 'life', label: '生命', value: 1 },
  { kind: 'double', label: '双倍分', value: 1 },
  { kind: 'relic', label: '图鉴碎片', value: 1 },
  { kind: 'lore', label: '知识碎片', value: 1 },
  { kind: 'empty', label: '空箱', value: 0 },
];

export function rollReward(r: number, rand: () => number, lore: string): Reward {
  const base = POOL[Math.floor(rand() * POOL.length)];
  const scale = 1 + r * 0.5;
  return {
    kind: base.kind,
    label: base.kind === 'lore' && lore ? lore.slice(0, 14) : base.label,
    value: base.kind === 'coin' ? Math.round(base.value * scale) : base.value,
    rarity: r,
  };
}

export function accuracy(s: QuestState): number {
  return s.answered ? s.correct / s.answered : 0;
}

export function stars(s: QuestState): number {
  const a = accuracy(s);
  return a >= 0.9 ? 3 : a >= 0.65 ? 2 : a >= 0.4 ? 1 : 0;
}

export const RARITY_NAME = ['普通', '稀有', '史诗', '传说'];
export const RARITY_COLOR = [0x8fa6d8, 0x53d6a8, 0xb478ff, 0xffc94a];
