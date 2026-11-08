declare module 'howler' {
  export class Howl {
    constructor(options: {
      src: string[];
      format?: string[];
      volume?: number;
      preload?: boolean;
      loop?: boolean;
    });
    play(): number;
    stop(): void;
    volume(v?: number): number;
    unload(): void;
  }
  export const Howler: {
    mute(muted: boolean): void;
    volume(v?: number): number;
  };
}
