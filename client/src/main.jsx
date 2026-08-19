import React from 'react';
import { createRoot } from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import '@xyflow/react/dist/style.css';
import { Theme } from '@astryxdesign/core/theme';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { unframedTheme } from './theme.js';
import App from './App.jsx';
import './styles.css';

// ?trace=1 arms the pointer/selection tracer. A dynamic import, so it is its own
// chunk and never lands in a normal bundle. See debug/trace.js for what it answers.
if (new URLSearchParams(location.search).has('trace')) import('./debug/trace.js');
// The whole node is draggable and controls opt out with `nodrag`; forgetting one is
// silent. This warns about any that were missed. Dev only, and dynamic for the same
// reason as above.
if (import.meta.env.DEV) import('./debug/nodragCheck.js');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Theme theme={unframedTheme}>
      {/* Explicit viewport (vs useToast's self-mounted fallback) for one reason:
          position. Toasts go bottom-left, clear of the tools rail and the FABs,
          which own the bottom-right corner. */}
      <ToastViewport position="bottomStart">
        <App />
      </ToastViewport>
    </Theme>
  </React.StrictMode>,
);
