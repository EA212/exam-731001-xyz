import { Howl, Howler } from 'howler';

type Shape = 'sine' | 'square' | 'triangle';

function wav(freqs: number[], dur: number, shape: Shape = 'sine', sweep = 0.3): string {
  const rate = 22050;
  const n = Math.floor(rate * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const asc = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  asc(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); asc(8, 'WAVE'); asc(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  asc(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 100) * Math.pow(1 - t / dur, 1.5);
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k] * (1 + t * sweep * k);
      const p = 2 * Math.PI * f * t;
      s += shape === 'square' ? Math.sign(Math.sin(p)) : shape === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(p)) : Math.sin(p);
    }
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, (s / freqs.length) * env * 0.55)) * 32767, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

export type Sound =
  | 'tap' | 'spin' | 'tick' | 'right' | 'wrong' | 'combo'
  | 'drop' | 'open' | 'scroll' | 'finish';

const bank: Record<Sound, Howl> = {
  tap: new Howl({ src: [wav([520], 0.06)], volume: 0.24 }),
  spin: new Howl({ src: [wav([180, 240], 0.5, 'triangle', 0.6)], volume: 0.22 }),
  tick: new Howl({ src: [wav([900], 0.035, 'square')], volume: 0.14 }),
  right: new Howl({ src: [wav([880], 0.22)], volume: 0.5 }),
  wrong: new Howl({ src: [wav([220, 150], 0.3, 'triangle')], volume: 0.42 }),
  combo: new Howl({ src: [wav([880, 1170, 1560], 0.2, 'square')], volume: 0.2 }),
  drop: new Howl({ src: [wav([420, 300], 0.3, 'triangle', -0.2)], volume: 0.34 }),
  open: new Howl({ src: [wav([523, 659, 784, 1047], 0.42)], volume: 0.42 }),
  scroll: new Howl({ src: [wav([392, 494, 587], 0.3)], volume: 0.34 }),
  finish: new Howl({ src: [wav([523, 659, 784, 1047, 1319], 0.72)], volume: 0.5 }),
};

const reveal: Howl[] = [
  new Howl({ src: [wav([660, 880], 0.3)], volume: 0.36 }),
  new Howl({ src: [wav([523, 659, 880], 0.46)], volume: 0.4 }),
  new Howl({ src: [wav([523, 659, 784, 1047], 0.62)], volume: 0.44 }),
  new Howl({ src: [wav([523, 659, 784, 1047, 1319, 1568], 0.92)], volume: 0.5 }),
];

export function play(name: Sound): void { bank[name].play(); }
export function playReveal(rarity: number): void { reveal[Math.max(0, Math.min(3, rarity))].play(); }
export function setMuted(m: boolean): void { Howler.mute(m); }
