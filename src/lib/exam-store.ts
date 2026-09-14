/**
 * 答题记录本地存储
 * ----------------------------------------------------------------
 * 主存储：localStorage（容量大，适合存整本错题）
 * 兜底：cookie（localStorage 被禁用时降级，容量约 4KB，只够少量记录）
 *
 * 用户要求「用 cookies 存错题」，但 cookie 单域名上限仅约 4KB，
 * 存不下一本题库（题干 + 选项 + 解析），因此这里以 localStorage 为主、
 * cookie 作为降级通道，两者的效果一致：数据只存在你自己的设备上，
 * 刷新 / 关掉浏览器都不会丢，也不会被上传到任何服务器。
 */

const PREFIX = 'zsb';
export const KEY_WRONG = `${PREFIX}.wrong.v1`;
export const KEY_PROG = `${PREFIX}.prog.v1`;
export const KEY_SEEN = `${PREFIX}.seen.v1`;
export const KEY_SESSION = `${PREFIX}.session.v1`;
export const KEY_SETTINGS = `${PREFIX}.settings.v1`;

export type QuizType = 'danxuan' | 'duoxuan' | 'panduan' | 'other';

export interface QuizOption {
  label: string;
  text: string;
}

/** 一道错题的完整快照（脱离原页面也能复习） */
export interface WrongRecord {
  id: string;
  docId: string;
  docTitle: string;
  docUrl: string;
  subject: string;
  type: QuizType;
  typeName: string;
  num: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  chosen: string;
  analysis: string;
  point: number;
  wrongCount: number;
  firstAt: number;
  lastAt: number;
  mastered?: boolean;
}

/** 每份试卷的作答进度 */
export interface DocProgress {
  docId: string;
  docTitle: string;
  docUrl: string;
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  score: number;
  fullScore: number;
  lastAt: number;
  finished?: boolean;
}

/** 每道题的作答足迹（用于统计「已刷题数 / 正确率」） */
export interface SeenRecord {
  id: string;
  docId: string;
  correct: boolean;
  at: number;
}

export interface QuizSettings {
  instant: boolean;
  shuffle: boolean;
}

/* ------------------------------ 底层读写 ------------------------------ */

function hasLocalStorage(): boolean {
  try {
    const k = `${PREFIX}.__probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const LS_OK = typeof window !== 'undefined' && hasLocalStorage();

function cookieGet(key: string): string | null {
  try {
    const m = document.cookie.match(
      new RegExp('(?:^|; )' + key.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function cookieSet(key: string, val: string): void {
  try {
    if (val.length > 3800) return; // 超出容量直接放弃，避免破坏其他 cookie
    document.cookie = `${key}=${encodeURIComponent(val)}; path=/; max-age=${
      60 * 60 * 24 * 365
    }`;
  } catch {
    /* ignore */
  }
}

/** 读取（localStorage 优先，cookie 兜底） */
export function readStore<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  let raw: string | null = null;
  if (LS_OK) {
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
  }
  if (raw === null) raw = cookieGet(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** 写入（localStorage 失败时写 cookie） */
export function writeStore<T>(key: string, val: T): void {
  if (typeof window === 'undefined') return;
  const raw = JSON.stringify(val);
  let ok = false;
  if (LS_OK) {
    try {
      window.localStorage.setItem(key, raw);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) cookieSet(key, raw);
}

export function removeStore(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    document.cookie = `${key}=; path=/; max-age=0`;
  } catch {
    /* ignore */
  }
}

export function storageMode(): 'localStorage' | 'cookie' {
  return LS_OK ? 'localStorage' : 'cookie';
}

/* ------------------------------ 错题本 ------------------------------ */

export function getWrongMap(): Record<string, WrongRecord> {
  return readStore<Record<string, WrongRecord>>(KEY_WRONG, {});
}

export function getWrongList(): WrongRecord[] {
  return Object.values(getWrongMap()).sort((a, b) => b.lastAt - a.lastAt);
}

/** 记录 / 累加一道错题 */
export function saveWrong(rec: Omit<WrongRecord, 'wrongCount' | 'firstAt' | 'lastAt'>): void {
  const map = getWrongMap();
  const prev = map[rec.id];
  const now = Date.now();
  map[rec.id] = {
    ...rec,
    wrongCount: (prev?.wrongCount ?? 0) + 1,
    firstAt: prev?.firstAt ?? now,
    lastAt: now,
    mastered: false,
  };
  writeStore(KEY_WRONG, map);
}

export function markWrongMastered(id: string, mastered: boolean): void {
  const map = getWrongMap();
  if (!map[id]) return;
  map[id].mastered = mastered;
  if (mastered) map[id].lastAt = Date.now();
  writeStore(KEY_WRONG, map);
}

export function removeWrong(id: string): void {
  const map = getWrongMap();
  delete map[id];
  writeStore(KEY_WRONG, map);
}

export function clearWrong(): void {
  writeStore(KEY_WRONG, {});
}

/* ------------------------------ 已刷足迹 ------------------------------ */

export function getSeenMap(): Record<string, SeenRecord> {
  return readStore<Record<string, SeenRecord>>(KEY_SEEN, {});
}

export function markSeen(id: string, docId: string, correct: boolean): void {
  const map = getSeenMap();
  const prev = map[id];
  map[id] = {
    id,
    docId,
    correct: prev ? prev.correct && correct : correct,
    at: Date.now(),
  };
  writeStore(KEY_SEEN, map);
}

/* ------------------------------ 试卷进度 ------------------------------ */

export function getProgressMap(): Record<string, DocProgress> {
  return readStore<Record<string, DocProgress>>(KEY_PROG, {});
}

export function saveDocProgress(p: DocProgress): void {
  const map = getProgressMap();
  map[p.docId] = p;
  writeStore(KEY_PROG, map);
}

/* ------------------------------ 断点续答 ------------------------------ */

export interface SessionState {
  docId: string;
  ids: string[];
  index: number;
  chosen: Record<string, string>;
  graded: Record<string, boolean>;
  startedAt: number;
  elapsed: number;
  finished: boolean;
}

export function getSession(docId: string): SessionState | null {
  const all = readStore<Record<string, SessionState>>(KEY_SESSION, {});
  return all[docId] ?? null;
}

export function saveSession(s: SessionState): void {
  const all = readStore<Record<string, SessionState>>(KEY_SESSION, {});
  all[s.docId] = s;
  writeStore(KEY_SESSION, all);
}

export function clearSession(docId: string): void {
  const all = readStore<Record<string, SessionState>>(KEY_SESSION, {});
  delete all[docId];
  writeStore(KEY_SESSION, all);
}

/* ------------------------------ 设置 ------------------------------ */

export function getSettings(): QuizSettings {
  return readStore<QuizSettings>(KEY_SETTINGS, { instant: true, shuffle: false });
}

export function saveSettings(s: QuizSettings): void {
  writeStore(KEY_SETTINGS, s);
}

/* ------------------------------ 统计 ------------------------------ */

export interface QuizStats {
  /** 累计已刷题数（做过的不同题目数） */
  answered: number;
  /** 累计答对题数 */
  correct: number;
  /** 未掌握的错题数（待复习） */
  pending: number;
  /** 错题总条数 */
  totalWrong: number;
  /** 涉及试卷数 */
  docs: number;
}

export function getStats(): QuizStats {
  const seen = getSeenMap();
  const list = Object.values(seen);
  const wrongs = Object.values(getWrongMap());
  return {
    answered: list.length,
    correct: list.filter((s) => s.correct).length,
    pending: wrongs.filter((w) => !w.mastered).length,
    totalWrong: wrongs.length,
    docs: new Set(list.map((s) => s.docId)).size,
  };
}
