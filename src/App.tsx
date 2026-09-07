import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { useUiStore } from './store/useUiStore';
import { AppShell } from './ui/layout/AppShell';
import { Toaster } from './ui/components/Toaster';
import { Dashboard } from './ui/views/Dashboard';
import { Timeline } from './ui/timeline/Timeline';
import { Projects } from './ui/views/Projects';
import { ProjectDetail } from './ui/views/ProjectDetail';
import { Team } from './ui/views/Team';
import { Forecast } from './ui/views/Forecast';

function App() {
  const status = useStore((s) => s.status);
  const errorMessage = useStore((s) => s.errorMessage);
  const theme = useStore((s) => s.theme);
  const init = useStore((s) => s.init);
  const view = useUiStore((s) => s.view);
  const selectedProjectId = useUiStore((s) => s.selectedProjectId);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  if (status === 'loading') {
    return <div className="app-loading">Loading plan…</div>;
  }

  if (status === 'error') {
    return (
      <div className="app-loading app-loading-error">
        <p>Could not load the plan.</p>
        <p className="app-loading-detail">{errorMessage}</p>
      </div>
    );
  }

  return (
    <>
      <AppShell>
        {view === 'dashboard' && <Dashboard />}
        {view === 'timeline' && <Timeline />}
        {view === 'projects' && <Projects />}
        {view === 'project-detail' && selectedProjectId && <ProjectDetail projectId={selectedProjectId} />}
        {view === 'team' && <Team />}
        {view === 'forecast' && <Forecast />}
      </AppShell>
      <Toaster />
    </>
  );
}

export default App;
