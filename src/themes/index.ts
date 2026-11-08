import type { QuizQuestion, QuizResult, QuizSnapshot } from '../lib/quiz-player';
import { mindTree } from './mind-tree';
import { arcade } from './arcade';

export interface ThemeSource {
  id: string;
  label: string;
  detail: string;
  gradable: boolean;
}

export interface ThemeVariant {
  id: string;
  label: string;
  questions: QuizQuestion[];
}

export interface ThemeHost {
  questions: QuizQuestion[];
  variants?: ThemeVariant[];
  onLaunch?(): void;
  onGrade(q: QuizQuestion, pick: string, correct: boolean): void;
  onStateChange(s: QuizSnapshot): void;
  onFinish(r: QuizResult): void;
  onClose(): void;
}

export interface ThemeContext {
  mount: HTMLElement;
  title: string;
  sources: ThemeSource[];
  host?: ThemeHost;
}

export interface ThemeInstance {
  onGrade?(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish?(r: QuizResult): void;
  launch?(questions: QuizQuestion[]): void;
  destroy?(): void;
}

export interface QuizTheme {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  pace: { right: number; wrong: number };
  standalone?: boolean;
  create(ctx: ThemeContext): ThemeInstance;
}

export interface ThemeBinding {
  pace: { right: number; wrong: number };
  standalone: boolean;
  launch(questions: QuizQuestion[]): void;
  onGrade(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish(r: QuizResult): void;
  destroy(): void;
}

export const themes: QuizTheme[] = [mindTree, arcade];

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

export function attachTheme(
  theme: QuizTheme | null,
  title: string,
  sources: ThemeSource[],
  anchor: Element,
  host?: ThemeHost,
): ThemeBinding | null {
  document.querySelector('.theme-stage')?.remove();
  if (!theme) return null;
  const mount = document.createElement('div');
  mount.className = 'theme-stage';
  if (theme.standalone) mount.classList.add('is-standalone');
  anchor.insertAdjacentElement('afterend', mount);
  const inst = theme.create({ mount, title, sources, host });
  return {
    pace: theme.pace,
    standalone: !!theme.standalone,
    launch: (qs): void => inst.launch?.(qs),
    onGrade: (q, pick, ok): void => { if (!theme.standalone) inst.onGrade?.(q, pick, ok); },
    onFinish: (r): void => { if (!theme.standalone) inst.onFinish?.(r); },
    destroy: (): void => { inst.destroy?.(); mount.remove(); },
  };
}
