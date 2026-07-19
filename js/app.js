/* ==========================================================================
   app.js — App 本体（ユーティリティ・ビュー登録/切替・ナビ・共通部品）
   設計.txt §4（ビュー構成）・§6（API契約）を実装する。
   store.js の直後に読み込まれる（各ビューより前）。
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;

  /* ------------------------------------------------------------------
     App.util — 全ビュー共通の小道具
     ------------------------------------------------------------------ */
  App.util = {

    /** 一意ID生成（例: uid("w") → "w_k3j9x2ab"）。参照はすべてこのIDで行う */
    uid: function(prefix){
      // 時刻36進＋乱数で実用上衝突しない長さにする（ローカル単独利用のため）
      return (prefix || "x") + "_" +
             Date.now().toString(36) +
             Math.random().toString(36).slice(2, 7);
    },

    /** HTMLエスケープ。ユーザー入力を innerHTML に混ぜる際は必ずこれを通す */
    esc: function(s){
      if (s === null || s === undefined) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    /** タイムスタンプ(ms)→ "2026-07-17" 形式。一覧・カードの日付表示用 */
    fmtDate: function(ts){
      if (!ts) return "";
      var d = new Date(ts);
      if (isNaN(d.getTime())) return "";
      function pad(n){ return (n < 10 ? "0" : "") + n; }
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    },

    /** 連打を間引く（入力欄の自動保存等で使う）*/
    debounce: function(fn, ms){
      var timer = null;
      return function(){
        var self = this, args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function(){
          timer = null;
          fn.apply(self, args);
        }, ms || 200);
      };
    }
  };

  /* ------------------------------------------------------------------
     ビュー登録・切替
     「なぜ登録キュー方式か」:各ビューJSの読込順に依存させないため。
     どの順で registerView が呼ばれても、起動時に order 昇順で並べ直す。
     ------------------------------------------------------------------ */

  var viewDefs = [];      // 登録キュー（{id,title,order,init,show}）
  var inited = {};        // init 済みフラグ（initは各ビュー1回だけ）
  var currentViewId = null;
  var booted = false;     // DOMContentLoaded 前に showView されない保険

  /** ビュー登録。各ビューJSがファイル末尾で呼ぶ */
  App.registerView = function(def){
    if (!def || !def.id){
      if (window.console) console.error("registerView: id がありません", def);
      return;
    }
    viewDefs.push(def);
    // 起動後に遅れて登録された場合もナビに反映する（通常は起動前に揃う）
    if (booted) buildNav();
  };

  /** 現在表示中のビューid（ビュー間連携用の読み取り専用情報）*/
  App.currentView = function(){ return currentViewId; };

  /** ビュー切替。タブとコンテンツの .active を付け替える */
  App.showView = function(id){
    var def = null;
    for (var i = 0; i < viewDefs.length; i++){
      if (viewDefs[i].id === id){ def = viewDefs[i]; break; }
    }
    if (!def){
      if (window.console) console.error("showView: 未登録のビュー:", id);
      return;
    }

    // 集中執筆モードの安全網: ビューを切り替える時は必ず全画面オーバーレイの
    // body クラスを外す。通常は執筆ビューの Esc/終了ボタンで外れるが、万一
    // 残ったまま別ビューへ遷移するとオーバーレイが画面を覆い続けるため。
    // （集中モードのトグル自体は showView を呼ばないので通常操作を邪魔しない）
    if (document.body) document.body.classList.remove("focus-mode");

    var viewsRoot = document.getElementById("views");

    // ビューのルート要素が無ければ作る（各ビューは init(root) の中身だけ書く）
    var root = document.getElementById("view-" + id);
    if (!root){
      root = document.createElement("section");
      root.id = "view-" + id;
      root.className = "view";
      viewsRoot.appendChild(root);
    }

    // 初回のみ init（重い描画の作り直しを避ける。再描画は onChange で各自行う）
    if (!inited[id]){
      inited[id] = true;
      if (typeof def.init === "function"){
        try { def.init(root); }
        catch (e) { if (window.console) console.error("view init error [" + id + "]:", e); }
      }
    }

    // ★安全網: init が root.className を上書きして .view/.active を消しても
    // ここで必ず復元する（音楽アプリで実際に起きた「画面が空になる」バグ対策）
    root.classList.add("view");

    // 全ビューの active を外し、対象だけに付ける
    var all = viewsRoot.querySelectorAll(".view");
    for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
    root.classList.add("active");
    currentViewId = id;

    // ナビタブの active も同期
    var tabs = document.querySelectorAll("#nav a");
    for (var k = 0; k < tabs.length; k++){
      if (tabs[k].getAttribute("data-view") === id) tabs[k].classList.add("active");
      else tabs[k].classList.remove("active");
    }

    // ビュー側の「表示のたびに行う処理」（一覧の再読込等）
    if (typeof def.show === "function"){
      try { def.show(); }
      catch (e) { if (window.console) console.error("view show error [" + id + "]:", e); }
    }
  };

  /** ナビタブを order 昇順で生成する */
  function buildNav(){
    var nav = document.getElementById("nav");
    if (!nav) return;
    var sorted = viewDefs.slice().sort(function(a, b){
      return (a.order || 0) - (b.order || 0);
    });
    nav.innerHTML = "";
    sorted.forEach(function(def){
      var a = document.createElement("a");
      a.href = "#";                       // file:// でも動くダミーhref
      a.textContent = def.title || def.id;
      a.setAttribute("data-view", def.id);
      if (def.id === currentViewId) a.classList.add("active");
      a.addEventListener("click", function(ev){
        ev.preventDefault();              // ページ先頭へのスクロールを防ぐ
        App.showView(def.id);
      });
      nav.appendChild(a);
    });
  }

  /* ------------------------------------------------------------------
     タグチップの共通部品
     「なぜ共通化するか」:技法/効果の2軸色分けの判定を1箇所に集約し、
     各ビューが独自実装して色がズレる事故を防ぐ（設計 §6）。
     ------------------------------------------------------------------ */

  /** 全タグを id→タグ の辞書で返す（一覧描画時の byId 連打を避ける）*/
  App.tagsById = function(){
    var map = {};
    App.store.get().tags.forEach(function(t){ map[t.id] = t; });
    return map;
  };

  /**
   * タグチップのHTML文字列を返す。category が「効果」なら .chip.effect、
   * それ以外（構成/演出/言葉遣い）は .chip.tech。
   * 削除済みタグのIDが残っていた場合は空文字（描画しない）。
   */
  App.tagChipHtml = function(tagId){
    var tag = App.store.byId("tags", tagId);
    if (!tag) return "";
    var cls = (tag.category === "効果") ? "chip effect" : "chip tech";
    return '<span class="' + cls + '" data-tag-id="' + App.util.esc(tag.id) + '">' +
           App.util.esc(tag.name) + '</span>';
  };

  /* ------------------------------------------------------------------
     起動処理
     ------------------------------------------------------------------ */

  /**
   * フォルダ保存(data/research-data.json)からの復元ガード。
   * なぜ必要か: ブラウザの「サイトデータ削除」後や別ブラウザで開くと
   * localStorage が空になる。そのまま使い始めると、最初の自動保存が
   * フォルダ内の正常な研究データを空データで上書きしてしまう（データ喪失）。
   * → 起動時に「localStorage が実質空 かつ フォルダに中身のあるデータが
   * ある」場合は【確認なしで自動復元】する。http(サーバー)経由のときだけ動く。
   * 「なぜ確認しないか」:local が空＝このブラウザには何も無い、フォルダに
   * 中身あり、という状況は事実上「復元すべき」しかない。確認ダイアログで
   * 誤って"いいえ"を選ぶと、直後の自動保存がフォルダの正規データを空で
   * 上書きして全損する（実測で確認）。選ばせない方が安全。新規で始めたい
   * ときは書き出し/読み込みで対応できる。
   * done() は復元の要否が確定してから呼ぶ＝復元前に自動保存が走らない。
   */
  function maybeRestoreFromFolder(done){
    var loc = window.location;
    if (!loc || (loc.protocol !== "http:" && loc.protocol !== "https:") ||
        typeof window.fetch !== "function"){
      done(); return;
    }
    var d = App.store.get();
    var localEmpty = !d.works.length && !d.nodes.length &&
                     !d.essays.length && !d.quotes.length;
    if (!localEmpty){ done(); return; }
    // キャッシュを避けて最新のファイルを読む（古い版からの誤復元防止）
    window.fetch("data/research-data.json", { cache: "no-store" })
      .then(function(res){ return res.ok ? res.json() : null; })
      .catch(function(){ return null; })
      .then(function(saved){
        try {
          var hasContent = saved && (
            (saved.works && saved.works.length) ||
            (saved.nodes && saved.nodes.length) ||
            (saved.essays && saved.essays.length) ||
            (saved.quotes && saved.quotes.length));
          if (hasContent){
            var r = App.store.importJson(JSON.stringify(saved));
            if (window.console){
              if (r.ok) console.info("フォルダの研究データを自動復元しました。");
              else console.error("フォルダからの復元に失敗:", r.error);
            }
          }
        } catch (e) {
          if (window.console) console.error("復元チェックでエラー:", e);
        }
        done();
      });
  }

  /* ------------------------------------------------------------------
     Discord 同期便
     なぜ Webhook か: ボタン1つでバックアップJSONを自分のDiscordチャンネルへ
     送れる＝スマホ⇄PCのファイル受け渡しが「Discordを開いて保存→読み込み」に
     短縮される。Webhookは送信専用なので、取り込み側は従来の⇧読み込み。
     ⚠ URLは各端末の settings に保存（公開コードには含まれない）。
     ⚠ ブラウザの仕様（CORS）で送信結果の成否は読めない＝no-cors で送り、
       「届いたかはDiscord側で確認」と案内する（正直に伝える）。
     ------------------------------------------------------------------ */

  function discordWebhookUrl(){
    return (App.store.get().settings || {}).discordWebhook || "";
  }

  function configureDiscordWebhook(){
    var cur = discordWebhookUrl();
    var url = window.prompt(
      "DiscordのWebhook URLを貼り付けてください。\n" +
      "（自分専用サーバーのチャンネル設定→「連携サービス」→「ウェブフック」で作成）\n" +
      "空にしてOKすると解除します。",
      cur || ""
    );
    if (url === null) return;          // キャンセル＝何もしない
    url = url.trim();
    // 送信先はDiscordのWebhookに限定（誤貼り付けや悪意あるURLへの
    // データ送信を防ぐ。研究データを外へ送る機能なので厳格に）
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)){
      window.alert("Webhook URLの形式が違います。\nhttps://discord.com/api/webhooks/… で始まるURLを貼ってください。");
      return;
    }
    var s = App.store.get().settings;
    s.discordWebhook = url;            // 空文字＝解除
    App.store.save();
    window.alert(url ? "送信先を設定しました。「☁ Discordへ送る」で送信できます。" : "送信先を解除しました。");
  }

  function sendBackupToDiscord(){
    var url = discordWebhookUrl();
    if (!url){
      configureDiscordWebhook();
      url = discordWebhookUrl();
      if (!url) return;                // 設定されなかった＝送らない
    }
    var d = App.store.get();
    var now = new Date();
    function pad(x){ return (x < 10 ? "0" : "") + x; }
    var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
                "-" + pad(now.getHours()) + pad(now.getMinutes());
    var disp = now.getFullYear() + "/" + pad(now.getMonth() + 1) + "/" + pad(now.getDate()) +
               " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    var fd = new FormData();
    fd.append("payload_json", JSON.stringify({
      content: "📚 物語研究室バックアップ（" + disp + "・作品" + d.works.length +
               "冊・一節" + d.quotes.length + "件）"
    }));
    fd.append("files[0]",
      new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
      "monogatari-backup-" + stamp + ".json");
    window.fetch(url, { method: "POST", body: fd, mode: "no-cors" })
      .then(function(){
        window.alert("Discordへ送信しました。チャンネルに届いているか確認してください。\n" +
                     "（ブラウザの仕様で、成否までは自動確認できません）");
      })
      .catch(function(){
        window.alert("送信に失敗しました。ネット接続とWebhook URLを確認してください。");
      });
  }

  /**
   * Service Worker の登録（オフライン対応＝スマホで「どこでも」の土台）。
   * secure context（https または localhost）でのみ動く仕様のため、
   * 自宅LANの http://192.168.… では黙って何もしない（エラーにしない）。
   */
  function registerServiceWorker(){
    if (!("serviceWorker" in navigator)) return;
    var loc = window.location;
    var secure = loc.protocol === "https:" ||
                 loc.hostname === "localhost" || loc.hostname === "127.0.0.1";
    if (!secure) return;
    navigator.serviceWorker.register("sw.js").catch(function(e){
      // 登録失敗でもアプリは通常動作する（オフライン対応が無いだけ）
      if (window.console) console.warn("ServiceWorker登録に失敗:", e);
    });
  }

  document.addEventListener("DOMContentLoaded", function(){
    // 1) データ読込 → フォルダ復元ガード → タグ初期語彙の取り込み → 起動。
    //    復元判定が終わるまで boot を遅らせる＝空データでの上書きを防ぐ。
    App.store.load();
    maybeRestoreFromFolder(function(){
      App.store.applySeed();
      boot();
    });
    registerServiceWorker();
  });

  function boot(){
    // 2) ナビ生成（この時点で全ビューJSの registerView が完了している）
    booted = true;
    buildNav();

    // 3) 既定ビュー=書庫（設計 §4）。未登録なら order 最小のビューで代替
    var hasLibrary = viewDefs.some(function(d){ return d.id === "library"; });
    if (hasLibrary){
      App.showView("library");
    } else if (viewDefs.length){
      var first = viewDefs.slice().sort(function(a, b){
        return (a.order || 0) - (b.order || 0);
      })[0];
      App.showView(first.id);
    }

    // 4) 書き出し/読み込みボタンの結線（スマホ移植3条件②）
    var btnExport = document.getElementById("btn-export");
    var btnImport = document.getElementById("btn-import");
    var fileInput = document.getElementById("import-file");

    if (btnExport){
      btnExport.addEventListener("click", function(){
        App.store.exportJson();
      });
    }

    // Discord 同期便（バックアップJSONを自分のWebhookへ送る。受信側は
    // Discordでファイルを保存→⇧読み込み。読み込みは全置換なので
    // 「片方向ずつ」の運用ルールは従来どおり）
    var btnDiscord = document.getElementById("btn-discord");
    var btnDiscordCfg = document.getElementById("btn-discord-config");
    if (btnDiscord) btnDiscord.addEventListener("click", sendBackupToDiscord);
    if (btnDiscordCfg) btnDiscordCfg.addEventListener("click", configureDiscordWebhook);
    if (btnImport && fileInput){
      btnImport.addEventListener("click", function(){
        fileInput.value = "";   // 同じファイルを2回選んでも change が発火するように
        fileInput.click();
      });
      fileInput.addEventListener("change", function(){
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        // 全置換の破壊的操作なので必ず確認を挟む
        var okToReplace = window.confirm(
          "読み込むと現在のデータはすべて置き換えられます。よろしいですか？\n" +
          "（心配な場合は先に「⇩ 書き出し」で控えを取ってください）"
        );
        if (!okToReplace) return;
        var reader = new FileReader();
        reader.onload = function(){
          var result = App.store.importJson(String(reader.result));
          if (result.ok){
            window.alert("読み込みました。");
            // onChange を購読していない初期ビューでも確実に反映されるよう
            // 現在ビューを表示し直す（show() で再描画される契約）
            if (currentViewId) App.showView(currentViewId);
          } else {
            window.alert("読み込みに失敗しました:\n" + result.error);
          }
        };
        reader.onerror = function(){
          window.alert("ファイルを読み取れませんでした。");
        };
        reader.readAsText(file);
      });
    }
  }

})();
