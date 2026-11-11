// Tiny shared app state + action registry (avoids circular imports between views).
import { today } from './core.js';

export const state = {
  tab: 'today',
  sub: { planner: 'tasks', nutrition: 'diary', health: 'water' },
  date: today(),
  planWeek: null,
  statsRange: 7,
  recipeFilter: 'all',
  recipeQuery: '',
  foodQuery: '',
  showDone: false,
};

export const actions = {};
export function register(map) {
  Object.assign(actions, map);
}

let renderFn = () => {};
export function setRenderer(fn) {
  renderFn = fn;
}
export function rerender() {
  return renderFn();
}
export function go(tab, sub) {
  state.tab = tab;
  if (sub) state.sub[tab] = sub;
  window.scrollTo(0, 0);
  return renderFn(true);
}
