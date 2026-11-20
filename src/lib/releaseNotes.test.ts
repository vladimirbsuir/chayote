import { describe, expect, it } from 'vitest';
import { releaseNoteBlocks } from './releaseNotes';

describe('releaseNoteBlocks', () => {
  it('keeps a one-line note as one paragraph', () => {
    expect(releaseNoteBlocks('Faster search, and the Updates tab.')).toEqual([
      { kind: 'text', text: 'Faster search, and the Updates tab.' },
    ]);
  });

  it('reads the list the release pipeline writes', () => {
    const notes =
      'Changes in 0.2.2:\n- Install retries after the Android grant\n- Notes read as text\n';
    expect(releaseNoteBlocks(notes)).toEqual([
      { kind: 'text', text: 'Changes in 0.2.2:' },
      { kind: 'item', text: 'Install retries after the Android grant' },
      { kind: 'item', text: 'Notes read as text' },
    ]);
  });

  it('joins hard-wrapped lines and keeps blank-line paragraphs apart', () => {
    const notes =
      'Android refuses an update signed with a different\ncertificate than the\r\ninstalled one.\n\nSecond.';
    expect(releaseNoteBlocks(notes)).toEqual([
      {
        kind: 'text',
        text: 'Android refuses an update signed with a different certificate than the installed one.',
      },
      { kind: 'text', text: 'Second.' },
    ]);
  });

  it('continues a list item onto its wrapped lines', () => {
    expect(releaseNoteBlocks('- first line\n  wraps here\n- second')).toEqual([
      { kind: 'item', text: 'first line wraps here' },
      { kind: 'item', text: 'second' },
    ]);
  });

  it('strips inline Markdown and keeps link text, never the URL', () => {
    expect(
      releaseNoteBlocks('**Android:** see [`docs/06`](https://example.com/x) for __why__'),
    ).toEqual([{ kind: 'text', text: 'Android: see docs/06 for why' }]);
  });

  it('drops a table separator and keeps each row on its own line', () => {
    const notes = 'Download | Asset\n--- | ---\nWindows | `setup.exe`\nAndroid | `app.apk`';
    expect(releaseNoteBlocks(notes)).toEqual([
      { kind: 'text', text: 'Download — Asset' },
      { kind: 'text', text: 'Windows — setup.exe' },
      { kind: 'text', text: 'Android — app.apk' },
    ]);
  });

  it('returns nothing for empty or blank notes', () => {
    expect(releaseNoteBlocks('')).toEqual([]);
    expect(releaseNoteBlocks('  \n\n ')).toEqual([]);
  });
});
