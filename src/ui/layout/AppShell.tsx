import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/Button';
import { ImportDrawer, type ImportKind } from '../components/ImportDrawer';
import { CommandPalette } from '../components/CommandPalette';
import { ValidationRulesDialog } from '../components/ValidationRulesDialog';
import { useStore } from '../../store/useStore';
import { useUiStore, type ViewName } from '../../store/useUiStore';

const NAV: { view: ViewName; label: string; icon: IconName }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { view: 'timeline', label: 'Timeline', icon: 'timeline' },
  { view: 'projects', label: 'Projects', icon: 'projects' },
  { view: 'team', label: 'Teams', icon: 'team' },
  { view: 'people', label: 'People', icon: 'calendar' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useUiStore((s) => s.view);
  const navigate = useUiStore((s) => s.navigate);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">CRP</span>
          <span className="brand-name">Resource Planner</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav-item ${view === item.view || (view === 'project-detail' && item.view === 'projects') ? 'active' : ''}`}
              onClick={() => navigate(item.view)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="main-column">
        <TopBar />
        <main className="content">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}

function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const saveDatabase = useStore((s) => s.saveDatabase);
  const exportXlsx = useStore((s) => s.exportXlsx);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [validationRulesOpen, setValidationRulesOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!helpMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (helpMenuRef.current && !helpMenuRef.current.contains(e.target as Node)) setHelpMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [helpMenuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-file">
        <Icon name="folder-open" size={14} />
        <span className="file-name">{fileName}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes to this file" />}
      </div>
      <div className="topbar-actions">
        <button type="button" className="topbar-search" onClick={() => setCommandPaletteOpen(true)}>
          <Icon name="search" size={13} />
          Jump to…
          <kbd>Ctrl K</kbd>
        </button>
        <Button icon="save" size="sm" variant={dirty ? 'primary' : 'secondary'} onClick={() => void saveDatabase()}>
          Save
        </Button>
        <div className="menu-wrap" ref={menuRef}>
          <Button icon="more" size="sm" variant="ghost" onClick={() => setMenuOpen((v) => !v)} aria-label="More file actions" />
          {menuOpen && <FileMenu onClose={() => setMenuOpen(false)} onImport={setImportKind} />}
        </div>
        <Button icon="download" size="sm" variant="secondary" onClick={() => void exportXlsx()}>
          Export
        </Button>
        <ProducerNameControl />
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
        </button>
        <div className="menu-wrap" ref={helpMenuRef}>
          <Button icon="help" size="sm" variant="ghost" onClick={() => setHelpMenuOpen((v) => !v)} aria-label="Help" />
          {helpMenuOpen && (
            <div className="dropdown-menu">
              <button type="button" onClick={() => { setHelpMenuOpen(false); setValidationRulesOpen(true); }}>
                <Icon name="info" size={14} /> Planning Health Validation Rules
              </button>
            </div>
          )}
        </div>
      </div>
      {importKind && <ImportDrawer kind={importKind} onClose={() => setImportKind(null)} />}
      {validationRulesOpen && <ValidationRulesDialog onClose={() => setValidationRulesOpen(false)} />}
    </header>
  );
}

/** Stamps every re-commit/variance declaration. A single global name kept in localStorage — good
 * enough until a real Settings/user-account screen exists (see useUiStore.ts producerName). */
function ProducerNameControl() {
  const producerName = useUiStore((s) => s.producerName);
  const setProducerName = useUiStore((s) => s.setProducerName);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(producerName);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function save(): void {
    setProducerName(draft.trim());
    setOpen(false);
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="producer-name-btn"
        onClick={() => { setDraft(producerName); setOpen((v) => !v); }}
        title="Your name — used to attribute re-commits and declared variances"
      >
        <Icon name="user" size={14} />
        {producerName || 'Set your name'}
      </button>
      {open && (
        <div className="dropdown-menu producer-name-menu">
          <label htmlFor="producer-name-input">Your name</label>
          <input
            id="producer-name-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            placeholder="e.g. Alex Martin"
          />
          <Button variant="primary" size="sm" onClick={save}>Save</Button>
        </div>
      )}
    </div>
  );
}

function FileMenu({ onClose, onImport }: { onClose: () => void; onImport: (kind: ImportKind) => void }) {
  const newDatabase = useStore((s) => s.newDatabase);
  const openDatabase = useStore((s) => s.openDatabase);
  const saveDatabaseAs = useStore((s) => s.saveDatabaseAs);

  function run(fn: () => void): void {
    fn();
    onClose();
  }

  return (
    <div className="dropdown-menu">
      <button type="button" onClick={() => run(() => void newDatabase(false))}>
        <Icon name="file-plus" size={14} /> New empty plan
      </button>
      <button type="button" onClick={() => run(() => void newDatabase(true))}>
        <Icon name="file-plus" size={14} /> New demo plan
      </button>
      <div className="dropdown-sep" />
      <button type="button" onClick={() => run(() => void openDatabase())}>
        <Icon name="folder-open" size={14} /> Open .sqlite…
      </button>
      <button type="button" onClick={() => run(() => void saveDatabaseAs())}>
        <Icon name="save" size={14} /> Save as / backup…
      </button>
      <div className="dropdown-sep" />
      <button type="button" onClick={() => run(() => onImport('rpm'))}>
        <Icon name="download" size={14} /> Import RPM export…
      </button>
      <button type="button" onClick={() => run(() => onImport('staffing'))}>
        <Icon name="download" size={14} /> Import Staffing Consolidated report…
      </button>
    </div>
  );
}
