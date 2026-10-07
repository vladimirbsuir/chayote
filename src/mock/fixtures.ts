import type { Uuid, JsonDoc } from '../types/note';
import { EMPTY_DOC } from '../types/note';

export const CONTENT_SAMPLES: JsonDoc[] = [
  {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Meeting notes' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Discussed the ' },
          { type: 'text', text: 'launch date', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' with the team. Action items below, owners assigned.' },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Launch moves to the 14th. No further slip.' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Beta stays closed until the crash rate drops below 0.5 %.',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Nothing ships until the onboarding flow is finished.' },
            ],
          },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Action items' }] },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Draft the announcement' }] },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Prepare the demo build' }] },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Book the room for the 14th' }],
              },
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Follow-up on Monday.' }] },
    ],
  },
  {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Q3 roadmap draft' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Rough outline of the priorities we agreed on. Needs numbers before it goes anywhere.',
          },
        ],
      },
    ],
  },
  {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'quick thought about the pricing page — need to check with legal first',
          },
        ],
      },
    ],
  },
];

export type Fixture = {
  id: Uuid;
  doc: JsonDoc;
  folderId: Uuid | null;
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  tagIds: Uuid[];
};

export const FIXTURE_NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EMPTY_NOTE: Fixture = {
  id: '01980000-0000-7000-8000-000000000000',
  doc: EMPTY_DOC,
  folderId: null,
  isPinned: false,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  deletedAt: null,
  tagIds: [],
};

export const FIXTURE_NOTES: Fixture[] = [
  {
    id: '01980000-0000-7000-8000-000000000001',
    doc: CONTENT_SAMPLES[0] ?? EMPTY_DOC,
    folderId: 'f-work',
    isPinned: true,
    createdAt: FIXTURE_NOW - 3 * DAY,
    updatedAt: FIXTURE_NOW - 2 * MINUTE,
    deletedAt: null,
    tagIds: ['t-work', 't-urgent'],
  },
  {
    id: '01980000-0000-7000-8000-000000000002',
    doc: CONTENT_SAMPLES[1] ?? EMPTY_DOC,
    folderId: 'f-projects',
    isPinned: false,
    createdAt: FIXTURE_NOW - 5 * DAY,
    updatedAt: FIXTURE_NOW - 3 * HOUR,
    deletedAt: null,
    tagIds: ['t-work'],
  },
  {
    id: '01980000-0000-7000-8000-000000000003',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Standup — Thursday' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Blocked on the ' },
            { type: 'text', text: 'design review', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' until Dana is back.' },
          ],
        },
      ],
    },
    folderId: 'f-meetings',
    isPinned: false,
    createdAt: FIXTURE_NOW - 4 * DAY,
    updatedAt: FIXTURE_NOW - DAY,
    deletedAt: null,
    tagIds: [],
  },
  {
    id: '01980000-0000-7000-8000-000000000004',
    doc: CONTENT_SAMPLES[2] ?? EMPTY_DOC,
    folderId: 'f-meetings',
    isPinned: false,
    createdAt: FIXTURE_NOW - 3 * DAY,
    updatedAt: FIXTURE_NOW - 2 * DAY,
    deletedAt: null,
    tagIds: [],
  },
  {
    id: '01980000-0000-7000-8000-000000000005',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Onboarding checklist' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Everything a new person needs in week one, in order.' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    folderId: 'f-work',
    isPinned: true,
    createdAt: FIXTURE_NOW - 40 * DAY,
    updatedAt: FIXTURE_NOW - 4 * DAY,
    deletedAt: null,
    tagIds: ['t-work', 't-ideas'],
  },
  {
    id: '01980000-0000-7000-8000-000000000006',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Expense report' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Submitted. Waiting on approval.' }] },
      ],
    },
    folderId: 'f-personal',
    isPinned: false,
    createdAt: FIXTURE_NOW - 40 * DAY,
    updatedAt: FIXTURE_NOW - 4 * DAY,
    deletedAt: null,
    tagIds: [],
  },
];

export const FIXTURE_TRASH: Fixture[] = [
  {
    id: '01980000-0000-7000-8000-0000000000ff',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Old brainstorm' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Superseded by the roadmap draft.' }],
        },
      ],
    },
    folderId: 'f-archive',
    isPinned: false,
    createdAt: FIXTURE_NOW - 90 * DAY,
    updatedAt: FIXTURE_NOW - 6 * DAY,
    deletedAt: FIXTURE_NOW - 6 * DAY,
    tagIds: ['t-ideas'],
  },
];
