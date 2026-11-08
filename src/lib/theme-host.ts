import { parseQuestions, isGradable, type QuizContext } from './exam-quiz';
import { markSeen, saveWrong } from './exam-store';
import { attachTheme, clearTheme, type QuizTheme, type ThemeChapter } from '../themes';
import type { QuizQuestion } from './quiz-player';

const docIdOf = (href: string): string =>
  href.replace(/^\/zsb\//, '').replace(/\?.*$/, '').replace(/\/$/, '') || 'index';

export function openThemeIndex(theme: QuizTheme): void {
  const chapters: ThemeChapter[] = Array.from(document.querySelectorAll<HTMLAnchorElement>('.zsb-card')).map((a) => ({
    label: a.querySelector('h3')?.textContent?.trim() || '',
    href: a.getAttribute('href') || '',
    meta: Array.from(a.querySelectorAll('.zsb-badge'))
      .map((b) => b.textContent?.trim())
      .filter(Boolean)
      .join(' · '),
  }));

  let current: QuizContext = { docId: 'index', docTitle: '资料库', docUrl: '/zsb/', subject: '' };

  const load = async (href: string): Promise<QuizQuestion[]> => {
    const res = await fetch(href);
    const html = await res.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const article = parsed.querySelector('article');
    if (!article) return [];
    current = {
      docId: docIdOf(href),
      docTitle: parsed.querySelector('h1')?.textContent?.trim() || href,
      docUrl: href,
      subject: parsed.querySelector('.zsb-badge.primary')?.textContent?.trim() || '',
    };
    return parseQuestions(article, current).filter(isGradable);
  };

  attachTheme(theme, '选择关卡', {
    questions: [],
    chapters,
    variants: [],
    load,
    onGrade: (q, pick, ok): void => {
      markSeen(q.id, current.docId, ok);
      if (ok) return;
      saveWrong({
        id: q.id,
        docId: current.docId,
        docTitle: current.docTitle,
        docUrl: current.docUrl,
        subject: current.subject,
        type: q.type,
        typeName: q.typeName,
        num: q.num,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        chosen: pick,
        analysis: q.analysis,
        point: q.point,
      });
    },
    onFinish: (): void => undefined,
    onClose: (): void => {
      clearTheme();
      location.assign('/zsb/?theme=none');
    },
  });
}
