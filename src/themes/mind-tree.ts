import type { QuizQuestion, QuizResult } from '../lib/quiz-player';
import type { QuizTheme, ThemeContext, ThemeInstance } from './index';

type Kind = 'root' | 'branch' | 'right' | 'wrong' | 'explore';

interface Node {
  id: string;
  parent: string | null;
  label: string;
  detail: string;
  kind: Kind;
  depth: number;
  slot: number;
  born: number;
  children: number;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
const X = (d: number): number => 24 + d * 172;
const Y = (s: number): number => 22 + (s % 5) * 34;

function tone(ac: AudioContext, freq: number, at: number, dur: number): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.13, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ac.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export const mindTree: QuizTheme = {
  id: 'mind-tree',
  name: '3D 结构树',
  tagline: '答对延伸父子节点，答错长出复习分支；主观题与背诵笔记也能逐层展开',
  accent: '#7c3aed',
  pace: { right: 1400, wrong: 2600 },

  create({ mount, title, sources }: ThemeContext): ThemeInstance {
    const nodes: Node[] = [];
    const byId = new Map<string, Node>();
    let seq = 0;
    let combo = 0;
    let muted = false;
    let folded = false;
    let active = '';
    let detail = '';
    let spark: { x: number; y: number } | null = null;
    let ac: AudioContext | null = null;

    const push = (parent: string | null, label: string, text: string, kind: Kind): Node => {
      const depth = parent ? (byId.get(parent)?.depth ?? 0) + 1 : 0;
      const slot = nodes.filter((n) => n.depth === depth).length;
      const n: Node = { id: `n${++seq}`, parent, label, detail: text, kind, depth, slot, born: seq, children: 0 };
      nodes.push(n);
      byId.set(n.id, n);
      const p = parent ? byId.get(parent) : null;
      if (p) p.children += 1;
      return n;
    };

    const sound = (kind: 'right' | 'wrong' | 'reward'): void => {
      if (muted) return;
      try {
        ac ??= new AudioContext();
        if (ac.state === 'suspended') void ac.resume();
        const t = ac.currentTime;
        const notes = kind === 'right' ? [523, 659] : kind === 'wrong' ? [392, 294] : [523, 659, 784];
        notes.forEach((f, i) => tone(ac!, f, t + i * 0.09, 0.14));
      } catch { return; }
    };

    const root = push(null, title, '根节点 · 每答一题向下延伸一层', 'root');
    active = root.id;
    const g = sources.filter((s) => s.gradable);
    const n = sources.filter((s) => !s.gradable);
    const seeds = [...g.slice(0, 2), ...n.slice(0, 2), ...g.slice(2, 4)].slice(0, 4);
    seeds.forEach((s) => push(root.id, s.label, s.detail, s.gradable ? 'branch' : 'explore'));
    if (!seeds.length) push(root.id, '探索知识点', '点击节点展开子节点', 'explore');

    function render(): void {
      const maxDepth = Math.max(...nodes.map((n) => n.depth));
      const w = X(maxDepth) + 188;
      const links = nodes
        .filter((n) => n.parent && byId.has(n.parent))
        .map((n) => {
          const p = byId.get(n.parent!)!;
          const x1 = X(p.depth) + 148;
          const y1 = Y(p.slot) + 15;
          const x2 = X(n.depth);
          const y2 = Y(n.slot) + 15;
          return `<path class="mt-link is-${n.kind}" d="M${x1} ${y1} C${x1 + 52} ${y1}, ${x2 - 52} ${y2}, ${x2} ${y2}"/>`;
        })
        .join('');
      const cards = nodes
        .map((n) => {
          const x = X(n.depth);
          const y = Y(n.slot);
          const lift = Math.min(n.depth, 6) * 3;
          return `<button class="mt-node is-${n.kind}${n.born === seq ? ' is-new' : ''}" data-node="${n.id}" type="button" style="left:${x}px;top:${y}px;--lift:${lift}px" title="点击展开分支"><i class="mt-dot"></i><span>${esc(n.label)}</span></button>`;
        })
        .join('');

      mount.className = 'theme-stage mt-stage' + (folded ? ' is-folded' : '');
      mount.innerHTML = `<div class="mt-bar">
          <span class="mt-mark">◇</span><b>3D 结构树</b>
          <span class="mt-combo${combo >= 3 ? ' is-hot' : ''}">连击 ×${combo}</span>
          <span class="mt-hint">点节点展开分支 · 答对向下延伸</span>
          <button class="mt-ctl" data-act="mute" type="button">${muted ? '音效关' : '音效开'}</button>
          <button class="mt-ctl" data-act="fold" type="button">${folded ? '展开' : '收起'}</button>
          <a class="mt-ctl" href="/zsb/?theme=none">标准模式</a>
        </div>
        <div class="mt-body" ${folded ? 'hidden' : ''}>
          <div class="mt-canvas" style="width:${w}px">
            <svg class="mt-links" width="${w}" height="200" aria-hidden="true">${links}</svg>${cards}
          </div>
        </div>
        ${detail ? `<div class="mt-detail">${esc(detail).replace(/\n/g, '<br>')}<button class="mt-ctl" data-act="close-detail" type="button">×</button></div>` : ''}`;

      const body = mount.querySelector<HTMLElement>('.mt-body');
      if (body) body.scrollLeft = body.scrollWidth;
      if (spark) {
        const canvas = mount.querySelector<HTMLElement>('.mt-canvas');
        for (let i = 0; i < 6; i++) {
          const s = document.createElement('i');
          s.className = 'mt-spark';
          s.style.left = `${spark.x}px`;
          s.style.top = `${spark.y}px`;
          s.style.setProperty('--dx', `${(i - 2.5) * 17}px`);
          s.style.setProperty('--dy', `${-26 - (i % 3) * 14}px`);
          canvas?.appendChild(s);
          window.setTimeout(() => s.remove(), 800);
        }
        spark = null;
      }
    }

    function expand(id: string): void {
      const n = byId.get(id);
      if (!n) return;
      detail = `【${n.label}】\n${n.detail}`;
      if (n.children < 2 && sources.length) {
        const a = sources[(seq + 1) % sources.length];
        const b = sources[(seq + 2) % sources.length];
        push(n.id, `· ${a.label}`, a.detail, 'branch');
        push(n.id, `· ${b.label}`, b.detail, 'explore');
      }
      render();
    }

    mount.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const node = t.closest<HTMLElement>('[data-node]');
      if (node) { expand(node.dataset.node || ''); return; }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'mute') { muted = !muted; render(); }
      else if (act === 'fold') { folded = !folded; render(); }
      else if (act === 'close-detail') { detail = ''; render(); }
    });

    render();

    return {
      onGrade(q: QuizQuestion, pick: string, ok: boolean): void {
        detail = '';
        const label = `${ok ? '✓' : '✗'} ${q.typeName.replace(/题$/, '')} ${q.num}`;
        const text = ok
          ? q.stem.split('\n')[0]
          : `${q.stem.split('\n')[0]}\n正确答案 ${q.answer} · 你选了 ${pick}`;
        const n = push(active, label, text, ok ? 'right' : 'wrong');
        combo = ok ? combo + 1 : 0;
        if (ok) {
          sound(combo >= 3 && combo % 3 === 0 ? 'reward' : 'right');
          spark = { x: X(n.depth) + 74, y: Y(n.slot) + 15 };
        } else {
          sound('wrong');
          push(n.id, '复习这个知识点', text, 'explore');
        }
        active = push(n.id, '下一层', '继续答题，继续生长', 'branch').id;
        render();
      },
      onFinish(r: QuizResult): void {
        detail = '';
        push(active, `完成 ${r.score}/${r.fullScore}`, `答对 ${r.correct} 题 · 待复习 ${r.wrong} 题`, 'right');
        combo = 0;
        sound('reward');
        render();
      },
      destroy(): void {
        void ac?.close();
      },
    };
  },
};
