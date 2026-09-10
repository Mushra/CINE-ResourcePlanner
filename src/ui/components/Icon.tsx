import type { SVGProps } from 'react';

export type IconName =
  | 'dashboard' | 'timeline' | 'projects' | 'team' | 'forecast'
  | 'plus' | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'close'
  | 'warning' | 'critical' | 'check' | 'info'
  | 'sun' | 'moon' | 'save' | 'folder-open' | 'file-plus' | 'download'
  | 'search' | 'more' | 'arrow-left' | 'trash' | 'edit' | 'calendar' | 'zoom-in' | 'zoom-out' | 'structure' | 'filter' | 'table';

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.2" /><rect x="14" y="3" width="7" height="5" rx="1.2" /><rect x="14" y="12" width="7" height="9" rx="1.2" /><rect x="3" y="16" width="7" height="5" rx="1.2" /></>,
  timeline: <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /><rect x="5" y="4.5" width="5" height="3" rx="0.8" fill="currentColor" stroke="none" /><rect x="10" y="10.5" width="7" height="3" rx="0.8" fill="currentColor" stroke="none" /><rect x="6" y="16.5" width="4" height="3" rx="0.8" fill="currentColor" stroke="none" /></>,
  projects: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="4" x2="8" y2="9" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.3" /><path d="M15.5 19.5a4.5 4.5 0 0 1 6.2-4.1" /></>,
  forecast: <><polyline points="3,18 9,10 13,14 21,5" /><polyline points="15,5 21,5 21,11" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  'chevron-right': <polyline points="9,5 16,12 9,19" />,
  'chevron-down': <polyline points="5,9 12,16 19,9" />,
  'chevron-left': <polyline points="15,5 8,12 15,19" />,
  close: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  warning: <><path d="M12 3.5 L21 19.5 H3 Z" /><line x1="12" y1="10" x2="12" y2="14.5" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>,
  critical: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="7" x2="12" y2="13" /><circle cx="12" cy="16" r="0.6" fill="currentColor" /></>,
  check: <polyline points="4,13 9,18 20,6" />,
  info: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="7.5" r="0.6" fill="currentColor" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><g strokeLinecap="round"><line x1="12" y1="2" x2="12" y2="4.5" /><line x1="12" y1="19.5" x2="12" y2="22" /><line x1="2" y1="12" x2="4.5" y2="12" /><line x1="19.5" y1="12" x2="22" y2="12" /><line x1="4.9" y1="4.9" x2="6.6" y2="6.6" /><line x1="17.4" y1="17.4" x2="19.1" y2="19.1" /><line x1="4.9" y1="19.1" x2="6.6" y2="17.4" /><line x1="17.4" y1="6.6" x2="19.1" y2="4.9" /></g></>,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />,
  save: <><path d="M5 3h11l3 3v15H5Z" /><rect x="8" y="14" width="8" height="6" /><rect x="8" y="4" width="6" height="4" /></>,
  'folder-open': <path d="M3 7a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2h7A1.5 1.5 0 0 1 18.5 9H8.5a1.5 1.5 0 0 0-1.45 1.12L4.8 18H3Z" />,
  'file-plus': <><path d="M6 3h8l4 4v14H6Z" /><line x1="10" y1="14" x2="16" y2="14" /><line x1="13" y1="11" x2="13" y2="17" /></>,
  download: <><path d="M12 3v12" /><polyline points="7,10 12,15 17,10" /><line x1="4" y1="20" x2="20" y2="20" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><line x1="19.5" y1="19.5" x2="15.2" y2="15.2" /></>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  'arrow-left': <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11,6 5,12 11,18" /></>,
  trash: <><path d="M5 7h14" /><path d="M9 7V4h6v3" /><path d="M7 7l1 13h8l1-13" /></>,
  edit: <><path d="M4 20l.9-4L16 5l4 4L8.9 20.9Z" /><line x1="13.5" y1="7.5" x2="17.5" y2="11.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="1.5" /><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /></>,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6.5" /><line x1="19.5" y1="19.5" x2="15.2" y2="15.2" /><line x1="7.5" y1="10.5" x2="13.5" y2="10.5" /><line x1="10.5" y1="7.5" x2="10.5" y2="13.5" /></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6.5" /><line x1="19.5" y1="19.5" x2="15.2" y2="15.2" /><line x1="7.5" y1="10.5" x2="13.5" y2="10.5" /></>,
  structure: <><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4" /><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" /></>,
  filter: <path d="M4 4h16l-6 8v6l-4 2v-8Z" />,
  table: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="3" y1="14.5" x2="21" y2="14.5" /><line x1="9" y1="4" x2="9" y2="20" /></>,
};

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
