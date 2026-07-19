/* ==========================================================================
   sw.js — Service Worker（オフライン対応・PWAインストールの土台）
   なぜ必要か: スマホで「アプリとして・どこでも」使うには、ネットが無くても
   アプリ本体（HTML/CSS/JS）が開ける必要がある。ここでアプリの殻（シェル）を
   端末にキャッシュし、オフライン時はキャッシュから配る。
   ⚠ 研究データ（data/〜・/save）は絶対にキャッシュしない。
     データの正は localStorage と PC の research-data.json であり、
     古いキャッシュが本物のデータのふりをする事故を構造的に防ぐため。
   ========================================================================== */

// 更新のたびに版を上げる（古い殻を確実に捨てさせるため）。
var CACHE_NAME = "monogatari-shell-v1_5_2";

// アプリの殻＝全て自前のファイル（外部CDN無しの設計がここで効く）
var SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "css/theme.css", "css/base.css", "css/library.css", "css/anatomy.css",
  "css/tags.css", "css/essays.css", "css/writing.css", "css/people.css",
  "css/quotes.css",
  "js/store.js", "js/app.js",
  "js/data/tags-seed.js", "js/data/works-guide.js",
  "js/library.js", "js/anatomy.js", "js/tags.js", "js/essays.js",
  "js/writing.js", "js/people.js", "js/quotes.js"
];

self.addEventListener("install", function(ev){
  ev.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); }) // 新版を即座に有効化
  );
});

self.addEventListener("activate", function(ev){
  // 旧版のキャッシュを掃除（版を上げた時に古い殻を残さない）
  ev.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== CACHE_NAME) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(ev){
  var req = ev.request;
  if (req.method !== "GET") return;              // /save 等のPOSTは素通し
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 他オリジンは扱わない
  // 研究データはキャッシュ禁止（常にネットワーク。オフライン時は失敗してよい
  // ＝アプリ側の復元ガードが「無ければ何もしない」設計になっている）。
  // ※GitHub Pages のサブパス配信（/リポジトリ名/…）でも効くよう、
  //   先頭一致でなく「/data/ を含み /js/data/ ではない」で判定する
  if (url.pathname.indexOf("/data/") !== -1 && url.pathname.indexOf("/js/data/") === -1) return;

  // アプリの殻: キャッシュ優先＋裏でネットワーク更新（stale-while-revalidate）。
  // 「なぜ」: オフラインで確実に開けることが最優先。更新は次回起動で効けばよい。
  ev.respondWith(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.match(req, { ignoreSearch: true }).then(function(cached){
        var fetched = fetch(req).then(function(res){
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function(){ return null; });
        // 画面遷移（navigate）でキャッシュに無ければ index.html で受ける
        if (cached) { fetched.catch(function(){}); return cached; }
        return fetched.then(function(res){
          if (res) return res;
          if (req.mode === "navigate") return cache.match("index.html");
          return new Response("", { status: 504 });
        });
      });
    })
  );
});
