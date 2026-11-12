// Tiny shared app state + action registry (avoids circular imports between views).
import { today } from './core.js';

export const state = {
  tab: 'today', // today | nutrition | health | planner
  page: null, // a page pushed over the tab: 'stats' | 'settings'
  sub: { planner: 'tasks', nutrition: 'diary', health: null },
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
/** Re-render the current screen in place (no navigation animation). */
export function rerender() {
  return renderFn('update');
}
/** Switch tab (optionally to a sub-section). */
export function go(tab, sub) {
  const same = state.tab === tab && !state.page;
  state.page = null;
  state.tab = tab;
  if (sub !== undefined) state.sub[tab] = sub;
  return renderFn(same ? (tab === 'health' && sub ? 'push' : 'sub') : 'tab');
}
/** Switch a segmented sub-section within the current tab. */
export function setSub(tab, sub) {
  state.sub[tab] = sub;
  return renderFn('sub');
}
/** Push a full page (Stats, Settings, a Health section) with a slide. */
export function push(page) {
  if (page.startsWith('health:')) state.sub.health = page.slice(7);
  else state.page = page;
  return renderFn('push');
}
export function canGoBack() {
  return !!(state.page || (state.tab === 'health' && state.sub.health));
}
export function back() {
  if (state.page) state.page = null;
  else if (state.tab === 'health' && state.sub.health) state.sub.health = null;
  else return;
  return renderFn('pop');
}
