/* ==========================================================================
   quotes.js — 一節ビュー（id: quotes / order: 60）
   設計.txt §4「一節」を実装する。
   思想: 日頃「良いと思った一節」を書き溜め、研究の素材にする。
   一節.txt のような自由記述メモ（作品名 著者 引用文の1行1件）を
   そのまま貼り付けて取り込めることを完了条件とする。
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;
  App.state = App.state || {};

  var CATEGORIES = ["構成", "演出", "言葉遣い", "効果"];

  /* ------------------------------------------------------------------
     ローカル状態
     「なぜ部分再描画にこだわるか」: 検索欄・取り込みの原稿欄で
     入力中に全体を作り直すとフォーカスが飛ぶ。フィルタ結果は
     #qt-list だけを、取り込み下書きの編集は該当行の値だけを
     状態オブジェクトへ反映し、DOMの再構築は「構造が変わる操作」
     （開閉・解析・行削除・保存）に限定する。
     ------------------------------------------------------------------ */
  var st = {
    filterTag: "",
    filterAuthor: "",
    filterQuery: "",
    formOpen: false,
    editingId: null,
    formDraft: null,       // {text,sourceTitle,sourceAuthor,whyGood,workId,tagIds,category}
    importOpen: false,
    importRaw: "",
    importDrafts: null     // [{sourceTitle,sourceAuthor,text}]
  };

  var rootEl = null;

  function esc(s){ return App.util.esc(s); }

  /* ------------------------------------------------------------------
     init
     ------------------------------------------------------------------ */
  function init(root){
    rootEl = root;
    root.classList.add("view--quotes");
    root.innerHTML =
      '<section class="block">' +
        '<h2 class="section-title">一節</h2>' +
        '<div id="qt-toolbar"></div>' +
        '<div id="qt-form-area"></div>' +
        '<div id="qt-import-area"></div>' +
        '<div id="qt-list"></div>' +
      '</section>';
  }

  function show(){
    renderToolbar();
    renderForm();
    renderImport();
    renderList();
  }

  /* ------------------------------------------------------------------
     フィルタ・ツールバー
     ------------------------------------------------------------------ */
  function renderToolbar(){
    var tb = rootEl.querySelector("#qt-toolbar");
    var tags = App.store.get().tags.slice().sort(function(a, b){
      return (a.name || "").localeCompare(b.name || "", "ja");
    });
    var html = '<div class="card qt-toolbar-card">';
    html += '<div class="qt-filter-row">';
    html += '<select class="select" id="qt-filter-tag"><option value="">タグ：すべて</option>';
    tags.forEach(function(t){
      html += '<option value="' + esc(t.id) + '"' + (st.filterTag === t.id ? " selected" : "") + '>' + esc(t.name) + '</option>';
    });
    html += '</select>';
    html += '<input type="text" class="input" id="qt-filter-author" placeholder="著者で絞り込み" value="' + esc(st.filterAuthor) + '">';
    html += '<input type="text" class="input" id="qt-filter-query" placeholder="全文検索（引用文・出典・メモ）" value="' + esc(st.filterQuery) + '">';
    html += '</div>';
    html += '<div class="qt-action-row">';
    html += '<button type="button" class="btn btn--primary btn--sm" id="qt-open-new">＋ 新規一節</button>';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="qt-open-import">＋ まとめて取り込み</button>';
    html += '</div>';
    html += '</div>';
    tb.innerHTML = html;

    tb.querySelector("#qt-filter-tag").addEventListener("change", function(e){
      st.filterTag = e.target.value; renderList();
    });
    tb.querySelector("#qt-filter-author").addEventListener("input", function(e){
      st.filterAuthor = e.target.value; renderList();
    });
    tb.querySelector("#qt-filter-query").addEventListener("input", function(e){
      st.filterQuery = e.target.value; renderList();
    });
    tb.querySelector("#qt-open-new").addEventListener("click", function(){ openForm(null); });
    tb.querySelector("#qt-open-import").addEventListener("click", function(){ openImport(); });
  }

  function passesFilter(q){
    if (st.filterTag && (!q.tagIds || q.tagIds.indexOf(st.filterTag) === -1)) return false;
    if (st.filterAuthor){
      var author = (q.sourceAuthor || "").toLowerCase();
      if (author.indexOf(st.filterAuthor.toLowerCase()) === -1) return false;
    }
    if (st.filterQuery){
      var hay = ((q.text || "") + " " + (q.sourceTitle || "") + " " +
                 (q.sourceAuthor || "") + " " + (q.whyGood || "")).toLowerCase();
      if (hay.indexOf(st.filterQuery.toLowerCase()) === -1) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------
     一節カード一覧
     ------------------------------------------------------------------ */
  function renderList(){
    var list = rootEl.querySelector("#qt-list");
    var quotes = App.store.get().quotes.filter(passesFilter).slice().sort(function(a, b){
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    if (!quotes.length){
      list.innerHTML = '<p class="qt-empty">該当する一節がありません。</p>';
      return;
    }
    var html = '<div class="qt-cards">';
    quotes.forEach(function(q){ html += renderCard(q); });
    html += '</div>';
    list.innerHTML = html;

    list.querySelectorAll(".qt-goto-work").forEach(function(btn){
      btn.addEventListener("click", function(){
        App.state.currentWorkId = btn.getAttribute("data-work-id");
        App.showView("anatomy");
      });
    });
    list.querySelectorAll(".qt-edit").forEach(function(btn){
      btn.addEventListener("click", function(){
        var q = App.store.byId("quotes", btn.getAttribute("data-quote-id"));
        if (q) openForm(q);
      });
    });
    list.querySelectorAll(".qt-delete").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-quote-id");
        if (window.confirm("この一節を削除します。よろしいですか？")){
          App.store.remove("quotes", id);
          renderList();
        }
      });
    });
  }

  function renderCard(q){
    var work = q.workId ? App.store.byId("works", q.workId) : null;
    var html = '<div class="card qt-card">';
    html += '<blockquote class="quote">' + esc(q.text) +
            '<cite>出典：' + esc(q.sourceTitle || "不明") + ' ／ ' + esc(q.sourceAuthor || "不明") + '</cite>' +
            '</blockquote>';
    if (q.whyGood) html += '<p class="qt-why">' + esc(q.whyGood) + '</p>';
    var tagIds = q.tagIds || [];
    if (tagIds.length){
      html += '<div class="tag-row qt-card-tags">';
      tagIds.forEach(function(id){
        var chip = App.tagChipHtml(id);
        if (chip) html += chip;
      });
      html += '</div>';
    }
    html += '<div class="qt-card-foot">';
    html += '<span class="overline">' + esc(App.util.fmtDate(q.createdAt)) + '</span>';
    if (work){
      html += '<button type="button" class="btn btn--ghost btn--sm qt-goto-work" data-work-id="' + esc(work.id) + '">作品：' + esc(work.title) + '</button>';
    }
    html += '<span class="qt-card-actions">';
    html += '<button type="button" class="qt-icon-btn qt-edit" data-quote-id="' + esc(q.id) + '">編集</button>';
    html += '<button type="button" class="qt-icon-btn qt-delete" data-quote-id="' + esc(q.id) + '">削除</button>';
    html += '</span>';
    html += '</div></div>';
    return html;
  }

  /* ------------------------------------------------------------------
     新規追加／編集フォーム
     ------------------------------------------------------------------ */
  function openForm(quote){
    st.importOpen = false; // 同時に開くと375px幅で煩雑になるため片方だけ開く
    st.editingId = quote ? quote.id : null;
    st.formDraft = {
      text: quote ? (quote.text || "") : "",
      sourceTitle: quote ? (quote.sourceTitle || "") : "",
      sourceAuthor: quote ? (quote.sourceAuthor || "") : "",
      whyGood: quote ? (quote.whyGood || "") : "",
      workId: quote ? (quote.workId || "") : "",
      tagIds: quote ? (quote.tagIds || []).slice() : [],
      category: CATEGORIES[0]
    };
    st.formOpen = true;
    renderForm();
    renderImport();
  }

  function closeForm(){
    st.formOpen = false;
    st.editingId = null;
    st.formDraft = null;
    renderForm();
  }

  function renderForm(){
    var area = rootEl.querySelector("#qt-form-area");
    if (!st.formOpen){ area.innerHTML = ""; return; }
    var draft = st.formDraft;
    var works = App.store.get().works.slice().sort(function(a, b){
      return (a.title || "").localeCompare(b.title || "", "ja");
    });

    var html = '<div class="card qt-form-card">';
    html += '<p class="overline">' + (st.editingId ? "一節を編集" : "新規一節を追加") + '</p>';
    html += '<div class="field"><label>引用文</label><textarea class="textarea" id="qt-f-text" rows="3">' + esc(draft.text) + '</textarea></div>';
    html += '<div class="field"><label>出典作品名</label><input type="text" class="input" id="qt-f-title" value="' + esc(draft.sourceTitle) + '"></div>';
    html += '<div class="field"><label>著者</label><input type="text" class="input" id="qt-f-author" value="' + esc(draft.sourceAuthor) + '"></div>';
    html += '<div class="field"><label>なぜ良いか</label><textarea class="textarea" id="qt-f-why" rows="3">' + esc(draft.whyGood) + '</textarea></div>';
    html += '<div class="field"><label>書庫の作品への紐付け（任意）</label><select class="select" id="qt-f-work"><option value="">紐付けなし</option>';
    works.forEach(function(w){
      html += '<option value="' + esc(w.id) + '"' + (draft.workId === w.id ? " selected" : "") + '>' + esc(w.title || "（無題）") + '</option>';
    });
    html += '</select></div>';

    html += '<div class="qt-form-tag-section">';
    html += '<div class="tag-row" id="qt-form-tags"></div>';
    html += '<div class="qt-tag-add-row" id="qt-form-tagadd"></div>';
    html += '</div>';

    html += '<div class="qt-form-buttons">';
    html += '<button type="button" class="btn btn--primary btn--sm" id="qt-f-save">保存する</button>';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="qt-f-cancel">キャンセル</button>';
    html += '</div>';
    html += '</div>';
    area.innerHTML = html;

    renderFormTags();
    renderFormTagAdd();

    area.querySelector("#qt-f-save").addEventListener("click", saveForm);
    area.querySelector("#qt-f-cancel").addEventListener("click", closeForm);
  }

  function renderFormTags(){
    var box = rootEl.querySelector("#qt-form-tags");
    if (!box) return;
    var draft = st.formDraft;
    var tagIds = draft.tagIds || [];
    if (!tagIds.length){
      box.innerHTML = '<span class="qt-empty">まだタグがありません。</span>';
      return;
    }
    var html = "";
    tagIds.forEach(function(tagId){
      var chip = App.tagChipHtml(tagId);
      if (!chip) return;
      html += '<span class="qt-tag-wrap">' + chip +
              '<button type="button" class="qt-tag-remove" data-tag-id="' + esc(tagId) + '" aria-label="タグを外す">×</button></span>';
    });
    box.innerHTML = html;
    box.querySelectorAll(".qt-tag-remove").forEach(function(btn){
      btn.addEventListener("click", function(){
        var tagId = btn.getAttribute("data-tag-id");
        draft.tagIds = draft.tagIds.filter(function(id){ return id !== tagId; });
        renderFormTags();
        renderFormTagAdd();
      });
    });
  }

  function renderFormTagAdd(){
    var box = rootEl.querySelector("#qt-form-tagadd");
    if (!box) return;
    var draft = st.formDraft;
    var allTags = App.store.get().tags;
    var html = '<select class="select" id="qt-f-tag-category">';
    CATEGORIES.forEach(function(c){
      html += '<option value="' + esc(c) + '"' + (draft.category === c ? " selected" : "") + '>' + esc(c) + '</option>';
    });
    html += '</select>';
    var candidates = allTags.filter(function(t){
      return t.category === draft.category && draft.tagIds.indexOf(t.id) === -1;
    });
    html += '<select class="select" id="qt-f-tag-select">';
    if (!candidates.length){
      html += '<option value="">（追加できるタグがありません）</option>';
    } else {
      candidates.forEach(function(t){
        html += '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      });
    }
    html += '</select>';
    html += '<button type="button" class="btn btn--sm" id="qt-f-tag-add">＋追加</button>';
    box.innerHTML = html;

    box.querySelector("#qt-f-tag-category").addEventListener("change", function(e){
      draft.category = e.target.value;
      renderFormTagAdd();
    });
    box.querySelector("#qt-f-tag-add").addEventListener("click", function(){
      var sel = box.querySelector("#qt-f-tag-select");
      var tagId = sel ? sel.value : "";
      if (!tagId) return;
      if (draft.tagIds.indexOf(tagId) === -1) draft.tagIds.push(tagId);
      renderFormTags();
      renderFormTagAdd();
    });
  }

  function saveForm(){
    var area = rootEl.querySelector("#qt-form-area");
    var text = area.querySelector("#qt-f-text").value.trim();
    if (!text){
      window.alert("引用文を入力してください。");
      return;
    }
    var sourceTitle = area.querySelector("#qt-f-title").value.trim();
    var sourceAuthor = area.querySelector("#qt-f-author").value.trim();
    var whyGood = area.querySelector("#qt-f-why").value.trim();
    var workId = area.querySelector("#qt-f-work").value || null;
    var tagIds = (st.formDraft.tagIds || []).slice();

    if (st.editingId){
      App.store.update("quotes", st.editingId, {
        text: text, sourceTitle: sourceTitle, sourceAuthor: sourceAuthor,
        whyGood: whyGood, workId: workId, tagIds: tagIds
      });
    } else {
      App.store.add("quotes", {
        text: text, sourceTitle: sourceTitle, sourceAuthor: sourceAuthor,
        whyGood: whyGood, workId: workId, tagIds: tagIds, nodeId: null
      });
    }
    closeForm();
    renderList();
  }

  /* ------------------------------------------------------------------
     まとめて取り込み
     「なぜ形式を決め打ちしないか」: ユーザーは「一節.txt」に
     "作品名 著者 引用文" を1行1件で書き溜めている（区切りはタブ／
     全角スペース／半角スペースの揺れがある）。素朴な推定を初期値に
     入れつつ全項目を修正可能にし、推定が外れても手で直せるようにする。
     ------------------------------------------------------------------ */
  function openImport(){
    st.formOpen = false;
    st.importOpen = true;
    st.importDrafts = null;
    renderForm();
    renderImport();
  }
  function closeImport(){
    st.importOpen = false;
    st.importRaw = "";
    st.importDrafts = null;
    renderImport();
  }

  function parseQuoteLine(line){
    var trimmed = line.replace(/^\s+/, "").replace(/\s+$/, "");
    if (!trimmed) return null;
    // 最初の語＝作品名・次の語＝著者・残り＝引用文（\s はタブ／半角／
    // 全角スペースすべてにマッチする＝一節.txt の区切りの揺れを許容）
    var m = trimmed.match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/);
    if (m){
      return { sourceTitle: m[1], sourceAuthor: m[2], text: m[3].replace(/\s+$/, "") };
    }
    // 区切りが見つからない行は全文を引用文欄に入れ、他は手で直してもらう
    return { sourceTitle: "", sourceAuthor: "", text: trimmed };
  }

  function parseLines(raw){
    var lines = String(raw || "").split(/\r\n|\r|\n/);
    var out = [];
    lines.forEach(function(line){
      var d = parseQuoteLine(line);
      if (d) out.push(d);
    });
    return out;
  }

  function renderImport(){
    var area = rootEl.querySelector("#qt-import-area");
    if (!st.importOpen){ area.innerHTML = ""; return; }

    var html = '<div class="card qt-import-card">';
    html += '<p class="overline">まとめて取り込み — 1行1件、自由な書式で貼り付けてください</p>';
    html += '<p class="qt-import-hint">例：「金閣寺　三島由紀夫　たしかに遠い過去に…」のように' +
            '作品名・著者・引用文をタブや空白で区切って1行にした形式（「一節.txt」と同じ形式）が' +
            'そのまま取り込めます。区切りの揺れ（全角/半角スペース・タブ）は自動で吸収します。</p>';
    html += '<div class="field"><textarea class="textarea" id="qt-import-raw" rows="6" placeholder="1行に1件、貼り付けてください">' + esc(st.importRaw) + '</textarea></div>';
    html += '<div class="qt-form-buttons">';
    html += '<button type="button" class="btn btn--sm" id="qt-import-parse">解析する</button>';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="qt-import-cancel">閉じる</button>';
    html += '</div>';

    if (st.importDrafts && st.importDrafts.length){
      html += '<div class="qt-import-drafts" id="qt-import-drafts">';
      html += '<p class="overline">' + st.importDrafts.length + ' 件の下書き（内容を確認・修正してから登録してください）</p>';
      st.importDrafts.forEach(function(d, i){
        html += '<div class="qt-import-draft-row" data-idx="' + i + '">';
        html += '<input type="text" class="input qt-imp-title" data-idx="' + i + '" data-field="sourceTitle" placeholder="作品名" value="' + esc(d.sourceTitle) + '">';
        html += '<input type="text" class="input qt-imp-author" data-idx="' + i + '" data-field="sourceAuthor" placeholder="著者" value="' + esc(d.sourceAuthor) + '">';
        html += '<textarea class="textarea qt-imp-text" data-idx="' + i + '" data-field="text" rows="2" placeholder="引用文">' + esc(d.text) + '</textarea>';
        html += '<button type="button" class="qt-icon-btn qt-imp-remove" data-idx="' + i + '" aria-label="この行を除外">×</button>';
        html += '</div>';
      });
      html += '</div>';
      html += '<button type="button" class="btn btn--primary btn--sm" id="qt-import-commit">登録する（' + st.importDrafts.length + '件）</button>';
    }
    html += '</div>';
    area.innerHTML = html;

    area.querySelector("#qt-import-parse").addEventListener("click", function(){
      var raw = area.querySelector("#qt-import-raw").value;
      st.importRaw = raw;
      st.importDrafts = parseLines(raw);
      renderImport();
    });
    area.querySelector("#qt-import-cancel").addEventListener("click", closeImport);

    // 取り込み前の下書き行編集（再描画せず状態だけ更新。フォーカス維持のため）
    area.querySelectorAll(".qt-imp-title, .qt-imp-author, .qt-imp-text").forEach(function(input){
      input.addEventListener("input", function(){
        var idx = Number(input.getAttribute("data-idx"));
        var field = input.getAttribute("data-field");
        if (st.importDrafts && st.importDrafts[idx]) st.importDrafts[idx][field] = input.value;
      });
    });
    area.querySelectorAll(".qt-imp-remove").forEach(function(btn){
      btn.addEventListener("click", function(){
        var idx = Number(btn.getAttribute("data-idx"));
        st.importDrafts.splice(idx, 1);
        renderImport();
      });
    });
    var commitBtn = area.querySelector("#qt-import-commit");
    if (commitBtn){
      commitBtn.addEventListener("click", function(){
        var drafts = st.importDrafts || [];
        var added = 0;
        drafts.forEach(function(d){
          var text = (d.text || "").trim();
          if (!text) return; // 引用文が空の行は登録しない
          App.store.add("quotes", {
            text: text,
            sourceTitle: (d.sourceTitle || "").trim(),
            sourceAuthor: (d.sourceAuthor || "").trim(),
            whyGood: "",
            tagIds: [],
            workId: null,
            nodeId: null
          });
          added++;
        });
        window.alert(added + " 件の一節を登録しました。");
        closeImport();
        renderList();
      });
    }
  }

  /* ------------------------------------------------------------------
     登録
     ------------------------------------------------------------------ */
  App.registerView({
    id: "quotes",
    title: "一節",
    order: 60,
    init: init,
    show: show
  });

})();
