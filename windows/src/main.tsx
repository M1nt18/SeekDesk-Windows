import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

async function start() {
  if (['127.0.0.1', 'localhost'].includes(window.location.hostname) && new URLSearchParams(window.location.search).has('preview')) {
    const { installPreviewBridge } = await import('./preview-bridge');
    installPreviewBridge();
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}

void start();
