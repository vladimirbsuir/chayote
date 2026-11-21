export type View = 'list' | 'editor';

export type ViewStack = {
  stack: View[];
};

export const INITIAL_STACK: ViewStack = { stack: ['list'] };

export function pushView(state: ViewStack, view: View): ViewStack {
  if (state.stack[state.stack.length - 1] === view) return state;
  return { stack: [...state.stack, view] };
}

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