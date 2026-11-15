const CACHE = 'onego-free-shell-v5';
const SHELL = ['/', '/index.html', '/config.js', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/.netlify/')) return;
  event.respondWith(fetch(req).catch(()=>caches.match(req).then(response=>response||caches.match('/index.html'))));
});
