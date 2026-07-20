/* ==========================================================================
   store.js — App.store（データ層・localStorage 一元管理）
   設計.txt §5（スキーマ）・§6（API契約）を実装する。
   読込順の先頭なので window.App 名前空間はここで作る（ES Modules 禁止）。
   ========================================================================== */
(function(){
  "use strict";

  // 名前空間。後続の app.js / 各ビューが同じ App にぶら下がる
  window.App = window.App || {};

  // localStorage のキー（設計.txt §5 で固定）
  var STORAGE_KEY = "monogatari_v1";

  // localStorage が使えない環境（file:// のプライベートモード等）向けの
  // メモリ退避。「なぜ」:保存に失敗しても例外でアプリを殺さないため。
  var memoryFallback = null;
  var storageBroken = false;

  // 変更購読者のリスト（ビューの再描画用）
  var listeners = [];

  // 全データの実体（load() で初期化される）
  var data = null;

  /* ------------------------------------------------------------------
     既定値
     ------------------------------------------------------------------ */

  // 軸の選択肢はデータとして持つ＝研究が進めば軸も増やせる（設計 §5）
  function defaultAxisDefs(){
    return {
      // 種別＝作品そのものの分類（2026-07-19追加）。長さ・受容形態・表現形式
      // とは別の観点なので独立した軸として持つ。詩や戯曲は小説と構造の見方が
      // 違うため、研究上ここを分けられることが重要
      kind:      ["小説", "詩", "戯曲", "映画", "漫画", "随筆・評論", "神話・伝承", "その他"],
      length:    ["短編", "中編", "長編"],
      reception: ["読解", "音声", "映像"],
      form:      ["文字", "漫画", "映像", "音声"]
    };
  }

  // 空データの雛形。スキーマの全コレクションを必ず持たせる
  // 「なぜ」:ビュー側で data.works が undefined になる事故を根絶するため
  function emptyData(){
    return {
      works: [],
      nodes: [],
      tags: [],
      essays: [],
      quotes: [],
      elements: [],   // 人物・設定資料（作品ごとの登場人物/場所/用語等。§5拡張2026-07-18）
      snapshots: [],  // 原稿の版履歴（場面ごとの書き直し前の控え。§5拡張2026-07-19）
      axisDefs: defaultAxisDefs(),
      settings: {}
    };
  }

  // 読み込んだデータの欠けを埋める（旧バージョンのデータや手編集JSON対策）
  function normalize(obj){
    var base = emptyData();
    if (!obj || typeof obj !== "object") return base;
    ["works","nodes","tags","essays","quotes","elements","snapshots"].forEach(function(k){
      if (Array.isArray(obj[k])) base[k] = obj[k];
    });
    if (obj.axisDefs && typeof obj.axisDefs === "object"){
      // 既定の軸に不足があれば補い、独自軸はそのまま残す
      var axes = defaultAxisDefs();
      Object.keys(obj.axisDefs).forEach(function(k){
        if (Array.isArray(obj.axisDefs[k])) axes[k] = obj.axisDefs[k];
      });
      base.axisDefs = axes;
    }
    if (obj.settings && typeof obj.settings === "object"){
      base.settings = obj.settings;
    }
    return base;
  }

  /* ------------------------------------------------------------------
     永続化（localStorage ⇔ メモリ退避）
     ------------------------------------------------------------------ */

  function readRaw(){
    if (storageBroken) return memoryFallback;
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // localStorage 不可＝以後メモリ運用に切替（例外で死なない）
      storageBroken = true;
      return memoryFallback;
    }
  }

  function writeRaw(text){
    memoryFallback = text; // 常にメモリにも持つ（保存失敗時の保険）
    if (storageBroken) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, text);
    } catch (e) {
      // 容量超過・アクセス不可など。メモリ退避で継続する
      storageBroken = true;
    }
  }

  /* ------------------------------------------------------------------
     変更通知
     ------------------------------------------------------------------ */

  function notify(){
    // 購読者の1つが例外を投げても他の購読者へ届くように個別に守る
    listeners.forEach(function(fn){
      try { fn(); } catch (e) {
        if (window.console) console.error("onChange listener error:", e);
      }
    });
  }

  /* ------------------------------------------------------------------
     フォルダへの自動保存（物語研究室起動.bat 経由のときだけ働く）
     なぜ: file:// 直開きだとデータは localStorage の中だけ＝研究の相棒
     （Claude）から見えず、毎回の手動書き出しが要る。server.py 経由
     （http://localhost）で開いた場合のみ、保存のたびに POST /save で
     data/research-data.json へも書く。失敗しても localStorage 保存は
     済んでいるのでデータは失われない（コンソールに警告のみ）。
     ------------------------------------------------------------------ */

  var fileSyncTimer = null;
  var fileSyncWarned = false;

  function scheduleFileSync(){
    // サーバー経由でなければ何もしない（file:// 直開きの従来動作を維持）
    var loc = window.location;
    if (!loc || (loc.protocol !== "http:" && loc.protocol !== "https:")) return;
    if (typeof window.fetch !== "function") return;
    // 連続編集で毎回POSTしない（1秒の猶予でまとめる）
    if (fileSyncTimer) clearTimeout(fileSyncTimer);
    fileSyncTimer = setTimeout(function(){
      fileSyncTimer = null;
      try {
        window.fetch("/save", {
          method: "POST",
          // X-Monogatari-Save はサーバー側のCSRF対策と対（外部サイトからの
          // 偽装POSTを防ぐ合言葉。server.py の _request_allowed 参照）
          headers: { "Content-Type": "application/json", "X-Monogatari-Save": "1" },
          body: JSON.stringify(data)
        }).then(function(res){
          if (!res.ok && window.console && !fileSyncWarned){
            fileSyncWarned = true;
            console.warn("フォルダへの自動保存に失敗（localStorage には保存済み）: HTTP " + res.status);
          }
        }).catch(function(e){
          if (window.console && !fileSyncWarned){
            fileSyncWarned = true;
            console.warn("フォルダへの自動保存に失敗（localStorage には保存済み）:", e);
          }
        });
      } catch (e) { /* fetch 自体の例外でもアプリは止めない */ }
    }, 1000);
  }

  /* ------------------------------------------------------------------
     App.store 本体
     ------------------------------------------------------------------ */

  var store = {

    /** 全データを localStorage から読み込む。壊れていても空データで復帰する */
    load: function(){
      var raw = readRaw();
      if (raw){
        try {
          data = normalize(JSON.parse(raw));
        } catch (e) {
          // JSONが壊れている＝初期化するしかないが、例外では死なない
          if (window.console) console.error("保存データの解析に失敗。初期化します:", e);
          data = emptyData();
        }
      } else {
        data = emptyData();
      }
      return data;
    },

    /** 全データを保存し、変更を購読者へ通知する */
    save: function(){
      if (!data) store.load();
      writeRaw(JSON.stringify(data));
      notify();
      scheduleFileSync();
    },

    /** 全データ取得（ビューは読み取りに使う。書換えたら save() を呼ぶこと）*/
    get: function(){
      if (!data) store.load();
      return data;
    },

    /**
     * タグ初期語彙（App.seedTags）を取り込む。
     * 「なぜ load() 内でないのか」:読込順の都合で seedTags は store.js より
     * 後（data/tags-seed.js）に定義される。そのため DOMContentLoaded 時に
     * app.js がこれを呼ぶ契約にしている（設計.txt §5）。
     * 取込済み管理は settings.appliedSeedIds（seed安定IDの配列）で行う。
     * 「なぜIDごとの増分方式か」:タグ語彙は調査で今後も増える（ユーザー要件）。
     * 一度きりフラグだと、後から追加した語彙が既存ユーザーに届かない。
     * IDを記録しておけば「新しい語だけ注入・ユーザーが削除した語は
     * 復活させない」の両方が成立する。
     */
    applySeed: function(){
      if (!data) store.load();
      if (!Array.isArray(window.App.seedTags)) return; // seed 未定義でも死なない
      var s = data.settings;
      var migrated = false;
      if (!Array.isArray(s.appliedSeedIds)){
        s.appliedSeedIds = [];
        if (s.seedApplied){
          // 旧方式（一度きりフラグ・ランダムID注入）からの移行:
          // 既存タグと同名の seed は取込済みとみなしてIDを記録する。
          // （旧方式で注入されたタグはランダムIDのためIDでは照合できない）
          var names = {};
          data.tags.forEach(function(t){ names[t.name] = true; });
          window.App.seedTags.forEach(function(t){
            if (t && t.id && names[t.name]) s.appliedSeedIds.push(t.id);
          });
          migrated = true;
        }
      }
      var now = Date.now();
      var changed = false;
      window.App.seedTags.forEach(function(t){
        if (!t || !t.name || !t.id) return;
        if (s.appliedSeedIds.indexOf(t.id) >= 0) return; // 取込済み（ユーザー削除済み含む）
        data.tags.push({
          id: t.id,   // seed の安定IDをそのまま使う（増分照合の要）
          name: t.name,
          category: t.category || "構成",
          definition: t.definition || "",
          examples: t.examples || "",
          source: t.source || "",
          createdAt: now
        });
        s.appliedSeedIds.push(t.id);
        changed = true;
      });
      s.seedApplied = true;
      if (changed || migrated) store.save();
    },

    /** コレクションへ追加（id / createdAt が無ければ補う）。追加した obj を返す */
    add: function(coll, obj){
      if (!data) store.load();
      if (!Array.isArray(data[coll])){
        throw new Error("不明なコレクション: " + coll);
      }
      if (!obj.id){
        obj.id = (window.App.util && window.App.util.uid) ?
                 window.App.util.uid(coll.charAt(0)) :
                 coll.charAt(0) + "_" + Math.random().toString(36).slice(2, 10);
      }
      if (!obj.createdAt) obj.createdAt = Date.now();
      data[coll].push(obj);
      store.save();
      return obj;
    },

    /** id 指定で部分更新。見つかれば更新後の obj、無ければ null を返す */
    update: function(coll, id, patch){
      if (!data) store.load();
      var item = store.byId(coll, id);
      if (!item) return null;
      Object.keys(patch || {}).forEach(function(k){
        // プロトタイプ汚染の保険（インポート由来の不正キーが将来の実装変更で
        // patch に流れ込んでも、Object.prototype を汚染させない）
        if (k === "__proto__" || k === "constructor" || k === "prototype") return;
        item[k] = patch[k];
      });
      // essays は updatedAt を持つスキーマなので更新時刻を自動で刻む
      if (coll === "essays") item.updatedAt = Date.now();
      store.save();
      return item;
    },

    /**
     * id 指定で削除＋参照掃除（設計 §5「削除時は参照を掃除する」）。
     * 「なぜ」:参照切れの id が残ると、ビュー側の byId が null を返して
     * 表示が壊れたり、存在しないタグのチップが出たりするため。
     */
    remove: function(coll, id){
      if (!data) store.load();
      if (!Array.isArray(data[coll])) return false;
      var before = data[coll].length;
      data[coll] = data[coll].filter(function(x){ return x.id !== id; });
      if (data[coll].length === before) return false;  // 見つからなかった

      if (coll === "works"){
        // 作品削除 → その作品の nodes を丸ごと削除し、その nodes への
        // essays.evidence 参照も除去。quotes は作品との紐付けだけ外す
        var removedNodeIds = {};
        data.nodes = data.nodes.filter(function(n){
          if (n.workId === id){ removedNodeIds[n.id] = true; return false; }
          return true;
        });
        cleanupEvidenceForNodes(removedNodeIds);
        data.quotes.forEach(function(q){
          if (q.workId === id){ q.workId = null; q.nodeId = null; }
        });
        // その作品の人物・設定資料・版履歴も一緒に削除（孤児を残さない）
        data.elements = data.elements.filter(function(el){ return el.workId !== id; });
        data.snapshots = data.snapshots.filter(function(s){ return s.workId !== id; });
      } else if (coll === "nodes"){
        // ノード削除 → 子孫ノードも削除（親を消して孤児を残さない）
        var doomed = {}; doomed[id] = true;
        var changed = true;
        while (changed){
          changed = false;
          data.nodes.forEach(function(n){
            if (n.parentId && doomed[n.parentId] && !doomed[n.id]){
              doomed[n.id] = true; changed = true;
            }
          });
        }
        data.nodes = data.nodes.filter(function(n){ return !doomed[n.id]; });
        cleanupEvidenceForNodes(doomed);
        data.quotes.forEach(function(q){
          if (q.nodeId && doomed[q.nodeId]) q.nodeId = null;
        });
        // 消えた場面の版履歴も一緒に削除
        data.snapshots = data.snapshots.filter(function(s){ return !doomed[s.nodeId]; });
      } else if (coll === "tags"){
        // タグ削除 → 全コレクションの tagIds から除去
        // （works=作品全体の構成タグ、elements=人物造形の技法タグ等も対象）
        [data.works, data.nodes, data.essays, data.quotes, data.elements].forEach(function(arr){
          arr.forEach(function(x){
            if (Array.isArray(x.tagIds)){
              x.tagIds = x.tagIds.filter(function(t){ return t !== id; });
            }
          });
        });
      } else if (coll === "quotes"){
        // 一節削除 → それを根拠にしている essays.evidence を除去
        // （孤児参照を残さない。設計.txt §5 の掃除契約）
        data.essays.forEach(function(e){
          if (Array.isArray(e.evidence)){
            e.evidence = e.evidence.filter(function(ev){
              return !(ev.refType === "quote" && ev.refId === id);
            });
          }
        });
      }
      store.save();
      return true;
    },

    /** 述語で検索（配列を返す）*/
    find: function(coll, pred){
      if (!data) store.load();
      var arr = data[coll];
      if (!Array.isArray(arr)) return [];
      return arr.filter(pred);
    },

    /** id で1件取得（無ければ null）*/
    byId: function(coll, id){
      if (!data) store.load();
      var arr = data[coll];
      if (!Array.isArray(arr)) return null;
      for (var i = 0; i < arr.length; i++){
        if (arr[i].id === id) return arr[i];
      }
      return null;
    },

    /**
     * 全データを monogatari-backup.json としてダウンロードさせる。
     * 「なぜ」:スマホ移植3条件②＝データごと持ち運べるようにするため。
     */
    exportJson: function(){
      if (!data) store.load();
      var text = JSON.stringify(data, null, 2);
      var blob = new Blob([text], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "monogatari-backup.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 解放は少し遅らせる（click 直後に revoke すると失敗するブラウザがある）
      setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    },

    /**
     * JSON テキストを検証して全置換で復元する。
     * 例外は投げず {ok:true} / {ok:false, error:"…"} を返す契約
     * （ユーザー操作起点なので、失敗はUI側でメッセージ表示するため）。
     */
    importJson: function(text){
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        return { ok: false, error: "JSONとして読み取れません: " + e.message };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)){
        return { ok: false, error: "データがオブジェクト形式ではありません" };
      }
      // 最低限の構造検証（設計指示: 5コレクションが配列であること）
      var required = ["works", "nodes", "tags", "essays", "quotes"];
      for (var i = 0; i < required.length; i++){
        if (!Array.isArray(parsed[required[i]])){
          return { ok: false, error: "必須データ「" + required[i] + "」が配列ではありません" };
        }
      }
      data = normalize(parsed);
      store.save();  // 保存＋onChange 発火（全ビューが再描画できる）
      return { ok: true };
    },

    /** 変更購読の登録（ビューが再描画のために使う）*/
    onChange: function(fn){
      if (typeof fn === "function") listeners.push(fn);
    }
  };

  /**
   * 削除されたノード群への essays.evidence 参照を除去する内部関数。
   * 「なぜ分離するか」:作品削除・ノード削除の両経路で同じ掃除が要るため。
   */
  function cleanupEvidenceForNodes(nodeIdSet){
    data.essays.forEach(function(e){
      if (Array.isArray(e.evidence)){
        e.evidence = e.evidence.filter(function(ev){
          return !(ev.refType === "node" && nodeIdSet[ev.refId]);
        });
      }
    });
  }

  /* ------------------------------------------------------------------
     複数タブ対策: 他タブの保存を取り込む。
     なぜ必要か: 保存は差分でなく全置換のため、古いメモリを持つタブが
     保存すると他タブの変更を静かに消してしまう。storage イベントで
     他タブの書き込みを検知したら、メモリを最新に読み直して通知する。
     以後この タブの update()/add() は最新データへの部分適用になるので、
     全置換による上書き喪失が「フィールド単位のマージ」に変わる。
     （入力途中の未保存テキストは各ビューの debounce/blur 保存が
     読み直し後のデータへ update するため失われない）
     ------------------------------------------------------------------ */
  if (window.addEventListener){
    window.addEventListener("storage", function(ev){
      // 自タブの書き込みでは発火しない仕様＝これは常に「他タブの変更」
      if (!ev || ev.key !== STORAGE_KEY) return;
      store.load();
      notify();
    });
  }

  window.App.store = store;

})();
