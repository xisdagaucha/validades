/* Service worker: deixa o app instalável e abre mesmo com internet fraca. */
const CACHE = "validades-xg-v2";
const SHELL = ["./", "index.html", "conexao.js", "firebase-config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Banco de dados e login do Firebase sempre direto pela rede
  if (/firestore\.googleapis|identitytoolkit|securetoken|googleapis\.com\/(identity|v1)/.test(url.href)) return;
  if (url.origin === location.origin) {
    // Arquivos do app: tenta a rede (pega atualizações), cai no cache se estiver sem internet
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else if (/cdnjs\.cloudflare|gstatic\.com|fonts\.googleapis|unpkg\.com/.test(url.host)) {
    // Bibliotecas e fontes: usa o cache e atualiza em segundo plano
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => { const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; })));
  }
});
