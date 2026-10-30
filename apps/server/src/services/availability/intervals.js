/**
 * Half-open interval math on instants, used by the availability engine.
 *
 * Conventions (used across the whole availability engine):
 * - An interval is `{ start, end }` where both values are `Date` instants
 *   (UTC) and `start < end`.
 * - Half-open `[start, end)`: the start instant belongs to the interval,
 *   the end instant does not. Adjacent intervals therefore never overlap.
 * - All comparisons happen on epoch milliseconds.
 */

/**
 * Validate that a value looks like a usable half-open interval.
 * @param {unknown} interval
 * @returns {boolean}
 */
export function isValidInterval(interval) {
  return (
    interval !== null &&
    typeof interval === 'object' &&
    interval.start instanceof Date &&
    interval.end instanceof Date &&
    Number.isFinite(interval.start.getTime()) &&
    Number.isFinite(interval.end.getTime()) &&
    interval.start.getTime() < interval.end.getTime()
  );
}

/**
 * Sort intervals by start time. Does not mutate the input.
 * @param {Array<{start: Date, end: Date}>} intervals
 * @returns {Array<{start: Date, end: Date}>}
 */
export function sortIntervals(intervals) {
  return [...intervals]
    .filter(isValidInterval)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
}

/**
 * Test whether two half-open intervals share any time.
 * @param {{start: Date, end: Date}} a
 * @param {{start: Date, end: Date}} b
 * @returns {boolean}
 */
export function intervalsOverlap(a, b) {
  return (
    isValidInterval(a) &&
    isValidInterval(b) &&
    a.start.getTime() < b.end.getTime() &&
    b.start.getTime() < a.end.getTime()
  );
}

/**
 * Merge overlapping or touching intervals into a minimal set of disjoint
 * intervals (e.g. [10,12) + [12,14) -> [10,14)).
 * @param {Array<{start: Date, end: Date}>} intervals
 * @returns {Array<{start: Date, end: Date}>} sorted, non-overlapping
 */
export function mergeIntervals(intervals) {
  const sorted = sortIntervals(intervals);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) {
        last.end = interval.end;
      }
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/**
 * Intersect two interval lists: returns the times covered by BOTH lists.
 * @param {Array<{start: Date, end: Date}>} listA
 * @param {Array<{start: Date, end: Date}>} listB
 * @returns {Array<{start: Date, end: Date}>} sorted non-overlapping intervals
 */
export function intersectIntervalLists(listA, listB) {
  const a = mergeIntervals(listA);
  const b = mergeIntervals(listB);
  const result = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start.getTime(), b[j].start.getTime());
    const end = Math.min(a[i].end.getTime(), b[j].end.getTime());
    if (start < end) {
      result.push({ start: new Date(start), end: new Date(end) });
    }
    if (a[i].end.getTime() < b[j].end.getTime()) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}

/**
 * Remove the times covered by `removals` from the intervals in `base`
 * (e.g. subtract breaks and leave from staff shift windows).
 * @param {Array<{start: Date, end: Date}>} base
 * @param {Array<{start: Date, end: Date}>} removals
 * @returns {Array<{start: Date, end: Date}>} sorted non-overlapping remainders
 */
export function subtractIntervals(base, removals) {
  let current = mergeIntervals(base);
  if (current.length === 0) return [];
  const mergedRemovals = mergeIntervals(removals);
  for (const removal of mergedRemovals) {
    const next = [];
    const rs = removal.start.getTime();
    const re = removal.end.getTime();
    for (const interval of current) {
      const s = interval.start.getTime();
      const e = interval.end.getTime();
      if (re <= s || e <= rs) {
        // No overlap
        next.push(interval);
        continue;
      }
      if (rs > s) {
        next.push({ start: new Date(s), end: new Date(rs) });
      }
      if (e > re) {
        next.push({ start: new Date(re), end: new Date(e) });
      }
    }
    current = next;
  }
  return current;
}

/**
 * Total elapsed milliseconds covered by an interval list (overlap-safe:
 * first merges, then sums).
 * @param {Array<{start: Date, end: Date}>} intervals
 * @returns {number}
 */
export function totalDurationMs(intervals) {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
}
