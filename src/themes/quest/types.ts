export type QuestKind = 'choice' | 'scroll';
export type QuestType = 'danxuan' | 'duoxuan' | 'panduan' | 'other';

export interface QuestOption { label: string; text: string }

export interface QuestQuestion {
  id: string;
  num: string;
  typeName: string;
  type: QuestType;
  kind: QuestKind;
  stem: string;
  material: string;
  options: QuestOption[];
  answer: string;
  answerText: string;
  analysis: string;
  keyPoints: string;
  point: number;
}

export interface QuestChapter { label: string; href: string; meta: string }
export interface QuestVariant { id: string; label: string; questions: QuestQuestion[] }

export interface QuestHost {
  questions: QuestQuestion[];
  chapters: QuestChapter[];
  variants: QuestVariant[];
  load?(href: string): Promise<QuestQuestion[]>;
  onGrade(q: QuestQuestion, pick: string, ok: boolean): void;
  onFinish(correct: number, total: number): void;
  onClose(): void;
}

export interface QuestContext {
  mount: HTMLElement;
  title: string;
  host: QuestHost;
}

export interface QuestTheme {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  create(ctx: QuestContext): () => void;
}

export type Phase = 'menu' | 'map' | 'play' | 'feedback' | 'reward' | 'result';

export interface Reward {
  kind: 'coin' | 'key' | 'life' | 'double' | 'relic' | 'lore' | 'empty';
  label: string;
  value: number;
  rarity: number;
}

export interface QuestState {
  phase: Phase;
  questions: QuestQuestion[];
  nodes: { id: number; kind: string; items: number[]; cleared: boolean }[];
  nodeIndex: number;
  itemIndex: number;
  score: number;
  coins: number;
  keys: number;
  lives: number;
  combo: number;
  bestCombo: number;
  correct: number;
  answered: number;
  chests: number;
  relics: string[];
  lore: string[];
  muted: boolean;
  paused: boolean;
  variant: number;
  brand: string;
}
