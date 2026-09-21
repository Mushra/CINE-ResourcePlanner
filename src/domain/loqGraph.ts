/** Simple reachability check, not a constraint solver (PLANNING_ENGINE.md §6). Adding an edge
 * predecessorId -> successorId would create a cycle iff successorId can already reach predecessorId
 * by following existing edges forward. */
export function wouldCreateCycle(
  deps: { predecessorLoqId: string; successorLoqId: string }[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  const stack = [successorId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === predecessorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of deps) {
      if (dep.predecessorLoqId === current) stack.push(dep.successorLoqId);
    }
  }
  return false;
}
