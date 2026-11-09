import type { QuestQuestion, QuestType, QuestOption } from './types';

const clean = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
const OPTION = /^\s*([A-Ha-h])\s*[.、．)）]\s*([\s\S]+)$/;
const LABEL = /^[【\[]?\s*(答案|参考答案|答案要点|解析|答案解析|试题解析|考点|知识点|问题|答题关键点|关键点)\s*[】\]]?\s*[：:]\s*/;

const TYPES: Array<[RegExp, QuestType, string]> = [
  [/多项选择|多选题/, 'duoxuan', '多项选择题'],
  [/单项选择|单选题/, 'danxuan', '单项选择题'],
  [/辨析|判断/, 'panduan', '判断题'],
  [/名词解释/, 'other', '名词解释题'],
  [/填空/, 'other', '填空题'],
  [/简答|简述|问答/, 'other', '简答题'],
  [/论述/, 'other', '论述题'],
  [/案例|材料分析/, 'other', '案例分析题'],
];

function heading(text: string): { type: QuestType; name: string; point: number } {
  const t = clean(text);
  let type: QuestType = 'other';
  let name = t.split('（')[0].replace(/^[一二三四五六七八九十]+、\s*/, '') || '题目';
  for (const [re, ty, nm] of TYPES) {
    if (re.test(t)) { type = ty; name = nm; break; }
  }
  const pm = t.match(/每小题\s*([\d.]+)\s*分/);
  return { type, name, point: pm ? parseFloat(pm[1]) : 1 };
}

function normalize(raw: string): string {
  let v = (raw || '').replace(/\*/g, '').replace(/\s+/g, '').trim();
  v = v.replace(/[（(]\s*[0-9一二三四五六七八九十]+\s*分\s*[）)]/g, '');
  v = v.replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '');
  v = v.replace(/[。．.，,、；;！!？?：:]+$/g, '');
  if (/^[A-H](?:[、,，]?[A-H]){0,7}$/i.test(v)) {
    return [...new Set(v.replace(/[、,，]/g, '').toUpperCase().split(''))].sort().join('');
  }
  if (/^(对|错|正确|错误|√|×|✓|✗|T|F)$/i.test(v)) {
    return /^(对|正确|√|✓|T)$/i.test(v) ? '对' : '错';
  }
  return '';
}

function question(el: Element, sec: ReturnType<typeof heading>, docId: string, n: number): QuestQuestion {
  const h3 = el.querySelector('h3');
  const rawStem = clean(h3?.textContent || '');
  const nm = rawStem.match(/^\s*(\d+)\s*[.、．]/);
  const num = nm ? nm[1] : String(n);
  const stem = rawStem.replace(/^\s*\d+\s*[.、．]\s*/, '');

  const options: QuestOption[] = [];
  for (const li of Array.from(el.querySelectorAll('ul > li'))) {
    const m = clean(li.textContent || '').match(OPTION);
    if (m) options.push({ label: m[1].toUpperCase(), text: m[2].trim() });
  }

  const children = Array.from(el.children);
  const ai = children.findIndex((c) => c.classList.contains('exam-answer'));
  const answerRaw = ai >= 0 ? clean(children[ai].textContent || '').replace(LABEL, '') : '';
  let answer = normalize(answerRaw);

  const material: string[] = [];
  const body: string[] = [];
  let analysis = '';
  let keyPoints = '';
  children.forEach((c, i) => {
    if (c === h3 || c.tagName === 'HR' || c.tagName === 'UL') return;
    const cls = c.classList;
    const text = clean(c.textContent || '');
    if (!text) return;
    if (cls.contains('exam-answer')) {
      if (!answer && answerRaw.length > 1) body.push(answerRaw);
      return;
    }
    if (cls.contains('exam-analysis')) { analysis = text.replace(LABEL, ''); return; }
    if (cls.contains('exam-point') || cls.contains('exam-ask')) { keyPoints = text.replace(LABEL, ''); return; }
    if (/^(答题关键点|关键点)/.test(text)) { keyPoints = text.replace(LABEL, ''); return; }
    if (i < ai || ai < 0) material.push(text);
    else body.push(text);
  });

  if (answer && /^[A-H]+$/.test(answer) && options.length) {
    const labels = new Set(options.map((o) => o.label));
    const kept = [...answer].filter((c) => labels.has(c)).join('');
    if (kept) answer = kept;
  }

  let kind: 'choice' | 'scroll' = 'scroll';
  if (options.length >= 2 && answer) kind = 'choice';
  else if (sec.type === 'panduan' && /^(对|错)$/.test(answer)) {
    options.push({ label: '对', text: '正确' }, { label: '错', text: '错误' });
    kind = 'choice';
  }

  return {
    id: `${docId}#${num}`,
    num,
    typeName: sec.name,
    type: sec.type,
    kind,
    stem,
    material: material.join('\n'),
    options,
    answer,
    answerText: body.join('\n') || answerRaw,
    analysis,
    keyPoints,
    point: sec.point,
  };
}

const QUESTION_HEADING = /^\s*(\d+)\s*[.、．]|【(简答|论述|辨析|名词解释|填空|材料|案例)/;

function scroll(title: string, parts: string[], docId: string, n: number, sec: ReturnType<typeof heading>): QuestQuestion {
  const raw = clean(title);
  const nm = raw.match(/^\s*(\d+)\s*[.、．]/);
  return {
    id: `${docId}#n${n}`,
    num: nm ? nm[1] : String(n),
    typeName: sec.name === '题目' ? '知识卡' : sec.name,
    type: 'other',
    kind: 'scroll',
    stem: raw.replace(/^\s*\d+\s*[.、．]\s*/, ''),
    material: '',
    options: [],
    answer: '',
    answerText: parts.join('\n'),
    analysis: '',
    keyPoints: '',
    point: 1,
  };
}

export function parseArticle(article: Element, docId = 'quest'): QuestQuestion[] {
  const out: QuestQuestion[] = [];
  const children = Array.from(article.children);
  const hasQ = children.some((c) => c.tagName === 'SECTION' && c.classList.contains('exam-q'));
  let sec = heading('');
  let n = 0;

  if (!hasQ) {
    let parts: string[] = [];
    let title = '';
    const flush = (): void => {
      if (title && parts.length) out.push(scroll(title, parts, docId, ++n, sec));
      parts = [];
      title = '';
    };
    for (const el of children) {
      if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') {
        flush();
        title = el.textContent || '';
        sec = heading(title);
      } else if (el.tagName === 'P' || el.tagName === 'BLOCKQUOTE' || el.tagName === 'UL') {
        const t = clean(el.textContent || '');
        if (t) parts.push(t);
      }
    }
    flush();
    return out;
  }

  let noteParts: string[] = [];
  let noteTitle = '';
  const flushNote = (): void => {
    if (noteTitle && QUESTION_HEADING.test(noteTitle) && noteParts.length) {
      out.push(scroll(noteTitle, noteParts, docId, ++n, sec));
    }
    noteParts = [];
    noteTitle = '';
  };

  for (const el of children) {
    if (el.tagName === 'H2') {
      flushNote();
      sec = heading(el.textContent || '');
      noteTitle = QUESTION_HEADING.test(el.textContent || '') ? el.textContent || '' : '';
      continue;
    }
    if (el.tagName === 'SECTION' && el.classList.contains('exam-q')) {
      flushNote();
      out.push(question(el, sec, docId, ++n));
      continue;
    }
    if (el.tagName === 'P' || el.tagName === 'BLOCKQUOTE') {
      const t = clean(el.textContent || '');
      if (t && noteTitle) noteParts.push(t);
    }
  }
  flushNote();
  return out;
}

export function isCorrect(q: QuestQuestion, pick: string): boolean {
  if (q.kind !== 'choice' || !q.answer || !pick) return false;
  if (q.type === 'panduan') return pick === q.answer;
  const key = (s: string): string => (s || '').replace(/[^A-H]/gi, '').toUpperCase().split('').sort().join('');
  return key(pick) === key(q.answer);
}
