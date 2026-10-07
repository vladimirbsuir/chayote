export type Uuid = string;

export type JsonDoc = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonDoc[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export const EMPTY_DOC: JsonDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
