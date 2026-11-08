import type { QuizQuestion } from '../lib/quiz-player';
import type { QuizTheme, ThemeContext, ThemeChapter, ThemeVariant } from './index';
import type { Field, Round } from './catch/engine';

type AudioModule = typeof import('./catch/audio');

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

export const catchTheme: QuizTheme = {
  id: 'catch',
  name: '光舱接星',
  tagline: '左右拖动光舱，接住坠落的正确答案',
  accent: '#6c8cff',
  create(ctx: ThemeContext): () => void {
    const root = ctx.mount;
    const host = ctx.host;
    let audio: AudioModule | null = null;
    let field: Field | null = null;
    let move: ((x: number) => void) | null = null;
    let style: HTMLStyleElement | null = null;
    let dead = false;
    let timer = 0;
    let pool: QuizQuestion[] = host.questions;
    let qs: QuizQuestion[] = [];
    let idx = 0;
    let score = 0;
    let combo = 0;
    let lives = 3;
    let correct = 0;
    let answered = 0;
    let muted = false;
    let paused = false;
    let running = false;
    let chosen = -1;
    let note = '';

    root.innerHTML = `
      <div class="ct-top">
        <button class="ct-icon" data-act="exit" aria-label="退出主题">✕</button>
        <div class="ct-brand"><b data-f="brand">${esc(ctx.title)}</b><span>${esc(catchTheme.tagline)}</span></div>
        <div class="ct-spacer"></div>
        <button class="ct-icon" data-act="mute" aria-label="音效">♪</button>
        <button class="ct-icon" data-act="pause" aria-label="暂停">Ⅱ</button>
      </div>
      <div class="ct-meters">
        <div class="ct-meter is-lives"><i>生命</i><b data-f="lives">♥♥♥</b></div>
        <div class="ct-meter is-combo"><i>连击</i><b data-f="combo">×0</b></div>
        <div class="ct-meter"><i>得分</i><b data-f="score">0</b></div>
      </div>
      <div class="ct-progress"><i data-f="bar"></i></div>
      <div class="ct-question">
        <div class="ct-qhead"><span class="ct-tag" data-f="type"></span><span data-f="pos"></span><button data-act="board">全文</button></div>
        <div class="ct-stem" data-f="stem"></div>
        <div class="ct-board" data-f="board" hidden></div>
      </div>
      <div class="ct-stage" data-f="stage"></div>
      <div class="ct-hint">左右拖动光舱 · 接住正确答案 · 避开干扰项</div>
      <div class="ct-toast" data-f="toast"></div>
      <div class="ct-overlay" data-f="overlay"></div>`;

    const one = <T extends HTMLElement>(f: string): T => root.querySelector(`[data-f="${f}"]`) as T;
    const overlay = one<HTMLElement>('overlay');
    const toast = one<HTMLElement>('toast');
    const board = one<HTMLElement>('board');
    let toastTimer = 0;

    function set(f: string, v: string): void {
      const el = root.querySelector(`[data-f="${f}"]`);
      if (el) el.textContent = v;
    }

    function meters(): void {
      set('lives', lives > 0 ? '♥'.repeat(lives) : '—');
      set('combo', `×${combo}`);
      set('score', String(score));
      const bar = root.querySelector('[data-f="bar"]') as HTMLElement;
      bar.style.width = `${qs.length ? Math.round((idx / qs.length) * 100) : 0}%`;
    }

    function flash(text: string, kind: 'ok' | 'bad' | 'info'): void {
      window.clearTimeout(toastTimer);
      toast.className = `ct-toast ${kind} is-on`;
      toast.textContent = text;
      toastTimer = window.setTimeout(() => { toast.className = 'ct-toast'; }, kind === 'info' ? 1900 : 1000);
    }

    function hideOverlay(): void {
      overlay.hidden = true;
      overlay.innerHTML = '';
    }

    function card(html: string): void {
      overlay.hidden = false;
      overlay.innerHTML = `<div class="ct-card">${html}</div>`;
    }

    function levelList(): string {
      if (!host.chapters.length) return '';
      return `<div class="ct-levels">${host.chapters
        .slice(0, 60)
        .map((c, i) => `<button class="ct-level" data-act="level" data-i="${i}">${esc(cut(c.label, 20))}<small>${esc(cut(c.meta, 22))}</small></button>`)
        .join('')}</div>`;
    }

    function menu(): void {
      running = false;
      const variants: ThemeVariant[] = pool.length === host.questions.length ? host.variants : [];
      const options = [`<button class="ct-variant ${chosen < 0 ? 'is-on' : ''}" data-act="variant" data-i="-1">全部 ${pool.length} 题</button>`]
        .concat(variants.map((v, i) => `<button class="ct-variant ${chosen === i ? 'is-on' : ''}" data-act="variant" data-i="${i}">${esc(v.label)}</button>`))
        .join('');
      card(`
        <h1>${esc(catchTheme.name)}</h1>
        <p>${esc(catchTheme.tagline)}</p>
        <div class="ct-rules">
          题干在上方，选项变成坠落的星体。<br>
          <b>拖动</b>底部光舱接住正确答案；单选接一颗，多选要接齐。<br>
          接到干扰项或漏接会掉一格生命，连击越高得分越高，宝箱里藏着知识点。
        </div>
        ${pool.length ? `<div class="ct-variants">${options}</div>` : ''}
        <div class="ct-actions">
          ${pool.length ? '<button class="ct-btn primary" data-act="start">开始闯关</button>' : ''}
          ${host.chapters.length ? '<button class="ct-btn" data-act="levels">选择关卡</button>' : ''}
          <button class="ct-btn ghost" data-act="exit">退出主题</button>
        </div>`);
    }

    function levels(): void {
      running = false;
      card(`<h2>选择关卡</h2><p>挑一份资料开始，进度会记入错题本。</p>${levelList()}
        <div class="ct-actions"><button class="ct-btn" data-act="back">返回</button><button class="ct-btn ghost" data-act="exit">退出主题</button></div>`);
    }

    function pauseCard(): void {
      card(`<h2>已暂停</h2><p>星体暂停下落，随时继续。</p>
        <div class="ct-actions">
          <button class="ct-btn primary" data-act="resume">继续</button>
          <button class="ct-btn" data-act="menu">重开</button>
          <button class="ct-btn ghost" data-act="exit">退出主题</button>
        </div>`);
    }

    function result(): void {
      running = false;
      const rate = answered ? Math.round((correct / answered) * 100) : 0;
      const stars = rate >= 90 ? '★★★' : rate >= 65 ? '★★☆' : rate >= 40 ? '★☆☆' : '☆☆☆';
      card(`
        <div class="ct-stars">${stars}</div>
        <h2>${lives > 0 ? '闯关完成' : '生命耗尽'}</h2>
        <div class="ct-grid">
          <div><b>${correct}</b><span>答对</span></div>
          <div><b>${answered}</b><span>已答</span></div>
          <div><b>${rate}%</b><span>正确率</span></div>
          <div><b>${score}</b><span>得分</span></div>
        </div>
        <div class="ct-actions">
          <button class="ct-btn primary" data-act="again">再来一局</button>
          ${host.chapters.length ? '<button class="ct-btn" data-act="levels">选择关卡</button>' : ''}
          <button class="ct-btn ghost" data-act="exit">退出主题</button>
        </div>`);
    }

    function showQuestion(q: QuizQuestion): void {
      set('type', q.typeName);
      set('pos', `${idx + 1} / ${qs.length}`);
      one<HTMLElement>('stem').textContent = q.stem.replace(/\n/g, ' ');
      board.hidden = true;
      board.innerHTML = q.options.length
        ? q.options.map((o) => `<p><b>${esc(o.label)}.</b> ${esc(o.text)}</p>`).join('')
        : `<p>${esc(q.stem)}</p>${q.analysis ? `<p>${esc(q.analysis)}</p>` : ''}`;
      meters();
    }

    function rightsOf(q: QuizQuestion): string[] {
      const labels = new Set(q.options.map((o) => o.label));
      return [...q.answer].filter((c) => labels.has(c));
    }

    function grade(q: QuizQuestion, res: import('./catch/engine').RoundResult): void {
      if (dead || !running) return;
      const pick = res.caught.join('');
      const ok = res.ok;
      host.onGrade(q, pick, ok);
      answered += 1;
      if (ok) {
        correct += 1;
        combo += 1;
        const gain = 100 + Math.min(combo, 10) * 20;
        score += gain;
        audio?.play(combo >= 3 ? 'combo' : 'right');
        flash(`+${gain}${combo >= 3 ? ` · ${combo} 连击` : ''}`, 'ok');
      } else {
        lives -= 1;
        combo = 0;
        audio?.play('wrong');
        flash(`正确答案 ${q.answer}`, 'bad');
      }
      if (res.chest && note) {
        score += 60;
        audio?.play('chest');
        window.setTimeout(() => flash(`宝箱 · ${cut(note.replace(/\n/g, ' '), 22)}`, 'info'), 260);
      }
      meters();
      timer = window.setTimeout(() => {
        if (dead || !running) return;
        idx += 1;
        next();
      }, ok ? 850 : 1500);
    }

    function next(): void {
      if (dead || !running) return;
      if (idx >= qs.length || lives <= 0) {
        host.onFinish(correct, qs.length);
        audio?.play('finish');
        result();
        return;
      }
      const q = qs[idx];
      const rights = rightsOf(q);
      if (!q.options.length || !rights.length) {
        idx += 1;
        next();
        return;
      }
      showQuestion(q);
      const level = Math.floor(idx / 6);
      note = host.notes?.length ? host.notes[(idx * 7 + 3) % host.notes.length] : '';
      const round: Round = {
        options: q.options,
        rights,
        speed: 168 + level * 26 + Math.min(idx, 24) * 3,
        chest: note && combo >= 2 && idx % 3 === 2 ? note : undefined,
      };
      field?.drop(round).then((res) => grade(q, res));
    }

    function start(list: QuizQuestion[]): void {
      window.clearTimeout(timer);
      qs = list;
      idx = 0;
      score = 0;
      combo = 0;
      lives = 3;
      correct = 0;
      answered = 0;
      paused = false;
      running = true;
      field?.pause(false);
      hideOverlay();
      meters();
      audio?.play('start');
      next();
    }

    function onVariant(i: number): void {
      chosen = i;
      menu();
    }

    function begin(): void {
      const variants = pool.length === host.questions.length ? host.variants : [];
      const v = chosen >= 0 ? variants[chosen] : null;
      start(v ? v.questions : pool);
    }

    function onClick(ev: MouseEvent): void {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act || '';
      const i = Number(btn.dataset.i ?? 0);
      if (act === 'exit') { host.onClose(); return; }
      if (act === 'mute') {
        muted = !muted;
        audio?.setMuted(muted);
        btn.textContent = muted ? '♪̸' : '♪';
        return;
      }
      if (act === 'board') { board.hidden = !board.hidden; return; }
      if (act === 'pause') {
        if (!running) return;
        paused = true;
        field?.pause(true);
        pauseCard();
        return;
      }
      if (act === 'resume') { paused = false; field?.pause(false); hideOverlay(); return; }
      if (act === 'variant') { onVariant(i); return; }
      if (act === 'start' || act === 'again') { begin(); return; }
      if (act === 'menu') { paused = false; field?.pause(false); menu(); return; }
      if (act === 'levels') { levels(); return; }
      if (act === 'back') { menu(); return; }
      if (act === 'level') {
        const c: ThemeChapter | undefined = host.chapters[i];
        if (!c) return;
        if (!host.load) { window.location.assign(c.href); return; }
        card(`<h2>载入中</h2><p>${esc(c.label)}</p>`);
        void Promise.resolve(host.load(c.href))
          .then((list) => {
            if (dead) return;
            if (!list?.length) { levels(); return; }
            pool = list;
            chosen = -1;
            const brand = root.querySelector<HTMLElement>('[data-f="brand"]');
            if (brand) brand.textContent = c.label;
            audio?.play('start');
            start(pool);
          })
          .catch(() => { if (!dead) levels(); });
      }
    }

    root.addEventListener('click', onClick as EventListener);

    const onMove = (ev: PointerEvent): void => {
      if (!running || paused || !move) return;
      const canvas = one<HTMLElement>('stage').querySelector('canvas');
      if (!canvas) return;
      const cr = canvas.getBoundingClientRect();
      move(((ev.clientX - cr.left) / cr.width) * 480);
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerdown', onMove);

    void (async (): Promise<void> => {
      const [engineMod, audioMod, cssMod] = await Promise.all([
        import('./catch/engine'),
        import('./catch/audio'),
        import('./catch/style.css?inline'),
      ]);
      if (dead) return;
      audio = audioMod;
      style = document.createElement('style');
      style.textContent = cssMod.default;
      document.head.appendChild(style);
      field = await engineMod.createField(one<HTMLElement>('stage'));
      if (dead) { field.destroy(); return; }
      move = (x: number): void => field?.moveTo(x);
      if (host.questions.length) menu();
      else if (host.chapters.length) levels();
      else card('<h2>暂无可玩内容</h2><p>返回资料库挑一份带客观题的试卷。</p><div class="ct-actions"><button class="ct-btn ghost" data-act="exit">退出主题</button></div>');
    })();

    return (): void => {
      dead = true;
      running = false;
      window.clearTimeout(timer);
      window.clearTimeout(toastTimer);
      root.removeEventListener('click', onClick as EventListener);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerdown', onMove);
      field?.destroy();
      style?.remove();
    };
  },
};
