/* ==========================================================================
   tags.js — タグ辞典ビュー（設計.txt §4 tags / order30）
   タグの定義・代表例・出典をカテゴリ別に一覧し、追加/編集/削除、
   使用数の逆引き（どの場面に付いているか）、名前/定義の検索を提供する。
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;
  // ビュー間の選択共有領域（分解ビューへジャンプする際に使う契約・設計.txt）
  App.state = App.state || {};

  // カテゴリの表示順（構成/演出/言葉遣い=技法、効果=効果）
  var CATEGORY_ORDER = ["構成", "演出", "言葉遣い", "効果"];

  var root = null;          // ビューのルート要素（init で受け取る）
  var editingId = null;     // 編集中タグid（null=新規追加モード）
  var usageTagId = null;    // 逆引きパネルで表示中のタグid（null=非表示）
  var searchText = "";      // 検索ボックスの現在値

  /* ------------------------------------------------------------------
     ヘルパー
     ------------------------------------------------------------------ */

  // examples は seed データが配列、手入力フォームは文字列で来るため両対応で表示する
  function fmtExamples(v){
    if (Array.isArray(v)) return v.join(" ／ ");
    return v || "";
  }

  // 全コレクションを横断してタグの使用回数を数える（設計 §4「使用数」）
  function countUsage(tagId){
    var data = App.store.get();
    var n = 0;
    // elements（人物・設定資料）も tagIds を持つので使用数に含める
    [data.nodes, data.works, data.quotes, data.essays, data.elements].forEach(function(arr){
      (arr || []).forEach(function(x){
        if (Array.isArray(x.tagIds) && x.tagIds.indexOf(tagId) !== -1) n++;
      });
    });
    return n;
  }

  // 逆引き:「そのタグが付いた場面」を作品名つきで返す
  function usageScenes(tagId){
    var data = App.store.get();
    return data.nodes
      .filter(function(n){ return Array.isArray(n.tagIds) && n.tagIds.indexOf(tagId) !== -1; })
      .map(function(n){
        var work = App.store.byId("works", n.workId);
        return { node: n, workTitle: work ? work.title : "（作品不明）" };
      });
  }

  /* ------------------------------------------------------------------
     描画
     ------------------------------------------------------------------ */

  // カテゴリ別のタグカード群を描画する（検索文字列で絞り込み）
  function renderGroups(){
    var data = App.store.get();
    var q = searchText.trim().toLowerCase();
    var groups = root.querySelector("#tag-groups");

    var html = "";
    CATEGORY_ORDER.forEach(function(cat){
      var tagsInCat = data.tags.filter(function(t){ return t.category === cat; });
      if (q){
        tagsInCat = tagsInCat.filter(function(t){
          var hay = (t.name || "") + " " + (t.definition || "");
          return hay.toLowerCase().indexOf(q) !== -1;
        });
      }
      if (!tagsInCat.length) return; // 該当なしの節は出さない（検索時の見通し優先）

      var dotCls = (cat === "効果") ? "dot--effect" : "dot--tech";
      html += '<section class="block tag-cat-block">';
      html += '<h2 class="section-title"><span class="dot ' + dotCls + '"></span>' +
              App.util.esc(cat) + '（' + tagsInCat.length + '）</h2>';
      html += '<div class="tag-dict-grid">';
      tagsInCat.forEach(function(t){
        var used = countUsage(t.id);
        var chipCls = (cat === "効果") ? "chip effect" : "chip tech";
        // data-tag-card=他ビューからの「このタグの説明へ飛ぶ」用の着地点
        html += '<div class="card card--soft tag-dict-card" data-tag-card="' + App.util.esc(t.id) + '">';
        html += '<div class="tag-dict-name"><span class="' + chipCls + '">' +
                App.util.esc(t.name) + '</span></div>';
        html += '<div class="tag-dict-def">' + App.util.esc(t.definition || "（定義未記入）") + '</div>';
        if (t.examples){
          html += '<div class="tag-dict-example"><b>代表例：</b>' + App.util.esc(fmtExamples(t.examples)) + '</div>';
        }
        if (t.source){
          html += '<div class="tag-dict-source"><b>出典：</b>' + App.util.esc(t.source) + '</div>';
        }
        html += '<div class="tag-dict-foot">';
        html += '<button type="button" class="chip chip--button tag-usage-btn" data-action="usage-tag" data-id="' +
                App.util.esc(t.id) + '">使用数 ' + used + ' 件 ▸</button>';
        html += '<span class="tag-dict-actions">' +
                '<button type="button" class="btn btn--ghost btn--sm" data-action="edit-tag" data-id="' + App.util.esc(t.id) + '">編集</button> ' +
                '<button type="button" class="btn btn--danger btn--sm" data-action="delete-tag" data-id="' + App.util.esc(t.id) + '">削除</button>' +
                '</span>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div></section>';
    });

    if (!html){
      html = '<p class="overline">' + (q ? "検索に一致するタグがありません。" : "タグがまだありません。下のフォームから追加してください。") + '</p>';
    }
    groups.innerHTML = html;
  }

  // 逆引きパネルの描画（対象タグが無ければ非表示のまま）
  function renderUsagePanel(){
    var block = root.querySelector("#tag-usage-block");
    if (!usageTagId){
      block.hidden = true;
      return;
    }
    var tag = App.store.byId("tags", usageTagId);
    if (!tag){
      // 表示中に当該タグが削除された等 → パネルを閉じる
      usageTagId = null;
      block.hidden = true;
      return;
    }
    block.hidden = false;
    root.querySelector("#tag-usage-name").innerHTML = App.tagChipHtml(tag.id);

    var scenes = usageScenes(tag.id);
    var listEl = root.querySelector("#tag-usage-list");
    if (!scenes.length){
      listEl.innerHTML = '<p class="overline">このタグが付いた場面はまだありません。</p>';
      return;
    }
    var html = "";
    scenes.forEach(function(s){
      html += '<div class="evidence-item tag-usage-item" data-action="jump-node" ' +
              'data-work-id="' + App.util.esc(s.node.workId) + '" data-node-id="' + App.util.esc(s.node.id) + '">' +
              '<span class="stamp">' + App.util.esc(s.workTitle) + '</span>' +
              '<span>' + App.util.esc(s.node.title || "（無題の場面）") + '</span>' +
              '</div>';
    });
    listEl.innerHTML = html;
  }

  // 追加/編集フォームの見出しと入力欄を現在の編集対象に合わせて更新
  function renderForm(){
    var titleEl = root.querySelector("#tag-form-title");
    var form = root.querySelector("#tag-form");
    if (editingId){
      var tag = App.store.byId("tags", editingId);
      if (!tag){ editingId = null; return renderForm(); }
      titleEl.textContent = "タグを編集：" + tag.name;
      form.category.value = tag.category || "構成";
      form.name.value = tag.name || "";
      form.definition.value = tag.definition || "";
      form.examples.value = fmtExamples(tag.examples);
      form.source.value = tag.source || "";
      root.querySelector("#tag-form-cancel").hidden = false;
    } else {
      titleEl.textContent = "タグを追加";
      form.reset();
      form.category.value = "構成";
      root.querySelector("#tag-form-cancel").hidden = true;
    }
  }

  function renderAll(){
    renderGroups();
    renderUsagePanel();
  }

  /* ------------------------------------------------------------------
     init（初回のみ骨組みを構築。以後の描画は show/renderAll が担う）
     ------------------------------------------------------------------ */
  function init(rootEl){
    root = rootEl;
    // ★root.className は上書きしない（classList.add のみ・設計.txt の注意事項）
    root.classList.add("view-tags");

    root.innerHTML =
      '<section class="block">' +
        '<h2 class="section-title">タグ辞典</h2>' +
        '<p class="overline">タグは研究の物差し。定義を曖昧にしない。</p>' +
        '<div class="legend">' +
          '<span><span class="dot dot--tech"></span>技法タグ（構成・演出・言葉遣いの仕掛け）</span>' +
          '<span><span class="dot dot--effect"></span>効果タグ（読者に生じる作用）</span>' +
        '</div>' +
        '<div class="field tag-search-field">' +
          '<label for="tag-search">検索（名前・定義の部分一致）</label>' +
          '<input type="text" class="input" id="tag-search" placeholder="例: 伏線">' +
        '</div>' +
      '</section>' +

      '<div id="tag-groups"></div>' +

      '<section class="block" id="tag-usage-block" hidden>' +
        '<h2 class="section-title">使用箇所の逆引き：<span id="tag-usage-name"></span></h2>' +
        '<div id="tag-usage-list"></div>' +
        '<button type="button" class="btn btn--ghost" id="tag-usage-close">閉じる</button>' +
      '</section>' +

      '<section class="block card" id="tag-form-block">' +
        '<h2 class="section-title" id="tag-form-title">タグを追加</h2>' +
        '<form id="tag-form">' +
          '<div class="field">' +
            '<label for="tag-f-category">カテゴリ</label>' +
            '<select class="select" id="tag-f-category" name="category">' +
              '<option value="構成">構成（技法）</option>' +
              '<option value="演出">演出（技法）</option>' +
              '<option value="言葉遣い">言葉遣い（技法）</option>' +
              '<option value="効果">効果</option>' +
            '</select>' +
          '</div>' +
          '<div class="field">' +
            '<label for="tag-f-name">名前</label>' +
            '<input type="text" class="input" id="tag-f-name" name="name" required maxlength="40">' +
          '</div>' +
          '<div class="field">' +
            '<label for="tag-f-definition">定義</label>' +
            '<textarea class="textarea" id="tag-f-definition" name="definition"></textarea>' +
          '</div>' +
          '<div class="field">' +
            '<label for="tag-f-examples">代表例</label>' +
            '<input type="text" class="input" id="tag-f-examples" name="examples" placeholder="作品名やシーンを「／」区切りで">' +
          '</div>' +
          '<div class="field">' +
            '<label for="tag-f-source">出典</label>' +
            '<input type="text" class="input" id="tag-f-source" name="source">' +
          '</div>' +
          '<button type="submit" class="btn btn--primary">保存</button> ' +
          '<button type="button" class="btn btn--ghost" id="tag-form-cancel" hidden>編集をやめる</button>' +
        '</form>' +
      '</section>';

    // --- イベント委譲（クリックはルート1箇所、以後の再描画でも張り直し不要） ---
    root.addEventListener("click", function(ev){
      var editBtn = ev.target.closest('[data-action="edit-tag"]');
      var delBtn = ev.target.closest('[data-action="delete-tag"]');
      var usageBtn = ev.target.closest('[data-action="usage-tag"]');
      var jumpEl = ev.target.closest('[data-action="jump-node"]');
      var closeBtn = ev.target.closest("#tag-usage-close");

      if (editBtn){
        editingId = editBtn.getAttribute("data-id");
        renderForm();
        root.querySelector("#tag-form-block").scrollIntoView({ block: "center" });
        return;
      }
      if (delBtn){
        var id = delBtn.getAttribute("data-id");
        var tag = App.store.byId("tags", id);
        var name = tag ? tag.name : "このタグ";
        var ok = window.confirm(
          "「" + name + "」を削除します。\n" +
          "全場面・作品・引用・考察からこのタグが外れます。よろしいですか？"
        );
        if (!ok) return;
        App.store.remove("tags", id);
        if (editingId === id){ editingId = null; renderForm(); }
        if (usageTagId === id){ usageTagId = null; }
        renderAll();
        return;
      }
      if (usageBtn){
        usageTagId = usageBtn.getAttribute("data-id");
        renderUsagePanel();
        root.querySelector("#tag-usage-block").scrollIntoView({ block: "center" });
        return;
      }
      if (closeBtn){
        usageTagId = null;
        renderUsagePanel();
        return;
      }
      if (jumpEl){
        // 分解ビューへジャンプ（設計 §6 の共有規約どおり App.state 経由）
        App.state.currentWorkId = jumpEl.getAttribute("data-work-id");
        App.state.currentNodeId = jumpEl.getAttribute("data-node-id");
        App.showView("anatomy");
        return;
      }
    });

    root.querySelector("#tag-form-cancel").addEventListener("click", function(){
      editingId = null;
      renderForm();
    });

    root.querySelector("#tag-form").addEventListener("submit", function(ev){
      ev.preventDefault();
      var f = ev.target;
      var name = f.name.value.trim();
      if (!name){ window.alert("名前を入力してください。"); return; }
      var patch = {
        category: f.category.value,
        name: name,
        definition: f.definition.value.trim(),
        examples: f.examples.value.trim(),
        source: f.source.value.trim()
      };
      if (editingId){
        App.store.update("tags", editingId, patch);
      } else {
        App.store.add("tags", patch);
      }
      editingId = null;
      renderForm();
      renderAll();
    });

    // 検索は入力のたびに絞り込み再描画（重い処理ではないため debounce 不要）
    root.querySelector("#tag-search").addEventListener("input", function(ev){
      searchText = ev.target.value;
      renderGroups();
    });

    // 他ビューでのタグ追加/削除（store.onChange）でも辞典を最新化する
    App.store.onChange(function(){
      if (App.currentView() === "tags") renderAll();
    });
  }

  App.registerView({
    id: "tags",
    title: "タグ辞典",
    order: 30,
    init: init,
    show: function(){
      renderAll();
      // 他ビュー（書庫のタグチップ等）からの「説明へ飛ぶ」着地処理。
      // 検索で隠れていると見つからないので、ジャンプ時は検索を一旦クリアする
      var jumpId = App.state && App.state.jumpToTagId;
      if (jumpId){
        App.state.jumpToTagId = null;              // 一度きり（次回表示に残さない）
        var search = root.querySelector("#tag-search");
        if (search && search.value){ search.value = ""; searchText = ""; renderAll(); }
        var card = root.querySelector('[data-tag-card="' + jumpId + '"]');
        if (card){
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          // 着地が分かるよう一瞬ハイライト（CSSアニメで自然に消える）
          card.classList.add("tag-dict-card--flash");
          setTimeout(function(){ card.classList.remove("tag-dict-card--flash"); }, 2000);
        }
      }
    }
  });

})();
