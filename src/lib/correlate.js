// Ingestion-agnostic correlation engine: a bipartite (or n-partite) graph over
// opaque node descriptors, emitted as connected components.
//
// THIS MODULE KNOWS NO FIELD NAME FROM ANY DATA SOURCE. It never mentions
// ServiceNow or Jira, never reads a `_jiraTickets` or a `statusCategory`, and
// imports nothing. Callers hand it normalized `{ side, id, data }` nodes and
// `{ from, to, kind }` edges built with `nodeKey()`, and get components back.
// That is what "extensible for future data sources" has to mean concretely:
// adding a Gainsight or a ServiceNow-API connector means writing one adapter
// (see `buildGraph` in insight-metrics.js) and touching nothing in here.
//
// Deliberate properties:
//   * No wall clock. Nothing in this file reads the current time; every
//     time-dependent value is computed by the caller against an explicit
//     snapshot anchor. There is a test that asserts this by scanning the source.
//   * No recursion and no `Math.max(...array)` spreads. Component sizes are
//     data-dependent — a hot ticket blocking hundreds of cases is exactly the
//     input this feature exists to surface, and both of those idioms blow up on
//     precisely that input.
//   * Deterministic output. Same nodes + same edges (in any input order) ⇒
//     byte-identical components, in a stable order, with stable ids. Screenshots
//     and CSV exports are reproducible.

/* ------------------------------ key handling ------------------------------ */

/**
 * Canonicalize a join key. Every id crossing this boundary passes through here,
 * on BOTH sides of every edge, so `hms-123`, `HMS-123 ` and `HMS-123` are one
 * node rather than three. (Defensive: the current ServiceNow-side parser already
 * uppercases its ids — see PLAN(unified-insights).md C2 — but a future adapter
 * or a hand-maintained key list will not.)
 *
 * @param {*} v
 * @returns {string} normalized key, or '' when there is nothing to normalize
 */
export const normalizeKey = (v) => (v == null ? '' : String(v).trim().toUpperCase());

// Composite-key separator. A NUL can't occur in a Jira key or a ServiceNow case
// number, so `side` and `id` are unambiguously recoverable.
const SEP = String.fromCharCode(0);

/**
 * Build the composite key that identifies a node inside the graph. Ids are only
 * unique WITHIN a side (a case number and a ticket key could in principle
 * collide), so the side is part of the identity.
 *
 * Edge endpoints MUST be built with this function — see `droppedEdges` on the
 * result for how a caller that forgets is caught rather than silently ignored.
 */
export const nodeKey = (side, id) => `${side}${SEP}${normalizeKey(id)}`;

/** Inverse of `nodeKey`. */
export function splitNodeKey(key) {
  const i = String(key).indexOf(SEP);
  if (i < 0) return { side: '', id: String(key) };
  return { side: key.slice(0, i), id: key.slice(i + 1) };
}

/* -------------------------------- hashing -------------------------------- */

// FNV-1a → 6 lowercase hex chars, for the stable-id suffix.
//
// Deliberately local rather than imported from ai-scrub.js `shortHash`, which
// is the same algorithm for an unrelated purpose (masking PII before it leaves
// the device). Keeping this engine import-free is the point of the module, and
// a reader should not have to wonder why a graph engine depends on the PII
// scrubber. Not a security primitive — it only names clusters.
function hash6(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/* ------------------------------- comparators ------------------------------ */

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpNode = (a, b) => cmpStr(a.key, b.key);
const cmpEdge = (a, b) =>
  cmpStr(a.from, b.from) || cmpStr(a.to, b.to) || cmpStr(String(a.kind ?? ''), String(b.kind ?? ''));

/* --------------------------------- types --------------------------------- */

/**
 * @typedef {Object} CorrelationNode
 * @property {string} side  which partition of the graph ('case', 'jira', …).
 *                          Chosen by the adapter; the engine only groups by it.
 * @property {string} id    the join key within that side (normalized on entry)
 * @property {*} [data]     opaque payload, returned untouched
 *
 * Any OTHER field an adapter puts on a node descriptor is preserved untouched
 * too, exactly like `data` — the engine never inspects it. That is how the
 * ServiceNow/Jira adapter tags a node as non-Atlassian (an `RN-` Resolution
 * Notes record) without the engine learning what Atlassian is.
 */

/**
 * @typedef {Object} CorrelationEdge
 * @property {string} from  a `nodeKey(side, id)` composite key
 * @property {string} to    a `nodeKey(side, id)` composite key
 * @property {string} [kind] opaque label carried through (e.g. which journal
 *                           field asserted the link). Never interpreted here.
 */

/**
 * @typedef {Object} Component
 * @property {string} id      stable, derived from the sorted member keys
 * @property {string[]} keys  sorted composite keys of every member
 * @property {CorrelationNode[]} nodes  members, sorted by composite key
 * @property {Record<string, CorrelationNode[]>} bySide  members grouped by side
 * @property {CorrelationEdge[]} edges  the edges inside this component, sorted
 */

/**
 * The Insight Object — one per cluster, assembled by insight-rank.js from a
 * `Component` plus the projections and metrics in insight-metrics.js. Documented
 * here because this is where the cluster identity is minted, and this shape is
 * the contract the UI, the CSV export and any future consumer read.
 *
 * `edges` / `mentionEdges` are an additive extension to the shape in the task
 * brief (PLAN(unified-insights).md Decision 2): `blastRadius` is PER-JIRA-KEY,
 * so projecting a 3-Jira / 5-case cluster back into three rows — each listing
 * only the cases actually linked to that key — is impossible from the membership
 * arrays alone. They also let a drill-down say which case is linked to which
 * ticket, rather than just "these things are related".
 *
 * @typedef {Object} Insight
 * @property {string} id
 * @property {string[]} jiraKeys            canonical, normalized
 * @property {string[]} caseNumbers
 * @property {string[]} mentionedOnlyKeys   display-only; NEVER edges
 * @property {{jiraKey: string, caseNumber: string, source: string}[]} edges
 * @property {{jiraKey: string, caseNumber: string}[]} mentionEdges  display-only
 * @property {object[]} jira    projections — see `projectJira`
 * @property {object[]} cases   projections — see `projectCase`
 * @property {object} metrics   see `clusterMetrics`
 * @property {number} score     0..100
 * @property {{label: string, weight: number, detail: string}[]} factors
 * @property {'high'|'medium'|'low'} band
 * @property {string[]} clusterFlags
 * @property {string} summary   deterministic, templated
 */

/* -------------------------------- the engine ------------------------------ */

/**
 * Group nodes into connected components over the given edges.
 *
 * Union-find with path compression and union-by-size: near-linear, iterative,
 * allocation-light. O(n + m).
 *
 * A node with no edges is NOT a component — it is returned in `isolated`. For
 * this app that is a meaningful distinction rather than a technicality: a case
 * that only name-drops a ticket in prose has asserted no linkage, so it must not
 * become a one-member "cluster" padding the bottom of the ranking. The caller
 * decides how to present it (see PLAN(unified-insights).md Decision 3).
 *
 * @param {object} input
 * @param {CorrelationNode[]} input.nodes
 * @param {CorrelationEdge[]} input.edges
 * @param {string} [input.idSide]  which side's ids form the readable prefix of a
 *   component id. Purely cosmetic — pass the side whose keys a human would
 *   recognize ('jira' here). Omit for "the first sorted member".
 * @returns {{
 *   components: Component[],
 *   isolated: CorrelationNode[],
 *   droppedEdges: CorrelationEdge[],
 * }}
 */
export function correlate({ nodes = [], edges = [], idSide = null } = {}) {
  /* 1. Index nodes by composite key. First writer wins, so a duplicate
        descriptor can't silently replace the payload of an earlier one. */
  const byKey = new Map();
  for (const n of nodes) {
    if (!n || n.side == null || n.id == null) continue;
    const id = normalizeKey(n.id);
    if (!id) continue;
    const key = nodeKey(n.side, id);
    // Spread first so adapter-supplied extras survive, then pin the fields the
    // engine owns.
    if (!byKey.has(key)) byKey.set(key, { ...n, side: String(n.side), id, key, data: n.data ?? null });
  }

  /* 2. Keep only edges whose BOTH endpoints are real nodes. A dangling edge is
        reported rather than ignored: silently dropping it is the exact failure
        mode of an unnormalized join (a synced ticket rendering as "not live"),
        so a caller that builds an endpoint without `nodeKey()` finds out. */
  const kept = [];
  const droppedEdges = [];
  for (const e of edges) {
    if (!e || e.from == null || e.to == null) continue;
    if (e.from === e.to) continue; // self-loop: no information, would union a node with itself
    if (byKey.has(e.from) && byKey.has(e.to)) kept.push(e);
    else droppedEdges.push(e);
  }

  /* 3. Union-find. */
  const parent = new Map();
  const size = new Map();
  for (const key of byKey.keys()) {
    parent.set(key, key);
    size.set(key, 1);
  }
  // Iterative find + two-pass path compression. No recursion: component depth
  // is data-dependent and a deep chain would overflow the stack.
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (size.get(ra) < size.get(rb)) {
      const t = ra;
      ra = rb;
      rb = t;
    }
    parent.set(rb, ra);
    size.set(ra, size.get(ra) + size.get(rb));
  };
  for (const e of kept) union(e.from, e.to);

  /* 4. Group edged nodes by root. */
  const touched = new Set();
  for (const e of kept) {
    touched.add(e.from);
    touched.add(e.to);
  }
  const groups = new Map(); // root -> { keys, edges }
  for (const key of touched) {
    const root = find(key);
    let g = groups.get(root);
    if (!g) {
      g = { keys: [], edges: [] };
      groups.set(root, g);
    }
    g.keys.push(key);
  }
  for (const e of kept) groups.get(find(e.from)).edges.push(e);

  /* 5. Emit, sorted at every level so the output is byte-stable. */
  const components = [];
  for (const g of groups.values()) {
    const keys = g.keys.sort(cmpStr);
    const nodesOut = keys.map((k) => byKey.get(k));
    const bySide = {};
    for (const n of nodesOut) {
      if (!bySide[n.side]) bySide[n.side] = [];
      bySide[n.side].push(n);
    }
    components.push({
      id: componentId(keys, idSide),
      keys,
      nodes: nodesOut,
      bySide,
      edges: g.edges.slice().sort(cmpEdge),
    });
  }
  components.sort((a, b) => cmpStr(a.id, b.id));

  const isolated = [];
  for (const n of byKey.values()) if (!touched.has(n.key)) isolated.push(n);
  isolated.sort(cmpNode);

  return { components, isolated, droppedEdges };
}

/**
 * Stable component id: a readable prefix plus a hash of the full sorted member
 * list. The prefix makes a CSV row or a React key debuggable at a glance
 * (`c:HMS-4821:1f2a9c`); the hash makes it unique and independent of input row
 * order. Two different clusters can share a prefix but never an id.
 */
function componentId(sortedKeys, idSide) {
  let head = null;
  if (idSide) {
    const prefix = `${idSide}${SEP}`;
    for (const k of sortedKeys) {
      if (k.startsWith(prefix)) {
        head = k.slice(prefix.length);
        break;
      }
    }
  }
  if (head == null) head = splitNodeKey(sortedKeys[0]).id;
  return `c:${head}:${hash6(sortedKeys.join('|'))}`;
}
