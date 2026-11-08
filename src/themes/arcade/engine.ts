import arcadeCss from '../../styles/arcade.css?inline';
import Phaser from 'phaser';
import { isCorrect, type QuizQuestion, type QuizResult, type QuizSnapshot } from '../../lib/quiz-player';
import type { ThemeHost, ThemeSource } from '../index';
import { createAudio, type AudioKit } from './audio';

const W = 960;
const H = 380;
const COLORS = [0x7c5cff, 0x22d3ee, 0xf472b6, 0xfbbf24, 0x34d399, 0xfb7185];

export interface ArcadeOptions {
  title: string;
  sources: ThemeSource[];
  pace: { right: number; wrong: number };
  host?: ThemeHost;
}

export interface ArcadeController {
  launch(questions: QuizQuestion[]): void;
  destroy(): void;
}

interface Star {
  obj: Phaser.GameObjects.Rectangle;
  sp: number;
}

interface Bridge {
  scene: Phaser.Scene;
  ship: Phaser.GameObjects.Container;
  stars: Star[];
  crystals: Phaser.GameObjects.Container[];
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fmtTime = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const isMulti = (q: QuizQuestion): boolean => q.type === 'duoxuan' || q.answer.replace(/[^A-H]/gi, '').length > 1;
const labelsOf = (a: string): string[] => a.replace(/[^A-H]/gi, '').toUpperCase().split('');

export function createArcade(mount: HTMLElement, opts: ArcadeOptions): ArcadeController {
  if (!document.getElementById('arc-style')) {
    const style = document.createElement('style');
    style.id = 'arc-style';
    style.textContent = arcadeCss;
    document.head.appendChild(style);
  }
  const audio: AudioKit = createAudio();
  const notes = opts.sources.filter((s) => !s.gradable);
  const host = opts.host;

  mount.innerHTML = `
    <div class="arc-shell">
      <div class="arc-topbar">
        <div class="arc-brand"><i></i>QUIZ BLASTER<small>星际答题</small></div>
        <div class="arc-meters">
          <span class="arc-m">LEVEL <b data-f="level">1</b></span>
          <span class="arc-m">进度 <b data-f="prog">0/0</b></span>
          <span class="arc-m">得分 <b data-f="score">0</b></span>
          <span class="arc-m arc-combo">连击 <b data-f="combo">0</b></span>
          <span class="arc-m arc-shield" data-f="shield"></span>
        </div>
        <div class="arc-tools">
          <button type="button" data-act="sound">音效 开</button>
          <button type="button" data-act="pause">暂停</button>
          <button type="button" data-act="exit">退出</button>
        </div>
      </div>
      <div class="arc-question">
        <span class="arc-qtag" data-f="qtag"></span>
        <div class="arc-stem" data-f="stem"></div>
        <div class="arc-progress"><i data-f="bar"></i></div>
      </div>
      <div class="arc-arena" data-f="arena"></div>
      <div class="arc-optbar" data-f="opts"></div>
      <div class="arc-toast" data-f="toast"></div>
      <div class="arc-overlay" data-f="overlay"></div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(f: string): T => mount.querySelector(`[data-f="${f}"]`) as T;

  let qs: QuizQuestion[] = [];
  let idx = 0;
  let score = 0;
  let combo = 0;
  let best = 0;
  let shield = 3;
  let right = 0;
  let wrong = 0;
  let chestCount = 0;
  let startedAt = 0;
  let picks = new Set<string>();
  let chosen: Record<string, string> = {};
  let graded: Record<string, boolean> = {};
  let locked = false;
  let running = false;
  let paused = false;
  let muted = false;
  let timer: number | null = null;
  let pendingChest: (() => void) | null = null;
  let game: Phaser.Game | null = null;
  let bridge: Bridge | null = null;
  let onReady: (() => void) | null = null;

  const clearTimer = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const snap = (finished = false): QuizSnapshot => ({
    ids: qs.map((q) => q.id),
    index: idx,
    chosen: { ...chosen },
    graded: { ...graded },
    elapsed: Math.round((Date.now() - startedAt) / 1000),
    finished,
    instant: true,
  });

  /* ---------------------------- Phaser 场景 ---------------------------- */

  function buildScene(s: Phaser.Scene): void {
    const tex = s.add.graphics();
    tex.fillStyle(0xffffff, 1);
    tex.fillRect(0, 0, 8, 8);
    tex.generateTexture('arc-px', 8, 8);
    tex.destroy();

    const grid = s.add.graphics();
    grid.lineStyle(1, 0x1b2a5e, 0.75);
    for (let y = H - 96; y < H; y += 18) grid.lineBetween(0, y, W, y);
    for (let x = -W; x < W * 2; x += 80) grid.lineBetween(W / 2 + (x - W / 2) * 0.22, H - 96, x, H);

    const stars: Star[] = [];
    for (let i = 0; i < 84; i += 1) {
      const obj = s.add.rectangle(
        Math.random() * W,
        Math.random() * H,
        Math.random() * 2 + 1,
        Math.random() * 2 + 1,
        0x9ec5ff,
        Math.random() * 0.55 + 0.15,
      );
      stars.push({ obj, sp: 8 + Math.random() * 26 });
    }

    const ship = s.add.container(W / 2, H - 42);
    const halo = s.add.circle(0, 6, 32, 0x22d3ee, 0.12);
    const body = s.add.graphics();
    body.fillStyle(0x7c5cff, 1);
    body.fillTriangle(-20, 15, 20, 15, 0, -22);
    body.lineStyle(2, 0x7ef0ff, 1);
    body.strokeTriangle(-20, 15, 20, 15, 0, -22);
    ship.add([halo, body, s.add.circle(0, 0, 5, 0xffffff, 0.9)]);
    s.tweens.add({ targets: halo, scale: 1.45, alpha: 0.03, duration: 900, yoyo: true, repeat: -1 });

    bridge = { scene: s, ship, stars, crystals: [] };
    s.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!bridge || paused || locked) return;
      bridge.ship.x = Phaser.Math.Clamp(p.x, 40, W - 40);
    });
  }

  function tickStars(delta: number): void {
    if (paused || !bridge) return;
    for (const st of bridge.stars) {
      st.obj.y += (st.sp * delta) / 1000;
      if (st.obj.y > H) {
        st.obj.y = -2;
        st.obj.x = Math.random() * W;
      }
    }
  }

  class Arena extends Phaser.Scene {
    constructor() {
      super('arcade-arena');
    }
    create(): void {
      buildScene(this);
      onReady?.();
      onReady = null;
    }
    update(_t: number, delta: number): void {
      tickStars(delta);
    }
  }

  function ensureGame(): Promise<void> {
    if (game) return Promise.resolve();
    return new Promise((resolve) => {
      onReady = resolve;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: $('arena'),
        width: W,
        height: H,
        backgroundColor: '#080d22',
        audio: { noAudio: true },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [Arena],
      });
    });
  }

  function burst(x: number, y: number, color: number, n: number): void {
    if (!bridge) return;
    const s = bridge.scene;
    const em = s.add.particles(x, y, 'arc-px', {
      speed: { min: 60, max: 250 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 480,
      tint: color,
      blendMode: 'ADD',
      emitting: false,
    });
    em.explode(n);
    s.time.delayedCall(620, () => em.destroy());
  }

  function cheer(text: string): void {
    if (!bridge) return;
    const t = bridge.scene.add
      .text(W / 2, 132, text, { fontFamily: 'ui-monospace, monospace', fontSize: '30px', fontStyle: 'bold', color: '#7ef0ff' })
      .setOrigin(0.5);
    bridge.scene.tweens.add({ targets: t, y: 74, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  function clearCrystals(): void {
    if (!bridge) return;
    bridge.crystals.forEach((c) => c.destroy());
    bridge.crystals = [];
  }

  function spawn(labels: string[]): void {
    if (!bridge) return;
    const s = bridge.scene;
    clearCrystals();
    const n = labels.length;
    labels.forEach((label, i) => {
      const x = n === 1 ? W / 2 : 160 + (i * 640) / (n - 1);
      const y = 156 + (i % 2 ? 36 : -14);
      const color = COLORS[i % COLORS.length];
      const c = s.add.container(x, -90);
      const bob = s.add.container(0, 0);
      c.add(bob);
      bob.add([
        s.add.circle(0, 0, 58, color, 0.1),
        s.add.circle(0, 0, 47, 0x0c1636, 1).setStrokeStyle(3, color, 0.9),
        s.add.circle(0, 0, 37, color, 0.16),
        s.add
          .text(0, 0, label, { fontFamily: 'ui-monospace, monospace', fontSize: '38px', fontStyle: 'bold', color: '#ffffff' })
          .setOrigin(0.5),
      ]);
      c.setSize(114, 114);
      c.setInteractive(new Phaser.Geom.Rectangle(-57, -57, 114, 114), Phaser.Geom.Rectangle.Contains);
      c.setData('label', label);
      c.setData('color', color);
      c.on('pointerover', () => s.tweens.add({ targets: bob, scale: 1.12, duration: 140 }));
      c.on('pointerout', () => s.tweens.add({ targets: bob, scale: 1, duration: 140 }));
      c.on('pointerdown', () => onPick(label));
      s.tweens.add({ targets: c, y, duration: 480, delay: i * 70, ease: 'Back.easeOut' });
      s.tweens.add({ targets: bob, y: -12, duration: 1400 + i * 170, delay: 500 + i * 70, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      bridge!.crystals.push(c);
    });
  }

  function fire(label: string, done: () => void): void {
    if (!bridge) {
      done();
      return;
    }
    audio.play('shoot');
    const s = bridge.scene;
    const c = bridge.crystals.find((x) => x.getData('label') === label);
    if (!c) {
      done();
      return;
    }
    const ship = bridge.ship;
    s.tweens.add({ targets: ship, x: c.x, duration: 170, ease: 'Sine.easeOut' });
    const a = s.add.graphics();
    a.lineStyle(14, 0x7c5cff, 0.32);
    a.lineBetween(ship.x, H - 60, c.x, c.y);
    const b = s.add.graphics();
    b.lineStyle(4, 0x7ef0ff, 1);
    b.lineBetween(ship.x, H - 60, c.x, c.y);
    s.tweens.add({ targets: [a, b], alpha: 0, duration: 240, onComplete: () => { a.destroy(); b.destroy(); } });
    burst(c.x, c.y, c.getData('color') as number, 10);
    window.setTimeout(done, 230);
  }

  function resolve(pick: string[], correct: string[], ok: boolean): void {
    if (!bridge) return;
    const s = bridge.scene;
    for (const c of bridge.crystals) {
      const label = c.getData('label') as string;
      const isRight = correct.includes(label);
      const isPick = pick.includes(label);
      if (ok && isRight) {
        burst(c.x, c.y, 0x34d399, 30);
        s.tweens.add({ targets: c, scale: 1.5, alpha: 0, duration: 380, ease: 'Back.easeIn' });
        s.cameras.main.flash(160, 60, 220, 180);
      } else if (!ok && isPick) {
        s.tweens.add({ targets: c, x: c.x + 9, duration: 55, yoyo: true, repeat: 4 });
        s.cameras.main.shake(220, 0.006);
      } else if (!ok && isRight) {
        s.tweens.add({ targets: c, scale: 1.18, duration: 260, yoyo: true, repeat: 2 });
      } else {
        s.tweens.add({ targets: c, alpha: 0.24, duration: 300 });
      }
    }
  }

  /* ---------------------------- UI ---------------------------- */

  function meters(): void {
    $('level').textContent = String(Math.floor(idx / 5) + 1);
    $('prog').textContent = `${idx}/${qs.length}`;
    $('score').textContent = String(score);
    $('combo').textContent = String(combo);
    $('shield').innerHTML = '♥'.repeat(shield) + `<span>${'♥'.repeat(3 - shield)}</span>`;
    $('combo').parentElement?.classList.toggle('is-hot', combo >= 3);
  }

  function showOverlay(html: string): void {
    const ov = $('overlay');
    ov.innerHTML = html;
    ov.classList.add('is-on');
  }

  function hideOverlay(): void {
    const ov = $('overlay');
    ov.classList.remove('is-on');
    ov.innerHTML = '';
  }

  function toast(kind: 'ok' | 'bad', title: string, detail: string): void {
    const t = $('toast');
    t.className = `arc-toast is-${kind}`;
    t.innerHTML = `<b>${esc(title)}</b>${detail ? `<span>${esc(detail).slice(0, 180)}</span>` : ''}`;
  }

  function showIntro(): void {
    showOverlay(`
      <div class="arc-card is-intro">
        <div class="arc-logo">◈</div>
        <h2>星际答题 <span>QUIZ BLASTER</span></h2>
        <p class="arc-lead">把正确答案打下来。每道题化作能量水晶，点击水晶或按 1–4 发射激光。</p>
        <ul class="arc-rules">
          <li>答对累积连击，分数最高 ×5 倍率</li>
          <li>连击 3 次开启知识宝箱，收下背诵要点</li>
          <li>答错扣护盾、亮出正确答案与解析，短暂停顿后自动进入下一题</li>
          <li>键盘 1–8 / A–H 选择，Enter 确认多选，Esc 暂停</li>
        </ul>
        <div class="arc-meta">本卷 <b>${qs.length}</b> 题 · 2D 引擎 Phaser 3 · 音效 Howler.js</div>
        ${(host?.variants ?? []).length
          ? `<div class="arc-variants">${(host?.variants ?? [])
              .map((v) => `<button class="arc-ghost" type="button" data-variant="${esc(v.id)}">${esc(v.label)}</button>`)
              .join('')}</div>`
          : ''}
        <button class="arc-primary" type="button" data-act="start">开始闯关 →</button>
      </div>`);
  }

  function showChest(done: () => void): void {
    const note = notes.length ? notes[chestCount % notes.length] : null;
    chestCount += 1;
    pendingChest = done;
    audio.play('chest');
    const title = note ? note.label : '连击奖励';
    const detail = note ? note.detail : qs[idx]?.analysis || '保持节奏，继续连击！';
    showOverlay(`
      <div class="arc-card is-chest">
        <div class="arc-chest">◈</div>
        <h2>知识宝箱</h2>
        <b>${esc(title)}</b>
        <p>${esc(detail).replace(/\n/g, '<br>')}</p>
        <button class="arc-primary" type="button" data-act="chest">收下 +200 分 →</button>
      </div>`);
  }

  function showResult(r: QuizResult): void {
    const acc = r.total ? Math.round((r.correct / r.total) * 100) : 0;
    const stars = acc >= 90 ? 3 : acc >= 70 ? 2 : acc >= 50 ? 1 : 0;
    showOverlay(`
      <div class="arc-card is-result">
        <div class="arc-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <h2>通关！</h2>
        <div class="arc-grid">
          <span><b>${acc}%</b>正确率</span>
          <span><b>${r.score}</b>得分</span>
          <span><b>${best}</b>最高连击</span>
          <span><b>${fmtTime(r.elapsed)}</b>用时</span>
        </div>
        <p class="arc-meta">共 ${r.total} 题 · 答对 ${r.correct} · 答错 ${r.wrong} · 未答 ${r.unanswered}</p>
        <div class="arc-btns">
          <button class="arc-primary" type="button" data-act="again">再来一局</button>
          <button class="arc-ghost" type="button" data-act="wrongbook">查看错题</button>
          <button class="arc-ghost" type="button" data-act="exit">退出</button>
        </div>
      </div>`);
  }

  /* ---------------------------- 答题循环 ---------------------------- */

  function loadQuestion(i: number): void {
    clearTimer();
    if (i >= qs.length) return finish();
    idx = i;
    locked = false;
    picks = new Set<string>();
    const q = qs[i];
    $('qtag').textContent = `Q${i + 1} / ${qs.length} · ${q.typeName}`;
    $('stem').innerHTML = q.stem.split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
    $('bar').style.width = `${(i / qs.length) * 100}%`;
    $('toast').className = 'arc-toast';
    $('toast').innerHTML = '';
    $('opts').innerHTML =
      q.options
        .map((o, k) => `<button class="arc-opt" type="button" data-pick="${esc(o.label)}"><b>${esc(o.label)}</b><span>${esc(o.text)}</span><i>${k + 1}</i></button>`)
        .join('') + (isMulti(q) ? '<button class="arc-fire" type="button" data-act="confirm">发射（0）</button>' : '');
    meters();
    spawn(q.options.map((o) => o.label));
    if (bridge) {
      const s = bridge.scene;
      const banner = s.add
        .text(W / 2, 92, `WAVE ${i + 1}`, { fontFamily: 'ui-monospace, monospace', fontSize: '26px', fontStyle: 'bold', color: '#7c5cff' })
        .setOrigin(0.5)
        .setAlpha(0);
      s.tweens.add({ targets: banner, alpha: 0.9, y: 66, duration: 260, yoyo: true, hold: 240, onComplete: () => banner.destroy() });
    }
    audio.play('tick');
  }

  function onPick(label: string): void {
    if (!running || locked || paused) return;
    const q = qs[idx];
    if (!q.options.some((o) => o.label === label)) return;
    if (isMulti(q)) {
      if (picks.has(label)) picks.delete(label);
      else picks.add(label);
      $('opts').querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.classList.toggle('is-picked', picks.has(b.dataset.pick || '')));
      const btn = $('opts').querySelector<HTMLElement>('.arc-fire');
      if (btn) btn.textContent = `发射（${picks.size}）`;
      audio.play('tick');
      return;
    }
    grade(label);
  }

  function grade(single: string): void {
    if (locked || !running) return;
    locked = true;
    const q = qs[idx];
    const pick = isMulti(q) ? [...picks].sort().join('') : single;
    const chosenLabels = pick ? labelsOf(pick) : [];
    const correct = labelsOf(q.answer);
    const ok = isCorrect(q, pick);
    chosen[q.id] = pick;
    graded[q.id] = true;

    fire(chosenLabels[0] || q.options[0].label, () => {
      resolve(chosenLabels, correct, ok);
      if (ok) {
        right += 1;
        combo += 1;
        best = Math.max(best, combo);
        const gain = 100 * Math.min(5, combo);
        score += gain;
        audio.play('right');
        if (combo >= 2) audio.play('combo', combo - 2);
        cheer(`+${gain}${combo >= 2 ? `  ×${combo} COMBO` : ''}`);
        toast('ok', `命中！正确答案 ${q.answer}`, q.analysis);
      } else {
        wrong += 1;
        combo = 0;
        shield = Math.max(0, shield - 1);
        audio.play('hit');
        window.setTimeout(() => audio.play('wrong'), 90);
        toast('bad', `未命中，正确答案 ${q.answer}`, q.analysis);
      }
      meters();
      $('opts').querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => {
        const l = b.dataset.pick || '';
        b.classList.toggle('is-right', correct.includes(l));
        b.classList.toggle('is-wrong', chosenLabels.includes(l) && !correct.includes(l));
      });
      host?.onGrade(q, pick, ok);
      host?.onStateChange(snap());
      timer = window.setTimeout(() => {
        if (ok && combo > 0 && combo % 3 === 0) showChest(() => loadQuestion(idx + 1));
        else loadQuestion(idx + 1);
      }, ok ? opts.pace.right : opts.pace.wrong);
    });
  }

  function finish(): void {
    clearTimer();
    running = false;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const r: QuizResult = {
      total: qs.length,
      answered: right + wrong,
      correct: right,
      wrong,
      unanswered: qs.length - right - wrong,
      score,
      fullScore: qs.length * 100,
      elapsed,
      wrongQuestions: qs.filter((q) => !isCorrect(q, chosen[q.id] || '')),
    };
    host?.onStateChange(snap(true));
    host?.onFinish(r);
    audio.play('win');
    if (bridge) bridge.scene.cameras.main.flash(320, 90, 220, 190);
    showResult(r);
  }

  function reset(): void {
    clearTimer();
    idx = 0; score = 0; combo = 0; best = 0; shield = 3; right = 0; wrong = 0;
    chestCount = 0; startedAt = 0;
    picks = new Set<string>();
    chosen = {}; graded = {};
    locked = false; running = false; paused = false;
    pendingChest = null;
    game?.destroy(true);
    game = null;
    bridge = null;
    meters();
  }

  function pause(): void {
    if (!running || !game) return;
    paused = !paused;
    if (paused) {
      game.scene.pause('arcade-arena');
      showOverlay('<div class="arc-card is-pause"><h2>已暂停</h2><p class="arc-meta">休息一下，随时继续。</p><button class="arc-primary" type="button" data-act="resume">继续闯关 →</button></div>');
    } else {
      game.scene.resume('arcade-arena');
      hideOverlay();
    }
  }

  function exit(): void {
    clearTimer();
    running = false;
    paused = false;
    pendingChest = null;
    game?.destroy(true);
    game = null;
    bridge = null;
    host?.onClose();
    mount.classList.remove('is-live');
    hideOverlay();
    showIntro();
  }

  function launch(questions: QuizQuestion[]): void {
    qs = questions.filter((q) => q.options.length >= 2);
    if (!qs.length) {
      showOverlay('<div class="arc-card"><h2>暂无可答题</h2><p class="arc-meta">本卷没有带选项的客观题。</p></div>');
      return;
    }
    reset();
    host?.onLaunch?.();
    mount.classList.add('is-live');
    mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showIntro();
  }

  async function start(): Promise<void> {
    host?.onLaunch?.();
    hideOverlay();
    running = true;
    paused = false;
    startedAt = Date.now();
    await ensureGame();
    if (!running) return;
    loadQuestion(0);
  }

  /* ---------------------------- 事件 ---------------------------- */

  function onClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement;
    const pick = target.closest<HTMLElement>('[data-pick]');
    if (pick) {
      onPick(pick.dataset.pick || '');
      return;
    }
    const variant = target.closest<HTMLElement>('[data-variant]');
    if (variant) {
      const v = (host?.variants ?? []).find((x) => x.id === variant.dataset.variant);
      const list = v?.questions.filter((q) => q.options.length >= 2) ?? [];
      if (list.length) {
        qs = list;
        reset();
        void start();
      }
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'start': void start(); break;
      case 'confirm': grade(''); break;
      case 'chest': {
        score += 200;
        meters();
        hideOverlay();
        const next = pendingChest;
        pendingChest = null;
        next?.();
        break;
      }
      case 'again':
        qs = (host?.questions?.length ? host.questions : qs).filter((q) => q.options.length >= 2);
        reset();
        void start();
        break;
      case 'sound':
        muted = !muted;
        audio.mute(muted);
        act.textContent = muted ? '音效 关' : '音效 开';
        break;
      case 'pause': pause(); break;
      case 'resume': pause(); break;
      case 'exit': exit(); break;
      case 'wrongbook': location.href = '/zsb/wrong/'; break;
      default: break;
    }
  }

  function onKey(ev: KeyboardEvent): void {
    if (!running || paused) {
      if (ev.key === 'Escape' && running) pause();
      return;
    }
    const k = ev.key.toUpperCase();
    if (k === 'ESCAPE') {
      ev.preventDefault();
      pause();
      return;
    }
    if (locked) return;
    const q = qs[idx];
    if (/^[1-8]$/.test(k)) {
      const o = q?.options[Number(k) - 1];
      if (o) { ev.preventDefault(); onPick(o.label); }
    } else if (/^[A-H]$/.test(k) && q?.options.some((o) => o.label === k)) {
      ev.preventDefault();
      onPick(k);
    } else if (k === 'ENTER' && isMulti(q)) {
      ev.preventDefault();
      grade('');
    }
  }

  mount.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  meters();

  return {
    launch,
    destroy(): void {
      clearTimer();
      mount.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      audio.destroy();
      game?.destroy(true);
      game = null;
      bridge = null;
      mount.innerHTML = '';
    },
  };
}
