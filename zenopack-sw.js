/*!
 * zenopack-sw.js
 * Service Worker for serving ZenoPack games in Eclipse.
 * Intercepts requests to /zenopack-games/{gameId}/* and serves
 * files from an in-memory store populated via postMessage.
 */

const SW_VERSION = '1.0.0';
const CACHE_NAME = 'zenopack-sw-v1';

// In-memory file store: Map<"/zenopack-games/{id}/{path}", { buffer: ArrayBuffer, mimeType: string }>
const fileStore = new Map();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ── MESSAGE HANDLER ───────────────────────────────────────────────
self.addEventListener('message', e => {
  const { type, gameId, filesMeta, buffers, payload } = e.data || {};
  const port = e.ports[0];

  if (type === 'REGISTER_GAME') {
    try {
      if (!gameId || !filesMeta || !buffers) {
        port?.postMessage({ type: 'ERROR', message: 'Missing fields' });
        return;
      }
      // Store each file
      filesMeta.forEach((meta, i) => {
        const key = `/zenopack-games/${gameId}/${meta.path}`;
        fileStore.set(key, { buffer: buffers[i], mimeType: meta.mimeType });
      });
      port?.postMessage({ type: 'GAME_REGISTERED', gameId });
    } catch(err) {
      port?.postMessage({ type: 'ERROR', message: err.message });
    }

  } else if (type === 'UNREGISTER_GAME') {
    const prefix = `/zenopack-games/${gameId}/`;
    for (const key of [...fileStore.keys()]) {
      if (key.startsWith(prefix)) fileStore.delete(key);
    }
    port?.postMessage({ type: 'GAME_UNREGISTERED', gameId });

  } else if (type === 'PING_GAME') {
    const prefix = `/zenopack-games/${gameId}/`;
    const found = [...fileStore.keys()].some(k => k.startsWith(prefix));
    port?.postMessage({ type: found ? 'GAME_FOUND' : 'GAME_MISSING', gameId });

  } else if (type === 'CLEAR_ALL') {
    fileStore.clear();
    port?.postMessage({ type: 'CLEARED' });

  } else if (type === 'PING') {
    port?.postMessage({ type: 'PONG', version: SW_VERSION });
  }
});

// ── FETCH HANDLER ─────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (!url.pathname.startsWith('/zenopack-games/')) return;

  e.respondWith(handleGameFetch(url));
});

async function handleGameFetch(url) {
  let path = url.pathname;

  // Try exact match
  if (fileStore.has(path)) {
    return serveFile(fileStore.get(path));
  }

  // Try with index.html fallback (SPA-style)
  const parts = path.split('/');
  // /zenopack-games/{gameId}/... -> try index.html
  if (parts.length >= 3) {
    const gameId = parts[2];
    const indexKey = `/zenopack-games/${gameId}/index.html`;
    if (fileStore.has(indexKey)) {
      return serveFile(fileStore.get(indexKey));
    }
  }

  return new Response(`Not found: ${path}`, {
    status: 404,
    headers: { 'Content-Type': 'text/plain' }
  });
}

function serveFile({ buffer, mimeType }) {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    }
  });
}