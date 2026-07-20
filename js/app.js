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

  // アプリの版。機能を足したらここを上げる（画面右上に小さく表示され、
  // 「更新が反映されているか」を目で確認できる＝古い画面のまま気づかない事故を防ぐ）
  var APP_VERSION = "v2.3";

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
     全体検索（ヘッダー）
     「なぜ app.js に置くか」:全コレクション横断＝どのビューにも属さない
     機能であり、ビュー間の遷移（App.showView＋App.state の受け渡し）を
     行う。この2つを知っているのは app.js だけなので、ここが正しい住所。
     ------------------------------------------------------------------ */

  // ビュー間の選択共有。どのファイルが先に走っても壊れないよう毎回保証する
  App.state = App.state || {};

  // 各コレクションの検索定義。
  // fields: 検索対象の文字列を item から取り出す関数の配列（前から順に評価し、
  //         最初に一致した欄の抜粋を出す＝「どこで当たったか」が分かる）。
  // name:   結果行の見出しに出す文字列。
  var SEARCH_DEFS = [
    { key: "works", label: "作品",
      name: function(w){ return w.title || "（無題）"; },
      fields: [
        function(w){ return w.title; },
        function(w){ return w.author; },
        function(w){ return w.note; }
      ] },
    { key: "nodes", label: "場面",
      name: function(n){ return n.title || "（無題の節）"; },
      fields: [
        function(n){ return n.title; },
        function(n){ return n.summary; },
        function(n){ return n.quoteText; },
        function(n){ return n.fullText; }
      ] },
    { key: "quotes", label: "一節",
      name: function(q){ return q.sourceTitle || "（出典不明）"; },
      fields: [
        function(q){ return q.text; },
        function(q){ return q.sourceTitle; },
        function(q){ return q.sourceAuthor; },
        function(q){ return q.whyGood; }
      ] },
    { key: "essays", label: "考察",
      name: function(e){ return e.title || "（無題の考察）"; },
      fields: [
        function(e){ return e.title; },
        function(e){ return e.body; }
      ] },
    { key: "elements", label: "人物",
      name: function(el){ return el.name || "（無名）"; },
      fields: [
        function(el){ return el.name; },
        function(el){ return el.body; },
        // 構造化メモは「値」だけを対象にする（ラベルは器＝何が書いてあるかで探す）
        function(el){
          var f = el.fields || {};
          return Object.keys(f).map(function(k){ return f[k]; }).join(" ／ ");
        }
      ] },
    { key: "tags", label: "タグ",
      name: function(t){ return t.name || "（無名タグ）"; },
      fields: [
        function(t){ return t.name; },
        function(t){ return t.definition; }
      ] }
  ];

  var SEARCH_PER_TYPE = 5;      // 種別ごとの表示上限（残りは「他N件」で示す）
  var SNIPPET_PAD = 20;         // 該当語の前後に何字ぶん文脈を添えるか

  /**
   * 該当箇所の抜粋HTMLを作る。一致しなければ null。
   * ★安全の要:「先に esc → エスケープ済み文字列の"間"に <mark> を挿入」
   *   の順序を厳守する。逆（先に <mark> を入れてから esc）だと mark 自体が
   *   文字列化されるし、生の text をそのまま連結すると利用者が書いた
   *   < > がタグとして解釈される（＝生HTMLが通る経路になる）。
   *   ここでは pre/hit/post の3片を個別に esc し、タグは定数としてのみ足す。
   */
  function searchSnippet(raw, qLower){
    if (raw === null || raw === undefined) return null;
    // 改行・連続空白は1つの空白へ潰す（本文が長い場合に抜粋を読みやすくする）
    var s = String(raw).replace(/\s+/g, " ").trim();
    if (!s) return null;
    var i = s.toLowerCase().indexOf(qLower);
    if (i < 0) return null;

    var start = Math.max(0, i - SNIPPET_PAD);
    var end   = Math.min(s.length, i + qLower.length + SNIPPET_PAD);
    var pre  = (start > 0 ? "…" : "") + s.slice(start, i);
    var hit  = s.slice(i, i + qLower.length);
    var post = s.slice(i + qLower.length, end) + (end < s.length ? "…" : "");

    var esc = App.util.esc;
    return esc(pre) + "<mark>" + esc(hit) + "</mark>" + esc(post);
  }

  /** 全コレクションを横断検索し、種別ごとの結果配列を返す */
  function runGlobalSearch(query){
    var qLower = query.toLowerCase();
    var data = App.store.get();
    var groups = [];

    SEARCH_DEFS.forEach(function(def){
      var items = data[def.key] || [];
      var hits = [];
      items.forEach(function(item){
        // 前から順に評価し、最初に当たった欄で抜粋を作る
        for (var i = 0; i < def.fields.length; i++){
          var snippet = searchSnippet(def.fields[i](item), qLower);
          if (snippet){
            hits.push({ id: item.id, name: def.name(item), snippet: snippet });
            return;
          }
        }
      });
      if (hits.length) groups.push({ def: def, hits: hits });
    });
    return groups;
  }

  /** 結果パネルのHTMLを組み立てる（name/snippet は既にエスケープ済み前提でない
      ため、name はここで esc し、snippet は searchSnippet が作った安全なHTML）*/
  function renderSearchResults(panel, groups){
    var esc = App.util.esc;
    if (!groups.length){
      panel.innerHTML = '<p class="gs-empty">見つかりませんでした。</p>';
      return;
    }
    var html = "";
    groups.forEach(function(g){
      html += '<div class="gs-group">' +
              '<h3 class="gs-group__title overline">' + esc(g.def.label) +
                '（' + g.hits.length + '）</h3>';
      g.hits.slice(0, SEARCH_PER_TYPE).forEach(function(h){
        html += '<button type="button" class="gs-item" ' +
                'data-gs-type="' + esc(g.def.key) + '" ' +
                'data-gs-id="' + esc(h.id) + '">' +
                '<span class="gs-item__name">' + esc(h.name) + '</span>' +
                '<span class="gs-item__snippet">' + h.snippet + '</span>' +
                '</button>';
      });
      if (g.hits.length > SEARCH_PER_TYPE){
        html += '<p class="gs-more">他 ' + (g.hits.length - SEARCH_PER_TYPE) + ' 件</p>';
      }
      html += '</div>';
    });
    panel.innerHTML = html;
  }

  /**
   * 検索結果のクリック＝対応ビューへ移動。
   * 「なぜ App.state 経由か」:各ビューは show() で App.state を読んで
   * 自分の表示対象を決める契約（設計 §6）。ここで直接DOMを触らない。
   */
  function gotoSearchResult(type, id){
    if (type === "works"){
      App.state.currentWorkId = id;
      App.showView("library");
    } else if (type === "nodes"){
      var node = App.store.byId("nodes", id);
      if (node && node.workId) App.state.currentWorkId = node.workId;
      App.state.currentNodeId = id;
      App.showView("anatomy");
    } else if (type === "quotes"){
      App.showView("quotes");
    } else if (type === "essays"){
      App.showView("essays");
    } else if (type === "elements"){
      var el = App.store.byId("elements", id);
      if (el && el.workId) App.state.currentWorkId = el.workId;
      App.showView("people");
    } else if (type === "tags"){
      App.state.jumpToTagId = id;        // タグ辞典の既存ジャンプ機構に乗る
      App.showView("tags");
    }
  }

  /** ヘッダー検索窓の結線（boot から1回だけ呼ぶ）*/
  function initGlobalSearch(){
    var input = document.getElementById("global-search");
    var panel = document.getElementById("global-search-results");
    if (!input || !panel) return;

    function close(){ panel.hidden = true; panel.innerHTML = ""; }

    function update(){
      var q = input.value.trim();
      if (!q){ close(); return; }        // 空入力は閉じる（雑音を出さない）
      renderSearchResults(panel, runGlobalSearch(q));
      panel.hidden = false;
    }

    // 連打で全件走査が走らないよう 200ms 間引く（データが増えるほど効く）
    input.addEventListener("input", App.util.debounce(update, 200));
    // 一度閉じた後に窓へ戻ったとき、入力が残っていれば結果を出し直す
    input.addEventListener("focus", function(){ if (input.value.trim()) update(); });

    panel.addEventListener("click", function(ev){
      var btn = ev.target.closest("[data-gs-type]");
      if (!btn) return;
      gotoSearchResult(btn.getAttribute("data-gs-type"), btn.getAttribute("data-gs-id"));
      close();
      input.blur();                      // スマホでキーボードを閉じる
    });

    // Esc で閉じる（キーボード操作の定石。入力欄にフォーカスが無くても効く）
    document.addEventListener("keydown", function(ev){
      if (ev.key === "Escape" && !panel.hidden) close();
    });

    // 外側クリックで閉じる。検索窓自身とパネルの中は対象外
    document.addEventListener("click", function(ev){
      if (panel.hidden) return;
      var wrap = document.getElementById("app-search");
      if (wrap && wrap.contains(ev.target)) return;
      close();
    });
  }

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

  /* ------------------------------------------------------------------
     Discord自動取り込み（PC専用）
     サーバー(server.py)がBotトークンでチャンネルの最新バックアップを
     取得し、ここで「取り込みますか？」を確認してから全置換で反映する。
     なぜ確認を挟むか: 取り込みは全置換＝PC側の未送信の変更が消えるため、
     日時とファイル名を見せて人が判断する（黙って上書きしない）。
     ------------------------------------------------------------------ */

  /**
   * Bot設定（トークン・チャンネルID）の入力。
   * current: サーバーから取得した現在の設定（channelId のみ。トークンは
   * 秘密なので送り返さない）。既存値を初期値にして「片方だけ直す」を可能にする。
   * 「なぜ再設定できることが重要か」: 貼り間違いは普通に起きる。
   * 初回しか入力できない作りだと、間違えた瞬間に詰む（実際に詰んだ）。
   */
  function setupDiscordImport(next, current){
    current = current || {};
    var token = window.prompt(
      "DiscordのBotトークンを貼り付けてください。\n" +
      "（作り方は フォルダ内の「Discord取り込み設定.txt」参照。\n" +
      "  トークンはこのPCの中だけに保存され、外へは出ません）\n" +
      (current.hasToken ? "※現在すでに保存されています。入れ直すと上書きします。" : ""));
    if (token === null || !token.trim()) return;
    var channel = window.prompt(
      "バックアップを送っているチャンネルのIDを貼り付けてください。\n" +
      "（Discordの設定→詳細設定→開発者モードON→チャンネル右クリック→IDをコピー）",
      current.channelId || "");
    if (channel === null || !channel.trim()) return;
    window.fetch("/discord-config", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Monogatari-Save": "1" },
      body: JSON.stringify({ botToken: token.trim(), channelId: channel.trim() })
    }).then(function(res){ return res.json(); })
      .then(function(r){
        if (r.ok){ if (next) next(); }
        else window.alert("設定に失敗: " + (r.error || "不明なエラー"));
      })
      .catch(function(){ window.alert("設定の保存に失敗しました（サーバー未起動？）"); });
  }

  /** 現在の設定を取得してから設定画面を開く（設定し直し用の入口）*/
  function reconfigureDiscordImport(next){
    window.fetch("/discord-config", { headers: { "X-Monogatari-Save": "1" } })
      .then(function(res){ return res.json(); })
      .catch(function(){ return {}; })
      .then(function(cur){ setupDiscordImport(next, cur); });
  }

  /**
   * PCのフォルダ(data/research-data.json)からアプリへ取り込む。
   * なぜ必要か: 自動復元は「localStorageが空のとき」だけ働くため、
   * Claudeがフォルダのデータを直接編集しても、すでに使っているアプリには
   * 届かない（実際に「修正が反映されない」事故が起きた）。
   * 全置換なので、中身（作品数など）を見せて人が判断してから反映する。
   */
  function importFromFolder(){
    window.fetch("data/research-data.json", { cache: "no-store" })
      .then(function(res){
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then(function(saved){
        var w = (saved.works || []).length;
        var q = (saved.quotes || []).length;
        var n = (saved.nodes || []).length;
        var el = (saved.elements || []).length;
        var cur = App.store.get();
        var ok = window.confirm(
          "PCのフォルダに保存されている研究データを取り込みますか？\n\n" +
          "【フォルダ側】作品 " + w + " ／ 場面 " + n + " ／ 一節 " + q + " ／ 人物・設定 " + el + "\n" +
          "【いま画面】作品 " + cur.works.length + " ／ 場面 " + cur.nodes.length +
          " ／ 一節 " + cur.quotes.length + " ／ 人物・設定 " + (cur.elements || []).length + "\n\n" +
          "⚠ いま画面のデータはすべて置き換えられます。");
        if (!ok) return;
        var r = App.store.importJson(JSON.stringify(saved));
        if (r.ok){
          window.alert("取り込みました。");
          if (currentViewId) App.showView(currentViewId);
        } else {
          window.alert("取り込みに失敗しました:\n" + r.error);
        }
      })
      .catch(function(){
        window.alert("フォルダのデータを読めませんでした。\n" +
                     "（物語研究室起動.bat で起動していますか？）");
      });
  }

  /** retried=true なら「設定し直し後の再試行」＝これ以上は自動再試行しない */
  function importFromDiscord(retried){
    window.fetch("/discord-inbox", { headers: { "X-Monogatari-Save": "1" } })
      .then(function(res){ return res.json(); })
      .then(function(r){
        if (!r.ok && r.error === "unconfigured"){
          // 初回＝Botの設定から（設定できたらそのまま取り込みを再試行）
          reconfigureDiscordImport(retried ? null : function(){
            importFromDiscord(true);
          });
          return;
        }
        if (!r.ok){
          // ★設定ミス（トークン無効・権限不足・チャンネルID違い）は
          //   その場で入れ直せるようにする。従来はalertだけで詰んでいた。
          //   再設定後の自動再試行は1回だけ（間違いが続くと「失敗→再設定→
          //   失敗…」の無限ループになるため。2回目からは手動で押し直す）
          var canFix = window.confirm(
            "取り込みに失敗しました:\n" + r.error + "\n\n" +
            "Botトークン／チャンネルIDを設定し直しますか？");
          if (canFix){
            reconfigureDiscordImport(retried ? null : function(){
              importFromDiscord(true);
            });
          }
          return;
        }
        if (!r.found){ window.alert(r.hint || "バックアップが見つかりませんでした。"); return; }
        var s = App.store.get().settings;
        var already = (s.lastDiscordImportId === r.messageId);
        var when = r.timestamp ? r.timestamp.replace("T", " ").slice(0, 16) : "日時不明";
        var ok = window.confirm(
          (already ? "【取り込み済みの版です】\n" : "") +
          "Discordの最新バックアップを取り込みますか？\n" +
          "・ファイル: " + r.filename + "\n" +
          "・送信日時: " + when + "\n" +
          "⚠ 現在のデータはすべて置き換えられます。");
        if (!ok) return;
        var result = App.store.importJson(JSON.stringify(r.data));
        if (result.ok){
          var s2 = App.store.get().settings;
          s2.lastDiscordImportId = r.messageId;
          App.store.save();
          window.alert("取り込みました。");
          if (currentViewId) App.showView(currentViewId);
        } else {
          window.alert("取り込みに失敗しました:\n" + result.error);
        }
      })
      .catch(function(){ window.alert("サーバーに接続できません（物語研究室起動.bat で起動していますか？）"); });
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
    navigator.serviceWorker.register("sw.js").then(function(reg){
      // 毎回 update を促し、新しい版が来たら即座に有効化して1度だけ再読込する。
      // 「なぜ」: 旧方式では更新の反映に手動リロード2回が必要で、
      // 新機能が見えない事故が続いた。ここで自動的に最新へ揃える
      reg.update();
      if (navigator.serviceWorker.controller){
        var refreshed = false;
        navigator.serviceWorker.addEventListener("controllerchange", function(){
          if (refreshed) return;       // 無限リロード防止
          refreshed = true;
          window.location.reload();
        });
      }
    }).catch(function(e){
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
    // 版番号を表示（更新の反映を目視確認するため）
    var verEl = document.getElementById("app-version");
    if (verEl) verEl.textContent = APP_VERSION;

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

    // 3.5) 全体検索の結線（ビュー登録後＝どのビューへも飛べる状態にしてから）
    initGlobalSearch();

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
    if (btnDiscordCfg){
      btnDiscordCfg.addEventListener("click", function(){
        // PC（localhost）では送信・取り込みの両方があるので、どちらの設定かを選ばせる。
        // スマホ／公開版には取り込みが無いので、そのままWebhook設定へ
        var isPc = (location.hostname === "localhost" || location.hostname === "127.0.0.1");
        if (!isPc){ configureDiscordWebhook(); return; }
        var toImport = window.confirm(
          "どちらの設定をしますか？\n\n" +
          "［OK］取り込みの設定（Botトークン・チャンネルID）\n" +
          "［キャンセル］送信の設定（Webhook URL）");
        if (toImport) reconfigureDiscordImport();
        else configureDiscordWebhook();
      });
    }

    // Discord自動取り込み（PC専用: Botトークンを扱うため localhost のみ表示。
    // スマホや公開版では隠れたまま＝押せない）
    var btnImport2 = document.getElementById("btn-discord-import");
    if (btnImport2 &&
        (location.hostname === "localhost" || location.hostname === "127.0.0.1")){
      btnImport2.hidden = false;
      // click イベントの第1引数(Event)が retried に入らないよう包む
      btnImport2.addEventListener("click", function(){ importFromDiscord(false); });
    }

    // フォルダから取り込み（サーバー経由のときだけ意味があるので http/https 限定）
    var btnFolder = document.getElementById("btn-folder-import");
    if (btnFolder &&
        (location.protocol === "http:" || location.protocol === "https:")){
      btnFolder.hidden = false;
      btnFolder.addEventListener("click", importFromFolder);
    }
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
