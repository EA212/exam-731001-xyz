import type { QuizQuestion, QuizResult } from '../lib/quiz-player';
import { mindTree } from './mind-tree';

export interface ThemeSource {
  id: string;
  label: string;
  detail: string;
  gradable: boolean;
}

export interface ThemeContext {
  mount: HTMLElement;
  title: string;
  sources: ThemeSource[];
}

export interface ThemeInstance {
  onGrade?(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish?(r: QuizResult): void;
  destroy?(): void;
}

export interface QuizTheme {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  pace: { right: number; wrong: number };
  create(ctx: ThemeContext): ThemeInstance;
}

export interface ThemeBinding {
  pace: { right: number; wrong: number };
  onGrade(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish(r: QuizResult): void;
  destroy(): void;
}

export const themes: QuizTheme[] = [mindTree];

const KEY = 'zsb.theme.v1';
const read = (): string | null => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
const write = (v: string | null): void => {
  try { v === null ? sessionStorage.removeItem(KEY) : sessionStorage.setItem(KEY, v); } catch { return; }
};

export function currentTheme(): QuizTheme | null {
  const q = new URLSearchParams(location.search).get('theme');
  if (q !== null) write(q === 'none' ? null : q);
  const id = q !== null ? (q === 'none' ? null : q) : read();
  return themes.find((t) => t.id === id) ?? null;
}

export function attachTheme(theme: QuizTheme | null, title: string, sources: ThemeSource[], anchor: Element): ThemeBinding | null {
  document.querySelector('.theme-stage')?.remove();
  if (!theme) return null;
  const mount = document.createElement('div');
  mount.className = 'theme-stage';
  anchor.insertAdjacentElement('afterend', mount);
  const inst = theme.create({ mount, title, sources });
  return {
    pace: theme.pace,
    onGrade: (q, pick, ok): void => inst.onGrade?.(q, pick, ok),
    onFinish: (r): void => inst.onFinish?.(r),
    destroy: (): void => { inst.destroy?.(); mount.remove(); },
  };
}
