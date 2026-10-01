import { Icon } from '../components/Icon';

/** The zoom slider shared by the project Timeline and the cinematic Schedule (LoqTimeline), so a
 * change to one view's zoom affordance applies to both. `zoom` may be fractional (the Schedule's
 * fit zoom), hence the rounded label. */
export function TimelineZoomControl({ zoom, min, max, onChange }: {
  zoom: number;
  min: number;
  max: number;
  onChange: (zoom: number) => void;
}) {
  return (
    <div className="tl-zoom">
      <Icon name="zoom-out" size={13} />
      <input
        type="range"
        className="tl-zoom-slider"
        min={min}
        max={max}
        step={5}
        value={zoom}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Zoom level"
        title="Ctrl+scroll over the timeline also zooms"
      />
      <Icon name="zoom-in" size={13} />
      <span className="zoom-label">{Math.round(zoom)}%</span>
    </div>
  );
}
