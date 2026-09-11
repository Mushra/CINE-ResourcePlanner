import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Button } from '../components/Button';
import { ImportDrawer } from '../components/ImportDrawer';
import { CommandPalette } from '../components/CommandPalette';
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
  const [importOpen, setImportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

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
          {menuOpen && <FileMenu onClose={() => setMenuOpen(false)} onImport={() => setImportOpen(true)} />}
        </div>
        <Button icon="download" size="sm" variant="secondary" onClick={() => void exportXlsx()}>
          Export
        </Button>
        <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
        </button>
      </div>
      {importOpen && <ImportDrawer onClose={() => setImportOpen(false)} />}
    </header>
  );
}

function FileMenu({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
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
      <button type="button" onClick={() => run(onImport)}>
        <Icon name="download" size={14} /> Import RPM export…
      </button>
    </div>
  );
}
