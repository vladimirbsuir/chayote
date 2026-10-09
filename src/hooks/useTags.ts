import { useQuery } from '@tanstack/react-query';
import type { TagWithCount } from '../types/tag';
import { tagsApi } from '../lib/ipc';
import { qk } from '../queries/keys';

/* Tags load once and are cached, for the same reason folders do
   (`10-conventions.md` §8). `tags_list` already excludes a tag whose notes are
   all in the trash — an empty filter in the sidebar is noise
   (`03-data-model.md` §5) — so nothing here has to re-count. */

export function useTags(): { tags: TagWithCount[] | undefined } {
  const query = useQuery({ queryKey: qk.tags(), queryFn: tagsApi.list });
  return { tags: query.data };
}