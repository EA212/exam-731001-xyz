import type { QuestTheme, QuestContext, QuestQuestion, Reward } from './types';
import { isCorrect } from './parse';
import { initialState, rollReward, rarity, accuracy } from './model';
import type { Engine } from './engine';
import * as audio from './audio';
import { createView, questionHtml, menuHtml, mapHtml, pauseHtml, resultHtml, scrollHtml, rewardHtml } from './view';

export const questTheme: QuestTheme = {
  id: 'quest',
  name: '秘境寻宝',
  tagline: '轮盘答题 · 答对开宝箱 · 主观题记忆卷轴',
  accent: '#ffd166',
  create(ctx: QuestContext): () => void {
    const shadow = ctx.mount.attachShadow({ mode: 'open' });
    const host = ctx.host;
    let state = initialState(host.questions, ctx.title);
    let engine: Engine | null = null;
    let style: HTMLStyleElement | null = null;
    let dead = false;
    let timer = 0;
    let pending: (() => void) | null = null;

    const view = createView(shadow, (act, i) => action(act, i));
    const f = (name: string): HTMLElement | null => shadow.querySelector(`[data-f="${name}"]`);

    const schedule = (fn: () => void, ms: number): void => {
      window.clearTimeout(timer);
      pending = fn;
      if (!state.paused) timer = window.setTimeout(() => { pending = null; if (!dead) fn(); }, ms);
    };
    const clearTimer = (): void => { window.clearTimeout(timer); pending = null; };

    function setQ(idx: number): void {
      const h = questionHtml(state, idx);
      const put = (n: string, v: string): void => { const el = f(n); if (el) el.textContent = v; };
      put('type', h.type); put('pos', h.pos); put('stem', h.stem); put('hint', h.hint);
      const mat = f('material'); if (mat) { mat.textContent = h.material; mat.hidden = !h.material; }
      const opts = f('options'); if (opts) { opts.innerHTML = h.options; opts.hidden = true; }
      const card = f('qcard'); card?.classList.remove('open');
      const stem = f('stem'); if (stem) stem.style.maxHeight = '';
    }

    function finish(): void {
      clearTimer();
      state.phase = 'result';
      audio.play('finish');
      host.onFinish(state.correct, state.questions.length);
      view.render(state);
      view.card(resultHtml(state));
    }

    function advance(): void {
      clearTimer();
      if (state.lives <= 0) { finish(); return; }
      const node = state.nodes[state.nodeIndex];
      if (!node) { finish(); return; }
      const local = node.items.indexOf(state.itemIndex);
      if (local < 0 || local + 1 >= node.items.length) {
        node.cleared = true;
        state.nodeIndex += 1;
        const next = state.nodes[state.nodeIndex];
        if (!next) { finish(); return; }
        state.itemIndex = next.items[0];
        audio.play('open');
        view.render(state);
        view.card(`<h2>第 ${node.id + 1} 关达成</h2><p>节点已点亮，继续深入秘境</p><button class="btn primary" data-act="next">继续前进</button>`);
        return;
      }
      state.itemIndex = node.items[local + 1];
      play();
    }

    function applyReward(r: Reward): void {
      state.chests += 1;
      if (r.kind === 'coin') { state.coins += r.value; state.score += r.value; }
      else if (r.kind === 'key') state.keys += r.value;
      else if (r.kind === 'life') state.lives = Math.min(3, state.lives + r.value);
      else if (r.kind === 'double') state.score += 100;
      else if (r.kind === 'relic') state.relics.push(r.label);
      else if (r.kind === 'lore' && r.label) state.lore.push(r.label);
      view.render(state);
    }

    function rewardFor(): Reward {
      const q = state.questions[state.itemIndex];
      const lore = q?.analysis || q?.keyPoints || q?.answerText?.split('\n')[0] || '';
      return rollReward(rarity(state.combo, accuracy(state)), Math.random, lore);
    }

    async function openChest(): Promise<void> {
      const r = rewardFor();
      applyReward(r);
      state.phase = 'reward';
      audio.play('drop');
      audio.playReveal(r.rarity);
      await engine?.chest({ label: r.label, rarity: r.rarity });
      if (dead) return;
      view.card(rewardHtml(r.label, r.rarity));
      schedule(() => { view.hideCard(); advance(); }, 650);
    }

    function grade(pick: string, ok: boolean): void {
      const q = state.questions[state.itemIndex];
      host.onGrade(q, pick, ok);
      state.answered += 1;
      if (ok) {
        state.correct += 1;
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.keys += 1;
        const gain = 100 + Math.min(state.combo, 10) * 20;
        state.score += gain;
        audio.play(state.combo >= 3 ? 'combo' : 'right');
        view.toast(`+${gain}${state.combo >= 3 ? ` · ${state.combo} 连击` : ''}`, 'ok');
        view.render(state);
        void openChest();
      } else {
        state.lives -= 1;
        state.combo = 0;
        audio.play('wrong');
        view.toast(q.answer ? `正确答案 ${q.answer}` : '再接再厉', 'bad');
        view.render(state);
        schedule(advance, 1050);
      }
    }

    async function playChoice(q: QuestQuestion): Promise<void> {
      audio.play('spin');
      const multi = q.type === 'duoxuan' || q.answer.length > 1;
      const res = await engine!.wheel({ options: q.options, multi, answer: q.answer }, () => audio.play('tick'));
      if (dead) return;
      grade(res.pick, res.ok);
    }

    function play(): void {
      clearTimer();
      if (dead || state.paused) return;
      state.phase = 'play';
      const q = state.questions[state.itemIndex];
      if (!q) { finish(); return; }
      view.hideCard();
      setQ(state.itemIndex);
      view.render(state);
      if (q.kind === 'scroll') view.card(scrollHtml(q, false));
      else void playChoice(q);
    }

    function start(list: QuestQuestion[]): void {
      clearTimer();
      const brand = state.brand;
      state = initialState(list, brand);
      state.phase = 'play';
      engine?.pause(false);
      audio.play('tap');
      play();
    }

    function menu(): void {
      clearTimer();
      state.phase = 'menu';
      const variants = state.questions.length === host.questions.length
        ? host.variants.map((v) => ({ id: v.id, label: v.label }))
        : [];
      view.card(menuHtml(state, variants, host.chapters.length > 0));
    }

    function map(): void {
      clearTimer();
      state.phase = 'map';
      view.card(mapHtml(state, host.chapters));
    }

    function action(act: string, i: number): void {
      if (dead) return;
      if (act === 'exit') { host.onClose(); return; }
      if (act === 'mute') { state.muted = !state.muted; audio.setMuted(state.muted); view.setMuted(state.muted); return; }
      if (act === 'full') {
        const card = f('qcard'); if (!card) return;
        const open = card.classList.toggle('open');
        const stem = f('stem'); if (stem) stem.style.maxHeight = open ? 'none' : '';
        const opts = f('options'); if (opts) opts.hidden = !open;
        return;
      }
      if (act === 'pause') {
        if (state.phase !== 'play' || !engine) return;
        state.paused = true;
        window.clearTimeout(timer);
        engine.pause(true);
        view.card(pauseHtml());
        return;
      }
      if (act === 'resume') {
        state.paused = false;
        engine?.pause(false);
        view.hideCard();
        if (pending) schedule(pending, 50);
        return;
      }
      if (act === 'variant') { state.variant = i; menu(); return; }
      if (act === 'start' || act === 'again') {
        const v = state.variant >= 0 ? host.variants[state.variant] : null;
        start(v ? v.questions : host.questions);
        return;
      }
      if (act === 'menu' || act === 'back') { state.paused = false; engine?.pause(false); menu(); return; }
      if (act === 'map') { map(); return; }
      if (act === 'next' || act === 'next-scroll') { view.hideCard(); play(); return; }
      if (act === 'node') {
        const node = state.nodes[i]; if (!node) return;
        state.nodeIndex = i;
        state.itemIndex = node.items[0];
        view.hideCard();
        play();
        return;
      }
      if (act === 'level') {
        const c = host.chapters[i]; if (!c) return;
        if (!host.load) { window.location.assign(c.href); return; }
        view.card(`<h2>载入中</h2><p>${c.label}</p>`);
        void Promise.resolve(host.load(c.href)).then((list) => {
          if (dead) return;
          if (!list?.length) { map(); return; }
          state.brand = c.label;
          start(list);
        }).catch(() => { if (!dead) map(); });
        return;
      }
      if (act === 'reveal') { audio.play('scroll'); view.card(scrollHtml(state.questions[state.itemIndex], true)); return; }
      if (act === 'relook') { view.card(scrollHtml(state.questions[state.itemIndex], true)); return; }
      if (act === 'remember') {
        const q = state.questions[state.itemIndex];
        host.onGrade(q, '', true);
        state.answered += 1;
        state.correct += 1;
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        state.keys += 1;
        state.score += 100;
        if (q.stem) state.lore.push(q.stem.slice(0, 14));
        audio.play('right');
        view.render(state);
        view.toast('已收进图鉴', 'ok');
        view.hideCard();
        void openChest();
        return;
      }
    }

    void (async (): Promise<void> => {
      const [engineMod, cssMod] = await Promise.all([
        import('./engine'),
        import('./tokens.css?inline'),
      ]);
      if (dead) return;
      style = document.createElement('style');
      style.textContent = cssMod.default;
      shadow.insertBefore(style, shadow.firstChild);
      engine = await engineMod.createEngine(view.stage(), (pick) => isCorrect(state.questions[state.itemIndex], pick));
      if (dead) { engine.destroy(); return; }
      if (state.questions.length) menu();
      else if (host.chapters.length) map();
      else view.card('<h2>暂无可玩内容</h2><p>返回资料库挑一份资料。</p><button class="btn ghost" data-act="exit">退出主题</button>');
    })();

    return (): void => {
      dead = true;
      clearTimer();
      engine?.destroy();
      style?.remove();
      ctx.mount.replaceChildren();
    };
  },
};
