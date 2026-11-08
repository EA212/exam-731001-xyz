import Phaser from 'phaser';

export interface OrbSpec { label: string; text: string }
export interface Round {
  options: OrbSpec[];
  rights: string[];
  speed: number;
  chest?: string;
}
export interface RoundResult {
  caught: string[];
  ok: boolean;
  wrong: boolean;
  chest: boolean;
}
export interface Field {
  drop(round: Round): Promise<RoundResult>;
  moveTo(x: number): void;
  pause(v: boolean): void;
  destroy(): void;
}

const W = 480;
const H = 780;
const PADDLE_Y = H - 82;
const CATCH_HALF = 54;
const COLORS = [0x5b8cff, 0x9a6bff, 0x36c9a8, 0xff8a5b, 0xff5b8f, 0x5bd0ff];

interface Orb {
  obj: Phaser.GameObjects.Container;
  label: string;
  right: boolean;
  chest: boolean;
  vy: number;
  alive: boolean;
}

const short = (s: string): string => {
  const t = s.replace(/\s+/g, '');
  return t.length > 6 ? t.slice(0, 6) + '…' : t;
};

export function createField(parent: HTMLElement): Promise<Field> {
  return new Promise((ready) => {
    let game: Phaser.Game;
    let scene: Phaser.Scene;
    let paddle: Phaser.GameObjects.Container;
    let targetX = W / 2;
    let orbs: Orb[] = [];
    let stars: Phaser.GameObjects.Arc[] = [];
    let settle: ((r: RoundResult) => void) | null = null;
    let caught: string[] = [];
    let remaining = 0;
    let failed = false;
    let chestGot = false;
    let active = false;
    let paused = false;
    let gone = false;

    const clamp = (x: number): number => Phaser.Math.Clamp(x, CATCH_HALF, W - CATCH_HALF);

    function burst(x: number, y: number, color: number, n = 16): void {
      const p = scene.add.particles(x, y, 'spark', {
        speed: { min: 70, max: 240 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.95, end: 0 },
        lifespan: { min: 240, max: 520 },
        tint: color,
        quantity: n,
        emitting: false,
      });
      p.explode(n);
      scene.time.delayedCall(620, () => p.destroy());
    }

    function kill(o: Orb): void {
      o.alive = false;
      burst(o.obj.x, o.obj.y, o.chest ? 0xffd166 : COLORS[0]);
      scene.tweens.add({ targets: o.obj, scale: 0, alpha: 0, duration: 180, onComplete: () => o.obj.destroy() });
    }

    function finish(ok: boolean): void {
      if (!active) return;
      active = false;
      for (const o of orbs) if (o.alive) {
        o.alive = false;
        scene.tweens.add({ targets: o.obj, alpha: 0, duration: 200, onComplete: () => o.obj.destroy() });
      }
      orbs = [];
      const done = settle;
      settle = null;
      done?.({ caught: caught.slice(), ok, wrong: !ok, chest: chestGot });
    }

    function take(o: Orb): void {
      if (o.chest) {
        chestGot = true;
        burst(o.obj.x, o.obj.y, 0xffd166, 26);
        o.alive = false;
        scene.tweens.add({ targets: o.obj, scale: 1.5, alpha: 0, duration: 240, onComplete: () => o.obj.destroy() });
        return;
      }
      kill(o);
      if (o.right) {
        caught.push(o.label);
        remaining -= 1;
        if (remaining <= 0) {
          scene.cameras.main.flash(150, 90, 150, 255);
          finish(true);
        }
      } else {
        failed = true;
        scene.cameras.main.shake(200, 0.008);
        finish(false);
      }
    }

    function miss(o: Orb): void {
      o.alive = false;
      o.obj.destroy();
      if (o.right) {
        failed = true;
        finish(false);
      }
    }

    function makeOrb(x: number, y: number, spec: OrbSpec, right: boolean, chest: boolean, vy: number): void {
      const color = chest ? 0xffc94a : COLORS[orbs.length % COLORS.length];
      const halo = scene.add.circle(0, 0, 40, color, 0.16);
      const body = scene.add.circle(0, 0, 30, 0x0c1636, 0.96).setStrokeStyle(3, color, 0.95);
      const label = scene.add.text(0, -7, chest ? '★' : spec.label, {
        fontFamily: 'system-ui, sans-serif', fontSize: chest ? '26px' : '22px', fontStyle: 'bold', color: '#ffffff',
      }).setOrigin(0.5);
      const note = scene.add.text(0, 16, chest ? '知识宝箱' : short(spec.text), {
        fontFamily: 'system-ui, sans-serif', fontSize: '11px', color: '#b9c9f5',
      }).setOrigin(0.5);
      const obj = scene.add.container(x, y, [halo, body, label, note]);
      scene.tweens.add({ targets: halo, scale: 1.18, duration: 720, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      orbs.push({ obj, label: spec.label, right, chest, vy, alive: true });
    }

    const field: Field = {
      drop(round: Round): Promise<RoundResult> {
        for (const o of orbs) o.obj.destroy();
        orbs = [];
        caught = [];
        chestGot = false;
        failed = false;
        const rights = new Set(round.rights);
        remaining = round.options.filter((o) => rights.has(o.label)).length;
        const n = round.options.length;
        round.options.forEach((spec, i) => {
          const x = Phaser.Math.Clamp(W * (i + 0.5) / n + Phaser.Math.Between(-12, 12), 46, W - 46);
          makeOrb(x, -50 - i * 78, spec, rights.has(spec.label), false, round.speed * (0.94 + Math.random() * 0.12));
        });
        if (round.chest) {
          makeOrb(Phaser.Math.Between(70, W - 70), -50 - n * 78, { label: '★', text: '' }, false, true, round.speed * 0.9);
        }
        active = true;
        return new Promise((res) => { settle = res; });
      },
      moveTo(x: number): void { targetX = clamp(x); },
      pause(v: boolean): void { paused = v; },
      destroy(): void {
        if (gone) return;
        gone = true;
        const done = settle;
        settle = null;
        done?.({ caught: [], ok: false, wrong: true, chest: false });
        game.destroy(true);
      },
    };

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: W,
      height: H,
      transparent: true,
      banner: false,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: {
        create(this: Phaser.Scene): void {
          scene = this;
          const g = this.add.graphics();
          g.fillStyle(0xffffff, 1);
          g.fillCircle(6, 6, 6);
          g.generateTexture('spark', 12, 12);
          g.destroy();

          for (let i = 0; i < 36; i++) {
            const s = this.add.circle(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), Phaser.Math.FloatBetween(0.7, 1.8), 0xbcd2ff, Phaser.Math.FloatBetween(0.15, 0.55));
            stars.push(s);
          }

          this.add.rectangle(W / 2, PADDLE_Y + 28, W, 2, 0x3a4f8a, 0.55);
          const base = this.add.graphics();
          base.fillStyle(0x0c1738, 0.94);
          base.fillRoundedRect(-72, -15, 144, 32, 15);
          base.lineStyle(3, 0x719dff, 0.95);
          base.strokeRoundedRect(-72, -15, 144, 32, 15);
          const beam = this.add.rectangle(0, -15, 118, 4, 0xa8c4ff, 0.9);
          const core = this.add.circle(0, 1, 7, 0xffd166, 1);
          paddle = this.add.container(W / 2, PADDLE_Y, [base, beam, core]);

          this.input.on('pointermove', (p: Phaser.Input.Pointer) => { targetX = clamp(p.x); });
          this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { targetX = clamp(p.x); });
          ready(field);
        },
        update(this: Phaser.Scene, _t: number, delta: number): void {
          const k = Math.min(1, (delta / 1000) * 16);
          paddle.x += (targetX - paddle.x) * k;
          for (const s of stars) {
            s.y += delta * 0.012;
            if (s.y > H) { s.y = 0; s.x = Phaser.Math.Between(0, W); }
          }
          if (!active || paused) return;
          for (const o of orbs) {
            if (!o.alive) continue;
            o.obj.y += o.vy * (delta / 1000);
            if (o.obj.y >= PADDLE_Y - 30 && o.obj.y <= PADDLE_Y + 30 && Math.abs(o.obj.x - paddle.x) <= CATCH_HALF) {
              take(o);
              if (!active) return;
              continue;
            }
            if (o.obj.y > H + 48) {
              miss(o);
              if (!active) return;
            }
          }
          if (!orbs.some((o) => o.alive) && !failed) finish(false);
        },
      },
    });
  });
}
