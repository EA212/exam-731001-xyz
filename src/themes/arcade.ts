import type { QuizQuestion } from '../lib/quiz-player';
import type { QuizTheme, ThemeContext, ThemeInstance } from './index';

interface Controller {
  launch(questions: QuizQuestion[]): void;
  destroy(): void;
}

export const arcade: QuizTheme = {
  id: 'arcade',
  name: '星际答题',
  tagline: '2D 射击闯关 · 连击加分 · 知识宝箱',
  accent: '#7c5cff',
  pace: { right: 820, wrong: 1500 },
  standalone: true,
  create(ctx: ThemeContext): ThemeInstance {
    let game: Controller | null = null;
    let loading: Promise<Controller> | null = null;

    const ensure = (): Promise<Controller> => {
      if (!loading) {
        loading = import('./arcade/engine').then(({ createArcade }) => {
          game = createArcade(ctx.mount, {
            title: ctx.title,
            sources: ctx.sources,
            pace: arcade.pace,
            host: ctx.host,
          });
          return game;
        });
      }
      return loading;
    };

    return {
      launch(questions): void {
        void ensure().then((g) => g.launch(questions));
      },
      destroy(): void {
        game?.destroy();
        game = null;
        loading = null;
      },
    };
  },
};
