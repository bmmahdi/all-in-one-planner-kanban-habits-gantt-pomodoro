'use strict';

/*
 * Merge two copies of the Planner data (PC + phone) item by item.
 * Every task / habit / project / focus session carries `updatedAt`;
 * deleted items are remembered in `deleted` ({ id: time }).
 * The newest version of each item wins, so changes made on both
 * devices are kept.
 */

const ITEM_COLLECTIONS = ['tasks', 'habits', 'projects', 'sessions'];
const TOMBSTONE_TTL = 120 * 864e5; // forget deletions after ~4 months

function mergeList(a, b, tomb) {
  const m = new Map();
  for (const x of a || []) if (x && x.id) m.set(x.id, x);
  for (const x of b || []) {
    if (!x || !x.id) continue;
    const y = m.get(x.id);
    if (!y || (x.updatedAt || 0) >= (y.updatedAt || 0)) m.set(x.id, x);
  }
  return [...m.values()].filter((x) => !(tomb[x.id] && tomb[x.id] >= (x.updatedAt || 0)));
}

/** Merge `incoming` into `base`. On a tie the incoming copy wins. */
function mergeStates(base, incoming) {
  if (!base) return incoming;
  if (!incoming) return base;
  const now = Date.now();
  const tomb = {};
  for (const src of [base.deleted || {}, incoming.deleted || {}]) {
    for (const [id, ts] of Object.entries(src)) {
      if (now - ts < TOMBSTONE_TTL) tomb[id] = Math.max(tomb[id] || 0, ts);
    }
  }
  const out = { ...base, ...incoming };
  for (const c of ITEM_COLLECTIONS) out[c] = mergeList(base[c], incoming[c], tomb);
  const newer = (stampA, stampB) => (stampB || 0) >= (stampA || 0);
  if (newer(base.columnsUpdatedAt, incoming.columnsUpdatedAt)) out.columns = incoming.columns || base.columns;
  else out.columns = base.columns;
  const colStamp = Math.max(base.columnsUpdatedAt || 0, incoming.columnsUpdatedAt || 0);
  if (colStamp) out.columnsUpdatedAt = colStamp;
  else delete out.columnsUpdatedAt;
  const sa = base.settings || {};
  const sb = incoming.settings || {};
  out.settings = newer(sa.updatedAt, sb.updatedAt) ? sb : sa;
  out.deleted = tomb;
  return out;
}

function canonical(s) {
  const o = {};
  for (const k of Object.keys(s || {}).sort()) {
    let v = s[k];
    if (ITEM_COLLECTIONS.includes(k) && Array.isArray(v)) v = [...v].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    o[k] = v;
  }
  return JSON.stringify(o);
}

/** True when both copies hold the same data (item order ignored). */
function sameContent(a, b) {
  return canonical(a) === canonical(b);
}

module.exports = { mergeStates, sameContent, ITEM_COLLECTIONS };
