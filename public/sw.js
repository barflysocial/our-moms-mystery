const CACHE = 'reunion-v3-guided-20260712';
const STATIC = ['/', '/styles.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install',(event)=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(STATIC)));});
self.addEventListener('activate',(event)=>{event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',(event)=>{const req=event.request;const url=new URL(req.url);if(req.method!=='GET'||url.pathname.startsWith('/api/'))return;if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/')));return;}event.respondWith(fetch(req).then((response)=>{const copy=response.clone();caches.open(CACHE).then((cache)=>cache.put(req,copy));return response;}).catch(()=>caches.match(req)));});
