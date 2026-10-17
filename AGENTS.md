# AGENTS.md — agent entry point

This file is the onboarding document (ADR-022). If you are an agent and you
have read this file, you already have everything below.

## Start here, in order

Do this in order. Do not skip to writing code.

1. Read `README.md` §§1–3 for the product state, the frozen decisions, and the
   document index.
2. Read `docs/01` through `docs/11` in numeric order.
3. Read `prototype/index.html`. It is the visual source of truth for the UI.
   Build components against it, never against the ASCII wireframes in
   `docs/05-ui-ux.md`. If you change tokens, icon sizes, layout metrics, or
   user-visible copy, change the prototype in the same edit (ADR-016).

## While working

- Follow `docs/10-conventions.md` for layout, naming, state, and errors.
- Verify your work with `docs/11-verification.md`. Run the gate commands;
  report the real output. Never claim a check passed that was not run.
- If a document and the code disagree, **the code is wrong.** Fix the code.
  If the document is genuinely wrong, change it in the same commit — never
  leave a document describing something the code does not do.

**Pause and ask the user when:** the plan needs approval · a visual judgement
is needed, since assertions cannot judge taste · a frozen decision would change
· a check cannot be run · any other ambiguous situation.

## Workflow: branches, commits, pull requests

- `main` is always buildable and always shippable. Work happens on topic
  branches (`fix/…`, `feat/…`); nothing lands on `main` except through a
  pull request, merged when CI is green.
- Conventional Commits, one logical change per commit
  (`docs/10-conventions.md` §11): `fix(sync): …`, `feat(ui): …`.
- Commit at the end of each task, without being asked: once the gates pass,
  commit and report the commit. Never end a work session with uncommitted
  changes unless the user said not to. Once the work is complete and verified,
  merge and push your working branches, Verify that the entire CI process
  has completed successfully, and then delete any unnecessary branches.