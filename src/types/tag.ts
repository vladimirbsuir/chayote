import type { Uuid } from './note';

export type TagWithCount = {
  id: Uuid;
  name: string;
  count: number;
};
