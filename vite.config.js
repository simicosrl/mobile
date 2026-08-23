import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Conservative target: this app is meant to run on Zebra handhelds and
    // other industrial/enterprise Android devices, which often carry an
    // older System WebView than a typical consumer phone. Targeting a
    // widely-supported baseline instead of Vite's default (which assumes a
    // very recent evergreen browser) avoids a JS syntax the WebView can't
    // even parse turning into a silent blank screen.
    target: ['es2019', 'chrome80', 'safari13'],
  },
})
