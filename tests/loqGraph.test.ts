import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from '../src/domain/loqGraph';

function edge(predecessorLoqId: string, successorLoqId: string) {
  return { predecessorLoqId, successorLoqId };
}

describe('wouldCreateCycle', () => {
  it('allows a fresh edge with no existing dependencies', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
  });

  it('rejects a self-loop', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects a direct back-edge (b already precedes a)', () => {
    const deps = [edge('b', 'a')];
    expect(wouldCreateCycle(deps, 'a', 'b')).toBe(true);
  });

  it('rejects an indirect back-edge through a longer chain', () => {
    // a -> b -> c already exists; c -> a would close the loop.
    const deps = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCreateCycle(deps, 'c', 'a')).toBe(true);
  });

  it('allows a chain extension that does not loop back', () => {
    const deps = [edge('a', 'b'), edge('b', 'c')];
    expect(wouldCreateCycle(deps, 'c', 'd')).toBe(false);
  });

  it('ignores unrelated edges elsewhere in the graph', () => {
    const deps = [edge('x', 'y'), edge('y', 'z')];
    expect(wouldCreateCycle(deps, 'a', 'b')).toBe(false);
  });
});
