/**
 * 答题模式（刷题引擎）
 * ----------------------------------------------------------------
 * 不新增数据源：直接从试卷页已渲染好的 DOM 里解析题目
 *   section.exam-q  →  一道题
 *     h3            →  题干（含题号）
 *     ul > li       →  选项（A. / B. …）
 *     .exam-answer  →  答案
 *     .exam-analysis→  解析
 * 题型 / 分值取自上方的 h2 分组标题。
 *
 * 支持：单选 / 多选 / 判断（含「辨析题」先判断正误）× 即时判分 / 交卷后判分、
 *       顺序 / 随机、限题量、答题卡跳题、只练错题、断点续答、成绩统计。
 */
import {
  type DocProgress,
  type QuizOption,
  type QuizType,
  type SessionState,
  getSession,
  getSettings,
  getSeenMap,
  getWrongMap,
  markSeen,
  saveDocProgress,
  saveSession,
  saveSettings,
  saveWrong,
  storageMode,
} from './exam-store';
import { normalizeObjectiveAnswer } from './taxonomy';

export interface ParsedQ {
  id: string;
  num: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  rawAnswer: string;
  analysis: string;
  type: QuizType;
  typeName: string;
  point: number;
}

export interface QuizContext {
  docId: string;
  docTitle: string;
  docUrl: string;
  subject: string;
}

/* ------------------------------ 工具 ------------------------------ */

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

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

export function parseSectionHeading(text: string): { type: QuizType; name: string; point: number } {  const t = norm(text);
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
        // 答案之后的第一段：辨析题的正误结论常写在这里（如「（1）错误。（2 分）」）
        if (seenAnswer) {
          if (!verdictText) verdictText = t;
        } else {
          extraStem.push(t);
        }
      }
    }

    // 辨析题：原卷答案只写「答案：」而把「正确 / 错误」放到下一段
    if (!answer && section.type === 'panduan') {
      const m = (verdictText || rawAnswer).slice(0, 40).match(/正确|错误|对|错/);
      if (m) answer = m[0] === '正确' || m[0] === '对' ? '对' : '错';
    }

    // 原卷笔误兜底：答案里的字母若不在选项中（如 2016 多选 26 的「ACDE」），按选项过滤
    if (answer && /^[A-H]+$/.test(answer) && options.length) {
      const labels = new Set(options.map((o) => o.label));
      const kept = [...answer].filter((c) => labels.has(c)).join('');
      if (kept) answer = kept;
    }

    // 辨析题 / 判断题：原卷没有选项列表，补一组「正确 / 错误」
    if (options.length === 0 && (section.type === 'panduan' || /^(对|错|正确|错误)$/.test(answer))) {
      if (answer) {
        options.push({ label: '对', text: '正确' }, { label: '错', text: '错误' });
      }
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

export function isGradable(q: ParsedQ): boolean {
  if (!q.answer) return false;
  if (q.type === 'danxuan' || q.type === 'duoxuan') return q.options.length >= 2;
  if (q.type === 'panduan') return true;
  return false;
}

/* ------------------------------ 主逻辑 ------------------------------ */

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

  wireAnswerToggle(doc);
  renderDocStats();

  if (pool.length === 0) {
    const btn = document.getElementById('start-quiz') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.title = '本页没有可自动判分的客观题';
      btn.textContent = '暂无可答题';
    }
    return;
  }

  /* ---------- 注入 UI 容器 ---------- */
  const shell = document.createElement('div');
  shell.className = 'quiz-root';
  shell.id = 'quiz-root';
  shell.hidden = true;
  doc.insertBefore(shell, article);

  type View = 'setup' | 'play' | 'result';
  let view: View = 'setup';
  let order: ParsedQ[] = [];
  let idx = 0;
  let chosen: Record<string, string> = {};
  let graded: Record<string, boolean> = {};
  let elapsed = 0;
  let tick: number | null = null;
  let finished = false;
  const settings = getSettings();

  const byId = new Map(all.map((q) => [q.id, q]));

  /** 试卷页顶部的「已刷 / 正确率 / 待复习」小条 */
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

  const isRight = (q: ParsedQ, pick: string): boolean => {
    if (!q.answer || !pick) return false;
    if (q.type === 'panduan') return pick === q.answer;
    return (
      pick
        .replace(/[^A-H]/g, '')
        .split('')
        .sort()
        .join('') === q.answer
    );
  };

  const scoreOf = (q: ParsedQ, pick: string, wasGraded: boolean): number =>
    wasGraded && isRight(q, pick) ? q.point : 0;

  /* ---------- 头部 ---------- */
  function headerHtml(): string {
    return `
      <div class="quiz-top">
        <button class="quiz-icon-btn" id="quiz-close" type="button" title="退出答题">×</button>
        <div class="quiz-top-info">
          <span class="quiz-pos" id="quiz-pos"></span>
          <span class="quiz-dot">·</span>
          <span id="quiz-count"></span>
          <span class="quiz-dot">·</span>
          <span class="quiz-timer" id="quiz-timer">00:00</span>
        </div>
        <a class="quiz-icon-btn quiz-link" href="/zsb/wrong/" title="错题本">错题本</a>
      </div>
      <div class="quiz-progress"><i id="quiz-progress-bar"></i></div>`;
  }

  /* ---------- 开始面板 ---------- */
  function renderSetup(): void {
    view = 'setup';
    const doneIds = getSeenMap();
    const answeredHere = pool.filter((q) => doneIds[q.id]).length;
    const wrongHere = Object.values(getWrongMap()).filter((w) => w.docId === ctx.docId && !w.mastered).length;
    const counts = {
      danxuan: pool.filter((q) => q.type === 'danxuan').length,
      duoxuan: pool.filter((q) => q.type === 'duoxuan').length,
      panduan: pool.filter((q) => q.type === 'panduan').length,
    };

    shell.innerHTML = `
      ${headerHtml()}
      <div class="quiz-panel">
        <h2 class="quiz-title">答题模式</h2>
        <p class="quiz-sub">共 <b>${pool.length}</b> 题可作答 · 已刷 <b>${answeredHere}</b> 题${
          wrongHere ? ` · 本卷待复习 <b class="quiz-warn">${wrongHere}</b> 题` : ''
        }</p>

        <div class="quiz-field">
          <label>题型</label>
          <div class="quiz-chips" data-field="type">
            <button class="quiz-chip on" data-v="all" type="button">全部</button>
            ${counts.danxuan ? `<button class="quiz-chip" data-v="danxuan" type="button">单选 ${counts.danxuan}</button>` : ''}
            ${counts.duoxuan ? `<button class="quiz-chip" data-v="duoxuan" type="button">多选 ${counts.duoxuan}</button>` : ''}
            ${counts.panduan ? `<button class="quiz-chip" data-v="panduan" type="button">判断 ${counts.panduan}</button>` : ''}
          </div>
        </div>

        <div class="quiz-field">
          <label>题量</label>
          <div class="quiz-chips" data-field="count">
            <button class="quiz-chip" data-v="10" type="button">10 题</button>
            <button class="quiz-chip" data-v="20" type="button">20 题</button>
            <button class="quiz-chip on" data-v="all" type="button">全部</button>
          </div>
        </div>

        <div class="quiz-field">
          <label>顺序</label>
          <div class="quiz-chips" data-field="order">
            <button class="quiz-chip on" data-v="seq" type="button">按原序</button>
            <button class="quiz-chip" data-v="shuffle" type="button">随机</button>
          </div>
        </div>

        <div class="quiz-field">
          <label>判分</label>
          <div class="quiz-chips" data-field="instant">
            <button class="quiz-chip ${settings.instant ? 'on' : ''}" data-v="instant" type="button">答完立即看答案</button>
            <button class="quiz-chip ${settings.instant ? '' : 'on'}" data-v="after" type="button">交卷后统一判</button>
          </div>
        </div>

        <div class="quiz-setup-actions">
          <button class="quiz-btn primary" id="quiz-go" type="button">开始答题</button>
          ${
            wrongHere
              ? `<button class="quiz-btn" id="quiz-redo-wrong" type="button">只练本卷错题（${wrongHere}）</button>`
              : ''
          }
          ${renderResumeBtn()}
        </div>
        <p class="quiz-tip">数据保存在本机浏览器（${storageMode()}），不会上传。可在「错题本」里复习。</p>
      </div>`;

    shell.querySelectorAll<HTMLElement>('.quiz-chips').forEach((box) => {
      box.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest('.quiz-chip');
        if (!chip) return;
        box.querySelectorAll('.quiz-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      });
    });

    const pick = (field: string): string =>
      (shell.querySelector(`.quiz-chips[data-field="${field}"] .quiz-chip.on`) as HTMLElement | null)?.dataset.v || 'all';

    shell.querySelector('#quiz-go')?.addEventListener('click', () => {
      saveSettings({ instant: pick('instant') === 'instant', shuffle: pick('order') === 'shuffle' });
      start(pool, pick('type'), pick('count'), pick('order') === 'shuffle', pick('instant') === 'instant');
    });
    shell.querySelector('#quiz-redo-wrong')?.addEventListener('click', () => {
      const wrong = Object.values(getWrongMap()).filter((w) => w.docId === ctx.docId);
      const qs = wrong.map((w) => byId.get(w.id)).filter((q): q is ParsedQ => !!q);
      start(qs.length ? qs : pool, 'all', 'all', false, true);
    });
    shell.querySelector('#quiz-resume')?.addEventListener('click', resume);
  }

  function renderResumeBtn(): string {
    const s = getSession(ctx.docId);
    if (!s || s.finished || !s.ids?.length) return '';
    return `<button class="quiz-btn" id="quiz-resume" type="button">继续上次（${s.index + 1}/${s.ids.length}）</button>`;
  }

  /* ---------- 开始 ---------- */
  function start(list: ParsedQ[], typeFilter: string, count: string, shuffle: boolean, instant: boolean): void {
    let qs = typeFilter === 'all' ? list.slice() : list.filter((q) => q.type === typeFilter);
    if (shuffle) qs = shuffleArr(qs);
    if (count !== 'all') qs = qs.slice(0, parseInt(count, 10));
    if (!qs.length) {
      alert('当前条件下没有题目');
      return;
    }
    order = qs;
    idx = 0;
    chosen = {};
    graded = {};
    finished = false;
    elapsed = 0;
    settings.instant = instant;
    settings.shuffle = shuffle;
    runTimer();
    view = 'play';
    renderPlay();
  }

  function resume(): void {
    const s = getSession(ctx.docId);
    if (!s) return;
    order = s.ids.map((id) => byId.get(id)).filter((q): q is ParsedQ => !!q);
    idx = Math.min(s.index, Math.max(order.length - 1, 0));
    chosen = { ...s.chosen };
    graded = { ...s.graded };
    elapsed = s.elapsed || 0;
    finished = !!s.finished;
    runTimer();
    view = 'play';
    renderPlay();
  }

  function persist(): void {
    if (!order.length) return;
    const answered = order.filter((q) => graded[q.id]);
    const correct = answered.filter((q) => isRight(q, chosen[q.id]));
    const score = answered.reduce((s, q) => s + scoreOf(q, chosen[q.id], true), 0);
    const fullScore = order.reduce((s, q) => s + q.point, 0);
    const prog: DocProgress = {
      docId: ctx.docId,
      docTitle: ctx.docTitle,
      docUrl: ctx.docUrl,
      total: order.length,
      answered: answered.length,
      correct: correct.length,
      wrong: answered.length - correct.length,
      score: Math.round(score * 10) / 10,
      fullScore: Math.round(fullScore * 10) / 10,
      lastAt: Date.now(),
      finished,
    };
    saveDocProgress(prog);
    const s: SessionState = {
      docId: ctx.docId,
      ids: order.map((q) => q.id),
      index: idx,
      chosen,
      graded,
      startedAt: 0,
      elapsed,
      finished,
    };
    saveSession(s);
  }

  function runTimer(): void {
    if (tick) window.clearInterval(tick);
    tick = window.setInterval(() => {
      elapsed += 1;
      const t = shell.querySelector('#quiz-timer');
      if (t) t.textContent = fmtTime(elapsed);
    }, 1000);
  }

  /* ---------- 答题界面 ---------- */
  function renderPlay(): void {
    const q = order[idx];
    if (!q) return;
    const answered = order.filter((x) => graded[x.id]);
    const correct = answered.filter((x) => isRight(x, chosen[x.id]));
    const wrong = answered.length - correct.length;
    const picked = chosen[q.id] || '';
    const wasGraded = !!graded[q.id];
    const multi = q.type === 'duoxuan';

    shell.innerHTML = `
      ${headerHtml()}
      <div class="quiz-play">
        <div class="quiz-card" id="quiz-card">
          <div class="quiz-qhead">
            <span class="quiz-qtype">${esc(q.typeName)}</span>
            <span class="quiz-qpoint">${q.point} 分</span>
            ${q.num ? `<span class="quiz-qnum">第 ${esc(q.num)} 题</span>` : ''}
          </div>
          <div class="quiz-stem">${stemHtml(q.stem)}</div>
          <div class="quiz-options" data-multi="${multi ? '1' : '0'}">
            ${q.options.map((o) => optionHtml(o, q, picked, wasGraded)).join('')}
          </div>
          ${wasGraded ? feedbackHtml(q, picked) : ''}
          <div class="quiz-actions">
            <button class="quiz-btn" id="quiz-prev" type="button" ${idx === 0 ? 'disabled' : ''}>上一题</button>
            ${
              multi && !wasGraded
                ? `<button class="quiz-btn primary" id="quiz-submit" type="button" ${picked ? '' : 'disabled'}>提交答案</button>`
                : ''
            }
            ${
              wasGraded
                ? `<button class="quiz-btn primary" id="quiz-next2" type="button">${
                    idx === order.length - 1 ? '查看成绩' : '下一题'
                  }</button>`
                : `<button class="quiz-btn" id="quiz-next" type="button">跳到下一题</button>`
            }
            <button class="quiz-btn ghost" id="quiz-finish" type="button">交卷</button>
          </div>
        </div>

        <aside class="quiz-sheet">
          <div class="quiz-sheet-head">
            <span>答题卡</span>
            <span class="quiz-sheet-stat">正确 ${correct.length} · 错误 ${wrong}</span>
          </div>
          <div class="quiz-sheet-grid">
            ${order
              .map((x, i) => {
                const g = graded[x.id];
                const ok = g && isRight(x, chosen[x.id]);
                const cls = [
                  'quiz-num',
                  i === idx ? 'cur' : '',
                  g ? (ok ? 'ok' : 'bad') : chosen[x.id] ? 'sel' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return `<button class="${cls}" data-i="${i}" type="button">${esc(x.num)}</button>`;
              })
              .join('')}
          </div>
          <div class="quiz-legend">
            <i class="lg cur"></i>当前 <i class="lg ok"></i>正确 <i class="lg bad"></i>错误 <i class="lg sel"></i>未判
          </div>
        </aside>
      </div>`;

    const pos = shell.querySelector('#quiz-pos');
    if (pos) pos.textContent = `${idx + 1} / ${order.length}`;
    const cnt = shell.querySelector('#quiz-count');
    if (cnt) cnt.textContent = `正确 ${correct.length} · 错 ${wrong}`;
    const timer = shell.querySelector('#quiz-timer');
    if (timer) timer.textContent = fmtTime(elapsed);
    const bar = shell.querySelector<HTMLElement>('#quiz-progress-bar');
    if (bar) bar.style.width = `${((idx + 1) / order.length) * 100}%`;

    /* 选选项 */
    shell.querySelectorAll<HTMLElement>('.quiz-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (graded[q.id]) return;
        const label = btn.dataset.label || '';
        if (multi) {
          const set = new Set(picked.split('').filter(Boolean));
          if (set.has(label)) set.delete(label);
          else set.add(label);
          chosen[q.id] = [...set].sort().join('');
        } else {
          chosen[q.id] = label;
          if (settings.instant) {
            gradeAndShow();
            return;
          }
        }
        renderPlay();
      });
    });

    bind('#quiz-prev', () => {
      if (idx > 0) {
        idx -= 1;
        persist();
        renderPlay();
      }
    });
    bind('#quiz-next', () => {
      if (idx < order.length - 1) idx += 1;
      persist();
      renderPlay();
    });
    bind('#quiz-next2', () => {
      if (idx < order.length - 1) {
        idx += 1;
        persist();
        renderPlay();
      } else finish();
    });
    bind('#quiz-submit', gradeAndShow);
    bind('#quiz-finish', finish);
    shell.querySelectorAll<HTMLElement>('.quiz-num').forEach((b) => {
      b.addEventListener('click', () => {
        idx = parseInt(b.dataset.i || '0', 10);
        persist();
        renderPlay();
      });
    });
    bind('#quiz-close', close);
    scrollTop();
  }

  function gradeAndShow(): void {
    const q = order[idx];
    if (!q) return;
    const pick = chosen[q.id] || '';
    if (!pick) return;
    graded[q.id] = true;
    const ok = isRight(q, pick);
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
    persist();
    renderDocStats();
    renderPlay();
  }

  /* ---------- 结果 ---------- */
  function finish(): void {
    const answered = order.filter((q) => graded[q.id]);
    const unanswered = order.length - answered.length;
    const correct = answered.filter((q) => isRight(q, chosen[q.id]));
    const score = answered.reduce((s, q) => s + scoreOf(q, chosen[q.id], true), 0);
    const fullScore = order.reduce((s, q) => s + q.point, 0);
    finished = true;
    if (tick) window.clearInterval(tick);
    tick = null;
    persist();
    view = 'result';

    const acc = answered.length ? Math.round((correct.length / answered.length) * 100) : 0;
    const wrongQs = answered.filter((q) => !isRight(q, chosen[q.id]));

    shell.innerHTML = `
      ${headerHtml()}
      <div class="quiz-panel quiz-result">
        <h2 class="quiz-title">本次成绩</h2>
        <div class="quiz-score-big">${Math.round(score * 10) / 10}<small> / ${Math.round(fullScore * 10) / 10}</small></div>
        <div class="quiz-result-stats">
          <div><b>${acc}%</b><span>正确率</span></div>
          <div><b>${correct.length}</b><span>答对</span></div>
          <div><b>${wrongQs.length}</b><span>答错</span></div>
          <div><b>${unanswered}</b><span>未答</span></div>
          <div><b>${fmtTime(elapsed)}</b><span>用时</span></div>
        </div>
        ${
          wrongQs.length
            ? `<div class="quiz-wrong-head">错题（已存入错题本）</div>
               <div class="quiz-wrong-list">
                 ${wrongQs
                   .map(
                     (q) => `<div class="quiz-wrong-item">
                       <div class="qw-stem"><b>${esc(q.num)}.</b> ${esc(q.stem.split('\n')[0])}</div>
                       <div class="qw-line">你的答案 <b class="bad">${esc(chosen[q.id] || '未答')}</b> · 正确答案 <b class="ok">${esc(q.answer)}</b></div>
                     </div>`
                   )
                   .join('')}
               </div>`
            : `<p class="quiz-perfect">全部答对</p>`
        }
        <div class="quiz-setup-actions">
          ${
            wrongQs.length
              ? `<button class="quiz-btn primary" id="quiz-again-wrong" type="button">重做错题（${wrongQs.length}）</button>`
              : ''
          }
          <button class="quiz-btn" id="quiz-restart" type="button">再答一遍</button>
          <button class="quiz-btn" id="quiz-back" type="button">返回阅读</button>
          <a class="quiz-btn ghost" href="/zsb/wrong/">去错题本</a>
        </div>
      </div>`;

    bind('#quiz-again-wrong', () => start(wrongQs, 'all', 'all', false, true));
    bind('#quiz-restart', () => start(pool, 'all', 'all', settings.shuffle, settings.instant));
    bind('#quiz-back', close);
    bind('#quiz-close', close);
    scrollTop();
  }

  /* ---------- 打开 / 关闭 ---------- */
  function openSetup(): void {
    doc!.classList.add('quiz-active');
    shell.hidden = false;
    if (view === 'setup' || !order.length) renderSetup();
    else renderPlay();
    scrollTop();
  }

  function close(): void {
    if (tick) window.clearInterval(tick);
    tick = null;
    shell.hidden = true;
    doc!.classList.remove('quiz-active');
    view = 'setup';
    renderDocStats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const scrollTop = (): void => {
    const y = shell.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  function bind(sel: string, fn: () => void): void {
    shell.querySelector(sel)?.addEventListener('click', fn);
  }

  document.getElementById('start-quiz')?.addEventListener('click', openSetup);
  window.addEventListener('keydown', (e) => {
    if (shell.hidden) return;
    if (e.key === 'ArrowLeft') bindClick('#quiz-prev');
    if (e.key === 'ArrowRight') bindClick('#quiz-next, #quiz-next2');
    if (e.key >= '1' && e.key <= '8') {
      const opt = shell.querySelector<HTMLElement>(`.quiz-opt[data-label="${'ABCDEFGH'[Number(e.key) - 1]}"]`);
      opt?.click();
    }
  });
  function bindClick(sel: string): void {
    const el = shell.querySelector<HTMLElement>(sel);
    el?.click();
  }
}

/* ------------------------------ 渲染小工具 ------------------------------ */

function optionHtml(o: QuizOption, q: ParsedQ, picked: string, graded: boolean): string {
  const on = picked.includes(o.label);
  const right = q.answer.includes(o.label) || (q.type === 'panduan' && q.answer === o.label);
  const cls = ['quiz-opt', on ? 'on' : '', graded && right ? 'correct' : '', graded && on && !right ? 'wrong' : '']
    .filter(Boolean)
    .join(' ');
  return `<button class="${cls}" data-label="${esc(o.label)}" type="button">
    <span class="k">${esc(o.label)}</span><span class="v">${esc(o.text)}</span>
  </button>`;
}

function feedbackHtml(q: ParsedQ, picked: string): string {
  const ok = q.type === 'panduan' ? picked === q.answer : picked.replace(/\W/g, '') === q.answer;
  return `<div class="quiz-feedback ${ok ? 'ok' : 'bad'}">
    <div class="qf-title">${ok ? '回答正确' : '回答错误'}</div>
    <div class="qf-answer">正确答案：<b>${esc(q.answer || '—')}</b>${picked ? ` · 你选了 <b>${esc(picked)}</b>` : ''}</div>
    ${q.analysis ? `<div class="qf-analysis">${esc(q.analysis)}</div>` : ''}
  </div>`;
}

function stemHtml(stem: string): string {
  return stem
    .split('\n')
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join('');
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 「显示答案 / 隐藏答案」开关 */
function wireAnswerToggle(doc: HTMLElement): void {
  const btn = document.getElementById('toggle-answers');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = doc.classList.toggle('show-answers');
    btn.textContent = on ? '隐藏答案' : '显示答案';
  });
}
