import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { maybeInstallXREmulator } from './game/xr/emulate'

// The emulator (dev, ?xr=emulate) must be in place before the app probes navigator.xr.
void maybeInstallXREmulator().finally(() => createRoot(document.getElementById('root')!).render(<App />))
