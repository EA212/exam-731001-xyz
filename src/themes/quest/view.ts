import type { QuestState } from './types';
import { accuracy, stars, RARITY_NAME } from './model';

export interface View {
  stage(): HTMLElement;
  render(s: QuestState): void;
  card(html: string): void;
  hideCard(): void;
  toast(text: string, kind: 'ok' | 'bad' | 'info'): void;
  setMuted(m: boolean): void;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

export function createView(shadow: ShadowRoot, onAct: (act: string, i: number) => void): View {
  shadow.innerHTML = `
    <div class="world">
      <div class="top">
        <button class="icon" data-act="exit" aria-label="退出">✕</button>
        <div class="brand"><b data-f="brand"></b><span>秘境寻宝 · 答对开宝箱</span></div>
        <button class="icon" data-act="mute" aria-label="音效" data-f="mute">♪</button>
        <button class="icon" data-act="pause" aria-label="暂停">Ⅱ</button>
      </div>
      <div class="meters">
        <div class="meter"><i>生命</i><b data-f="lives">♥♥♥</b></div>
        <div class="meter"><i>连击</i><b data-f="combo">×0</b></div>
        <div class="meter"><i>钥匙</i><b data-f="keys">0</b></div>
        <div class="meter"><i>得分</i><b data-f="score">0</b></div>
      </div>
      <div class="progress"><i data-f="bar"></i></div>
      <div class="qcard" data-f="qcard">
        <div class="qhead"><span class="tag" data-f="type">题目</span><span data-f="pos"></span><span class="sp"></span><button data-act="full">展开</button></div>
        <div class="stem" data-f="stem"></div>
        <div class="material" data-f="material" hidden></div>
        <div class="options" data-f="options" hidden></div>
      </div>
      <div class="stage" data-f="stage"></div>
      <div class="hint" data-f="hint">点选轮盘扇区作答 · 答对掉落宝箱</div>
      <div class="toast" data-f="toast"></div>
      <div class="overlay" data-f="overlay" hidden></div>
    </div>`;

  const one = <T extends HTMLElement>(f: string): T => shadow.querySelector(`[data-f="${f}"]`) as T;
  const set = (f: string, v: string): void => { const el = shadow.querySelector(`[data-f="${f}"]`); if (el) el.textContent = v; };
  const overlay = one<HTMLElement>('overlay');
  const toastEl = one<HTMLElement>('toast');
  let toastTimer = 0;

  shadow.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    onAct(btn.dataset.act || '', Number(btn.dataset.i ?? 0));
  });

  const view: View = {
    stage: () => one<HTMLElement>('stage'),
    render(s) {
      set('brand', s.brand);
      set('lives', s.lives > 0 ? '♥'.repeat(s.lives) : '—');
      set('combo', `×${s.combo}`);
      set('keys', String(s.keys));
      set('score', String(s.score));
      const done = s.nodes.filter((n) => n.cleared).length;
      (shadow.querySelector('[data-f="bar"]') as HTMLElement).style.width = `${s.nodes.length ? Math.round((done / s.nodes.length) * 100) : 0}%`;
    },
    card(html) { overlay.hidden = false; overlay.innerHTML = `<div class="panel">${html}</div>`; },
    hideCard() { overlay.hidden = true; overlay.innerHTML = ''; },
    toast(text, kind) {
      window.clearTimeout(toastTimer);
      toastEl.className = `toast ${kind} on`;
      toastEl.textContent = text;
      toastTimer = window.setTimeout(() => { toastEl.className = 'toast'; }, kind === 'info' ? 1800 : 1100);
    },
    setMuted(m) { set('mute', m ? '♪̸' : '♪'); },
  };
  return view;
}

export function questionHtml(s: QuestState, idx: number): { type: string; pos: string; stem: string; material: string; options: string; hint: string } {
  const q = s.questions[idx];
  return {
    type: q.typeName,
    pos: `${idx + 1} / ${s.questions.length}`,
    stem: q.stem,
    material: q.material,
    options: q.options.map((o) => `<div class="opt"><b>${esc(o.label)}.</b><span>${esc(o.text)}</span></div>`).join(''),
    hint: q.kind === 'scroll' ? '翻开卷轴看答案 · 自评记住了' : '点选轮盘扇区作答 · 答对掉落宝箱',
  };
}

export function menuHtml(s: QuestState, variants: { id: string; label: string }[], hasChapters: boolean): string {
  const opts = [`<button class="variant ${s.variant < 0 ? 'on' : ''}" data-act="variant" data-i="-1">全部 ${s.questions.length} 题</button>`]
    .concat(variants.map((v, i) => `<button class="variant ${s.variant === i ? 'on' : ''}" data-act="variant" data-i="${i}">${esc(v.label)}</button>`))
    .join('');
  return `
    <h1>秘境寻宝</h1>
    <p>答对开宝箱，点亮地图，把整份资料走完</p>
    <div class="rules">
      每道题的选项铺在<b>轮盘</b>上，点选你认为正确的扇区。<br>
      <b>答对</b> → 掉落宝箱 → 开箱得星币 / 钥匙 / 图鉴碎片。<br>
      <b>答错</b> → 显示正确答案，掉 1 点生命，不给宝箱。<br>
      简答 / 论述等<b>主观题</b>是记忆卷轴：翻开答案全文、自评记住，同样算通关。
    </div>
    ${s.questions.length ? `<div class="variants">${opts}</div>` : ''}
    <div class="row">
      ${s.questions.length ? '<button class="btn primary" data-act="start">开始探险</button>' : ''}
      ${hasChapters ? '<button class="btn" data-act="map">选择关卡</button>' : ''}
    </div>
    <button class="btn ghost" data-act="exit">退出主题</button>`;
}

export function mapHtml(s: QuestState, chapters: { label: string; meta: string }[]): string {
  const nodes = s.nodes.map((n) => {
    const icon = n.kind === 'boss' ? '👑' : n.kind === 'scroll' ? '📜' : n.kind === 'lore' ? '✨' : '⚔️';
    return `<button class="level ${n.cleared ? 'done' : ''}" data-act="node" data-i="${n.id}">
      <b>${icon} 第 ${n.id + 1} 关 · ${n.items.length} 题</b>
      <small>${n.cleared ? '已点亮 · 可重探' : cut(n.items.map((k) => s.questions[k]?.typeName || '').filter((v, i, a) => a.indexOf(v) === i).join(' / '), 22)}</small>
    </button>`;
  }).join('');
  const list = chapters.length
    ? `<div class="levels">${chapters.slice(0, 60).map((c, i) => `<button class="level" data-act="level" data-i="${i}"><b>${esc(cut(c.label, 18))}</b><small>${esc(cut(c.meta, 20))}</small></button>`).join('')}</div>`
    : '';
  return `<h2>探险地图</h2><p>${s.nodes.length ? '选一个节点开始，完成即点亮' : '挑一份资料开始'}</p>
    ${s.nodes.length ? `<div class="levels">${nodes}</div>` : ''}
    ${chapters.length ? `<p>切换关卡</p>${list}` : ''}
    <div class="row"><button class="btn" data-act="back">返回</button><button class="btn ghost" data-act="exit">退出主题</button></div>`;
}

export function pauseHtml(): string {
  return `<h2>已暂停</h2><p>进度都在，随时继续。</p>
    <button class="btn primary" data-act="resume">继续</button>
    <button class="btn" data-act="menu">回主菜单</button>
    <button class="btn ghost" data-act="exit">退出主题</button>`;
}

export function resultHtml(s: QuestState): string {
  const st = stars(s);
  const rate = Math.round(accuracy(s) * 100);
  return `<div class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</div>
    <h2>${s.lives > 0 ? '秘境通关' : '生命耗尽'}</h2>
    <div class="grid">
      <div class="cell"><b>${s.correct}</b><span>答对</span></div>
      <div class="cell"><b>${s.answered}</b><span>已答</span></div>
      <div class="cell"><b>${rate}%</b><span>正确率</span></div>
      <div class="cell"><b>${s.score}</b><span>得分</span></div>
      <div class="cell"><b>${s.chests}</b><span>宝箱</span></div>
      <div class="cell"><b>×${s.bestCombo}</b><span>最高连击</span></div>
    </div>
    ${s.relics.length ? `<div class="relics">${s.relics.slice(0, 8).map((r) => `<span class="relic">${esc(cut(r, 12))}</span>`).join('')}</div>` : ''}
    <button class="btn primary" data-act="again">再来一局</button>
    <div class="row"><button class="btn" data-act="map">探险地图</button><button class="btn ghost" data-act="exit">退出主题</button></div>`;
}

export function scrollHtml(q: { stem: string; material: string; answerText: string; analysis: string; keyPoints: string }, revealed: boolean): string {
  const body = revealed
    ? `<h4>参考答案</h4>${esc(q.answerText || '（原卷未提供答案正文）')}
       ${q.analysis ? `<h4>解析</h4>${esc(q.analysis)}` : ''}
       ${q.keyPoints ? `<h4>答题关键点</h4>${esc(q.keyPoints)}` : ''}`
    : `<h4>先自己回忆</h4>${esc(q.material || '在心里默写要点，再翻开对照。')}`;
  return `<h2>记忆卷轴</h2><p>${esc(cut(q.stem, 40))}</p>
    <div class="scroll">${body}</div>
    ${revealed
      ? '<div class="row"><button class="btn primary" data-act="remember">记住了</button><button class="btn" data-act="relook">再看看</button></div>'
      : '<button class="btn primary" data-act="reveal">翻开答案</button>'}`;
}

export function rewardHtml(label: string, rarity: number): string {
  return `<div class="gem">✦</div><h2 data-f="chest-title">宝箱开启</h2>
    <p>${esc(RARITY_NAME[rarity] ?? '普通')}奖励</p>
    <div class="grid"><div class="cell" style="grid-column:1/3"><b style="font-size:18px">${esc(label)}</b><span>已收入背包</span></div></div>`;
}
