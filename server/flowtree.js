// The conversation's flowchart: a tree that only grows. Goal nodes are what the user asked for;
// step nodes under them are the work. The model never rewrites it: it returns operations (add a
// node, change a state, rename a step not started yet) and these rules apply them, so finished and
// dropped nodes stay exactly as they were and a change of direction becomes a new branch.
export const MAX_NODES = 120;
export const MAX_GOAL_DEPTH = 3; // trunk, a branch, a branch off a branch
const FINAL = new Set(["done", "dropped"]);

export function emptyTree() { return { nodes: [], seq: 0, cursor: 0 }; }

const byId = (t) => new Map(t.nodes.map((n) => [n.id, n]));
export const childrenOf = (t, id) => t.nodes.filter((n) => n.parent === id);
const ancestors = (t, n) => { const m = byId(t), out = []; for (let p = n && m.get(n.parent); p; p = m.get(p.parent)) out.push(p); return out; };

// Apply the model's operations. Returns a new tree; the input is not changed.
export function applyOps(tree, ops = [], turn = 0) {
  const t = { ...tree, nodes: tree.nodes.map((n) => ({ ...n })) };
  const m = byId(t), refs = new Map();
  const resolve = (x) => (x && (refs.get(x) || (m.has(x) ? x : null))) || null;
  for (const o of ops || []) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "add") {
      const label = String(o.label || "").trim().slice(0, 80);
      if (!label || t.nodes.length >= MAX_NODES) continue;
      let parent = resolve(o.parent);
      // A step needs a goal above it. The conversation's first goal is the trunk: every later goal
      // branches off it (or off the goal it grew from), never far enough down to run off the rail.
      if (!parent && o.kind !== "goal") parent = currentGoal(t)?.id || null;
      const trunk = t.nodes.find((n) => !n.parent);
      if (o.kind === "goal" && trunk) {
        if (!parent) parent = trunk.id;
        while (parent && ancestors(t, m.get(parent)).length >= MAX_GOAL_DEPTH - 1) parent = m.get(parent).parent;
      }
      const id = "n" + ++t.seq;
      const n = { id, parent, label, kind: o.kind === "goal" ? "goal" : "step", state: ["done", "current", "next", "dropped"].includes(o.state) ? o.state : "next", note: String(o.note || "").slice(0, 40), turn };
      t.nodes.push(n); m.set(id, n);
      if (o.ref) refs.set(String(o.ref), id);
    } else if (o.op === "state") {
      const n = m.get(resolve(o.id));
      if (!n || FINAL.has(n.state) || !["done", "current", "next", "dropped"].includes(o.state)) continue;
      n.state = o.state;
      if (o.note) n.note = String(o.note).slice(0, 40);
    } else if (o.op === "rename") {
      const n = m.get(resolve(o.id));
      const label = String(o.label || "").trim().slice(0, 80);
      if (n && n.state === "next" && label) n.label = label;
    }
  }
  return normalize(t);
}

// Exactly one current leaf (the newest the model marked current); its goals are current too.
// An older current step the work has moved past is done; an older current goal is done once all
// its steps are, otherwise it waits as "next".
export function normalize(t) {
  const cur = t.nodes.filter((n) => n.state === "current");
  const leaf = [...cur].reverse().find((n) => !childrenOf(t, n.id).some((c) => c.state === "current")) || null;
  const path = new Set(leaf ? [leaf.id, ...ancestors(t, leaf).map((a) => a.id)] : []);
  for (const n of cur) {
    if (path.has(n.id)) continue;
    n.state = n.kind === "step" || childrenOf(t, n.id).every((c) => FINAL.has(c.state)) ? "done" : "next";
  }
  for (const id of path) { const n = t.nodes.find((x) => x.id === id); if (n && !FINAL.has(n.state)) n.state = "current"; }
  // A goal whose steps are all finished, and which isn't on the current path, is done.
  // Deepest first, so a goal sees its finished branches as finished.
  for (const g of t.nodes.filter((n) => n.kind === "goal" && !path.has(n.id) && !FINAL.has(n.state)).reverse()) {
    const kids = childrenOf(t, g.id);
    if (kids.length && kids.every((c) => FINAL.has(c.state))) g.state = "done";
  }
  return t;
}

export function currentLeaf(t) {
  const cur = t.nodes.filter((n) => n.state === "current");
  return cur.find((n) => !childrenOf(t, n.id).some((c) => c.state === "current")) || null;
}
export function currentGoal(t) {
  const leaf = currentLeaf(t);
  if (leaf && leaf.kind === "goal") return leaf;
  if (leaf) return ancestors(t, leaf).find((a) => a.kind === "goal") || null;
  return [...t.nodes].reverse().find((n) => n.kind === "goal") || null;
}

// The steps of the goal being worked on: the short list the Orchestrator row and counts use.
export function stepsFromTree(t) {
  const g = currentGoal(t);
  const kids = g ? childrenOf(t, g.id).filter((n) => n.state !== "dropped") : t.nodes.filter((n) => !n.parent);
  return kids.map((n) => ({ label: n.label, state: n.state === "dropped" ? "done" : n.state, note: n.note || "" }));
}

// The tree as the model sees it: indented, with ids and states.
export function treeText(t) {
  const lines = [];
  const walk = (parent, depth) => { for (const n of childrenOf(t, parent)) { lines.push(`${"  ".repeat(depth)}- ${n.id} [${n.kind}, ${n.state}] ${n.label}${n.note ? ` (${n.note})` : ""}`); walk(n.id, depth + 1); } };
  walk(null, 0);
  return lines.join("\n");
}
