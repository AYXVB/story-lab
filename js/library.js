/* ==========================================================================
   library.js — 書庫ビュー（id:library / order:10 / タブ「書庫」）
   作品を索引カード風に一覧・登録・編集・削除し、構造軸で絞り込む。
   カードのクリックで App.state.currentWorkId を渡して分解(anatomy)へ遷移する。
   設計.txt §4/§5/§6 に準拠。共通部品は theme.css / app.js を最大限使う。
   ========================================================================== */
(function(){
  "use strict";

  var App = window.App;

  // ★ビュー間の選択共有：どのファイルが先に走っても壊れないよう毎回保証する
  App.state = App.state || {};

  // init で作った要素への参照（show/再描画で使い回す）
  var els = {};

  // 絞り込みの現在値（show をまたいで保持）
  // 軸の絞り込み値（キーは AXIS_KEYS と同じ。own だけは軸でなく自作/名著の別）
  var filter = { kind: "", length: "", reception: "", form: "", own: "" };

  // 編集中の作品id（null=新規登録モード）
  var editingId = null;

  // 案内所が提案したタグ候補（登録/更新時に作品の tagIds へ合流させる。
  // なぜ即保存しないか: 新規登録では作品がまだ存在しないため）
  var pendingGuideTagIds = [];

  // 軸キー→日本語ラベル（フォーム/絞り込みの見出しに使う）
  // 軸の定義（ラベル）。★軸を増やすときはここに1行足すだけで
  // 登録フォーム・絞り込み・カード表示すべてに反映される（データ駆動）。
  // kind=種別 は「小説/詩/戯曲/映画…」の枠。他の3軸（長さ・受容形態・
  // 表現形式）とは別の観点なので独立した軸として持つ（2026-07-19 追加）
  var AXIS_LABELS = {
    kind: "種別", length: "長さ", reception: "受容形態", form: "表現形式"
  };
  var AXIS_KEYS = Object.keys(AXIS_LABELS);

  /* ------------------------------------------------------------------
     初回1回だけ：静的な骨組み（絞り込み・一覧の器・登録フォーム）を作る
     ★root.className は上書きせず classList.add のみ（設計 §2 の既知バグ対策）
     ------------------------------------------------------------------ */
  function init(root){
    root.classList.add("view-library");

    root.innerHTML =
      '<div class="block">' +
        '<h2 class="section-title">書庫</h2>' +
        '<div class="lib-filters" id="lib-filters"></div>' +
        '<div id="lib-list"></div>' +
      '</div>' +
      '<div class="block">' +
        '<h2 class="section-title" id="lib-form-title">新しい一冊を登録</h2>' +
        '<form class="lib-form" id="lib-form" autocomplete="off">' +
          '<div class="field">' +
            '<label for="lf-title">題名</label>' +
            '<div class="lf-title-row">' +
              '<input class="input" type="text" id="lf-title" required>' +
              // 案内所＝内蔵の有名作品データ（works-guide.js）。題名から
              // 著者・年・構造軸・あらすじ・タグ候補を自動入力する
              '<button type="button" class="btn btn--ghost btn--sm" id="lf-guide">📖 案内所から自動入力</button>' +
            '</div>' +
            '<div class="lf-guide-status" id="lf-guide-status" aria-live="polite"></div>' +
          '</div>' +
          '<div class="axis-row">' +
            '<div class="field">' +
              '<label for="lf-author">著者</label>' +
              '<input class="input" type="text" id="lf-author">' +
            '</div>' +
            '<div class="field">' +
              '<label for="lf-year">年</label>' +
              '<input class="input" type="text" id="lf-year" inputmode="numeric" placeholder="例: 1940">' +
            '</div>' +
          '</div>' +
          '<div class="axis-row" id="lf-axes"></div>' +
          '<label class="lib-check">' +
            '<input type="checkbox" id="lf-isown"> 自作品として登録する（自分の作品も名著と同じ物差しで扱う）' +
          '</label>' +
          '<div class="field">' +
            '<label for="lf-note">メモ</label>' +
            '<textarea class="textarea" id="lf-note" placeholder="研究上の覚え書き（任意）"></textarea>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn--primary" id="lf-submit">登録する</button>' +
            '<button type="button" class="btn" id="lf-cancel" hidden>編集をやめる</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    els.filters = root.querySelector("#lib-filters");
    els.list    = root.querySelector("#lib-list");
    els.form     = root.querySelector("#lib-form");
    els.formTitle= root.querySelector("#lib-form-title");
    els.axesWrap = root.querySelector("#lf-axes");
    els.submit   = root.querySelector("#lf-submit");
    els.cancel   = root.querySelector("#lf-cancel");
    els.fTitle   = root.querySelector("#lf-title");
    els.fAuthor  = root.querySelector("#lf-author");
    els.fYear    = root.querySelector("#lf-year");
    els.fIsOwn   = root.querySelector("#lf-isown");
    els.fNote    = root.querySelector("#lf-note");

    // 軸セレクト（選択肢は axisDefs から動的生成＝軸が増えても追随する）
    els.axesWrap.innerHTML = buildAxisSelects("lf");

    els.guideBtn    = root.querySelector("#lf-guide");
    els.guideStatus = root.querySelector("#lf-guide-status");

    // フォーム送信＝新規追加 or 更新
    els.form.addEventListener("submit", onSubmit);
    els.cancel.addEventListener("click", resetForm);

    // 案内所から自動入力（題名照合→著者/年/軸/あらすじ/タグ候補）
    els.guideBtn.addEventListener("click", applyGuide);

    // 一覧のクリック（カード＝分解へ、編集/削除ボタン＝各操作）をまとめて委譲
    els.list.addEventListener("click", onListClick);

    // 他ビューでの変更（作品削除等）に追随して一覧を再描画
    App.store.onChange(function(){
      if (App.currentView() === "library") render();
    });
  }

  /** 軸セレクト群のHTML（prefix で lf=フォーム / flt=絞り込み を区別）*/
  function buildAxisSelects(prefix){
    var axisDefs = App.store.get().axisDefs || {};
    var html = "";
    AXIS_KEYS.forEach(function(key){
      var opts = (axisDefs[key] || []).map(function(v){
        return '<option value="' + App.util.esc(v) + '">' + App.util.esc(v) + '</option>';
      }).join("");
      html +=
        '<div class="field">' +
          '<label for="' + prefix + '-' + key + '">' + AXIS_LABELS[key] + '</label>' +
          '<select class="select" id="' + prefix + '-' + key + '">' + opts + '</select>' +
        '</div>';
    });
    return html;
  }

  /* ------------------------------------------------------------------
     表示のたび：絞り込みバーと一覧を作り直す（show 契約）
     ------------------------------------------------------------------ */
  function show(){ render(); }

  function render(){
    renderFilters();
    renderList();
  }

  /** 絞り込みバー（軸3つ＋自作/名著）。値は filter に保持して再描画で復元 */
  function renderFilters(){
    var axisDefs = App.store.get().axisDefs || {};
    function optionSet(key){
      var opts = '<option value="">すべて</option>';
      (axisDefs[key] || []).forEach(function(v){
        var sel = (filter[key] === v) ? " selected" : "";
        opts += '<option value="' + App.util.esc(v) + '"' + sel + '>' + App.util.esc(v) + '</option>';
      });
      return opts;
    }
    var ownOpts =
      '<option value=""'    + (filter.own === ""    ? " selected" : "") + '>すべて</option>' +
      '<option value="own"' + (filter.own === "own" ? " selected" : "") + '>自作のみ</option>' +
      '<option value="classic"' + (filter.own === "classic" ? " selected" : "") + '>名著のみ</option>';

    // 軸の絞り込みは AXIS_KEYS から自動生成（軸を増やしても追随する）
    var axisFilters = AXIS_KEYS.map(function(key){
      return '<div class="field"><label for="flt-' + key + '">' + AXIS_LABELS[key] + '</label>' +
        '<select class="select" id="flt-' + key + '" data-fkey="' + key + '">' +
        optionSet(key) + '</select></div>';
    }).join("");

    els.filters.innerHTML =
      axisFilters +
      '<div class="field"><label for="flt-own">区分</label>' +
        '<select class="select" id="flt-own" data-fkey="own">' + ownOpts + '</select></div>' +
      '<div class="lib-filter-spacer"></div>' +
      '<div class="lib-count" id="lib-count"></div>';

    // 絞り込み変更で filter を更新して一覧だけ再描画（フォーカスは失ってよい）
    var selects = els.filters.querySelectorAll("select[data-fkey]");
    for (var i = 0; i < selects.length; i++){
      selects[i].addEventListener("change", function(){
        filter[this.getAttribute("data-fkey")] = this.value;
        renderList();
      });
    }
  }

  /** 現在の絞り込みを通過する作品を返す */
  function filteredWorks(){
    return App.store.get().works.filter(function(w){
      var axes = w.axes || {};
      // 軸の絞り込みは AXIS_KEYS を回す（軸を増やしても自動で効く）
      for (var i = 0; i < AXIS_KEYS.length; i++){
        var k = AXIS_KEYS[i];
        if (filter[k] && axes[k] !== filter[k]) return false;
      }
      if (filter.own === "own"     && !w.isOwn) return false;
      if (filter.own === "classic" &&  w.isOwn) return false;
      return true;
    });
  }

  /** 作品カード一覧を描画（0件は空状態）*/
  function renderList(){
    var all = App.store.get().works;
    var works = filteredWorks();

    var countEl = els.filters.querySelector("#lib-count");
    if (countEl){
      countEl.textContent = "全 " + all.length + " 冊中 " + works.length + " 冊";
    }

    if (all.length === 0){
      // 1冊も無い＝最初の一冊への導線を出す（下の登録フォームへ促す）
      els.list.innerHTML =
        '<div class="lib-empty">' +
          '<p>まだ作品がありません。<br>下の「新しい一冊を登録」から、分解したい名著や自作品を加えてください。</p>' +
          '<button type="button" class="btn btn--primary" id="lib-empty-focus">最初の一冊を登録する</button>' +
        '</div>';
      var b = els.list.querySelector("#lib-empty-focus");
      if (b) b.addEventListener("click", function(){ els.fTitle.focus(); });
      return;
    }
    if (works.length === 0){
      els.list.innerHTML =
        '<div class="lib-empty"><p>絞り込み条件に合う作品がありません。</p></div>';
      return;
    }

    // 場面数（type=="場面"）を作品ごとに数える
    var sceneCount = {};
    App.store.get().nodes.forEach(function(n){
      if (n.type === "場面"){ sceneCount[n.workId] = (sceneCount[n.workId] || 0) + 1; }
    });

    var html = '<div class="lib-grid">';
    works.forEach(function(w){
      var axes = w.axes || {};
      var axisChips = AXIS_KEYS.map(function(k){
        return axes[k] ? '<span class="axis-chip">' + App.util.esc(axes[k]) + '</span>' : "";
      }).join("");
      var meta = [];
      if (w.author) meta.push(App.util.esc(w.author));
      if (w.year)   meta.push(App.util.esc(w.year));
      var ownStamp = w.isOwn ? '<span class="own-stamp">自作</span>' : "";
      var scenes = sceneCount[w.id] || 0;

      // 作品タグ（構成タグ等）。チップをボタンで包み、クリックで
      // タグ辞典の該当説明へ飛べるようにする（ユーザー要望 2026-07-18）
      var tagChips = (w.tagIds || []).map(function(tid){
        var chip = App.tagChipHtml(tid);
        if (!chip) return "";   // 削除済みタグは描かない（共通契約）
        return '<button type="button" class="work-card__tagbtn" data-tag-jump="' +
               App.util.esc(tid) + '" title="タグの説明を見る">' + chip + '</button>';
      }).join("");

      html +=
        '<div class="card work-card" data-open="' + App.util.esc(w.id) + '">' +
          '<div class="work-card__head">' +
            '<span class="work-card__title">' + App.util.esc(w.title) + '</span>' +
            ownStamp +
          '</div>' +
          (meta.length ? '<div class="work-card__meta">' + meta.join("／") + '</div>' : "") +
          (axisChips ? '<div class="work-card__axes">' + axisChips + '</div>' : "") +
          (tagChips ? '<div class="work-card__tags">' + tagChips + '</div>' : "") +
          '<div class="work-card__foot">' +
            '<span>場面 ' + scenes + '</span>' +
            '<span class="work-card__actions">' +
              '<button type="button" class="btn btn--sm" data-edit="' + App.util.esc(w.id) + '">編集</button>' +
              '<button type="button" class="btn btn--sm btn--danger" data-del="' + App.util.esc(w.id) + '">削除</button>' +
            '</span>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    els.list.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     一覧内クリックの委譲処理
     ------------------------------------------------------------------ */
  function onListClick(ev){
    var t = ev.target;

    // タグチップ→タグ辞典の該当説明へ（カードクリックより先に判定）
    var tagBtn = t.closest("[data-tag-jump]");
    if (tagBtn){
      ev.stopPropagation();
      App.state.jumpToTagId = tagBtn.getAttribute("data-tag-jump");
      App.showView("tags");
      return;
    }

    // 編集ボタン（カードのクリックより先に判定＝伝播で分解へ飛ばさない）
    var editBtn = t.closest("[data-edit]");
    if (editBtn){ ev.stopPropagation(); startEdit(editBtn.getAttribute("data-edit")); return; }

    // 削除ボタン（confirm 必須＝場面等も消えることを明示）
    var delBtn = t.closest("[data-del]");
    if (delBtn){
      ev.stopPropagation();
      var w = App.store.byId("works", delBtn.getAttribute("data-del"));
      if (!w) return;
      var ok = window.confirm(
        "『" + w.title + "』を削除します。\n" +
        "この作品に紐づく場面・章・タグ付け・引用の紐付けもすべて消えます。\n" +
        "元に戻せません。よろしいですか？"
      );
      if (!ok) return;
      App.store.remove("works", w.id);        // 参照掃除は store が行う
      if (editingId === w.id) resetForm();    // 編集中を消したらフォームも戻す
      render();
      return;
    }

    // カード本体クリック＝分解ビューへ（選択作品を渡す）
    var card = t.closest("[data-open]");
    if (card){
      App.state.currentWorkId = card.getAttribute("data-open");
      App.showView("anatomy");
    }
  }

  /* ------------------------------------------------------------------
     登録／編集フォーム
     ------------------------------------------------------------------ */
  function readAxisSelect(prefix, key){
    var el = els.form.querySelector("#" + prefix + "-" + key);
    return el ? el.value : "";
  }

  function onSubmit(ev){
    ev.preventDefault();
    var title = els.fTitle.value.trim();
    if (!title){ els.fTitle.focus(); return; }   // required の保険

    var payload = {
      title: title,
      author: els.fAuthor.value.trim(),
      year: els.fYear.value.trim(),
      isOwn: !!els.fIsOwn.checked,
      // 軸は AXIS_KEYS から動的に読む（軸を増やしても保存に追随する）
      axes: (function(){
        var a = {};
        AXIS_KEYS.forEach(function(k){ a[k] = readAxisSelect("lf", k); });
        return a;
      })(),
      note: els.fNote.value.trim()
    };

    if (editingId){
      // 案内所のタグ候補があれば既存タグと重複なしで合流させる
      if (pendingGuideTagIds.length){
        var w0 = App.store.byId("works", editingId);
        var merged = (w0 && w0.tagIds ? w0.tagIds.slice() : []);
        pendingGuideTagIds.forEach(function(id){
          if (merged.indexOf(id) < 0) merged.push(id);
        });
        payload.tagIds = merged;
      }
      App.store.update("works", editingId, payload);
    } else {
      // 新規は案内所候補があればそれを、なければ空で初期化
      payload.tagIds = pendingGuideTagIds.slice();
      App.store.add("works", payload);
    }
    resetForm();
    render();
  }

  /**
   * 案内所（App.worksGuide）から自動入力する。
   * 方針: 題名で照合し、空欄のみ埋める（ユーザーが手で入れた値を上書きしない）。
   * あらすじはメモ欄へ、タグ候補は pendingGuideTagIds に保持して保存時に合流。
   * 見つからない場合も正直に伝える（勝手に推測しない）。
   */
  function applyGuide(){
    var title = els.fTitle.value.trim();
    if (!title){
      els.guideStatus.textContent = "先に題名を入れてください。";
      return;
    }
    if (!Array.isArray(window.App.worksGuide)){
      els.guideStatus.textContent = "案内所データが読み込まれていません。";
      return;
    }
    // 照合: 完全一致→空白除去＋小文字化一致（表記ゆれ耐性。部分一致は誤爆するのでしない）
    var norm = function(s){ return String(s).replace(/[\s　]/g, "").toLowerCase(); };
    var hit = null;
    window.App.worksGuide.forEach(function(g){
      if (hit || !g || !Array.isArray(g.titles)) return;
      g.titles.forEach(function(t){
        if (hit) return;
        if (t === title || norm(t) === norm(title)) hit = g;
      });
    });
    if (!hit){
      els.guideStatus.textContent =
        "案内所に「" + title + "」は見つかりませんでした" +
        "（有名作品のみ収録。Claude に頼めば追加できます）。";
      return;
    }
    // 空欄のみ埋める（手入力を尊重）
    if (!els.fAuthor.value.trim() && hit.author) els.fAuthor.value = hit.author;
    if (!els.fYear.value.trim() && hit.year) els.fYear.value = String(hit.year);
    var axes = hit.axes || {};
    AXIS_KEYS.forEach(function(k){
      var el = els.form.querySelector("#lf-" + k);
      if (el && axes[k] && !el.value) el.value = axes[k];
    });
    if (hit.synopsis){
      var line = "【あらすじ（案内所）】" + hit.synopsis;
      if (!els.fNote.value.trim()){
        els.fNote.value = line;
      } else if (els.fNote.value.indexOf("【あらすじ（案内所）】") < 0){
        els.fNote.value = els.fNote.value + "\n\n" + line;
      }
    }
    // タグ候補の解決。案内所は seed の安定IDを参照するが、初期に取り込まれた
    // タグはランダムIDで保存されている環境がある（旧 applySeed の名残）。
    // そのため「IDで見つからなければ seed の名前で照合する」二段構えにする。
    // これが無いと旧データの利用者にはタグ候補がほとんど付かない。
    pendingGuideTagIds = (hit.tagIds || []).map(function(id){
      if (App.store.byId("tags", id)) return id;          // ①IDで一致
      var seed = null;
      (window.App.seedTags || []).forEach(function(s){
        if (s.id === id) seed = s;
      });
      if (!seed) return null;
      var found = null;
      App.store.get().tags.forEach(function(t){            // ②名前で一致
        if (!found && t.name === seed.name) found = t;
      });
      return found ? found.id : null;
    }).filter(Boolean);
    var tagNames = pendingGuideTagIds.map(function(id){
      var t = App.store.byId("tags", id);
      return t ? t.name : "";
    }).filter(Boolean);
    els.guideStatus.textContent =
      "案内所から自動入力しました。" +
      (tagNames.length ? "タグ候補: " + tagNames.join("・") +
       "（" + (editingId ? "更新" : "登録") + "時に付きます）" : "");
  }

  /** 指定作品をフォームへ読み込んで編集モードにする */
  function startEdit(id){
    var w = App.store.byId("works", id);
    if (!w) return;
    editingId = id;
    pendingGuideTagIds = [];                      // 前の作品の候補を持ち越さない
    if (els.guideStatus) els.guideStatus.textContent = "";
    els.fTitle.value  = w.title || "";
    els.fAuthor.value = w.author || "";
    els.fYear.value   = w.year || "";
    els.fIsOwn.checked= !!w.isOwn;
    els.fNote.value   = w.note || "";
    var axes = w.axes || {};
    AXIS_KEYS.forEach(function(k){
      var el = els.form.querySelector("#lf-" + k);
      if (el) el.value = axes[k] || "";
    });
    els.formTitle.textContent = "作品を編集：" + w.title;
    els.submit.textContent = "更新する";
    els.cancel.hidden = false;
    // 編集フォームへスクロールして迷子を防ぐ
    els.formTitle.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** フォームを新規登録モードへ戻す */
  function resetForm(){
    editingId = null;
    pendingGuideTagIds = [];
    if (els.guideStatus) els.guideStatus.textContent = "";
    els.form.reset();
    // reset は select を先頭へ戻すだけ＝それで良い（軸の既定値）
    els.formTitle.textContent = "新しい一冊を登録";
    els.submit.textContent = "登録する";
    els.cancel.hidden = true;
  }

  // ビュー登録（設計 §4）。init=初回のみ、show=表示のたび一覧を作り直す
  App.registerView({ id: "library", title: "書庫", order: 10, init: init, show: show });

})();
