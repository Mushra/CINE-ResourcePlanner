import { describe, expect, it } from 'vitest';
import { useUiStore } from '../../src/store/useUiStore';

describe('useUiStore producerName preference', () => {
  it('defaults to empty and persists to localStorage on change', () => {
    expect(useUiStore.getState().producerName).toBe('');

    useUiStore.getState().setProducerName('Alex Martin');

    expect(useUiStore.getState().producerName).toBe('Alex Martin');
    expect(localStorage.getItem('cine-planner-producer-name')).toBe('Alex Martin');
  });
});
