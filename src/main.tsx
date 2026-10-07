import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/editor.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root element missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
