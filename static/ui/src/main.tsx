import { view } from '@forge/bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Follow Jira's light or dark theme (sets data-color-mode on <html>). Outside Jira this
// rejects and the stylesheet falls back to the OS setting.
view.theme.enable().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
