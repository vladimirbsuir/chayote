import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { pinToVisualViewport } from './lib/pinToVisualViewport';
import './styles/base.css';
import './styles/editor.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root element missing');
}

/* Before the first paint: the app is positioned against the visual viewport, and a
   reader who opens the keyboard on a phone should not see the frame where it has
   not been placed yet. */
pinToVisualViewport();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
