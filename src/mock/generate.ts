import type { Uuid } from '../types/note';
import type { MockDatabase } from './derive';

const WORDS = [
  'launch',
  'roadmap',
  'meeting',
  'announcement',
  'pricing',
  'onboarding',
  'demo',
  'crash',
  'rate',
  'design',
  'review',
  'budget',
  'hiring',
  'interview',
  'retro',
  'customer',
  'feedback',
  'release',
  'migration',
  'schema',
  'index',
  'outbox',
  'checkpoint',
  'editorial',
  'draft',
  'interview',
  'reading',
  'list',
  'quarterly',
  'notes',
  'summary',
  'follow',
  'action',
  'items',
  'owner',
  'deadline',
];

const TITLES = [
  'Meeting notes',
  'Q3 roadmap draft',
  'Standup',
  'Reading list',
  'Expense report',
  'Untitled',
  'Onboarding checklist',
  'Weekly review',
  'Retro notes',
  'Ideas',
];

const FOLDER_NAMES = ['Work', 'Projects', 'Meetings', 'Personal', 'Reading', 'Archive'];

const TAG_NAMES = ['work', 'ideas', 'urgent', 'reading', 'personal'];

function uuidFrom(seed: string): Uuid {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of seed) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch.charCodeAt(0), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number, len: number): string => n.toString(16).padStart(len, '0').slice(-len);
  const version = '7';
  const variant = ((h2 & 0x3) | 0x8).toString(16);
  return [
    hex(h1, 8),
    hex(h2, 4),
    version + hex(h1 >> 8, 3),
    variant + hex(h2 >> 4, 3),
    hex(h2, 12),
  ].join('-');
}

export type BuildOptions = {
  noteCount?: number;
  folders?: boolean;
  tags?: boolean;
  now?: number;
};

function seededIndex(count: number): number {
  let n = count;
  n = (n * 1103515245 + 12345) % 2147483648;
  return n / 2147483648;
}

function paragraph(text: string): { type: 'paragraph'; content: [{ type: 'text'; text: string }] } {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function makeDoc(index: number): MockDatabase['notes'][number]['doc'] {
  const title = TITLES[index % TITLES.length] ?? 'Untitled';
  const sentence = `${WORDS[index % WORDS.length]} ${WORDS[(index * 7) % WORDS.length]} ${WORDS[(index * 13) % WORDS.length]}`;
  const body = `${sentence} ${WORDS[(index * 3) % WORDS.length]} and ${WORDS[(index * 5) % WORDS.length]}.`;
  const isUntitled = title === 'Untitled';

  const content: MockDatabase['notes'][number]['doc']['content'] = isUntitled
    ? [paragraph(`${body} ${sentence}.`)]
    : [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
        paragraph(body),
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: index % 5 === 0 },
              content: [
                paragraph(
                  `${WORDS[(index * 11) % WORDS.length]} the ${WORDS[(index * 17) % WORDS.length]} build`,
                ),
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                paragraph(
                  `${WORDS[(index * 19) % WORDS.length]} the ${WORDS[(index * 23) % WORDS.length]} notes`,
                ),
              ],
            },
          ],
        },
      ];

  return { type: 'doc', content };
}

export function buildDatabase(options: BuildOptions = {}): MockDatabase {
  const noteCount = options.noteCount ?? 0;
  const now = options.now ?? Date.UTC(2026, 9, 7, 12, 0, 0);

  const folders: MockDatabase['folders'] =
    options.folders === false
      ? []
      : [
          { id: uuidFrom('f-work'), name: 'Work', parentId: null, position: 0 },
          {
            id: uuidFrom('f-projects'),
            name: 'Projects',
            parentId: uuidFrom('f-work'),
            position: 0,
          },
          {
            id: uuidFrom('f-meetings'),
            name: 'Meetings',
            parentId: uuidFrom('f-work'),
            position: 1,
          },
          { id: uuidFrom('f-personal'), name: 'Personal', parentId: null, position: 1 },
          {
            id: uuidFrom('f-reading'),
            name: 'Reading',
            parentId: uuidFrom('f-personal'),
            position: 0,
          },
          { id: uuidFrom('f-archive'), name: 'Archive', parentId: null, position: 2 },
        ];

  const tags: MockDatabase['tags'] =
    options.tags === false ? [] : TAG_NAMES.map((name) => ({ id: uuidFrom(`t-${name}`), name }));

  const notes: MockDatabase['notes'] = Array.from({ length: noteCount }, (_, index) => {
    const roll = seededIndex(index + 1);
    const folderId =
      folders.length === 0 ? null : (folders[Math.floor(roll * folders.length)]?.id ?? null);
    const tagCount = Math.floor(roll * 3);
    const tagIds = tags
      .filter((_, tagIndex) => tagIndex % 2 === roll % 2)
      .slice(0, tagCount)
      .map((tag) => tag.id);

    const updatedAt = now - Math.floor(roll * 60 * 60 * 1000 * 24 * 30);
    return {
      id: uuidFrom(`n-${index}`),
      doc: makeDoc(index),
      /* Every generated note is `auto`, like every note written before ADR-023:
         its title is its first line, which is what the scroll tests read. */
      title: '',
      titleSource: 'auto' as const,
      folderId,
      isPinned: index % 17 === 0,
      createdAt: updatedAt - 60_000,
      updatedAt,
      deletedAt: null,
      tagIds,
    };
  });

  return { notes, folders, tags };
}

export { uuidFrom };
export const FIXTURE_FOLDER_NAMES = FOLDER_NAMES;
