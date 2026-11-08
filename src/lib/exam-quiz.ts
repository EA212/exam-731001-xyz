import {
  type QuizOption,
  type QuizType,
  getSession,
  getSettings,
  getSeenMap,
  getWrongMap,
  markSeen,
  saveDocProgress,
  saveSession,
  saveWrong,
  storageMode,
} from './exam-store';
import {
  type QuizQuestion,
  type QuizSnapshot,
  type QuizPlayer,
  createQuizPlayer,
  isCorrect,
} from './quiz-player';
import { normalizeObjectiveAnswer } from './taxonomy';
import { attachTheme, currentTheme, clearTheme, type ThemeHost } from '../themes';

export type ParsedQ = QuizQuestion & { rawAnswer: string };

export interface QuizContext {
  docId: string;
  docTitle: string;
  docUrl: string;
  subject: string;
}

const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();

const TYPE_ALIAS: Array<[RegExp, QuizType, string]> = [
  [/单项选择|单选题/, 'danxuan', '单项选择题'],
  [/多项选择|多选题/, 'duoxuan', '多项选择题'],
  [/辨析/, 'panduan', '辨析题'],
  [/判断/, 'panduan', '判断题'],
  [/名词解释/, 'other', '名词解释题'],
  [/填空/, 'other', '填空题'],
  [/简答|简述|问答/, 'other', '简答题'],
  [/论述/, 'other', '论述题'],
  [/案例/, 'other', '案例分析题'],
  [/材料分析/, 'other', '材料分析题'],
];

export function parseSectionHeading(text: string): { type: QuizType; name: string; point: number } {
  const t = norm(text);
  let type: QuizType = 'other';
  let name = t.split('（')[0].replace(/^[一二三四五六七八九十]+、\s*/, '') || '题目';
  for (const [re, ty, nm] of TYPE_ALIAS) {
    if (re.test(t)) {
      type = ty;
      name = nm;
      break;
    }
  }
  const pm = t.match(/每小题\s*([\d.]+)\s*分/);
  const point = pm ? parseFloat(pm[1]) : 1;
  return { type, name, point };
}

const OPTION_RE = /^\s*([A-Ha-h])\s*[.、．)）]\s*([\s\S]+)$/;

export function parseQuestions(root: Element, ctx: QuizContext): ParsedQ[] {
  const out: ParsedQ[] = [];
  let section = { type: 'other' as QuizType, name: '题目', point: 1 };
  let counter = 0;

  for (const el of Array.from(root.children)) {
    const tag = el.tagName;
    if (tag === 'H2') {
      section = parseSectionHeading(el.textContent || '');
      continue;
    }
    if (tag !== 'SECTION' || !el.classList.contains('exam-q')) continue;

    const h3 = el.querySelector('h3');
    if (!h3) continue;
    const rawStem = norm(h3.textContent || '');
    const nm = rawStem.match(/^\s*(\d+)\s*[.、．]/);

    const options: QuizOption[] = [];
    let answer = '';
    let rawAnswer = '';
    let analysis = '';
    let verdictText = '';
    let seenAnswer = false;
    const extraStem: string[] = [];

    for (const child of Array.from(el.children)) {
      if (child === h3) continue;
      const cls = child.classList;
      if (cls.contains('exam-answer')) {
        rawAnswer = norm(child.textContent || '');
        answer = normalizeObjectiveAnswer(rawAnswer.replace(/^[^：:]*[：:]\s*/, '')) || '';
        seenAnswer = true;
        continue;
      }
      if (cls.contains('exam-analysis')) {
        analysis = norm(child.textContent || '');
        seenAnswer = true;
        continue;
      }
      if (cls.contains('exam-point')) continue;
      if (child.tagName === 'UL') {
        for (const li of Array.from(child.querySelectorAll('li'))) {
          const m = norm(li.textContent || '').match(OPTION_RE);
          if (m) options.push({ label: m[1].toUpperCase(), text: m[2].trim() });
        }
        continue;
      }
      if (child.tagName === 'P' || child.tagName === 'BLOCKQUOTE') {
        const t = norm(child.textContent || '');
        if (!t) continue;
        if (seenAnswer) {
          if (!verdictText) verdictText = t;
        } else {
          extraStem.push(t);
        }
      }
    }

    if (!answer && section.type === 'panduan') {
      const m = (verdictText || rawAnswer).slice(0, 40).match(/正确|错误|对|错/);
      if (m) answer = m[0] === '正确' || m[0] === '对' ? '对' : '错';
    }
    if (answer && /^[A-H]+$/.test(answer) && options.length) {
      const labels = new Set(options.map((o) => o.label));
      const kept = [...answer].filter((c) => labels.has(c)).join('');
      if (kept) answer = kept;
    }
    if (options.length === 0 && (section.type === 'panduan' || /^(对|错|正确|错误)$/.test(answer))) {
      if (answer) options.push({ label: '对', text: '正确' }, { label: '错', text: '错误' });
    }

    counter += 1;
    const num = nm ? nm[1] : String(counter);
    out.push({
      id: `${ctx.docId}#${num}`,
      num,
      stem: [rawStem, ...extraStem].filter(Boolean).join('\n'),
      options,
      answer,
      rawAnswer,
      analysis,
      type: section.type,
      typeName: section.name,
      point: section.point,
    });
  }
  return out;
}

export function isGradable(q: QuizQuestion): boolean {
  if (!q.answer) return false;
  if (q.type === 'danxuan' || q.type === 'duoxuan') return q.options.length >= 2;
  if (q.type === 'panduan') return true;
  return false;
}

export function initQuiz(): void {
  const doc = document.getElementById('zsb-doc');
  const article = doc?.querySelector('article');
  if (!doc || !article) return;

  const title = norm(doc.querySelector('h1')?.textContent || document.title);
  const subject = norm(doc.querySelector('.zsb-badge.primary')?.textContent || '');
  const ctx: QuizContext = {
    docId: location.pathname.replace(/^\/zsb\//, '').replace(/\/+$/, '') || 'index',
    docTitle: title,
    docUrl: location.pathname,
    subject,
  };

  const all = parseQuestions(article, ctx);
  const pool = all.filter(isGradable);
  const byId = new Map<string, QuizQuestion>(pool.map((q) => [q.id, q]));
  wireAnswerToggle(doc);
  renderDocStats();

  const wrongQs = (): QuizQuestion[] =>
    Object.values(getWrongMap())
      .filter((w) => w.docId === ctx.docId && !w.mastered)
      .map((w) => byId.get(w.id))
      .filter((q): q is QuizQuestion => !!q);

  function hostGrade(q: QuizQuestion, pick: string, ok: boolean): void {
    markSeen(q.id, ctx.docId, ok);
    if (!ok) {
      saveWrong({
        id: q.id,
        docId: ctx.docId,
        docTitle: ctx.docTitle,
        docUrl: ctx.docUrl,
        subject: ctx.subject,
        type: q.type,
        typeName: q.typeName,
        num: q.num,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        chosen: pick,
        analysis: q.analysis,
        point: q.point,
      });
    }
    renderDocStats();
  }

  function hostState(snap: QuizSnapshot): void {
    const order = snap.ids.map((id) => byId.get(id)).filter((q): q is QuizQuestion => !!q);
    const answered = order.filter((q) => snap.graded[q.id]);
    const correct = answered.filter((q) => isCorrect(q, snap.chosen[q.id] || ''));
    const score = correct.reduce((n, q) => n + q.point, 0);
    const full = order.reduce((n, q) => n + q.point, 0);
    saveDocProgress({
      docId: ctx.docId,
      docTitle: ctx.docTitle,
      docUrl: ctx.docUrl,
      total: order.length,
      answered: answered.length,
      correct: correct.length,
      wrong: answered.length - correct.length,
      score: Math.round(score * 10) / 10,
      fullScore: Math.round(full * 10) / 10,
      lastAt: Date.now(),
      finished: snap.finished,
    });
    saveSession({
      docId: ctx.docId,
      ids: snap.ids,
      index: snap.index,
      chosen: snap.chosen,
      graded: snap.graded,
      startedAt: 0,
      elapsed: snap.elapsed,
      finished: snap.finished,
    });
  }

  function hostClose(): void {
    doc!.classList.remove('quiz-active');
    renderDocStats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const theme = currentTheme();
  if (theme) {
    const notes = all.filter((q) => !isGradable(q)).map((q) => q.stem.split('\n')[0]).filter(Boolean).slice(0, 40);
    const host: ThemeHost = {
      questions: pool,
      chapters: [{ label: '选择关卡', href: `/zsb/?theme=${theme.id}`, meta: '切换试卷' }],
      variants: wrongQs().length
        ? [{ id: 'wrong', label: `只练本卷错题（${wrongQs().length}）`, questions: wrongQs() }]
        : [],
      notes: notes.length
        ? notes
        : Array.from(article.querySelectorAll('h2, h3')).map((h) => (h.textContent || '').trim()).filter(Boolean).slice(0, 30),
      onGrade: hostGrade,
      onFinish: (): void => { renderDocStats(); },
      onClose: (): void => {
        clearTheme();
        const u = new URL(location.href);
        u.searchParams.delete('theme');
        location.replace(u.toString());
      },
    };
    attachTheme(theme, title, host);
    return;
  }

  const btn = document.getElementById('start-quiz') as HTMLButtonElement | null;
  if (!pool.length) {
    if (btn) {
      btn.disabled = true;
      btn.title = '本页没有可自动判分的客观题';
      btn.textContent = '暂无可答题';
    }
    return;
  }

  const shell = document.createElement('div');
  shell.id = 'quiz-root';
  shell.hidden = true;
  doc.insertBefore(shell, article);

  const s = getSession(ctx.docId);
  const canResume = !!s && !s.finished && !!s.ids?.length;
  const wrongHere = wrongQs().length;

  let player: QuizPlayer;
  player = createQuizPlayer({
    mount: shell,
    questions: pool,
    title,
    instant: getSettings().instant,
    note: `数据保存在本机浏览器（${storageMode()}），不会上传。可在「错题本」里复习。`,
    setupActions: [
      ...(canResume
        ? [{
            id: 'resume',
            label: `继续上次（${s!.index + 1}/${s!.ids.length}）`,
            run: (): void => {
              const snap: QuizSnapshot = {
                ids: s!.ids,
                index: s!.index,
                chosen: s!.chosen,
                graded: s!.graded,
                elapsed: s!.elapsed,
                finished: false,
                instant: getSettings().instant,
              };
              doc.classList.add('quiz-active');
              player.resume(snap);
            },
          }]
        : []),
      ...(wrongHere
        ? [{ id: 'redo-wrong', label: `只练本卷错题（${wrongHere}）`, run: (): void => { doc.classList.add('quiz-active'); player.start(wrongQs(), true); } }]
        : []),
    ],
    onGrade: hostGrade,
    onStateChange: hostState,
    onFinish: (): void => renderDocStats(),
    onClose: hostClose,
  });

  btn?.addEventListener('click', () => {
    doc.classList.add('quiz-active');
    player.open();
  });

  function renderDocStats(): void {
    const box = document.getElementById('doc-stats');
    if (!box) return;
    const seen = getSeenMap();
    const wrong = getWrongMap();
    const answered = pool.filter((q) => seen[q.id]).length;
    const correct = pool.filter((q) => seen[q.id]?.correct).length;
    const pending = Object.values(wrong).filter((w) => w.docId === ctx.docId && !w.mastered).length;
    if (!answered && !pending) {
      box.hidden = true;
      return;
    }
    const acc = answered ? Math.round((correct / answered) * 100) : 0;
    box.hidden = false;
    box.innerHTML =
      `<span>本卷已刷 <b>${answered}</b> / ${pool.length} 题</span>` +
      `<span>正确率 <b>${acc}%</b></span>` +
      (pending ? `<a class="zsb-badge warn" href="/zsb/wrong/">待复习错题 ${pending} →</a>` : '');
  }
}

function wireAnswerToggle(doc: HTMLElement): void {
  const btn = document.getElementById('toggle-answers');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = doc.classList.toggle('show-answers');
    btn.textContent = on ? '隐藏答案' : '显示答案';
  });
}
