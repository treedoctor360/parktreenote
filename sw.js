// =============================================
//  樹木台帳メモ - Service Worker v4.0
//  戦略:
//    ・index.html（アプリ本体）= Network First（更新を確実に反映）
//      → 4秒で応答がなければキャッシュを使う（電波の弱い現場対策）
//      → オフライン時もキャッシュで動作する
//    ・その他のファイル（アイコン等）= Cache First（表示を速く）
//  IndexedDBのデータはキャッシュしない（常に端末ローカル・SW更新でも消えない）
//
//  【重要】v3.0 は Cache First かつキャッシュ名が固定だったため、
//  一度保存した index.html が更新されず、古いバージョンが使われ続けていた。
//  キャッシュ名を変更すると activate で旧キャッシュが削除され、確実に更新される。
//  アプリを更新したら、このキャッシュ名も必ず変更すること。
// =============================================

var CACHE_NAME = 'tree-ledger-v4.5';
var NETWORK_TIMEOUT_MS = 4000; // 電波が弱い現場で待たされ過ぎないための上限

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
      console.log('[SW] Caching app shell:', CACHE_NAME);
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

// リクエストがアプリ本体（HTML）かどうかを判定
function isAppShell(request) {
  if (request.mode === 'navigate') return true;
  var url = request.url.split('?')[0];
  return url.charAt(url.length - 1) === '/' || url.indexOf('index.html') >= 0;
}

// ネットワーク取得（一定時間で打ち切る）
function fetchWithTimeout(request) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (!settled) { settled = true; reject(new Error('timeout')); }
    }, NETWORK_TIMEOUT_MS);
    fetch(request).then(function(res) {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(res);
    }).catch(function(err) {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(err);
    });
  });
}

// 取得できたレスポンスをキャッシュに保存
function putCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    var clone = response.clone();
    caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
  }
  return response;
}

// ===== フェッチ =====
self.addEventListener('fetch', function(event) {
  // POST や chrome-extension などは無視
  if (event.request.method !== 'GET') return;
  if (event.request.url.indexOf('http') !== 0) return;

  // --- アプリ本体(HTML): Network First ---
  // 最新のindex.htmlを優先。取得できたらキャッシュも更新する。
  // オフライン・低速時はキャッシュを使う（現場で使えなくならないように）。
  if (isAppShell(event.request)) {
    event.respondWith(
      fetchWithTimeout(event.request).then(function(response) {
        return putCache(event.request, response);
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // --- その他のファイル: Cache First ---
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetchWithTimeout(event.request).then(function(response) {
        return putCache(event.request, response);
      }).catch(function() {
        return caches.match('./index.html');
      });
    })
  );
});
