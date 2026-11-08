import { Howl, Howler } from 'howler';

function wav(freqs: number[], dur: number, shape: 'sine' | 'square' | 'triangle' = 'sine'): string {
  const rate = 22050;
  const n = Math.floor(rate * dur);
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 90) * Math.pow(1 - t / dur, 1.6);
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k] * (1 + t * 0.3 * k);
      const p = 2 * Math.PI * f * t;
      s += shape === 'square' ? Math.sign(Math.sin(p)) : shape === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(p)) : Math.sin(p);
    }
    const v = Math.max(-1, Math.min(1, (s / freqs.length) * env * 0.55));
    view.setInt16(44 + i * 2, v * 32767, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

export type SoundName = 'start' | 'catch' | 'right' | 'wrong' | 'combo' | 'chest' | 'finish';

const bank: Record<SoundName, Howl> = {
  start: new Howl({ src: [wav([330, 440, 550], 0.28)], volume: 0.5 }),
  catch: new Howl({ src: [wav([520, 780], 0.12)], volume: 0.32 }),
  right: new Howl({ src: [wav([660, 880, 1040], 0.26)], volume: 0.5 }),
  wrong: new Howl({ src: [wav([220, 150], 0.3, 'triangle')], volume: 0.45 }),
  combo: new Howl({ src: [wav([880, 1170, 1560], 0.2, 'square')], volume: 0.22 }),
  chest: new Howl({ src: [wav([1040, 1310, 1760, 2090], 0.36)], volume: 0.4 }),
  finish: new Howl({ src: [wav([523, 659, 784, 1047], 0.62)], volume: 0.5 }),
};

export function play(name: SoundName): void {
  bank[name].play();
}

export function setMuted(muted: boolean): void {
  Howler.mute(muted);
}
