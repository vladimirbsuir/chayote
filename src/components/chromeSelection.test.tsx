import { AlertCircle } from 'lucide-react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorOverflowMenu } from './EditorOverflowMenu';
import { EmptyState } from './EmptyState';
import { TagRowMenu } from './TagRowMenu';

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
