/* `05-ui-ux.md` §2.4 and `06-platform.md` §4.4: one view visible at a time on a
   single pane, and the Android back button pops the stack. Reducer-shaped
   rather than a pair of booleans, because "what does back do at depth 1" is a
   rule and a rule belongs in a testable function rather than in a handler. */

export type View = 'list' | 'editor';

export type ViewStack = {
  stack: View[];
};

export const INITIAL_STACK: ViewStack = { stack: ['list'] };

export function pushView(state: ViewStack, view: View): ViewStack {
  if (state.stack[state.stack.length - 1] === view) return state;
  return { stack: [...state.stack, view] };
}

/** At the root the stack does not change: `06-platform.md` §4.4 moves the task
    to the background instead, which is the platform's job, not this reducer's.
    Reporting that as "nothing popped" is what lets the caller tell the two apart. */
export function popView(state: ViewStack): ViewStack {
  if (state.stack.length <= 1) return state;
  return { stack: state.stack.slice(0, -1) };
}

export function canPop(state: ViewStack): boolean {
  return state.stack.length > 1;
}

export function currentView(state: ViewStack): View {
  return state.stack[state.stack.length - 1] ?? 'list';
}