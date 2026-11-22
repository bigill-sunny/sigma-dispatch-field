const shellCache='sigma-shell-v5';
const shell=['/','/model.js','/app.js','/guard.js','/chat.js','/attendance-ui.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(shellCache).then(cache=>cache.addAll(shell)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sigma-shell-')&&key!==shellCache).map(key=>caches.delete(key)))));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!shell.includes(url.pathname))return;
  event.respondWith(fetch(event.request).catch(async()=>{
    const cache=await caches.open(shellCache);
    return await cache.match(url.pathname)||Response.error();
  }));
});
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('Sigma Dispatch',{body:'Open Dispatch to review your latest offer or upcoming shift.',tag:'sigma-shift-update',icon:'/icon-192.png'}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
