import { useState } from 'react';
import { Drawer } from './Drawer';
import { Button } from './Button';
import { useStore } from '../../store/useStore';
import type { Loq } from '../../domain/types';

/**
 * The only UI path allowed to change a LOQ's committed dates: every change is an attributed,
 * justified event (PLANNING_ENGINE.md §3), not an in-place overwrite. Also shows the LOQ's full
 * commitment history, satisfying the "see a LOQ's commitment history" Phase 3 acceptance criterion.
 */
export function RecommitDialog({
  loq, initialStart, initialFinish, onClose,
}: {
  loq: Loq;
  initialStart: string | null;
  initialFinish: string | null;
  onClose: () => void;
}) {
  const allEvents = useStore((s) => s.data.loqCommitmentEvents);
  const recommitLoq = useStore((s) => s.recommitLoq);
  const events = allEvents.filter((e) => e.loqId === loq.id);
  const history = [...events].sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const defaultReason = history.length === 0 ? 'Initial commitment' : '';

  const [start, setStart] = useState(initialStart);
  const [finish, setFinish] = useState(initialFinish);
  const [reason, setReason] = useState(defaultReason);
  const [comment, setComment] = useState('');

  const dirty = start !== initialStart || finish !== initialFinish || reason !== defaultReason || comment !== '';
  const datesInvalid = Boolean(start && finish && start > finish);
  const canSave = reason.trim().length > 0 && !datesInvalid;

  function save(): void {
    recommitLoq(loq.id, { committedStart: start, committedFinish: finish, reason: reason.trim(), comment: comment.trim() });
    onClose();
  }

  return (
    <Drawer title="Re-commit dates" onClose={onClose} dirty={dirty}>
      <p className="field-hint">
        {loq.type} — committed dates change only via an attributed, justified event, never a silent overwrite.
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="recommit-start">Committed start</label>
          <input id="recommit-start" type="date" value={start ?? ''} onChange={(e) => setStart(e.target.value || null)} />
        </div>
        <div className="field">
          <label htmlFor="recommit-finish">Committed finish</label>
          <input id="recommit-finish" type="date" value={finish ?? ''} onChange={(e) => setFinish(e.target.value || null)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="recommit-reason">Reason</label>
        <input id="recommit-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this changing?" />
      </div>

      <div className="field">
        <label htmlFor="recommit-comment">Comment</label>
        <textarea id="recommit-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional detail…" />
      </div>

      {datesInvalid && <div className="form-warning">Committed finish is before the committed start — fix this before saving.</div>}

      <div className="drawer-footer" style={{ margin: '4px -20px -18px', width: 'calc(100% + 40px)' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>Re-commit</Button>
      </div>

      {history.length > 0 && (
        <div className="recommit-history">
          <h3>Commitment history</h3>
          <ul>
            {history.map((e) => (
              <li key={e.id}>
                <div className="recommit-history-window">{e.committedStart ?? '—'} → {e.committedFinish ?? '—'}</div>
                <div className="recommit-history-meta">{e.changedBy} · {new Date(e.changedAt).toLocaleString()}</div>
                {e.reason && <div className="recommit-history-reason">{e.reason}</div>}
                {e.comment && <div className="recommit-history-comment">{e.comment}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}
