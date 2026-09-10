import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './ui/components/components.css';
import './ui/components/drawer.css';
import './ui/components/table.css';
import './ui/layout/layout.css';
import './ui/views/views.css';
import './ui/views/dashboard.css';
import './ui/views/project-detail.css';
import './ui/views/forecast.css';
import './ui/views/people.css';
import './ui/views/team.css';
import './ui/timeline/timeline.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
