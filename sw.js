// =============================================
//  樹木台帳メモ - Service Worker v3.0
//  戦略: Cache First（アプリシェルをキャッシュ）
//  IndexedDBのデータはキャッシュしない（常に端末ローカル）
// =============================================

var CACHE_NAME = 'tree-ledger-v3.0';

// キャッシュするファイル一覧（アプリシェル）
var CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ===== インストール: 初回アクセス時にキャッシュを作成 =====
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Caching app shell');
      // icon が未作成でもエラーで止まらないよう個別にキャッシュ
      return Promise.allSettled(
        CACHE_FILES.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Failed to cache:', url, err);
          });
        })
      );
    })
  );
  self.skipWaiting(); // 新しいSWを即座にアクティブ化
});

// ===== アクティベート: 古いキャッシュを削除 =====
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME; // 現バージョン以外を削除
        }).map(function(key) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim(); // アクティブ化後すぐ全クライアントを制御
});

// ===== フェッチ: Cache First 戦略 =====
// キャッシュにあればキャッシュを返す → なければネットワークから取得してキャッシュ
self.addEventListener('fetch', function(event) {
  // POST や chrome-extension などは無視
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        return cached; // キャッシュヒット
      }
      // キャッシュミス → ネットワークから取得
      return fetch(event.request).then(function(response) {
        // 有効なレスポンスのみキャッシュに追加
        if (response && response.status === 200 && response.type === 'basic') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(function() {
        // オフライン時にindex.htmlを返す（フォールバック）
        return caches.match('./index.html');
      });
    })
  );
});
