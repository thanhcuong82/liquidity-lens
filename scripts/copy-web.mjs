// Copies the static web app into www/ for the Android (Capacitor) build.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'icons']) cpSync(p, `www/${p}`, { recursive: true });
console.log('web files copied to www/');
