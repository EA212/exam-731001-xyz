import Phaser from 'phaser';
import { RARITY_COLOR } from './model';

const W = 480;
const H = 560;
const CX = W / 2;
const CY = 258;
const R = 176;

export interface WheelRound {
  options: { label: string; text: string }[];
  multi: boolean;
  answer: string;
}
export interface WheelResult { pick: string; ok: boolean }

export interface Engine {
  wheel(round: WheelRound, onTick: () => void): Promise<WheelResult>;
  chest(reward: { label: string; rarity: number }): Promise<void>;
  pause(v: boolean): void;
  destroy(): void;
}

const short = (s: string): string => {
  const t = s.replace(/\s+/g, '');
  return t.length > 7 ? t.slice(0, 7) + '…' : t;
};
const norm = (a: number): number => (a + Math.PI * 2 * 4) % (Math.PI * 2);

export function createEngine(parent: HTMLElement, ok: (pick: string) => boolean): Promise<Engine> {
  return new Promise((ready) => {
    let game: Phaser.Game;
    let scene: Phaser.Scene;
    let gone = false;
    let paused = false;
    let tap: ((x: number, y: number) => void) | null = null;
    let resolveWheel: ((r: WheelResult) => void) | null = null;
    let disc: Phaser.GameObjects.Container | null = null;
    let labels: Phaser.GameObjects.Text[] = [];
    let decor: Phaser.GameObjects.GameObject[] = [];
    let stars: Phaser.GameObjects.Arc[] = [];

    const clear = (): void => {
      tap = null;
      disc?.destroy(true);
      disc = null;
      labels = [];
      for (const d of decor) d.destroy();
      decor = [];
    };

    const spark = (x: number, y: number, color: number, n = 18): void => {
      const p = scene.add.particles(x, y, 'q-spark', {
        speed: { min: 60, max: 260 }, angle: { min: 0, max: 360 },
        scale: { start: 0.9, end: 0 }, lifespan: { min: 260, max: 620 },
        tint: color, quantity: n, emitting: false,
      });
      p.explode(n);
      scene.time.delayedCall(680, () => p.destroy());
    };

    const drawWheel = (round: WheelRound, onTick: () => void): void => {
      clear();
      const n = Math.max(2, Math.min(8, round.options.length));
      const step = (Math.PI * 2) / n;
      const g = scene.add.graphics();
      const pal = [0x2a3f7a, 0x33498c, 0x3a5299, 0x2c447f, 0x4056a0, 0x314784, 0x3b5196, 0x294070];
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * step - step / 2;
        g.fillStyle(pal[i % pal.length], 1);
        g.slice(0, 0, R, a0, a0 + step, false);
        g.fillPath();
        g.lineStyle(2, 0x0a1230, 0.9);
        g.lineBetween(0, 0, Math.cos(a0) * R, Math.sin(a0) * R);
      }
      g.lineStyle(4, 0xffd166, 0.9);
      g.strokeCircle(0, 0, R);
      const rim = scene.add.circle(0, 0, R + 10, 0x000000, 0).setStrokeStyle(6, 0x6c8cff, 0.32);
      const hub = scene.add.circle(0, 0, 36, 0x0c1738, 1).setStrokeStyle(3, 0xffd166, 0.95);
      const hubText = scene.add.text(0, 0, round.multi ? '确定' : 'GO', {
        fontFamily: 'system-ui,sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffd166',
      }).setOrigin(0.5);
      disc = scene.add.container(CX, CY, [rim, g, hub, hubText]);

      round.options.slice(0, n).forEach((o, i) => {
        const mid = -Math.PI / 2 + i * step;
        const rr = R * 0.62;
        const t = scene.add.text(Math.cos(mid) * rr, Math.sin(mid) * rr, `${o.label}\n${short(o.text)}`, {
          fontFamily: 'system-ui,sans-serif', fontSize: n > 5 ? '12px' : '14px', color: '#eaf0ff',
          align: 'center', wordWrap: { width: R * 0.5 }, lineSpacing: 2,
        }).setOrigin(0.5);
        labels.push(t);
        disc?.add(t);
      });

      const pointer = scene.add.triangle(CX, CY - R - 14, 0, 24, 12, 0, 24, 24, 0xffd166, 1);
      const knob = scene.add.circle(CX, CY - R - 32, 5, 0xff8a5b, 1);
      decor.push(pointer, knob);

      const picked = new Set<string>();
      const paint = (): void => {
        labels.forEach((t, k) => t.setColor(picked.has(round.options[k].label) ? '#ffd166' : '#eaf0ff'));
      };
      let spinning = false;
      const confirm = (): void => {
        if (spinning || !disc || picked.size === 0) return;
        spinning = true;
        tap = null;
        const first = round.options.findIndex((o) => o.label === [...picked][0]);
        const delta = -first * (360 / n);
        const loops = 2 + Math.floor(Math.random() * 2);
        scene.tweens.add({
          targets: disc,
          angle: disc.angle + 360 * loops + delta,
          duration: 760 + loops * 130,
          ease: 'Cubic.easeOut',
          onUpdate: () => { if (Math.random() < 0.2) onTick(); },
          onComplete: () => {
            const pick = [...picked].sort().join('');
            const good = ok(pick);
            const color = good ? 0x53d6a8 : 0xff5b6e;
            scene.cameras.main.flash(160, (color >> 16) & 255, (color >> 8) & 255, color & 255);
            if (good) spark(CX, CY - R * 0.5, 0xffd166, 26);
            else scene.cameras.main.shake(180, 0.006);
            const r = resolveWheel;
            resolveWheel = null;
            r?.({ pick, ok: good });
          },
        });
      };
      tap = (x, y): void => {
        const d = Math.hypot(x - CX, y - CY);
        if (d < 38) { if (round.multi) confirm(); return; }
        if (d > R + 14) return;
        const ang = Math.atan2(y - CY, x - CX);
        const idx = Math.round(norm(ang + Math.PI / 2) / step) % n;
        const label = round.options[idx].label;
        if (round.multi) {
          if (picked.has(label)) picked.delete(label); else picked.add(label);
          paint();
        } else {
          picked.add(label);
          paint();
          confirm();
        }
      };
    };

    const engine: Engine = {
      wheel(round, onTick) {
        drawWheel(round, onTick);
        return new Promise((resolve) => { resolveWheel = resolve; });
      },
      chest(reward) {
        clear();
        return new Promise((resolve) => {
          const color = RARITY_COLOR[reward.rarity] ?? 0xffd166;
          const glow = scene.add.circle(0, 0, 76, color, 0.14);
          const body = scene.add.rectangle(0, 8, 118, 88, 0x7a4a1e, 1).setStrokeStyle(4, color, 0.95);
          const lid = scene.add.rectangle(0, -40, 126, 30, 0x9a5f28, 1).setStrokeStyle(4, color, 0.95);
          const lock = scene.add.circle(0, 10, 12, color, 1);
          const band = scene.add.rectangle(0, 8, 118, 12, color, 0.6);
          const box = scene.add.container(CX, -70, [glow, body, lid, lock, band]);
          box.setScale(0.9);
          disc = box;
          const beam = scene.add.rectangle(CX, CY, 12, H, color, 0.5).setScale(1, 0);
          decor.push(beam);
          scene.tweens.add({
            targets: box, y: CY, duration: 480, ease: 'Bounce.easeOut',
            onComplete: () => {
              const wob = scene.tweens.add({ targets: box, angle: { from: -4, to: 4 }, duration: 130, yoyo: true, repeat: -1 });
              let opened = false;
              const open = (): void => {
                if (opened) return;
                opened = true;
                tap = null;
                wob.stop();
                box.setAngle(0);
                scene.tweens.add({ targets: lid, y: -100, angle: -20, alpha: 0, duration: 320, ease: 'Cubic.easeOut' });
                scene.tweens.add({ targets: [lock, band], alpha: 0, duration: 220 });
                scene.tweens.add({ targets: glow, scale: 2.6, alpha: 0, duration: 520 });
                scene.tweens.add({ targets: beam, scaleY: 1, alpha: 0, duration: 560 });
                spark(CX, CY - 16, color, 18 + reward.rarity * 12);
                if (reward.rarity >= 2) scene.cameras.main.flash(220, (color >> 16) & 255, (color >> 8) & 255, color & 255);
                if (reward.rarity >= 3) scene.cameras.main.shake(240, 0.008);
                const title = scene.add.text(CX, CY - 150, reward.label, {
                  fontFamily: 'system-ui,sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffd166',
                }).setOrigin(0.5).setScale(0.6).setAlpha(0);
                decor.push(title);
                scene.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 360, ease: 'Back.easeOut' });
                scene.time.delayedCall(760, () => { clear(); resolve(); });
              };
              tap = (): void => open();
              scene.time.delayedCall(1000, open);
            },
          });
        });
      },
      pause(v) {
        paused = v;
        if (!scene) return;
        if (v) { scene.tweens.pauseAll(); scene.time.paused = true; }
        else { scene.tweens.resumeAll(); scene.time.paused = false; }
      },
      destroy() {
        if (gone) return;
        gone = true;
        const r = resolveWheel;
        resolveWheel = null;
        r?.({ pick: '', ok: false });
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
          g.generateTexture('q-spark', 12, 12);
          g.destroy();
          for (let i = 0; i < 40; i++) {
            const s = this.add.circle(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), Phaser.Math.FloatBetween(0.6, 1.7), 0xbcd2ff, Phaser.Math.FloatBetween(0.12, 0.5));
            stars.push(s);
          }
          this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (!paused && tap) tap(p.x, p.y);
          });
          ready(engine);
        },
        update(_t: number, delta: number): void {
          if (paused) return;
          for (const s of stars) {
            s.y += delta * 0.01;
            if (s.y > H) { s.y = 0; s.x = Phaser.Math.Between(0, W); }
          }
        },
      },
    });
  });
}
