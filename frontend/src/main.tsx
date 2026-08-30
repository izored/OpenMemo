import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import './styles/fonts.css';
import './index.css';
import './styles/transitions.css';
import './styles/typeset.css';
import './styles/openmemo.css';

// Running inside the macOS shell? The window is frameless
// (titleBarStyle: 'hiddenInset'), so the traffic lights float over whatever the
// page paints in its top-left corner — which is the sidebar's "openMemo" mark.
// Stamping the root before first paint lets the stylesheet reserve that band
// itself, instead of relying on CSS the shell injects after load (which lands
// AFTER the app's own rules and only ever patched .om-sidebar-head).
if (typeof window !== 'undefined' && window.openmemoShell?.platform === 'darwin') {
  document.documentElement.dataset.shell = 'mac';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
