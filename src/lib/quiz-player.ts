import type { QuizOption, QuizType } from './exam-store';

export interface QuizQuestion {
  id: string;
  num: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  analysis: string;
  type: QuizType;
  typeName: string;
  point: number;
  source?: string;
}

export interface QuizSnapshot {
  ids: string[];
  index: number;
  chosen: Record<string, string>;
  graded: Record<string, boolean>;
  elapsed: number;
  finished: boolean;
  instant: boolean;
}

export interface QuizResult {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  unanswered: number;
  score: number;
  fullScore: number;
  elapsed: number;
  wrongQuestions: QuizQuestion[];
}

export interface QuizConfig {
  mount: HTMLElement;
  questions: QuizQuestion[];
  title?: string;
  instant?: boolean;
  autoNext?: boolean;
  pace?: { right?: number; wrong?: number };
  settings?: boolean;
  wrongBookUrl?: string;
  note?: string;
  setupActions?: Array<{ id: string; label: string; run: () => void }>;
  onGrade?: (q: QuizQuestion, pick: string, correct: boolean) => void;
  onStateChange?: (s: QuizSnapshot) => void;
  onFinish?: (r: QuizResult) => void;
  onClose?: () => void;
}

export interface QuizPlayer {
  open(): void;
  start(questions?: QuizQuestion[], instant?: boolean): void;
  resume(s: QuizSnapshot): void;
  close(): void;
  destroy(): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const key = (s: string): string => (s || '').replace(/[^A-H]/gi, '').toUpperCase().split('').sort().join('');
const fmtTime = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const stemHtml = (s: string): string => s.split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');

export function isCorrect(q: QuizQuestion, pick: string): boolean {
  if (!q.answer || !pick) return false;
  if (q.type === 'panduan') return pick === q.answer;
  return key(pick) === key(q.answer);
}

function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function createQuizPlayer(cfg: QuizConfig): QuizPlayer {
  const root = cfg.mount;
  root.classList.add('quiz-root');
  root.hidden = true;

  let qs = cfg.questions.slice();
  let instant = cfg.instant ?? true;
  let view: 'setup' | 'play' | 'result' = 'setup';
  let order: QuizQuestion[] = [];
  let idx = 0;
  let chosen: Record<string, string> = {};
  let graded: Record<string, boolean> = {};
  let flagged: Record<string, boolean> = {};
  let revealed: Record<string, boolean> = {};
  let elapsed = 0;
  let finished = false;
  let result: QuizResult | null = null;
  let tick: number | null = null;
  let autoTimer: number | null = null;
  let byId = new Map(qs.map((q) => [q.id, q]));
  const sel = { type: 'all', count: 'all', order: 'seq', instant: instant ? 'instant' : 'after' };

  const snapshot = (): QuizSnapshot => ({
    ids: order.map((q) => q.id),
    index: idx,
    chosen: { ...chosen },
    graded: { ...graded },
    elapsed,
    finished,
    instant,
  });
  const emit = (): void => { cfg.onStateChange?.(snapshot()); };
  const cur = (): QuizQuestion => order[idx];

  function clearAuto(): void {
    if (autoTimer !== null) window.clearTimeout(autoTimer);
    autoTimer = null;
    root.classList.remove('is-autonext');
  }

  function stopTimer(): void {
    if (tick !== null) window.clearInterval(tick);
    tick = null;
  }

  function runTimer(): void {
    stopTimer();
    tick = window.setInterval(() => {
      elapsed += 1;
      const t = root.querySelector('#quiz-timer');
      if (t) t.textContent = fmtTime(elapsed);
    }, 1000);
  }

  function scrollTop(): void {
    window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 8, behavior: 'smooth' });
  }

  function go(i: number): void {
    clearAuto();
    if (i < 0 || i >= order.length) return;
    idx = i;
    emit();
    render();
  }

  function start(list: QuizQuestion[] = qs, mode = instant): void {
    clearAuto();
    if (list !== qs) {
      sel.type = 'all';
      sel.count = 'all';
      sel.order = 'seq';
    }
    qs = list.slice();
    byId = new Map(qs.map((q) => [q.id, q]));
    let arr = sel.type === 'all' ? qs.slice() : qs.filter((q) => q.type === sel.type);
    if (sel.order === 'shuffle') arr = shuffle(arr);
    if (sel.count !== 'all') arr = arr.slice(0, parseInt(sel.count, 10));
    if (!arr.length) return;
    order = arr;
    idx = 0;
    chosen = {};
    graded = {};
    flagged = {};
    revealed = {};
    elapsed = 0;
    finished = false;
    instant = mode;
    result = null;
    view = 'play';
    root.hidden = false;
    runTimer();
    emit();
    render();
    scrollTop();
  }

  function resume(s: QuizSnapshot): void {
    clearAuto();
    order = s.ids.map((id) => byId.get(id)).filter((q): q is QuizQuestion => !!q);
    if (!order.length) return;
    idx = Math.min(s.index, order.length - 1);
    chosen = { ...s.chosen };
    graded = { ...s.graded };
    elapsed = s.elapsed || 0;
    instant = s.instant;
    finished = false;
    view = 'play';
    root.hidden = false;
    runTimer();
    render();
    scrollTop();
  }

  function grade(): void {
    const q = cur();
    if (!q) return;
    const pick = chosen[q.id] || '';
    if (!pick || graded[q.id]) return;
    graded[q.id] = true;
    const ok = isCorrect(q, pick);
    cfg.onGrade?.(q, pick, ok);
    emit();
    render();
    maybeAuto(ok);
  }

  function maybeAuto(ok: boolean): void {
    clearAuto();
    if (cfg.autoNext === false || !instant || idx >= order.length - 1) return;
    const delay = ok ? (cfg.pace?.right ?? 900) : (cfg.pace?.wrong ?? 1600);
    const bar = root.querySelector<HTMLElement>('.quiz-next-bar i');
    if (bar) bar.style.animationDuration = `${delay}ms`;
    root.classList.add('is-autonext');
    autoTimer = window.setTimeout(() => go(idx + 1), delay);
  }

  function finish(): void {
    clearAuto();
    order.forEach((q) => {
      const pick = chosen[q.id];
      if (pick && !graded[q.id]) {
        graded[q.id] = true;
        cfg.onGrade?.(q, pick, isCorrect(q, pick));
      }
    });
    finished = true;
    stopTimer();
    const answered = order.filter((q) => graded[q.id]);
    const correct = answered.filter((q) => isCorrect(q, chosen[q.id] || ''));
    const wrongQs = answered.filter((q) => !isCorrect(q, chosen[q.id] || ''));
    const score = correct.reduce((s, q) => s + q.point, 0);
    result = {
      total: order.length,
      answered: answered.length,
      correct: correct.length,
      wrong: wrongQs.length,
      unanswered: order.length - answered.length,
      score: Math.round(score * 10) / 10,
      fullScore: Math.round(order.reduce((s, q) => s + q.point, 0) * 10) / 10,
      elapsed,
      wrongQuestions: wrongQs,
    };
    view = 'result';
    emit();
    cfg.onFinish?.(result);
    render();
    scrollTop();
  }

  function close(): void {
    clearAuto();
    stopTimer();
    root.hidden = true;
    view = 'setup';
    cfg.onClose?.();
  }

  function optionHtml(o: QuizOption, q: QuizQuestion, picked: string, done: boolean): string {
    const on = q.type === 'panduan' ? picked === o.label : key(picked).includes(o.label);
    const right = q.type === 'panduan' ? q.answer === o.label : key(q.answer).includes(o.label);
    const cls = ['quiz-opt', on ? 'on' : '', done && right ? 'correct' : '', done && on && !right ? 'wrong' : ''].filter(Boolean).join(' ');
    const mark = done && right ? '✓' : done && on && !right ? '✗' : '';
    return `<button class="${cls}" data-act="opt" data-label="${esc(o.label)}" type="button" ${done ? 'disabled' : ''}>
      <span class="k">${esc(o.label)}</span><span class="v">${esc(o.text)}</span>
      ${mark ? `<span class="quiz-opt-mark">${mark}</span>` : ''}
    </button>`;
  }

  function feedbackHtml(q: QuizQuestion, picked: string): string {
    const ok = isCorrect(q, picked);
    return `<div class="quiz-feedback ${ok ? 'ok' : 'bad'}">
      <div class="qf-title"><span class="qf-icon">${ok ? '✓' : '✗'}</span>${ok ? '回答正确' : '回答错误'}</div>
      <div class="qf-answer">正确答案：<b>${esc(q.answer || '—')}</b>${picked ? ` · 你选了 <b>${esc(picked)}</b>` : ''}</div>
      ${q.analysis ? `<div class="qf-analysis">${esc(q.analysis)}</div>` : ''}
    </div>`;
  }

  function answerHtml(q: QuizQuestion): string {
    return `<div class="quiz-feedback reveal">
      <div class="qf-title">本题答案与解析</div>
      <div class="qf-answer">正确答案：<b>${esc(q.answer || '—')}</b></div>
      <div class="qf-analysis">${q.analysis ? esc(q.analysis) : '原卷未提供解析'}</div>
    </div>`;
  }

  function headerHtml(): string {
    return `<div class="quiz-top">
      <button class="quiz-icon-btn" data-act="close" type="button" title="退出答题">×</button>
      <div class="quiz-top-info">
        <span class="quiz-pos" id="quiz-pos"></span><span class="quiz-dot">·</span>
        <span id="quiz-count"></span><span class="quiz-dot">·</span>
        <span class="quiz-timer" id="quiz-timer">00:00</span>
      </div>
      <a class="quiz-icon-btn quiz-link" href="${esc(cfg.wrongBookUrl || '/zsb/wrong/')}">错题本</a>
    </div>
    <div class="quiz-progress"><i id="quiz-progress-bar"></i></div>`;
  }

  function setupHtml(): string {
    const counts = {
      danxuan: qs.filter((q) => q.type === 'danxuan').length,
      duoxuan: qs.filter((q) => q.type === 'duoxuan').length,
      panduan: qs.filter((q) => q.type === 'panduan').length,
    };
    const field = (name: string, label: string, items: string[][]): string =>
      `<div class="quiz-field"><label>${label}</label><div class="quiz-chips" data-field="${name}">
        ${items.map(([v, t]) => `<button class="quiz-chip${sel[name as keyof typeof sel] === v ? ' on' : ''}" data-act="chip" data-field="${name}" data-v="${v}" type="button">${t}</button>`).join('')}
      </div></div>`;
    return `<div class="quiz-panel">
      <h2 class="quiz-title">${esc(cfg.title || '答题模式')}</h2>
      <p class="quiz-sub">共 <b>${qs.length}</b> 题可作答</p>
      ${field('type', '题型', [
        ['all', '全部'],
        ...(counts.danxuan ? ([['danxuan', `单选 ${counts.danxuan}`]] as [string, string][]) : []),
        ...(counts.duoxuan ? ([['duoxuan', `多选 ${counts.duoxuan}`]] as [string, string][]) : []),
        ...(counts.panduan ? ([['panduan', `判断 ${counts.panduan}`]] as [string, string][]) : []),
      ])}
      ${field('count', '题量', [['10', '10 题'], ['20', '20 题'], ['all', '全部']])}
      ${field('order', '顺序', [['seq', '按原序'], ['shuffle', '随机']])}
      ${field('instant', '判分', [['instant', '答完立即看答案'], ['after', '交卷后统一判']])}
      <div class="quiz-setup-actions">
        <button class="quiz-btn primary" data-act="go" type="button">开始答题</button>
        ${(cfg.setupActions || []).map((a) => `<button class="quiz-btn" data-act="action" data-id="${esc(a.id)}" type="button">${esc(a.label)}</button>`).join('')}
      </div>
      ${cfg.note ? `<p class="quiz-tip">${esc(cfg.note)}</p>` : ''}
    </div>`;
  }

  function sheetHtml(): string {
    const answered = order.filter((q) => graded[q.id]);
    const right = answered.filter((q) => isCorrect(q, chosen[q.id] || '')).length;
    return `<aside class="quiz-sheet">
      <div class="quiz-sheet-head"><span>答题卡</span><span class="quiz-sheet-stat">${right} 对 · ${answered.length - right} 错 · ${order.length - answered.length} 未答</span></div>
      <div class="quiz-sheet-grid">
        ${order.map((x, i) => {
          const g = graded[x.id];
          const ok = g && isCorrect(x, chosen[x.id] || '');
          const cls = ['quiz-num', i === idx ? 'cur' : '', g ? (ok ? 'ok' : 'bad') : chosen[x.id] ? 'done' : '', flagged[x.id] ? 'flag' : ''].filter(Boolean).join(' ');
          return `<button class="${cls}" data-act="jump" data-i="${i}" type="button" title="第 ${i + 1} 题">${i + 1}</button>`;
        }).join('')}
      </div>
      <div class="quiz-legend"><i class="lg cur"></i>当前 <i class="lg done"></i>已答 <i class="lg ok"></i>正确 <i class="lg bad"></i>错误 <i class="lg flag"></i>标记</div>
    </aside>`;
  }

  function playHtml(): string {
    const q = cur();
    if (!q) return '';
    const picked = chosen[q.id] || '';
    const done = !!graded[q.id];
    const multi = q.type === 'duoxuan';
    const isLast = idx === order.length - 1;
    const answered = order.filter((x) => graded[x.id]);
    const right = answered.filter((x) => isCorrect(x, chosen[x.id] || '')).length;
    return `${headerHtml()}
      <div class="quiz-play">
        <div class="quiz-card">
          <div class="quiz-qhead">
            <span class="quiz-qtype">${esc(q.typeName)}</span>
            <span class="quiz-qpoint">${q.point} 分</span>
            <span class="quiz-qnum">第 ${idx + 1} 题${q.source ? ` · ${esc(q.source)}` : ''}</span>
            <button class="quiz-flag${flagged[q.id] ? ' on' : ''}" data-act="flag" type="button">${flagged[q.id] ? '★ 已标记' : '☆ 标记'}</button>
          </div>
          <div class="quiz-stem">${stemHtml(q.stem)}</div>
          <div class="quiz-options" data-multi="${multi ? '1' : '0'}">${q.options.map((o) => optionHtml(o, q, picked, done)).join('')}</div>
          ${done ? feedbackHtml(q, picked) : ''}
          ${revealed[q.id] ? answerHtml(q) : ''}
          <div class="quiz-actions">
            <button class="quiz-btn" data-act="prev" type="button" ${idx === 0 ? 'disabled' : ''}>上一题</button>
            ${multi && instant && !done && picked ? `<button class="quiz-btn primary" data-act="submit" type="button">提交答案</button>` : ''}
            <button class="quiz-btn" data-act="reveal" type="button">${revealed[q.id] ? '收起答案' : '查看答案'}</button>
            ${done && isLast
              ? `<button class="quiz-btn primary" data-act="finish" type="button">查看成绩</button>`
              : `<button class="quiz-btn${done ? ' primary' : ''}" data-act="next" type="button">下一题</button>`}
            <button class="quiz-btn ghost" data-act="finish" type="button">交卷</button>
          </div>
          <div class="quiz-next-bar"><i></i><span>即将进入下一题</span><button class="quiz-btn" data-act="cancel-next" type="button">停留</button></div>
        </div>
        ${sheetHtml()}
      </div>`;
  }

  function resultHtml(): string {
    const r = result!;
    const acc = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
    return `${headerHtml()}
      <div class="quiz-panel quiz-result">
        <h2 class="quiz-title">本次成绩</h2>
        <div class="quiz-score-big">${r.score}<small> / ${r.fullScore}</small></div>
        <div class="quiz-result-stats">
          <div><b>${acc}%</b><span>正确率</span></div>
          <div><b>${r.correct}</b><span>答对</span></div>
          <div><b>${r.wrong}</b><span>答错</span></div>
          <div><b>${r.unanswered}</b><span>未答</span></div>
          <div><b>${fmtTime(r.elapsed)}</b><span>用时</span></div>
        </div>
        ${r.wrongQuestions.length
          ? `<div class="quiz-wrong-head">错题（已存入错题本）</div>
             <div class="quiz-wrong-list">${r.wrongQuestions.map((q) => `<div class="quiz-wrong-item">
               <div class="qw-stem"><b>${esc(q.num)}.</b> ${esc(q.stem.split('\n')[0])}</div>
               <div class="qw-line">你的答案 <b class="bad">${esc(chosen[q.id] || '未答')}</b> · 正确答案 <b class="ok">${esc(q.answer)}</b></div>
             </div>`).join('')}</div>`
          : `<p class="quiz-perfect">全部答对</p>`}
        <div class="quiz-setup-actions">
          ${r.wrongQuestions.length ? `<button class="quiz-btn primary" data-act="again-wrong" type="button">重做错题（${r.wrongQuestions.length}）</button>` : ''}
          <button class="quiz-btn" data-act="restart" type="button">再答一遍</button>
          <button class="quiz-btn" data-act="close" type="button">返回阅读</button>
          <a class="quiz-btn ghost" href="${esc(cfg.wrongBookUrl || '/zsb/wrong/')}">去错题本</a>
        </div>
      </div>`;
  }

  function syncHead(): void {
    const pos = root.querySelector('#quiz-pos');
    if (pos) pos.textContent = view === 'play' ? `${idx + 1} / ${order.length}` : view === 'result' ? '已完成' : `${qs.length} 题`;
    const cnt = root.querySelector('#quiz-count');
    if (cnt && view === 'play') {
      const a = order.filter((q) => graded[q.id]);
      const r = a.filter((q) => isCorrect(q, chosen[q.id] || '')).length;
      cnt.textContent = `正确 ${r} · 错 ${a.length - r}`;
    }
    const timer = root.querySelector('#quiz-timer');
    if (timer) timer.textContent = fmtTime(elapsed);
    const bar = root.querySelector<HTMLElement>('#quiz-progress-bar');
    if (bar && view === 'play') bar.style.width = `${((idx + 1) / order.length) * 100}%`;
  }

  function render(): void {
    root.innerHTML = view === 'setup' ? headerHtml() + setupHtml() : view === 'play' ? playHtml() : resultHtml();
    syncHead();
  }

  function onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.act || '';
    const q = view === 'play' ? cur() : null;

    if (act === 'chip') {
      const f = el.dataset.field || '';
      const box = root.querySelector(`.quiz-chips[data-field="${f}"]`);
      box?.querySelectorAll('.quiz-chip').forEach((c) => c.classList.remove('on'));
      el.classList.add('on');
      if (f in sel) (sel as Record<string, string>)[f] = el.dataset.v || '';
      return;
    }
    if (act === 'go') {
      instant = sel.instant === 'instant';
      start(qs, instant);
      return;
    }
    if (act === 'action') {
      (cfg.setupActions || []).find((a) => a.id === el.dataset.id)?.run();
      return;
    }
    if (act === 'close') { close(); return; }
    if (act === 'finish') { finish(); return; }
    if (act === 'again-wrong') { start(result?.wrongQuestions || qs, true); return; }
    if (act === 'restart') { if (cfg.settings === false) start(qs); else { view = 'setup'; render(); } return; }

    clearAuto();
    if (act === 'opt' && q && !graded[q.id]) {
      const label = el.dataset.label || '';
      if (q.type === 'duoxuan') {
        const set = new Set(key(chosen[q.id] || '').split(''));
        if (set.has(label)) set.delete(label); else set.add(label);
        chosen[q.id] = [...set].sort().join('');
        emit();
        render();
      } else {
        chosen[q.id] = label;
        if (instant) grade(); else { emit(); render(); }
      }
      return;
    }
    if (act === 'submit') { grade(); return; }
    if (act === 'prev') { go(idx - 1); return; }
    if (act === 'next') { if (idx < order.length - 1) go(idx + 1); else finish(); return; }
    if (act === 'jump') { go(parseInt(el.dataset.i || '0', 10)); return; }
    if (act === 'flag' && q) { flagged[q.id] = !flagged[q.id]; render(); return; }
    if (act === 'reveal' && q) { revealed[q.id] = !revealed[q.id]; render(); return; }
    if (act === 'cancel-next') { render(); return; }
  }

  function onKey(e: KeyboardEvent): void {
    if (root.hidden || view !== 'play') return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowLeft') { go(idx - 1); return; }
    if (e.key === 'ArrowRight') { if (idx < order.length - 1) go(idx + 1); else finish(); return; }
    if (/^[1-8]$/.test(e.key)) {
      root.querySelectorAll<HTMLElement>('.quiz-opt:not(:disabled)')[Number(e.key) - 1]?.click();
    }
  }

  root.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);

  return {
    open(): void {
      root.hidden = false;
      view = cfg.settings === false && order.length ? 'play' : 'setup';
      render();
      scrollTop();
    },
    start,
    resume,
    close,
    destroy(): void {
      clearAuto();
      stopTimer();
      root.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    },
  };
}
