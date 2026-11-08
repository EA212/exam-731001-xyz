declare module 'howler' {
  export class Howl {
    constructor(options: { src: string[]; volume?: number; loop?: boolean; preload?: boolean });
    play(): number;
    stop(): void;
    unload(): void;
  }
  export const Howler: { mute(muted: boolean): void; volume(v?: number): number };
}
