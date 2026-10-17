# Chayote — Product & Engineering Specification

**Chayote** is a minimalist, local-first WYSIWYG notes application for **Desktop (Windows/macOS/Linux)** and **Android**, built with **Tauri 2 + React + TypeScript + TipTap + SQLite**.

---

## 1. Document index

| #   | Document                                             | Purpose                                                                                |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 01  | [`docs/01-product.md`](docs/01-product.md)           | Vision, UX principles, v1 scope, explicit non-goals                                    |
| 02  | [`docs/02-architecture.md`](docs/02-architecture.md) | Stack, layer diagram, IPC surface, sync                                                |
| 03  | [`docs/03-data-model.md`](docs/03-data-model.md)     | Full SQLite schema, FTS5, migrations, mapping to Postgres                              |
| 04  | [`docs/04-editor.md`](docs/04-editor.md)             | TipTap configuration, document format, paste, autosave                                 |
| 05  | [`docs/05-ui-ux.md`](docs/05-ui-ux.md)               | Layout, icon system, tokens, shortcuts, empty states, a11y                             |
| 06  | [`docs/06-platform.md`](docs/06-platform.md)         | Desktop and Android specifics, paths, build and release                                |
| 07  | [`docs/07-sync-plan.md`](docs/07-sync-plan.md)       | Supabase/Postgres sync: phases, conflict policy, RLS                                   |
| 08  | [`docs/08-roadmap.md`](docs/08-roadmap.md)           | Milestones M0–M8, acceptance criteria, **progress tracker §7**                         |
| 09  | [`docs/09-decisions.md`](docs/09-decisions.md)       | Decision log: what was chosen, what was rejected, why                                  |
| 10  | [`docs/10-conventions.md`](docs/10-conventions.md)   | Repo layout, naming, state, errors, testing, quality gates                             |
| 11  | [`docs/11-verification.md`](docs/11-verification.md) | How each layer is proved correct. Gates, Playwright, what an agent can check alone     |