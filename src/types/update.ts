/* Shapes for the Updates tab (ADR-024). Rust structs carry
   #[serde(rename_all = "camelCase")], and `DownloadEvent` is
   #[serde(tag = "event", content = "data")], so the union below is the exact
   wire shape rather than an approximation of it. */

export type AppInfo = {
  /** The version the app is running, and the one an update has to beat. */
  version: string;
  /** A platform label for the sentence explaining why updating is unavailable. */
  os: string;
  /** False on macOS and Android (`06-platform.md` §3.8). */
  updatesSupported: boolean;
};

export type UpdateSummary = {
  version: string;
  /** Release notes, or an empty string when `latest.json` carried none. */
  notes: string;
  /** RFC 3339, shown as-is. Never parsed. */
  date: string | null;
};

/** One message down the `updates_install` channel. The three names are the
    variant names on the Rust side, lowercased there deliberately so this union
    needs no remapping. */
export type DownloadEvent =
  | { event: 'started'; data: { contentLength: number | null } }
  | { event: 'progress'; data: { chunkLength: number } }
  | { event: 'finished'; data: null };