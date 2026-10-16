# AGENTS.md — agent entry point

This file is the onboarding document (ADR-022). If you are an agent and you
have read this file, you already have everything below. Do not wait to be
told to read the other documents.

The only thing a new session cannot discover on its own is **the path to
this folder**, because the session may have opened somewhere else entirely.
That is what the one-line first message provides:

```
Chayote. D:\Projects\chayote — read AGENTS.md and follow it.
```

Once code exists in the tree, `Chayote, D:\Projects\chayote, continue` is
enough: read this file, `docs/10-conventions.md`, and whichever documents the
request actually touches.

## Start here, in order

Do this in order. Do not skip to writing code.

1. Read `README.md` §§1–3 for the product state, the frozen decisions, and the
   document index.
2. Read `docs/01` through `docs/11` in numeric order. They total about 190 KB.
   Read them all; they are written to be read once and then followed.
3. Read `prototype/index.html`. It is the visual source of truth for the UI.
   Build components against it, never against the ASCII wireframes in
   `docs/05-ui-ux.md`. If you change tokens, icon sizes, layout metrics, or
   user-visible copy, change the prototype in the same edit (ADR-016).
4. Read `docs/08-roadmap.md` §7 (progress tracker), then compare it against
   what actually exists in the working tree.
5. State which milestone is current and what the next concrete tasks are.
   **Stop there and wait for confirmation.** Do not start writing code in the
   same turn as the plan.

Why a bare "read the documents" is not enough: the prototype looks optional
next to numbered documents (it is not — skipping it is the most common
failure mode); "decided" without reasoning invites re-proposing the stack;
and the ASCII diagrams in `docs/05-ui-ux.md` read as specification but are
not. None of these is an agent failure — a specification does not advertise
its own auxiliary artefacts, which is exactly why this file exists.

## While working

- Follow `docs/10-conventions.md` for layout, naming, state, and errors.
- Verify your work with `docs/11-verification.md`. Run the gate commands;
  report the real output. Never claim a check passed that was not run.
- Never violate the sync-readiness rules **R1–R9** (`docs/02-architecture.md`
  §6). They are review criteria, not suggestions.
- If a document and the code disagree, **the code is wrong.** Fix the code.
  If the document is genuinely wrong, change it in the same commit — never
  leave a document describing something the code does not do.
- Update `docs/08-roadmap.md` §7 in the same commit as the work it describes.
- Do not re-propose the stack, the layout, or the editor choice. They are
  decided and the reasoning is in `docs/09-decisions.md`.

**Pause and ask the user when:** the plan needs approval · a visual judgement
is needed, since assertions cannot judge taste · a change touches R1–R9 · a
frozen decision would change · a check cannot be run.

## Workflow: branches, commits, pull requests

- `main` is always buildable and always shippable. Work happens on topic
  branches (`fix/…`, `feat/…`); nothing lands on `main` except through a
  pull request, merged when CI is green.
- Conventional Commits, one logical change per commit
  (`docs/10-conventions.md` §11): `fix(sync): …`, `feat(ui): …`.
- Commit at the end of each task, without being asked: once the gates pass,
  commit and report the commit. Never end a work session with uncommitted
  changes unless the user said not to. Do not push or open a PR unless
  explicitly asked.
- If a session ends abruptly, documents and code drift — `docs/08-roadmap.md`
  §7 (the one document recording state) most of all. Before any repair, ask
  for a report first: `Compare docs/08-roadmap.md §7 against the working
tree. List every discrepancy. Report only — change nothing yet.` Then fix
  whichever side is genuinely wrong, and update the other in the same commit.
