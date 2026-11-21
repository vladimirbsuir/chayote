import { useQuery } from '@tanstack/react-query';
import type { TagWithCount } from '../types/tag';
import { tagsApi } from '../lib/ipc';
import { qk } from '../queries/keys';

export function useTags(): { tags: TagWithCount[] | undefined } {
  const query = useQuery({ queryKey: qk.tags(), queryFn: tagsApi.list });
  return { tags: query.data };
}