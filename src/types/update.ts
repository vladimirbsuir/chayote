export type AppInfo = {
  version: string;
  os: string;
  updatesSupported: boolean;
};

export type UpdateSummary = {
  version: string;
  date: string | null;
};

export type DownloadEvent =
  | { event: 'started'; data: { contentLength: number | null } }
  | { event: 'progress'; data: { chunkLength: number } }
  | { event: 'finished'; data: null };