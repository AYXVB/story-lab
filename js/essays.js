/* ==========================================================================
   essays.js — 考察ビュー（設計.txt §4 essays / order40）
   2つの道具を1画面に:
   A) 考察ノート（一覧・作成/編集・根拠(evidence)リンク・削除）
   B) 横断検索（タグの組み合わせ→効果の集計。構成の組み合わせがどんな
      効果を生むかをデータで見るための研究道具）
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;
  // ビュー間の選択共有領域（分解ビューへジャンプする際に使う契約・設計.txt）
  App.state = App.state || {};

  var root = null;

  // --- A) 考察ノート の編集状態 ---
  var editingEssayId = null;   // null=新規未保存の下書き
  var draft = null;            // 未保存下書き（title/body/tagIds/evidence を保持）

  // --- B) 横断検索 の選択状態 ---
  var selectedTech = {};       // { tagId: true } 技法タグ（構成/演出/言葉遣い）
  var selectedEffect = {};     // { tagId: true } 効果タグ（任意）

  /* ------------------------------------------------------------------
     ヘルパー
     ------------------------------------------------------------------ */

  function newDraft(){
    return { title: "", body: "", tagIds: [], evidence: [] };
  }

  // 編集中の対象（保存済みならstoreの実体、未保存ならdraft）を返す
  function currentEssay(){
    if (editingEssayId) return App.store.byId("essays", editingEssayId);
    return draft;
  }

  // 場面(node)の「作品名｜場面名」ラベルを作る
  function nodeLabel(node){
    if (!node) return "（場面が見つかりません）";
    var work = App.store.byId("works", node.workId);
    return (work ? work.title : "（作品不明）") + "｜" + (node.title || "（無題）");
  }

  /* ------------------------------------------------------------------
     A) 考察ノート — 一覧
     ------------------------------------------------------------------ */

  function renderEssayList(){
    var data = App.store.get();
    var listEl = root.querySelector("#essay-list");
    var essays = data.essays.slice().sort(function(a, b){
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    if (!essays.length){
      listEl.innerHTML = '<p class="overline">考察ノートはまだありません。「＋ 新規作成」から書き始めてください。</p>';
      return;
    }
    var html = '<div class="essay-list-grid">';
    essays.forEach(function(e){
      var chips = (e.tagIds || []).map(function(id){ return App.tagChipHtml(id); }).join(" ");
      var isCurrent = (e.id === editingEssayId);
      html += '<div class="card card--soft essay-list-item' + (isCurrent ? " essay-list-item--active" : "") + '" ' +
              'data-action="open-essay" data-id="' + App.util.esc(e.id) + '">' +
              '<div class="essay-list-title">' + App.util.esc(e.title || "（無題の考察）") + '</div>' +
              '<div class="essay-list-meta">更新: ' + App.util.esc(App.util.fmtDate(e.updatedAt || e.createdAt)) + '</div>' +
              '<div class="tag-row">' + (chips || '<span class="overline">タグなし</span>') + '</div>' +
              '</div>';
    });
    html += '</div>';
    listEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     A) 考察ノート — エディタ
     ------------------------------------------------------------------ */

  function renderEssayEditor(){
    var essay = currentEssay();
    var form = root.querySelector("#essay-form");
    form.title.value = essay.title || "";
    form.body.value = essay.body || "";

    // タグ付けチップ（トグル式・タップで完結）
    var data = App.store.get();
    var tagIds = essay.tagIds || [];
    var tagPickHtml = data.tags.map(function(t){
      var active = tagIds.indexOf(t.id) !== -1;
      var cls = (t.category === "効果") ? "chip effect" : "chip tech";
      return '<button type="button" class="' + cls + ' chip--button' + (active ? " chip--active" : "") + '" ' +
             'data-action="toggle-essay-tag" data-id="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</button>';
    }).join(" ");
    root.querySelector("#essay-tag-picker").innerHTML = tagPickHtml ||
      '<p class="overline">タグがありません。先に「タグ辞典」で登録してください。</p>';

    root.querySelector("#essay-editor-title").textContent = editingEssayId ? "考察を編集" : "考察を新規作成";
    root.querySelector("#essay-delete-btn").hidden = !editingEssayId;

    renderEvidenceList();
    renderEvidencePickers();
  }

  function renderEvidenceList(){
    var essay = currentEssay();
    var evidence = essay.evidence || [];
    var listEl = root.querySelector("#essay-evidence-list");
    if (!evidence.length){
      listEl.innerHTML = '<p class="overline">根拠となる場面を繋ぐと考察が強くなる。</p>';
      return;
    }
    var html = "";
    evidence.forEach(function(ev, idx){
      var stampLabel, bodyText, jumpAttrs = "";
      if (ev.refType === "node"){
        var node = App.store.byId("nodes", ev.refId);
        stampLabel = "場面";
        bodyText = nodeLabel(node);
        if (node) jumpAttrs = 'data-action="jump-node" data-work-id="' + App.util.esc(node.workId) + '" data-node-id="' + App.util.esc(node.id) + '"';
      } else {
        var quote = App.store.byId("quotes", ev.refId);
        stampLabel = "一節";
        bodyText = quote ? ('「' + quote.text + '」') : "（一節が見つかりません）";
        if (quote && quote.nodeId){
          jumpAttrs = 'data-action="jump-node" data-work-id="' + App.util.esc(quote.workId || "") + '" data-node-id="' + App.util.esc(quote.nodeId) + '"';
        }
      }
      html += '<div class="evidence-item essay-evidence-item">' +
              '<span class="stamp" ' + jumpAttrs + (jumpAttrs ? ' style="cursor:pointer;"' : '') + '>' + stampLabel + '</span>' +
              '<span class="essay-evidence-body">' + App.util.esc(bodyText) +
                (ev.note ? '<br><span class="essay-evidence-note">— ' + App.util.esc(ev.note) + '</span>' : '') +
              '</span>' +
              '<button type="button" class="btn btn--danger btn--sm" data-action="remove-evidence" data-idx="' + idx + '">削除</button>' +
              '</div>';
    });
    listEl.innerHTML = html;
  }

  // 根拠追加フォーム（場面選択・一節選択）の選択肢を作品/場面一覧から作る
  function renderEvidencePickers(){
    var data = App.store.get();

    var workSel = root.querySelector("#ev-work-select");
    workSel.innerHTML = '<option value="">（作品を選ぶ）</option>' +
      data.works.map(function(w){ return '<option value="' + App.util.esc(w.id) + '">' + App.util.esc(w.title) + '</option>'; }).join("");

    updateSceneOptions();

    var quoteSel = root.querySelector("#ev-quote-select");
    quoteSel.innerHTML = '<option value="">（一節を選ぶ）</option>' +
      data.quotes.map(function(q){
        var label = q.text.length > 30 ? (q.text.slice(0, 30) + "…") : q.text;
        return '<option value="' + App.util.esc(q.id) + '">' + App.util.esc(label) + '</option>';
      }).join("");
  }

  // 作品セレクトの変更に応じて場面セレクトの選択肢を更新
  function updateSceneOptions(){
    var data = App.store.get();
    var workId = root.querySelector("#ev-work-select").value;
    var sceneSel = root.querySelector("#ev-scene-select");
    var nodes = workId ? data.nodes.filter(function(n){ return n.workId === workId; }) : [];
    // order順（部/章/場面の階層があるため単純なorder昇順で十分・詳細な階層表示は分解ビューの役目）
    nodes = nodes.slice().sort(function(a, b){ return (a.order || 0) - (b.order || 0); });
    sceneSel.innerHTML = '<option value="">（場面を選ぶ）</option>' +
      nodes.map(function(n){
        return '<option value="' + App.util.esc(n.id) + '">[' + App.util.esc(n.type || "") + '] ' + App.util.esc(n.title || "（無題）") + '</option>';
      }).join("");
  }

  /* ------------------------------------------------------------------
     B) 横断検索
     ------------------------------------------------------------------ */

  function renderCrossSearch(){
    var data = App.store.get();
    var techTags = data.tags.filter(function(t){ return t.category !== "効果"; });
    var effectTags = data.tags.filter(function(t){ return t.category === "効果"; });

    var techHtml = techTags.map(function(t){
      var active = !!selectedTech[t.id];
      return '<button type="button" class="chip tech chip--button' + (active ? " chip--active" : "") + '" ' +
             'data-action="toggle-cross-tech" data-id="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</button>';
    }).join(" ");
    root.querySelector("#cross-tech-picker").innerHTML = techHtml ||
      '<p class="overline">技法タグがありません。</p>';

    var effectHtml = effectTags.map(function(t){
      var active = !!selectedEffect[t.id];
      return '<button type="button" class="chip effect chip--button' + (active ? " chip--active" : "") + '" ' +
             'data-action="toggle-cross-effect" data-id="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</button>';
    }).join(" ");
    root.querySelector("#cross-effect-picker").innerHTML = effectHtml ||
      '<p class="overline">効果タグがありません。</p>';

    renderCrossResults();
  }

  function renderCrossResults(){
    var resultsEl = root.querySelector("#cross-results");
    var summaryEl = root.querySelector("#cross-summary");
    var techIds = Object.keys(selectedTech);
    var effectIds = Object.keys(selectedEffect);
    var allSelected = techIds.concat(effectIds);

    if (!techIds.length){
      resultsEl.innerHTML = '<p class="overline">技法タグを1つ以上選んでください。</p>';
      summaryEl.innerHTML = "";
      return;
    }

    var data = App.store.get();
    var matched = data.nodes.filter(function(n){
      var tagIds = n.tagIds || [];
      return allSelected.every(function(id){ return tagIds.indexOf(id) !== -1; });
    });

    if (!matched.length){
      resultsEl.innerHTML = '<p class="overline">この組み合わせに一致する場面はありません。</p>';
      summaryEl.innerHTML = "";
      return;
    }

    var html = '<div class="table-wrap"><table class="table"><thead><tr>' +
               '<th>作品</th><th>場面</th><th>タグ</th><th>極性</th></tr></thead><tbody>';
    matched.forEach(function(n){
      var work = App.store.byId("works", n.workId);
      var chips = (n.tagIds || []).map(function(id){ return App.tagChipHtml(id); }).join(" ");
      html += '<tr class="cross-result-row" data-action="jump-node" data-work-id="' + App.util.esc(n.workId) + '" data-node-id="' + App.util.esc(n.id) + '">' +
              '<td>' + App.util.esc(work ? work.title : "（作品不明）") + '</td>' +
              '<td>' + App.util.esc(n.title || "（無題）") + '</td>' +
              '<td><div class="tag-row">' + chips + '</div></td>' +
              '<td>' + App.util.esc(n.polarity || "") + '</td>' +
              '</tr>';
    });
    html += '</tbody></table></div>';
    resultsEl.innerHTML = html;

    // 共起する効果タグの集計（多い順）
    var counts = {};
    matched.forEach(function(n){
      (n.tagIds || []).forEach(function(id){
        var tag = App.store.byId("tags", id);
        if (tag && tag.category === "効果"){
          counts[id] = (counts[id] || 0) + 1;
        }
      });
    });
    var pairs = Object.keys(counts).map(function(id){ return { id: id, n: counts[id] }; })
      .sort(function(a, b){ return b.n - a.n; });
    if (!pairs.length){
      summaryEl.innerHTML = '<p class="overline">共起する効果タグはありません。</p>';
    } else {
      var sHtml = '<h3 class="section-title" style="font-size:13px;">共起する効果タグ（' + matched.length + '場面中）</h3><div class="tag-row">';
      pairs.forEach(function(p){
        sHtml += App.tagChipHtml(p.id).replace("</span>", " (" + p.n + ")</span>");
      });
      sHtml += '</div>';
      summaryEl.innerHTML = sHtml;
    }
  }

  /* ------------------------------------------------------------------
     init
     ------------------------------------------------------------------ */
  function init(rootEl){
    root = rootEl;
    root.classList.add("view-essays"); // ★className上書き禁止・classList.add のみ
    draft = newDraft();

    root.innerHTML =
      // --- A) 考察ノート ---
      '<section class="block">' +
        '<div class="essay-section-head">' +
          '<h2 class="section-title">考察ノート</h2>' +
          '<button type="button" class="btn btn--primary" id="essay-new-btn">＋ 新規作成</button>' +
        '</div>' +
        '<div id="essay-list"></div>' +
      '</section>' +

      '<section class="block card" id="essay-editor-block">' +
        '<h2 class="section-title" id="essay-editor-title">考察を新規作成</h2>' +
        '<form id="essay-form">' +
          '<div class="field"><label for="essay-f-title">題名</label>' +
            '<input type="text" class="input" id="essay-f-title" name="title" maxlength="80"></div>' +
          '<div class="field"><label for="essay-f-body">本文</label>' +
            '<textarea class="textarea essay-body-textarea" id="essay-f-body" name="body"></textarea></div>' +
          '<div class="field"><label>タグ</label><div class="tag-row" id="essay-tag-picker"></div></div>' +
          '<button type="submit" class="btn btn--primary">保存</button> ' +
          '<button type="button" class="btn btn--danger" id="essay-delete-btn" hidden>この考察を削除</button>' +
        '</form>' +

        '<div class="evidence-list essay-evidence-block">' +
          '<div class="ev-title">根拠（場面・引用）</div>' +
          '<div id="essay-evidence-list"></div>' +

          '<div class="essay-evidence-add">' +
            '<div class="essay-evidence-add-col">' +
              '<div class="overline">場面を根拠に追加</div>' +
              '<select class="select" id="ev-work-select"></select>' +
              '<select class="select" id="ev-scene-select"></select>' +
              '<input type="text" class="input" id="ev-scene-note" placeholder="一言メモ（任意）">' +
              '<button type="button" class="btn btn--ghost" id="ev-scene-add-btn">＋ 場面を根拠に追加</button>' +
            '</div>' +
            '<div class="essay-evidence-add-col">' +
              '<div class="overline">一節を根拠に追加</div>' +
              '<select class="select" id="ev-quote-select"></select>' +
              '<input type="text" class="input" id="ev-quote-note" placeholder="一言メモ（任意）">' +
              '<button type="button" class="btn btn--ghost" id="ev-quote-add-btn">＋ 一節を根拠に追加</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // --- B) 横断検索 ---
      '<section class="block card">' +
        '<h2 class="section-title">横断検索（タグの組み合わせ→効果）</h2>' +
        '<p class="overline">構成の組み合わせがどんな効果を生むかをデータで見るための道具。</p>' +
        '<div class="field"><label>技法タグ（1つ以上選ぶ）</label><div class="tag-row" id="cross-tech-picker"></div></div>' +
        '<div class="field"><label>効果タグ（任意）</label><div class="tag-row" id="cross-effect-picker"></div></div>' +
        '<div id="cross-results"></div>' +
        '<div id="cross-summary" class="cross-summary"></div>' +
      '</section>';

    /* ---------------- イベント: 新規作成/削除/保存 ---------------- */

    root.querySelector("#essay-new-btn").addEventListener("click", function(){
      editingEssayId = null;
      draft = newDraft();
      renderEssayEditor();
      renderEssayList();
      root.querySelector("#essay-editor-block").scrollIntoView({ block: "center" });
    });

    root.querySelector("#essay-form").addEventListener("submit", function(ev){
      ev.preventDefault();
      var f = ev.target;
      var patch = { title: f.title.value.trim(), body: f.body.value };
      if (editingEssayId){
        App.store.update("essays", editingEssayId, patch);
      } else {
        // 新規保存。タグ・根拠は draft に溜めていた分をまとめて渡す
        patch.tagIds = draft.tagIds.slice();
        patch.evidence = draft.evidence.slice();
        var obj = App.store.add("essays", patch);
        editingEssayId = obj.id;
        draft = newDraft();
      }
      renderEssayEditor();
      renderEssayList();
    });

    root.querySelector("#essay-delete-btn").addEventListener("click", function(){
      if (!editingEssayId) return;
      var essay = App.store.byId("essays", editingEssayId);
      var ok = window.confirm("「" + (essay ? essay.title : "この考察") + "」を削除します。よろしいですか？");
      if (!ok) return;
      App.store.remove("essays", editingEssayId);
      editingEssayId = null;
      draft = newDraft();
      renderEssayEditor();
      renderEssayList();
    });

    /* ---------------- イベント: 根拠の追加 ---------------- */

    root.querySelector("#ev-work-select").addEventListener("change", updateSceneOptions);

    root.querySelector("#ev-scene-add-btn").addEventListener("click", function(){
      var nodeId = root.querySelector("#ev-scene-select").value;
      if (!nodeId){ window.alert("場面を選んでください。"); return; }
      var note = root.querySelector("#ev-scene-note").value.trim();
      addEvidence({ refType: "node", refId: nodeId, note: note });
      root.querySelector("#ev-scene-note").value = "";
    });

    root.querySelector("#ev-quote-add-btn").addEventListener("click", function(){
      var quoteId = root.querySelector("#ev-quote-select").value;
      if (!quoteId){ window.alert("一節を選んでください。"); return; }
      var note = root.querySelector("#ev-quote-note").value.trim();
      addEvidence({ refType: "quote", refId: quoteId, note: note });
      root.querySelector("#ev-quote-note").value = "";
    });

    function addEvidence(ev){
      if (editingEssayId){
        var essay = App.store.byId("essays", editingEssayId);
        var evidence = (essay.evidence || []).slice();
        evidence.push(ev);
        App.store.update("essays", editingEssayId, { evidence: evidence });
      } else {
        // 未保存の下書きは先に「保存」してから根拠を付けてもらう
        // （id が無い状態では evidence だけを永続化できないため）
        window.alert("先に本文を保存してから根拠を追加してください。");
        return;
      }
      renderEvidenceList();
    }

    /* ---------------- イベント委譲（クリック全般） ---------------- */

    root.addEventListener("click", function(ev){
      var openEssay = ev.target.closest('[data-action="open-essay"]');
      var toggleEssayTag = ev.target.closest('[data-action="toggle-essay-tag"]');
      var removeEv = ev.target.closest('[data-action="remove-evidence"]');
      var toggleTech = ev.target.closest('[data-action="toggle-cross-tech"]');
      var toggleEffect = ev.target.closest('[data-action="toggle-cross-effect"]');
      var jumpEl = ev.target.closest('[data-action="jump-node"]');

      if (openEssay){
        editingEssayId = openEssay.getAttribute("data-id");
        renderEssayEditor();
        renderEssayList();
        root.querySelector("#essay-editor-block").scrollIntoView({ block: "center" });
        return;
      }
      if (toggleEssayTag){
        var tid = toggleEssayTag.getAttribute("data-id");
        var essay = currentEssay();
        var tagIds = (essay.tagIds || []).slice();
        var idx = tagIds.indexOf(tid);
        if (idx === -1) tagIds.push(tid); else tagIds.splice(idx, 1);
        if (editingEssayId){
          App.store.update("essays", editingEssayId, { tagIds: tagIds });
        } else {
          draft.tagIds = tagIds;
        }
        renderEssayEditor();
        renderEssayList();
        return;
      }
      if (removeEv){
        var idx2 = Number(removeEv.getAttribute("data-idx"));
        if (editingEssayId){
          var essay2 = App.store.byId("essays", editingEssayId);
          var evidence2 = (essay2.evidence || []).slice();
          evidence2.splice(idx2, 1);
          App.store.update("essays", editingEssayId, { evidence: evidence2 });
        } else {
          draft.evidence.splice(idx2, 1);
        }
        renderEvidenceList();
        return;
      }
      if (toggleTech){
        var id1 = toggleTech.getAttribute("data-id");
        if (selectedTech[id1]) delete selectedTech[id1]; else selectedTech[id1] = true;
        renderCrossSearch();
        return;
      }
      if (toggleEffect){
        var id2 = toggleEffect.getAttribute("data-id");
        if (selectedEffect[id2]) delete selectedEffect[id2]; else selectedEffect[id2] = true;
        renderCrossSearch();
        return;
      }
      if (jumpEl){
        // 根拠・逆引き・横断検索結果のどこからでも分解ビューへジャンプできる契約
        App.state.currentWorkId = jumpEl.getAttribute("data-work-id");
        App.state.currentNodeId = jumpEl.getAttribute("data-node-id");
        App.showView("anatomy");
        return;
      }
    });

    // 他ビューでのデータ変更（タグ削除・場面削除等）に追随して再描画する
    App.store.onChange(function(){
      if (App.currentView() !== "essays") return;
      renderEssayList();
      renderEssayEditor();
      renderCrossSearch();
    });
  }

  App.registerView({
    id: "essays",
    title: "考察",
    order: 40,
    init: init,
    show: function(){
      renderEssayList();
      renderEssayEditor();
      renderCrossSearch();
    }
  });

})();
