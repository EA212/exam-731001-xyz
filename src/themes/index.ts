import type { QuizQuestion } from '../lib/quiz-player';
import { catchTheme } from './catch';

export interface ThemeChapter {
  label: string;
  href: string;
  meta: string;
}

export interface ThemeVariant {
  id: string;
  label: string;
  questions: QuizQuestion[];
}

export interface ThemeHost {
  questions: QuizQuestion[];
  chapters: ThemeChapter[];
  variants: ThemeVariant[];
  notes?: string[];
  load?(href: string): Promise<QuizQuestion[]>;
  onGrade(q: QuizQuestion, pick: string, correct: boolean): void;
  onFinish(correct: number, total: number): void;
  onClose(): void;
}

export interface ThemeContext {
  mount: HTMLElement;
  title: string;
  host: ThemeHost;
}

export interface QuizTheme {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  create(ctx: ThemeContext): () => void;
}

export interface ThemeBinding {
  destroy(): void;
}

export const themes: QuizTheme[] = [catchTheme];

const LOCK_ID = 'zsb-theme-lock';
const LOCK_CSS = `html.theme-lock,html.theme-lock body{height:100%;overflow:hidden;overscroll-behavior:none;background:#05070f}
html.theme-lock body>:not(.theme-root){display:none!important}
.theme-root{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;overflow:hidden;touch-action:none;background:#05070f;color:#eaf0ff}`;

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

export function clearTheme(): void {
  write(null);
}

export function attachTheme(theme: QuizTheme, title: string, host: ThemeHost): ThemeBinding {
  document.querySelector('.theme-root')?.remove();
  let lock = document.getElementById(LOCK_ID) as HTMLStyleElement | null;
  if (!lock) {
    lock = document.createElement('style');
    lock.id = LOCK_ID;
    lock.textContent = LOCK_CSS;
    document.head.appendChild(lock);
  }
  const mount = document.createElement('div');
  mount.className = 'theme-root';
  document.body.appendChild(mount);
  document.documentElement.classList.add('theme-lock');
  window.scrollTo(0, 0);
  let alive = true;
  let dispose: () => void = () => undefined;
  const binding: ThemeBinding = {
    destroy(): void {
      if (!alive) return;
      alive = false;
      dispose();
      mount.remove();
      document.documentElement.classList.remove('theme-lock');
      lock?.remove();
    },
  };
  dispose = theme.create({
    mount,
    title,
    host: { ...host, onClose: (): void => { binding.destroy(); host.onClose(); } },
  });
  return binding;
}
