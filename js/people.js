/* ==========================================================================
   people.js — 人物・設定ビュー（id:people / order:55 / タブ「人物・設定」）
   設計.txt §4/§5(elements)/§6 に準拠。
   思想: 名著の登場人物・設定を「研究として記録」し、自作の人物・設定を
   「執筆として設計」する。両方を同じ器(elements)・同じタグ体系で扱うことで、
   名著の人物造形と自作を同じ物差しで比較できるのがこのアプリの強み。
   共通部品(theme.css / app.js の tagChipHtml・esc)を最大限使う。
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;

  // ★ビュー間の選択共有：どのファイルが先に走っても壊れないよう毎回保証する
  //   （作品選択 App.state.currentWorkId を分解/執筆ビューと共有するため）
  App.state = App.state || {};

  var root = null;

  // kind の表示順（設計.txt §5: 人物→場所→アイテム→組織→用語→その他）。
  // この順で節分けするため配列で固定する（一覧・グループ見出しの基準）。
  var KIND_ORDER = ["人物", "場所", "アイテム", "組織", "用語", "その他"];

  // kind 別の推奨ラベル雛形。
  // 「なぜ雛形か」:研究の切り口を最初に示して記録を促す。ただし研究用途では
  // 「何が重要か」は本人が決めるべきなので、ラベルも値も自由編集できる（設計 §5）。
  var FIELD_TEMPLATES = {
    "人物":     ["役割", "性格", "外見", "動機・目標", "背景", "関係", "成長弧"],
    "場所":     ["地理・環境", "歴史", "雰囲気", "物語での役割"],
    "アイテム": ["概要", "由来", "物語での役割"],
    "組織":     ["目的", "構成", "立場"],
    "用語":     ["定義", "補足"],
    "その他":   ["メモ"]
  };

  // タグのカテゴリ（tags スキーマ §5）。カテゴリ別セレクトで貼るために使う。
  var TAG_CATEGORIES = ["構成", "演出", "言葉遣い", "効果"];

  // 編集中の作業用ドラフト（新規=id:null / 既存=id あり）。
  // 「なぜドラフト方式か」:本文・可変ラベル行の途中入力を保持したまま、
  // 「行の追加/削除」「タグ付け」など構造変更でフォームを再描画しても
  // 入力が消えないようにするため（保存は明示ボタンで一貫させる）。
  var editing = null;

  // 一覧の絞り込み文字（show をまたいで保持）
  var searchQuery = "";

  // 表示モード "list"（索引カード一覧）/ "graph"（関係図）。show をまたいで保持
  var viewMode = "list";

  // 関係図の判定に使う最小名前長。
  // 「なぜ2文字以上か」:関係欄のテキストに名前が含まれるかの部分一致で線を
  // 引くため、1文字名（例「A」「兄」）だと無関係な文中の1字に当たって
  // 誤った線が大量に出る。誤検出より「引かない」方が研究の害が小さい。
  var GRAPH_MIN_NAME_LEN = 2;

  /* ------------------------------------------------------------------
     ヘルパー
     ------------------------------------------------------------------ */

  // kind の推奨ラベルから空値のフィールド行配列を作る（雛形の初期表示用）
  function templateFields(kind){
    var labels = FIELD_TEMPLATES[kind] || FIELD_TEMPLATES["その他"];
    return labels.map(function(label){ return { key: label, value: "" }; });
  }

  // 新規登録用の空ドラフトを作る（既定 kind=人物）
  function newDraft(kind){
    var k = kind || "人物";
    return { id: null, kind: k, name: "", fields: templateFields(k), body: "", tagIds: [] };
  }

  // 既存要素をドラフトへ読み込む（fields オブジェクト→編集用の順序つき配列へ）
  function draftFromElement(el){
    var fieldsObj = el.fields || {};
    var rows = Object.keys(fieldsObj).map(function(k){
      return { key: k, value: fieldsObj[k] == null ? "" : String(fieldsObj[k]) };
    });
    return {
      id: el.id,
      kind: KIND_ORDER.indexOf(el.kind) >= 0 ? el.kind : "その他",
      name: el.name || "",
      fields: rows,
      body: el.body || "",
      tagIds: (el.tagIds || []).slice()
    };
  }

  // 現在選択中の作品を返す（無効なら null）
  function currentWork(){
    var id = App.state.currentWorkId;
    return id ? App.store.byId("works", id) : null;
  }

  // 選択作品が未設定/消滅していたら先頭作品へ寄せる（作品があれば必ず1つ選ぶ）
  function ensureCurrentWork(){
    var works = App.store.get().works;
    if (!works.length) return;
    if (!currentWork()) App.state.currentWorkId = works[0].id;
  }

  // カードに出す「一言」= fields の先頭の非空値、無ければ body 冒頭
  function oneLiner(el){
    var f = el.fields || {};
    var keys = Object.keys(f);
    for (var i = 0; i < keys.length; i++){
      var v = f[keys[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    if (el.body && String(el.body).trim()) return String(el.body).trim();
    return "";
  }

  /* ------------------------------------------------------------------
     初回1回だけ：静的な骨組みを作り、イベントを結線する（init 契約）
     ★root.className は上書きせず classList.add のみ（設計 §2 の既知バグ対策）
     ------------------------------------------------------------------ */
  function init(rootEl){
    root = rootEl;
    root.classList.add("view-people");
    editing = newDraft();

    root.innerHTML =
      '<div class="block">' +
        '<h2 class="section-title">人物・設定</h2>' +
        '<p class="overline">名著の人物造形の記録と、自作の人物設計を同じ器・同じタグ体系で扱う。</p>' +
        '<div class="people-workbar" id="pp-workbar"></div>' +
        '<div class="people-modebar" id="pp-modebar"></div>' +
        '<div class="field people-search-field" id="pp-search-field">' +
          '<label for="pp-search">検索</label>' +
          '<input class="input" type="text" id="pp-search" placeholder="名前・メモの値・本文で絞り込む">' +
        '</div>' +
        '<div id="pp-list"></div>' +
        '<div id="pp-graph" hidden></div>' +
      '</div>' +
      '<div class="block" id="pp-form-block">' +
        '<div class="people-form-head">' +
          '<h2 class="section-title" id="pp-form-title">新しい人物・設定を追加</h2>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="new-element">＋ 新規追加</button>' +
        '</div>' +
        '<div id="pp-form"></div>' +
      '</div>';

    // 検索欄は静的（再描画されない）ので直接結線。入力のたび一覧のみ再描画
    // （フォームは触らないのでフォームの入力は消えない）。連打は debounce で間引く。
    var searchEl = root.querySelector("#pp-search");
    searchEl.addEventListener("input", App.util.debounce(function(){
      searchQuery = searchEl.value.trim();
      renderList();
    }, 150));

    // クリック/変更はイベント委譲でまとめて処理（フォームは再描画されるため、
    // 個別要素でなく root に一度だけ結ぶ＝再結線漏れの事故を防ぐ）
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);

    // 他ビューでの変更（作品削除・タグ削除等）に追随して再描画する
    App.store.onChange(function(){
      if (App.currentView() === "people") render();
    });
  }

  /* ------------------------------------------------------------------
     表示のたび：全体を作り直す（show 契約）
     ------------------------------------------------------------------ */
  function show(){ render(); }

  function render(){
    var works = App.store.get().works;
    var workbar = root.querySelector("#pp-workbar");
    var searchField = root.querySelector("#pp-search-field");
    var listEl = root.querySelector("#pp-list");
    var graphEl = root.querySelector("#pp-graph");
    var modebar = root.querySelector("#pp-modebar");
    var formBlock = root.querySelector("#pp-form-block");

    // 作品が1冊も無い＝空状態（設計指示の文言）。フォーム/検索は隠す
    if (!works.length){
      workbar.innerHTML = '<p class="people-empty">書庫で作品を登録してください。</p>';
      searchField.hidden = true;
      modebar.innerHTML = "";
      listEl.innerHTML = "";
      graphEl.hidden = true;
      graphEl.innerHTML = "";
      formBlock.hidden = true;
      return;
    }

    ensureCurrentWork();
    formBlock.hidden = false;
    renderWorkSelector();
    renderModeBar();

    // 検索は一覧の絞り込み専用なので、関係図モードでは隠す
    // （関係図は「その作品の人物全員の関係」を見る図＝部分表示だと誤読を招く）
    var isGraph = (viewMode === "graph");
    searchField.hidden = isGraph;
    listEl.hidden = isGraph;
    graphEl.hidden = !isGraph;

    if (isGraph) renderGraph();
    else renderList();
    renderForm();
  }

  /**
   * 「いま表示中の閲覧面」だけを描き直す。
   * 「なぜ必要か」:編集・保存・削除のたびに一覧を描き直していたが、関係図
   * モードでは一覧は隠れていて意味がなく、逆に図が古いまま残ってしまう。
   * 呼び出し側がモードを気にしなくて済むよう、ここで振り分ける。
   */
  function refreshBrowse(){
    if (viewMode === "graph") renderGraph();
    else renderList();
  }

  /** 一覧⇄関係図 の表示切替（タップで完結・現在モードを見て分かるようにする）*/
  function renderModeBar(){
    var modes = [
      { key: "list",  label: "一覧" },
      { key: "graph", label: "関係図" }
    ];
    root.querySelector("#pp-modebar").innerHTML =
      '<div class="people-modes">' +
      modes.map(function(m){
        var on = (viewMode === m.key);
        return '<button type="button" class="btn btn--sm' + (on ? " btn--primary" : "") + '" ' +
               'data-action="set-mode" data-mode="' + m.key + '"' +
               (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
               App.util.esc(m.label) + '</button>';
      }).join("") +
      '</div>';
  }

  /** 作品セレクタ（全作品＝名著も自作も対象・currentWorkId を初期選択）*/
  function renderWorkSelector(){
    var works = App.store.get().works;
    var curId = App.state.currentWorkId;
    var opts = works.map(function(w){
      var sel = (w.id === curId) ? " selected" : "";
      var mark = w.isOwn ? "〔自作〕" : "";
      return '<option value="' + App.util.esc(w.id) + '"' + sel + '>' +
             App.util.esc(w.title) + App.util.esc(mark) + '</option>';
    }).join("");
    root.querySelector("#pp-workbar").innerHTML =
      '<div class="field people-work-field">' +
        '<label for="pp-work-select">作品を選ぶ</label>' +
        '<select class="select" id="pp-work-select" data-action="select-work">' + opts + '</select>' +
      '</div>';
  }

  /* ------------------------------------------------------------------
     一覧（kind ごとに節分け・索引カード）
     ------------------------------------------------------------------ */
  function renderList(){
    var listEl = root.querySelector("#pp-list");
    var work = currentWork();
    if (!work){ listEl.innerHTML = ""; return; }

    var q = searchQuery.toLowerCase();
    var elements = App.store.find("elements", function(el){
      if (el.workId !== work.id) return false;
      if (!q) return true;
      // 検索対象: 名前・fields の全値・body の部分一致（ラベルは検索対象外＝
      // 「何が書いてあるか」で探す。ラベルは器なので値/本文を優先）
      if ((el.name || "").toLowerCase().indexOf(q) >= 0) return true;
      var f = el.fields || {};
      var hit = Object.keys(f).some(function(k){
        return String(f[k] == null ? "" : f[k]).toLowerCase().indexOf(q) >= 0;
      });
      if (hit) return true;
      if ((el.body || "").toLowerCase().indexOf(q) >= 0) return true;
      return false;
    });

    if (!elements.length){
      listEl.innerHTML = q
        ? '<p class="overline">検索条件に合う項目がありません。</p>'
        : '<p class="overline">この作品にはまだ人物・設定がありません。下のフォームから追加してください。</p>';
      return;
    }

    // kind ごとにまとめて、KIND_ORDER の順で節を並べる
    var byKind = {};
    elements.forEach(function(el){
      var k = KIND_ORDER.indexOf(el.kind) >= 0 ? el.kind : "その他";
      (byKind[k] = byKind[k] || []).push(el);
    });

    var html = "";
    KIND_ORDER.forEach(function(kind){
      var arr = byKind[kind];
      if (!arr || !arr.length) return;
      html += '<div class="people-group">' +
              '<h3 class="people-group-title overline">' + App.util.esc(kind) +
                '（' + arr.length + '）</h3>' +
              '<div class="people-grid">';
      arr.forEach(function(el){
        var line = oneLiner(el);
        var chips = (el.tagIds || []).map(function(id){ return App.tagChipHtml(id); }).join(" ");
        var active = (editing && editing.id === el.id);
        html +=
          '<div class="card people-card' + (active ? " people-card--active" : "") + '" ' +
               'data-action="open-element" data-id="' + App.util.esc(el.id) + '">' +
            '<div class="people-card__head">' +
              '<span class="overline">' + App.util.esc(el.kind) + '</span>' +
              '<span class="people-card__name">' + App.util.esc(el.name || "（無名）") + '</span>' +
            '</div>' +
            (line ? '<div class="people-card__line">' + App.util.esc(line) + '</div>' : "") +
            (chips ? '<div class="tag-row">' + chips + '</div>' : "") +
          '</div>';
      });
      html += '</div></div>';
    });
    listEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     関係図（kind=="人物" を円周に並べ、関係欄の記述から線を引く）
     「なぜ自前SVGか」:外部ライブラリ禁止（設計 §3）。円周配置＋直線なら
     三角関数だけで書け、viewBox でスマホ幅までそのまま縮む。
     「なぜ推定か」:関係はテキストで自由に書く器なので、構造化された
     「誰と誰がどういう関係か」のデータは持っていない。持っている情報
     （関係欄の文中に他の人物名が出るか）だけで引ける線を引く＝正直な近似。
     ------------------------------------------------------------------ */

  /** その人物の「関係」欄（ラベルに「関係」を含む行）の値をまとめて返す */
  function relationText(el){
    var f = el.fields || {};
    return Object.keys(f).filter(function(k){
      return k.indexOf("関係") >= 0;
    }).map(function(k){
      return f[k] == null ? "" : String(f[k]);
    }).join(" ");
  }

  function renderGraph(){
    var graphEl = root.querySelector("#pp-graph");
    var work = currentWork();
    if (!work){ graphEl.innerHTML = ""; return; }

    var people = App.store.find("elements", function(el){
      return el.workId === work.id && el.kind === "人物";
    });

    // 注記は常に出す（図が無いときも「何をする画面か」が分かるように）
    var note =
      '<p class="people-graph-note">関係欄のテキストから自動で推定した図です' +
      '（正確な関係の種類までは判定しません）。' +
      '名前の部分一致で判定するため、1文字の人物名は誤検出を避けて線を引きません。</p>';

    if (people.length < 2){
      graphEl.innerHTML =
        '<p class="overline">関係図には2人以上の人物が必要です。' +
        '（種別「人物」で登録した項目が対象です）</p>' + note;
      return;
    }

    // --- 線の推定: A の関係欄に B の名前が含まれる、または逆 → A—B を結ぶ ---
    var names = people.map(function(p){ return String(p.name || "").trim(); });
    var rels  = people.map(function(p){ return relationText(p); });
    var edges = [];
    for (var i = 0; i < people.length; i++){
      for (var j = i + 1; j < people.length; j++){
        var a = names[i], b = names[j];
        var linked =
          (b.length >= GRAPH_MIN_NAME_LEN && rels[i].indexOf(b) >= 0) ||
          (a.length >= GRAPH_MIN_NAME_LEN && rels[j].indexOf(a) >= 0);
        if (linked) edges.push([i, j]);
      }
    }

    // --- 円周配置 ---
    // viewBox 固定＝CSS 側の幅に合わせて自動で縮む（375px でも横あふれしない）
    // 幅は「円＋外側ラベル」が必ず内側に収まる値にする。ラベルは最大9字・
    // 13px 相当＝約117単位。左端 cx-LABEL_R-117 が正になるよう cx=280 とした
    // （viewBox からはみ出すとスマホ幅で名前が切れて読めなくなるため）
    var W = 560, H = 420, cx = W / 2, cy = 200, R = 120, LABEL_R = 140;
    var LABEL_MAX = 9;
    var pts = people.map(function(p, idx){
      // 真上(-90°)から時計回りに等間隔。上から読み始められる並びにする
      var ang = (-Math.PI / 2) + (2 * Math.PI * idx / people.length);
      return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), cos: Math.cos(ang) };
    });

    var svg = '<svg class="people-graph-svg" viewBox="0 0 ' + W + ' ' + H + '" ' +
              'role="img" aria-label="人物関係図">';

    // 線を先に描く（円の下に来るようにする）
    edges.forEach(function(e){
      svg += '<line class="pg-edge" x1="' + pts[e[0]].x.toFixed(1) + '" y1="' + pts[e[0]].y.toFixed(1) +
             '" x2="' + pts[e[1]].x.toFixed(1) + '" y2="' + pts[e[1]].y.toFixed(1) + '"></line>';
    });

    people.forEach(function(p, idx){
      var pt = pts[idx];
      var active = (editing && editing.id === p.id);
      var nm = String(p.name || "（無名）");
      // 長い名前は図が破綻するので表示だけ省略する（データは変えない）
      var shown = nm.length > LABEL_MAX ? nm.slice(0, LABEL_MAX) + "…" : nm;
      // 円の外側にラベルを置く。左半分は右寄せ、右半分は左寄せ＝図に被らない
      var lx = cx + LABEL_R * Math.cos(Math.atan2(pt.y - cy, pt.x - cx));
      var ly = cy + LABEL_R * Math.sin(Math.atan2(pt.y - cy, pt.x - cx));
      var anchor = pt.cos > 0.25 ? "start" : (pt.cos < -0.25 ? "end" : "middle");

      svg +=
        '<g class="pg-node' + (active ? " pg-node--active" : "") + '" ' +
           'data-action="open-element" data-id="' + App.util.esc(p.id) + '">' +
          '<circle class="pg-dot" cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="14"></circle>' +
          '<text class="pg-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" ' +
                'text-anchor="' + anchor + '" dominant-baseline="middle">' +
            App.util.esc(shown) +
          '</text>' +
        '</g>';
    });
    svg += '</svg>';

    graphEl.innerHTML =
      '<div class="people-graph-wrap">' + svg + '</div>' +
      '<p class="overline">人物 ' + people.length + ' 名／推定した関係線 ' + edges.length + ' 本。' +
      '丸をタップするとその人物の編集フォームが開きます。</p>' +
      note;
  }

  /* ------------------------------------------------------------------
     フォーム（新規追加・編集）
     ------------------------------------------------------------------ */
  function renderForm(){
    var formEl = root.querySelector("#pp-form");
    var titleEl = root.querySelector("#pp-form-title");
    titleEl.textContent = editing.id ? "人物・設定を編集" : "新しい人物・設定を追加";

    // kind セレクト
    var kindOpts = KIND_ORDER.map(function(k){
      var sel = (k === editing.kind) ? " selected" : "";
      return '<option value="' + App.util.esc(k) + '"' + sel + '>' + App.util.esc(k) + '</option>';
    }).join("");

    // 構造化メモ fields（可変 key-value 行）
    var fieldRows = editing.fields.map(function(f, idx){
      return '<div class="pp-field-row">' +
        '<input class="input pp-field-key" data-idx="' + idx + '" type="text" ' +
               'placeholder="ラベル" value="' + App.util.esc(f.key) + '">' +
        '<input class="input pp-field-value" data-idx="' + idx + '" type="text" ' +
               'placeholder="値" value="' + App.util.esc(f.value) + '">' +
        '<button type="button" class="btn btn--danger btn--sm pp-field-remove" ' +
               'data-action="remove-field" data-idx="' + idx + '">×</button>' +
      '</div>';
    }).join("");

    // タグ: 現在チップ（×で外す）
    var currentTagsHtml = editing.tagIds.map(function(id){
      var chip = App.tagChipHtml(id);
      if (!chip) return "";  // 削除済みタグIDは描画しない
      return '<span class="people-tag-wrap">' + chip +
             '<button type="button" class="people-tag-x" data-action="remove-tag" ' +
                     'data-id="' + App.util.esc(id) + '" aria-label="タグを外す">×</button></span>';
    }).join(" ");

    // タグ: カテゴリ別セレクトで追加（未付与のタグだけを候補に出す）
    var data = App.store.get();
    var addSelects = TAG_CATEGORIES.map(function(cat){
      var opts = data.tags.filter(function(t){
        return t.category === cat && editing.tagIds.indexOf(t.id) < 0;
      }).map(function(t){
        return '<option value="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</option>';
      }).join("");
      if (!opts) return "";  // その分類に貼れるタグが無ければセレクトを出さない
      return '<select class="select people-tag-add" data-action="add-tag" data-category="' +
               App.util.esc(cat) + '">' +
             '<option value="">＋ ' + App.util.esc(cat) + 'タグを貼る</option>' + opts +
             '</select>';
    }).join("");
    if (!addSelects){
      addSelects = '<p class="overline">貼れるタグがありません。先に「タグ辞典」で登録してください。</p>';
    }

    formEl.innerHTML =
      '<div class="field">' +
        '<label for="pp-kind">種別</label>' +
        '<select class="select" id="pp-kind" data-action="form-kind">' + kindOpts + '</select>' +
      '</div>' +
      '<div class="field">' +
        '<label for="pp-name">名前（必須）</label>' +
        '<input class="input" type="text" id="pp-name" value="' + App.util.esc(editing.name) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>構造化メモ（ラベルも値も自由に編集・行の追加削除ができます）</label>' +
        '<div id="pp-fields">' + fieldRows + '</div>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-action="add-field">＋ 行を追加</button>' +
      '</div>' +
      '<div class="field">' +
        '<label for="pp-body">本文メモ</label>' +
        '<textarea class="textarea" id="pp-body" placeholder="自由記述">' + App.util.esc(editing.body) + '</textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>タグ付け</label>' +
        '<p class="overline">名著の人物なら造形の技法、自作なら狙う技法を貼れる。</p>' +
        '<div class="tag-row people-current-tags">' +
          (currentTagsHtml || '<span class="overline">タグなし</span>') +
        '</div>' +
        '<div class="people-tag-adders">' + addSelects + '</div>' +
      '</div>' +
      '<div class="form-actions people-form-actions">' +
        '<button type="button" class="btn btn--primary" data-action="save-element">' +
          (editing.id ? "更新する" : "追加する") + '</button>' +
        (editing.id ? '<button type="button" class="btn" data-action="cancel-edit">編集をやめる</button>' : "") +
        (editing.id ? '<button type="button" class="btn btn--danger" data-action="delete-element">この項目を削除</button>' : "") +
      '</div>';
  }

  /**
   * フォームの現在のDOM値をドラフトへ吸い上げる。
   * 「なぜ必要か」:名前・本文・可変ラベル行はテキスト入力＝入力のたびには
   * 再描画しない（フォーカスが飛ぶため）。行追加/タグ変更などで再描画する
   * 直前にここでDOM→ドラフトへ写し取り、途中入力を失わないようにする。
   */
  function syncFormToDraft(){
    var formEl = root.querySelector("#pp-form");
    if (!formEl) return;
    var kindEl = formEl.querySelector("#pp-kind");
    var nameEl = formEl.querySelector("#pp-name");
    var bodyEl = formEl.querySelector("#pp-body");
    if (kindEl) editing.kind = kindEl.value;
    if (nameEl) editing.name = nameEl.value;
    if (bodyEl) editing.body = bodyEl.value;

    var keyEls = formEl.querySelectorAll(".pp-field-key");
    var valEls = formEl.querySelectorAll(".pp-field-value");
    var rows = [];
    for (var i = 0; i < keyEls.length; i++){
      rows.push({ key: keyEls[i].value, value: (valEls[i] ? valEls[i].value : "") });
    }
    editing.fields = rows;
  }

  /* ------------------------------------------------------------------
     イベント委譲：クリック
     ------------------------------------------------------------------ */
  function onClick(ev){
    var t = ev.target;
    // ★SVG の子要素（circle/text）も closest を持つが、念のため
    //   Element でない標的（テキストノード等）は無視して落ちないようにする
    if (!t || typeof t.closest !== "function") return;

    var modeBtn = t.closest('[data-action="set-mode"]');
    if (modeBtn){
      viewMode = modeBtn.getAttribute("data-mode");
      render();
      return;
    }

    var openEl = t.closest('[data-action="open-element"]');
    if (openEl){ openElement(openEl.getAttribute("data-id")); return; }

    var newBtn = t.closest('[data-action="new-element"]');
    if (newBtn){ editing = newDraft(); renderForm(); refreshBrowse(); return; }

    var addField = t.closest('[data-action="add-field"]');
    if (addField){
      syncFormToDraft();
      editing.fields.push({ key: "", value: "" });
      renderForm();
      return;
    }

    var rmField = t.closest('[data-action="remove-field"]');
    if (rmField){
      syncFormToDraft();
      editing.fields.splice(Number(rmField.getAttribute("data-idx")), 1);
      renderForm();
      return;
    }

    var rmTag = t.closest('[data-action="remove-tag"]');
    if (rmTag){
      syncFormToDraft();
      var rid = rmTag.getAttribute("data-id");
      var i = editing.tagIds.indexOf(rid);
      if (i >= 0) editing.tagIds.splice(i, 1);
      renderForm();
      return;
    }

    var saveBtn = t.closest('[data-action="save-element"]');
    if (saveBtn){ syncFormToDraft(); saveElement(); return; }

    var cancelBtn = t.closest('[data-action="cancel-edit"]');
    if (cancelBtn){ editing = newDraft(); renderForm(); refreshBrowse(); return; }

    var delBtn = t.closest('[data-action="delete-element"]');
    if (delBtn){ deleteElement(); return; }
  }

  /* ------------------------------------------------------------------
     イベント委譲：変更（select 系）
     ------------------------------------------------------------------ */
  function onChange(ev){
    var t = ev.target;

    var workSel = t.closest('[data-action="select-work"]');
    if (workSel){
      // 作品を切り替えたら、その作品用の新規フォームに戻す（別作品の下書きを持ち越さない）
      App.state.currentWorkId = workSel.value;
      editing = newDraft();
      refreshBrowse();
      renderForm();
      return;
    }

    var kindSel = t.closest('[data-action="form-kind"]');
    if (kindSel){
      syncFormToDraft();
      editing.kind = kindSel.value;
      // 値が1つも入っていなければ、選んだ種別の推奨ラベル雛形に差し替える
      // （入力済みなら壊さない＝手入力を尊重）
      var allEmpty = editing.fields.every(function(f){ return !String(f.value).trim(); });
      if (allEmpty) editing.fields = templateFields(editing.kind);
      renderForm();
      return;
    }

    var addTag = t.closest('[data-action="add-tag"]');
    if (addTag){
      var tid = addTag.value;
      if (tid){
        syncFormToDraft();
        if (editing.tagIds.indexOf(tid) < 0) editing.tagIds.push(tid);
        renderForm();
      }
      return;
    }
  }

  /* ------------------------------------------------------------------
     操作の実体
     ------------------------------------------------------------------ */

  // 指定要素をフォームへ読み込み、編集モードにする
  function openElement(id){
    var el = App.store.byId("elements", id);
    if (!el) return;
    // 別作品の要素を開いた場合も、選択作品をその作品へ合わせる（一貫性）
    if (el.workId) App.state.currentWorkId = el.workId;
    editing = draftFromElement(el);
    renderWorkSelector();
    refreshBrowse();
    renderForm();
    root.querySelector("#pp-form-block").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 追加/更新の保存（名前必須・fields 配列→オブジェクトへ変換）
  function saveElement(){
    var work = currentWork();
    if (!work){ window.alert("先に作品を選んでください。"); return; }

    var name = editing.name.trim();
    if (!name){
      window.alert("名前を入力してください。");
      var nameEl = root.querySelector("#pp-name");
      if (nameEl) nameEl.focus();
      return;
    }

    // fields: ラベルが空の行は捨てる（器として意味を成さないため）。
    // 同名ラベルは後勝ち（オブジェクトのキー制約）。値はそのまま保持。
    var fieldsObj = {};
    editing.fields.forEach(function(f){
      var key = String(f.key).trim();
      if (!key) return;
      fieldsObj[key] = f.value;
    });

    var now = Date.now();
    if (editing.id){
      // ★App.store.update は essays 以外 updatedAt を自動更新しないため、
      //   people 側で patch に updatedAt を明示的に含めて渡す（設計指示）。
      App.store.update("elements", editing.id, {
        kind: editing.kind,
        name: name,
        fields: fieldsObj,
        body: editing.body,
        tagIds: editing.tagIds.slice(),
        updatedAt: now
      });
    } else {
      var obj = App.store.add("elements", {
        workId: work.id,
        kind: editing.kind,
        name: name,
        fields: fieldsObj,
        body: editing.body,
        tagIds: editing.tagIds.slice(),
        updatedAt: now   // 追加時点から updatedAt を持たせる（一覧の並び等の一貫性）
      });
      editing.id = obj.id;  // 追加後はそのまま編集を続けられるようにする
    }
    refreshBrowse();
    renderForm();
  }

  // 削除（confirm 必須）
  function deleteElement(){
    if (!editing.id) return;
    var el = App.store.byId("elements", editing.id);
    var label = el ? el.name : "この項目";
    var ok = window.confirm("「" + label + "」を削除します。元に戻せません。よろしいですか？");
    if (!ok) return;
    App.store.remove("elements", editing.id);
    editing = newDraft();
    refreshBrowse();
    renderForm();
  }

  // ビュー登録（設計 §4）。init=初回のみ、show=表示のたび再描画
  App.registerView({ id: "people", title: "人物・設定", order: 55, init: init, show: show });

})();
