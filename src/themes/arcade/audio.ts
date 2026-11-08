import { Howl, Howler } from 'howler';

export type Sfx = 'shoot' | 'hit' | 'right' | 'wrong' | 'combo' | 'chest' | 'win' | 'tick';

const RATE = 22050;

function wav(dur: number, sample: (t: number) => number): string {
  const n = Math.floor(RATE * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i));
  };
  put(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); put(8, 'WAVE'); put(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const env = Math.min(1, t * 180) * Math.min(1, (dur - t) * 20);
    const s = Math.max(-1, Math.min(1, sample(t) * env));
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

type Note = [number, number, number, number, number];

const seq = (dur: number, notes: Note[]): string =>
  wav(dur, (t) => {
    let out = 0;
    for (const [at, len, f0, f1, vol] of notes) {
      const lt = t - at;
      if (lt < 0 || lt >= len) continue;
      const env = Math.min(1, lt * 220) * Math.min(1, (len - lt) * 26);
      out += Math.sin(2 * Math.PI * (f0 * lt + ((f1 - f0) * lt * lt) / (2 * len))) * vol * env;
    }
    return out;
  });

const chirp = (dur: number, f0: number, f1: number, vol: number, saw = false): string =>
  wav(dur, (t) => {
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * dur));
    return (saw ? 2 * ((phase / (2 * Math.PI)) % 1) - 1 : Math.sin(phase)) * vol;
  });

const howl = (uri: string, volume = 0.5): Howl => new Howl({ src: [uri], format: ['wav'], volume, preload: true });

export interface AudioKit {
  play(name: Sfx, variant?: number): void;
  mute(on: boolean): void;
  muted(): boolean;
  destroy(): void;
}

export function createAudio(): AudioKit {
  const bank: Record<Exclude<Sfx, 'combo'>, Howl> = {
    shoot: howl(chirp(0.13, 1250, 300, 0.32, true), 0.4),
    hit: howl(chirp(0.1, 440, 120, 0.45, true), 0.45),
    right: howl(seq(0.44, [[0, 0.15, 523, 660, 0.4], [0.1, 0.15, 659, 784, 0.4], [0.2, 0.22, 784, 1047, 0.42]]), 0.55),
    wrong: howl(seq(0.36, [[0, 0.17, 300, 190, 0.42], [0.13, 0.22, 190, 105, 0.38]]), 0.5),
    chest: howl(seq(0.62, [[0, 0.16, 523, 660, 0.34], [0.1, 0.16, 659, 784, 0.34], [0.2, 0.16, 784, 1047, 0.34], [0.3, 0.3, 1047, 1319, 0.36]]), 0.5),
    win: howl(seq(1.0, [[0, 0.5, 392, 392, 0.24], [0, 0.5, 523, 523, 0.24], [0, 0.5, 659, 659, 0.24], [0.4, 0.6, 784, 1047, 0.32]]), 0.55),
    tick: howl(chirp(0.05, 880, 980, 0.2), 0.3),
  };
  const combos = [0, 1, 2, 3, 4].map((i) =>
    howl(seq(0.22, [[0, 0.2, 660 + i * 110, 990 + i * 150, 0.38]]), 0.45),
  );
  let muted = false;

  return {
    play(name, variant = 0): void {
      if (muted) return;
      if (name === 'combo') combos[Math.max(0, Math.min(combos.length - 1, variant))].play();
      else bank[name as Exclude<Sfx, 'combo'>].play();
    },
    mute(on): void {
      muted = on;
      Howler.mute(on);
    },
    muted(): boolean {
      return muted;
    },
    destroy(): void {
      Object.values(bank).forEach((h) => h.unload());
      combos.forEach((h) => h.unload());
    },
  };
}
