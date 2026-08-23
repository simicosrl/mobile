import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { defineCustomElements } from '@ionic/pwa-elements/loader'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// If this script runs at all, clear the plain pre-React fallback wired up
// in index.html (see the inline script there for what happens if it never
// gets this far).
window.__appBooted = true;

// @capacitor/camera's web fallback (used if this ever runs as a plain web
// build, and by the browser-preview dev server) needs these custom elements
// registered for its action-sheet/camera-modal UI. The native Android path
// doesn't need this — it shows its own native action sheet.
defineCustomElements(window);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
