/**
 * 错题本
 * ----------------------------------------------------------------
 * 数据来源：exam-store 里保存的错题快照（题干 / 选项 / 正确答案 / 我的答案 / 解析 / 出处）
 * 功能：按试卷分组浏览、按科目 / 试卷筛选、搜索、
 *       重做错题（答对可直接移出）、标记已掌握、移出、清空、导出 / 导入 JSON
 */
import {
  type WrongRecord,
  clearWrong,
  getStats,
  getWrongMap,
  markWrongMastered,
  removeWrong,
  storageMode,
  writeStore,
  KEY_WRONG,
} from './exam-store';
import { createQuizPlayer, type QuizQuestion, type QuizPlayer } from './quiz-player';
import { attachTheme, currentTheme, type ThemeBinding, type ThemeSource } from '../themes';

type Filter = 'pending' | 'mastered' | 'all';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const fmtDate = (t: number): string => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function initWrongBook(): void {
  const root = document.getElementById('wrongbook');
  if (!root) return;
  const rootEl: HTMLElement = root;

  const state: { filter: Filter; doc: string; kw: string } = {
    filter: 'pending',
    doc: 'all',
    kw: '',
  };

  /* ------------------------------ 顶部统计 ------------------------------ */
  function renderStats(): void {
    const s = getStats();
    const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
    const el = document.getElementById('wb-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="wb-stat"><b>${s.pending}</b><span>待复习错题</span></div>
      <div class="wb-stat"><b>${s.totalWrong}</b><span>错题总条数</span></div>
      <div class="wb-stat"><b>${s.answered}</b><span>累计已刷</span></div>
      <div class="wb-stat"><b>${acc}%</b><span>正确率</span></div>
      <div class="wb-stat"><b>${s.docs}</b><span>涉及试卷</span></div>`;
  }

  /* ------------------------------ 列表 ------------------------------ */
  function visible(): WrongRecord[] {
    const all = Object.values(getWrongMap());
    return all
      .filter((w) => (state.filter === 'all' ? true : state.filter === 'mastered' ? w.mastered : !w.mastered))
      .filter((w) => state.doc === 'all' || w.docId === state.doc)
      .filter((w) => {
        if (!state.kw) return true;
        const t = `${w.stem} ${w.docTitle} ${w.num} ${w.answer}`.toLowerCase();
        return t.includes(state.kw);
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  }

  function optionRow(o: { label: string; text: string }, w: WrongRecord): string {
    const isRight = w.answer.includes(o.label);
    const isMine = w.chosen.includes(o.label);
    const cls = ['wb-opt', isRight ? 'ok' : '', isMine && !isRight ? 'bad' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}">
      <span class="k">${esc(o.label)}</span>
      <span class="v">${esc(o.text)}</span>
      ${isMine ? '<em class="tag-mine">你的选择</em>' : ''}
      ${isRight ? '<em class="tag-right">正确答案</em>' : ''}
    </div>`;
  }

  function renderList(): void {
    const list = visible();
    const all = Object.values(getWrongMap());
    const docs = [...new Map(all.map((w) => [w.docId, w.docTitle])).entries()];

    const filters = `
      <div class="wb-toolbar">
        <div class="wb-chips" data-g="filter">
          ${chip('pending', '待复习', state.filter)}
          ${chip('all', '全部', state.filter)}
          ${chip('mastered', '已掌握', state.filter)}
        </div>
        <select id="wb-doc" class="wb-select">
          <option value="all">全部试卷</option>
          ${docs
            .map(
              ([id, title]) =>
                `<option value="${esc(id)}"${state.doc === id ? ' selected' : ''}>${esc(title)}</option>`
            )
            .join('')}
        </select>
        <input id="wb-search" class="wb-select" type="search" placeholder="搜索题干 / 答案…" value="${esc(state.kw)}" />
        <button class="quiz-btn primary" id="wb-redo" type="button" ${list.length ? '' : 'disabled'}>重做这些题（${list.length}）</button>
        <button class="quiz-btn" id="wb-export" type="button">导出 JSON</button>
        <button class="quiz-btn" id="wb-import" type="button">导入</button>
        <button class="quiz-btn ghost" id="wb-clear" type="button">清空</button>
      </div>`;

    const body = list.length
      ? list
          .map(
            (w) => `
        <article class="wb-item ${w.mastered ? 'is-mastered' : ''}" data-id="${esc(w.id)}">
          <div class="wb-head">
            <span class="wb-doc" title="${esc(w.docTitle)}">${esc(w.docTitle)}</span>
            <span class="wb-badge">${esc(w.typeName)}</span>
            <span class="wb-badge">第 ${esc(w.num)} 题</span>
            ${w.wrongCount > 1 ? `<span class="wb-badge warn">错 ${w.wrongCount} 次</span>` : ''}
            ${w.mastered ? '<span class="wb-badge ok">已掌握</span>' : ''}
            <span class="wb-time">${fmtDate(w.lastAt)}</span>
          </div>
          <div class="wb-stem">${esc(w.stem.split('\n').filter(Boolean).join(' '))}</div>
          ${w.options.length ? `<div class="wb-options">${w.options.map((o) => optionRow(o, w)).join('')}</div>` : ''}
          <div class="wb-answer">
            正确答案 <b class="ok">${esc(w.answer || '—')}</b>
            · 你的答案 <b class="bad">${esc(w.chosen || '未答')}</b>
          </div>
          ${
            w.analysis
              ? `<details class="wb-analysis"><summary>查看解析</summary><p>${esc(w.analysis)}</p></details>`
              : ''
          }
          <div class="wb-actions">
            <a class="quiz-btn" href="${esc(w.docUrl)}">回原卷</a>
            <button class="quiz-btn" data-act="mastered" type="button">${w.mastered ? '取消已掌握' : '标记已掌握'}</button>
            <button class="quiz-btn ghost" data-act="remove" type="button">移出错题本</button>
          </div>
        </article>`
          )
          .join('')
      : `<p class="wb-empty">${
          all.length ? '当前筛选条件下没有错题。' : '还没有错题记录 —— 去任意一份真题里点「开始答题」吧。'
        }</p>`;

    rootEl.innerHTML = `${body}`;

    const bar = document.getElementById('wb-toolbar-host');
    if (bar) bar.innerHTML = filters;
  }

  const chip = (v: Filter, label: string, cur: Filter): string =>
    `<button class="quiz-chip ${cur === v ? 'on' : ''}" data-v="${v}" type="button">${label}</button>`;

  /* ------------------------------ 重做 ------------------------------ */
  let redoPlayer: QuizPlayer | null = null;
  let redoTheme: ThemeBinding | null = null;

  function startRedo(list: WrongRecord[]): void {
    const panel = document.getElementById('wb-redo-panel') as HTMLElement | null;
    if (!panel || !list.length) return;
    const questions: QuizQuestion[] = list.map((w) => ({
      id: w.id,
      num: w.num,
      stem: w.stem,
      options: w.options,
      answer: w.answer,
      analysis: w.analysis,
      type: w.type,
      typeName: w.typeName,
      point: w.point,
      source: w.docTitle,
    }));
    const sources: ThemeSource[] = questions.map((q) => ({
      id: q.id,
      label: `第 ${q.num} 题`,
      detail: [q.stem.split('\n')[0], q.answer ? `答案 ${q.answer}` : '', q.analysis].filter(Boolean).join('\n').slice(0, 200),
      gradable: true,
    }));
    redoTheme?.destroy();
    redoTheme = attachTheme(currentTheme(), '错题重做', sources, panel, {
      questions,
      onGrade: (q, _pick, ok): void => { if (ok) markWrongMastered(q.id, true); },
      onStateChange: (): void => undefined,
      onFinish: (): void => { renderList(); renderStats(); },
      onClose: (): void => { renderList(); renderStats(); },
    });
    if (redoTheme?.standalone) {
      redoTheme.launch(questions);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!redoPlayer) {
      redoPlayer = createQuizPlayer({
        mount: panel,
        questions,
        title: '错题重做',
        settings: false,
        pace: redoTheme?.pace,
        wrongBookUrl: '/zsb/wrong/',
        onGrade: (q, pick, ok): void => { if (ok) markWrongMastered(q.id, true); redoTheme?.onGrade(q, pick, ok); },
        onFinish: (r): void => redoTheme?.onFinish(r),
        onClose: (): void => { renderList(); renderStats(); },
      });
    }
    redoPlayer.start(questions, true);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------ 事件 ------------------------------ */
  function bindStatic(): void {
    document.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const chipBtn = t.closest<HTMLElement>('.wb-chips .quiz-chip');
      if (chipBtn) {
        state.filter = chipBtn.dataset.v as Filter;
        renderList();
        return;
      }
      const act = t.closest<HTMLElement>('.wb-item [data-act]');
      if (act) {
        const item = act.closest<HTMLElement>('.wb-item');
        const id = item?.dataset.id;
        if (!id) return;
        if (act.dataset.act === 'remove') removeWrong(id);
        else markWrongMastered(id, !item!.classList.contains('is-mastered'));
        renderList();
        renderStats();
        return;
      }
      if (t.id === 'wb-redo') return startRedo(visible());
      if (t.id === 'wb-export') {
        const data = JSON.stringify(getWrongMap(), null, 2);
        const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `错题本-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (t.id === 'wb-import') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => {
          const f = input.files?.[0];
          if (!f) return;
          f.text().then((txt) => {
            try {
              const incoming = JSON.parse(txt) as Record<string, WrongRecord>;
              const merged = { ...getWrongMap(), ...incoming };
              writeStore(KEY_WRONG, merged);
              renderList();
              renderStats();
              alert(`已导入 ${Object.keys(incoming).length} 条错题`);
            } catch {
              alert('导入失败：文件不是合法的错题 JSON');
            }
          });
        });
        input.click();
        return;
      }
      if (t.id === 'wb-clear') {
        if (confirm('确定清空全部错题记录吗？此操作不可撤销。')) {
          clearWrong();
          renderList();
          renderStats();
        }
      }
    });

    document.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.id === 'wb-search') {
        state.kw = t.value.trim().toLowerCase();
        renderList();
      }
    });

    document.addEventListener('change', (ev) => {
      const t = ev.target as HTMLSelectElement;
      if (t.id === 'wb-doc') {
        state.doc = t.value;
        renderList();
      }
    });
  }

  const mode = document.getElementById('wb-mode');
  if (mode) mode.textContent = storageMode() === 'localStorage' ? '本机浏览器存储' : '浏览器 Cookie';

  bindStatic();
  renderStats();
  renderList();
}
