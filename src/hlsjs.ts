/**
 * Local hls.js bundle for the browser player page.
 *
 * Served from node_modules so the player has no runtime dependency on an
 * external CDN (jsdelivr is often slow/blocked on Indonesian networks,
 * which made the player intermittently fail to start).  The file is read
 * once at first request and cached in memory afterwards.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let bundle: Promise<string> | null = null;

export function hlsJsBundle(): Promise<string> {
  if (!bundle) {
    const dist = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../node_modules/hls.js/dist/hls.min.js',
    );
    bundle = readFile(dist, 'utf8');
  }
  return bundle;
}
