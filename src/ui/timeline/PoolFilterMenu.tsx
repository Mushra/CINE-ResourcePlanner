import type { ResourcePool } from '../../domain/types';
import { FilterMenu } from '../components/FilterMenu';

/** Timeline's métier (role) filter — a thin FilterMenu grouping roles by discipline. */
export function PoolFilterMenu({
  pools, disciplineName, activePoolIds, onChange,
}: {
  pools: ResourcePool[];
  disciplineName: (pool: ResourcePool) => string;
  activePoolIds: Set<string>;
  onChange: (next: Set<string> | null) => void;
}) {
  const options = pools.map((pool) => ({ id: pool.id, label: pool.name, color: pool.color, group: disciplineName(pool) }));
  return (
    <FilterMenu
      label="Role"
      options={options}
      activeIds={activePoolIds}
      onChange={onChange}
    />
  );
}
