import type { ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  body: string;
  icon: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'warning';
};

export function EmptyState({ title, body, icon, action, tone = 'default' }: EmptyStateProps) {
  const titleTone = tone === 'warning' ? 'text-[var(--warning)]' : 'text-[var(--text)]';
  return (
    /* Empty-state copy is chrome, not content: read, never copied. */
    <div className="flex min-h-[210px] flex-col items-center justify-center gap-[10px] rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center select-none">
      <div className={`flex items-center gap-[7px] text-[15px] font-semibold ${titleTone}`}>
        <span className="flex text-[var(--text-subtle)]">{icon}</span>
        {title}
      </div>
      <p className="max-w-[30ch] text-[13px] leading-[1.5] text-[var(--text-muted)]">{body}</p>
      {action}
    </div>
  );
}
