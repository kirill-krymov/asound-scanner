const CACHE='asound-offline-v3';
const SHELL=['./index.html','./styles.css','./app.js','./offline-core.js','./manifest.webmanifest','./icon.svg','./vendor/html5-qrcode.min.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.endsWith('manifest.enc.json'))return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
