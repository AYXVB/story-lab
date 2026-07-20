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
var CACHE_NAME = "monogatari-shell-v2_4_0";

// アプリの殻＝全て自前のファイル（外部CDN無しの設計がここで効く）
var SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "css/theme.css", "css/base.css", "css/library.css", "css/anatomy.css",
  "css/tags.css", "css/essays.css", "css/writing.css", "css/people.css",
  "css/quotes.css", "css/compare.css", "css/read.css",
  "js/store.js", "js/app.js",
  "js/data/tags-seed.js", "js/data/works-guide.js", "js/data/scene-axes.js",
  "js/library.js", "js/anatomy.js", "js/tags.js", "js/essays.js",
  "js/writing.js", "js/people.js", "js/quotes.js", "js/compare.js",
  "js/read.js"
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

  // アプリの殻: ★ネットワーク優先・失敗時のみキャッシュ（network falling back
  // to cache）。
  // 「なぜキャッシュ優先をやめたか」: 旧方式（stale-while-revalidate）は
  // 古い画面を返しつつ裏で更新する方式のため、更新の反映に「リロード2回」が
  // 必要で、実際に「新機能のボタンが見つからない」事故を繰り返した。
  // オンラインなら常に最新を出し、オフラインのときだけ保存版で開く方が、
  // 「アプリが古いまま動く」という最も分かりにくい不具合を根絶できる。
  // （ローカル／自宅LANが前提なので、ネットワーク優先でも体感は速い）
  ev.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
      }
      return res;
    }).catch(function(){
      // オフライン（サーバー停止・電波なし）→ 保存版で開く
      return caches.open(CACHE_NAME).then(function(cache){
        return cache.match(req, { ignoreSearch: true }).then(function(cached){
          if (cached) return cached;
          if (req.mode === "navigate") return cache.match("index.html");
          return new Response("", { status: 504 });
        });
      });
    })
  );
});
