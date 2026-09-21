import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { useStore } from '../../store/useStore';
import { VARIANCE_CATEGORIES } from '../../domain/variance';
import type { Loq } from '../../domain/types';

/**
 * Declares why forecast differs from committed without changing the committed baseline itself
 * (PLANNING_ENGINE.md §4) — distinct from RecommitDialog, which changes the baseline. Also shows the
 * LOQ's full declared-variance history.
 */
export function VarianceDialog({ loq, onClose }: { loq: Loq; onClose: () => void }) {
  const allEvents = useStore((s) => s.data.varianceEvents);
  const declareVariance = useStore((s) => s.declareVariance);
  const history = allEvents
    .filter((e) => e.loqId === loq.id)
    .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));

  const committedDate = loq.committedFinish ?? loq.committedStart;
  const [category, setCategory] = useState<string>(VARIANCE_CATEGORIES[0].value);
  const [expectedFinish, setExpectedFinish] = useState(committedDate ?? '');
  const [comment, setComment] = useState('');

  const dirty = category !== VARIANCE_CATEGORIES[0].value || expectedFinish !== (committedDate ?? '') || comment !== '';
  const canSave = expectedFinish.trim().length > 0;

  function save(): void {
    declareVariance(loq.id, { category, expectedFinish, comment: comment.trim() });
    onClose();
  }

  return (
    <Drawer title="Declare variance" onClose={onClose} dirty={dirty}>
      <p className="field-hint">
        {loq.type} — a variance explains a gap between committed and forecast without changing the committed baseline.
      </p>

      {committedDate && <p className="field-hint">Committed: {committedDate}</p>}

      <div className="field">
        <label htmlFor="variance-category">Category</label>
        <select id="variance-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {VARIANCE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="variance-expected-finish">Expected finish</label>
        <input id="variance-expected-finish" type="date" value={expectedFinish} onChange={(e) => setExpectedFinish(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="variance-comment">Comment</label>
        <textarea id="variance-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional detail…" />
      </div>

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>Declare</Button>
      </div>

      {history.length > 0 && (
        <div className="recommit-history">
          <h3>Declared variances</h3>
          <ul>
            {history.map((e) => {
              const label = VARIANCE_CATEGORIES.find((c) => c.value === e.category)?.label ?? e.category;
              return (
                <li key={e.id}>
                  <div className="recommit-history-window">
                    {label} · {e.deltaDays >= 0 ? '+' : ''}{e.deltaDays}d
                  </div>
                  <div className="recommit-history-meta">{e.declaredBy} · {new Date(e.declaredAt).toLocaleString()}</div>
                  {e.comment && <div className="recommit-history-comment">{e.comment}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Drawer>
  );
}
