import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
// The Windows workspace may be reached through a directory junction on another drive.
export default defineConfig({root:realpathSync(process.cwd()),base: './', plugins: [react(), {name:'local-dev-csp',apply:'serve',transformIndexHtml: html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")}], server: {host: '127.0.0.1', port: 5173, strictPort: true,watch:{ignored:['**/.test-data/**','**/release/**','**/verification/**','**/dist-electron/**']}}});
