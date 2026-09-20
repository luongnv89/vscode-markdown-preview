// Incremental DOM patch (issue #77): diff the incoming render's top-level
// blocks against the last applied render and replace only the regions that
// changed. Unchanged blocks keep their live DOM nodes, so rendered diagrams,
// wrapped code blocks, checkbox state, and observer registrations all
// survive a keystroke elsewhere in the document.
//
// The diff runs on block signatures — each incoming top-level element's
// outerHTML — recorded at apply time. Signatures compare incoming render to
// incoming render, so post-processing mutations on live nodes (copy-button
// wrappers, rendered SVGs, KaTeX output) never enter the comparison: a block
// whose source is unchanged is kept no matter what post-processing did to it.
//
// Invariant: after each patch, `container.children` has exactly one element
// per recorded signature — every structural mutation this pipeline makes
// (wrapping a <pre>, filling a diagram block) preserves the top-level count.
// A count mismatch means the container was populated out-of-band (the
// rendering placeholder, or a missed code path) and the patch falls back to
// the same innerHTML rebuild it replaces, so state can never diverge.

export interface BlockPatch {
  // Top-level nodes inserted by this patch — the only subtrees
  // post-processing needs to visit.
  added: Element[];
  // Top-level nodes removed by this patch (already detached — observers
  // need them for unobserve calls).
  removed: Element[];
  // Top-level nodes kept in place.
  kept: Element[];
  // Whether the DOM was mutated (false when the render was identical).
  changed: boolean;
  // True when the patch fell back to a full innerHTML rebuild.
  fullRebuild: boolean;
}

let prevSignatures: string[] = [];

// Middle sizes beyond this skip the LCS and replace the whole region — a
// wholesale document change costs the same as the old innerHTML rebuild
// anyway, and quadratic LCS work buys nothing there.
const LCS_MIDDLE_LIMIT = 128;

/**
 * Patch `container` to match `html`, replacing only the top-level blocks
 * whose signature changed. Pass `forceFullRebuild` for renders whose whole
 * output must be rebuilt regardless of the diff (e.g. a feature-flag toggle
 * re-rendering the same source under new flags).
 */
export function applyBlockPatch(
  container: HTMLElement,
  html: string,
  forceFullRebuild = false
): BlockPatch {
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  const newKids = Array.from(scratch.children);
  const newSigs = newKids.map((el) => el.outerHTML);

  const oldKids = Array.from(container.children);
  if (forceFullRebuild || oldKids.length !== prevSignatures.length) {
    container.innerHTML = html;
    prevSignatures = newSigs;
    return {
      added: Array.from(container.children),
      removed: oldKids,
      kept: [],
      changed: true,
      fullRebuild: true,
    };
  }

  const keepPairs = diffSignatures(prevSignatures, newSigs);
  const patch = applyPairs(container, oldKids, newKids, keepPairs);
  resyncKeptCheckboxes(patch.kept);
  prevSignatures = newSigs;
  return patch;
}

/** Forget the recorded render — the next patch rebuilds wholesale. */
export function resetBlockDiff(): void {
  prevSignatures = [];
}

/**
 * Map nodes to their current top-level child of `container` (a <pre> that
 * was wrapped by a copy button resolves to its .code-block-wrapper).
 * Detached nodes and nodes outside `container` are dropped; the result is
 * deduplicated and in document order.
 */
export function topLevelNodes(container: Element, nodes: Element[]): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const node of nodes) {
    let n: Element | null = node;
    while (n.parentElement && n.parentElement !== container) {
      n = n.parentElement;
    }
    if (n.parentElement === container && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// Pair up blocks that survived the edit: the common prefix and suffix match
// directly, and an LCS over the differing middle keeps untouched siblings of
// an insertion, deletion, or move. Returns [oldIndex, newIndex] pairs sorted
// by both components.
function diffSignatures(oldSigs: string[], newSigs: string[]): Array<[number, number]> {
  let start = 0;
  while (start < oldSigs.length && start < newSigs.length && oldSigs[start] === newSigs[start]) {
    start++;
  }
  let oldEnd = oldSigs.length - 1;
  let newEnd = newSigs.length - 1;
  while (oldEnd >= start && newEnd >= start && oldSigs[oldEnd] === newSigs[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i++) {
    pairs.push([i, i]);
  }
  const oldMid = oldEnd - start + 1;
  const newMid = newEnd - start + 1;
  if (oldMid > 0 && newMid > 0 && oldMid <= LCS_MIDDLE_LIMIT && newMid <= LCS_MIDDLE_LIMIT) {
    pairs.push(...lcsPairs(oldSigs, newSigs, start, oldEnd, newEnd));
  }
  const shift = newEnd - oldEnd;
  for (let i = oldEnd + 1; i < oldSigs.length; i++) {
    pairs.push([i, i + shift]);
  }
  return pairs;
}

// Classic suffix-DP longest common subsequence over the middle ranges —
// kept small by LCS_MIDDLE_LIMIT, so the O(m·n) table stays trivial.
function lcsPairs(
  oldSigs: string[],
  newSigs: string[],
  start: number,
  oldEnd: number,
  newEnd: number
): Array<[number, number]> {
  const m = oldEnd - start + 1;
  const n = newEnd - start + 1;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        oldSigs[start + i] === newSigs[start + j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldSigs[start + i] === newSigs[start + j]) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

// Apply the keep pairs: drop every old node without a pair, insert the new
// nodes left-to-right, and sweep any child the patch does not track.
function applyPairs(
  container: HTMLElement,
  oldKids: Element[],
  newKids: Element[],
  keepPairs: Array<[number, number]>
): BlockPatch {
  const keptOld = new Set<number>();
  const oldOfNew = new Map<number, number>();
  for (const [o, n] of keepPairs) {
    keptOld.add(o);
    oldOfNew.set(n, o);
  }

  const removed: Element[] = [];
  const kept: Element[] = [];
  for (let i = 0; i < oldKids.length; i++) {
    if (keptOld.has(i)) {
      kept.push(oldKids[i]);
    } else {
      removed.push(oldKids[i]);
      oldKids[i].remove();
    }
  }

  const added = insertNewBlocks(container, oldKids, newKids, oldOfNew);
  sweepUntracked(container, kept, added);
  return {
    added,
    removed,
    kept,
    changed: added.length > 0 || removed.length > 0,
    fullRebuild: false,
  };
}

// Insert each unpaired new block after the last in-place node. Element
// order is what the patch tracks — stray whitespace text nodes between
// blocks are inert (stats are computed per block, not from
// container.textContent).
function insertNewBlocks(
  container: HTMLElement,
  oldKids: Element[],
  newKids: Element[],
  oldOfNew: Map<number, number>
): Element[] {
  const added: Element[] = [];
  let cursor: Element | null = null;
  for (let j = 0; j < newKids.length; j++) {
    const oldIdx = oldOfNew.get(j);
    if (oldIdx !== undefined) {
      cursor = oldKids[oldIdx];
      continue;
    }
    const el = newKids[j];
    container.insertBefore(el, cursor ? cursor.nextSibling : container.firstChild);
    added.push(el);
    cursor = el;
  }
  return added;
}

// Anything still in the container that the patch does not account for —
// the rendering placeholder on the first update — goes.
function sweepUntracked(container: HTMLElement, kept: Element[], added: Element[]): void {
  const tracked = new Set<Element>([...kept, ...added]);
  for (const child of Array.from(container.children)) {
    if (!tracked.has(child)) {
      child.remove();
    }
  }
}

// A kept list block's checkboxes can drift from the source of truth: a click
// flips the `checked` property, never the attribute, so when the document
// text says the box is still unchecked (a toggle whose edit did not land)
// the live node disagrees with a fresh render. Re-sync kept inputs to their
// attribute state — the same thing a full rebuild would have produced.
function resyncKeptCheckboxes(kept: Element[]): void {
  for (const el of kept) {
    if (el.tagName !== 'UL' && el.tagName !== 'OL') {
      continue;
    }
    el.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      (input as HTMLInputElement).checked = input.hasAttribute('checked');
    });
  }
}
