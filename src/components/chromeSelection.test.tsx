import { AlertCircle } from 'lucide-react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorOverflowMenu } from './EditorOverflowMenu';
import { EmptyState } from './EmptyState';
import { TagRowMenu } from './TagRowMenu';

/* `05-ui-ux.md` §9: chrome text is not selectable — only text inputs and the
   editor content are. These three surfaces have no dedicated test file of their
   own; what is asserted is the one class each carries, following the
   danger-token pattern in `NoteList.trash.test.tsx`. */

describe('chrome selection', () => {
  it('renders the tag menu unselectable so a hold presses, never selects', () => {
    render(
      <TagRowMenu
        tagId="t-work"
        tagName="work"
        placement={{ top: 100, left: 100 }}
        onAction={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('tag-menu').className).toContain('select-none');
  });

  it('renders the editor overflow menu unselectable', () => {
    render(<EditorOverflowMenu isPinned={false} onTogglePin={() => {}} onTrash={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.getByTestId('editor-overflow').className).toContain('select-none');
  });

  it('renders empty states unselectable, so a hold never selects the copy', () => {
    const { container } = render(
      <EmptyState
        title="No notes yet"
        body="Your notes are stored on this device."
        icon={<AlertCircle className="icon i-20" aria-hidden="true" />}
      />,
    );

    expect((container.firstChild as HTMLElement).className).toContain('select-none');
  });
});
