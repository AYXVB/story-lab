/* ==========================================================================
   anatomy.js — 分解ビュー（id:anatomy / order:20 / タブ「分解」）
   このアプリの心臓部。作品を 部/章/場面 の階層に分解し、各場面へ緊張度・
   タグ・研究記録（Story Grid 方式）を付ける。構成バーで「平坦な区間＝物語が
   停滞している箇所」を発見する。設計.txt §4/§5/§6 準拠。
   ========================================================================== */
(function(){
  "use strict";

  var App = window.App;

  // ★ビュー間の選択共有：どのファイルが先に走っても壊れないよう毎回保証する
  App.state = App.state || {};

  // init で作った要素／レイアウト構築後に作られる要素への参照
  var els = {};

  // 現在選択中のノードid（この作品内でのカーソル。作品を変えると null に戻す）
  var currentNodeId = null;

  // renderMain がどの作品でレイアウトを組んだか（作品切替の検知に使う）
  var laidOutWorkId = null;

  // 種別の選択肢（設計 §5：部/章/場面）
  var NODE_TYPES = ["部", "章", "場面"];

  // 極性の選択肢（Story Grid：場面の価値がどちら向きに振れたか）
  var POLARITY_OPTS = ["", "+→-", "-→+", "+→++", "-→--", "++→+", "--→-", "変化なし"];

  // 構造要素チェック（設計 §5：場面内に存在する構造要素）
  var COMMANDMENTS = ["事件", "複雑化", "危機", "クライマックス", "解決"];

  // タグのカテゴリ順（追加セレクトの optgroup 並び）
  var TAG_CATEGORIES = ["構成", "演出", "言葉遣い", "効果"];

  /* ------------------------------------------------------------------
     場面の軸（緊張・推進・密度・情動）— 定義は data/scene-axes.js が真実。
     「なぜハードコードしないか」: 研究が進めば軸は増える／変わる。ここで
     配列を持つと分解・通読・比較で定義がズレる（＝同じ棒が別の意味になる）。
     ★scene-axes.js が読み込まれていない環境でも落ちないよう、従来どおり
     「緊張だけ」で動く保険を持たせる（後方互換）。
     ------------------------------------------------------------------ */
  var AXIS_FALLBACK = [
    { key: "tension", label: "緊張", hint: "", color: "var(--accent)" }
  ];
  function axisDefs(){
    var defs = (window.App && window.App.sceneAxes) || [];
    return (defs && defs.length) ? defs : AXIS_FALLBACK;
  }
  /** 軸キー → 定義（不明キーなら先頭軸へ落とす＝壊れた状態を残さない）*/
  function axisDef(key){
    var defs = axisDefs();
    for (var i = 0; i < defs.length; i++){ if (defs[i].key === key) return defs[i]; }
    return defs[0];
  }
  /** その軸が未記入か（null/undefined/空文字/数値でない を等しく「なし」とみなす）。
      ★既存132場面は tension のみ入っており drive/density/emotion は null。
      「0」と「未記入」は意味が違う（0＝測って低い／null＝測っていない）ので必ず区別する。 */
  function isAxisNull(n, key){
    var v = n ? n[key] : null;
    return (v === null || v === undefined || v === "" || isNaN(Number(v)));
  }
  function axisVal(n, key){ return Math.max(0, Math.min(100, Number(n[key]))); }

  // 構成バーの表示状態（保存しない＝見方の一時的な好み。データではない）
  var arcAxis = (window.App && App.sceneAxisDefault) || "tension";
  var arcOverlay = false;      // true=4軸を1つのグラフに重ねて見る

  /* ==================================================================
     初回1回だけ：静的な骨組み（タイトル・作品セレクタ・本体の器）
     ★root.className は上書きせず classList.add のみ（設計 §2 の既知バグ対策）
     ================================================================== */
  function init(root){
    root.classList.add("view-anatomy");
    root.innerHTML =
      '<div class="block">' +
        '<h2 class="section-title" id="ana-title">分解</h2>' +
        '<div class="ana-top" id="ana-top"></div>' +
        '<div id="ana-main"></div>' +
      '</div>';

    els.title = root.querySelector("#ana-title");
    els.top   = root.querySelector("#ana-top");
    els.main  = root.querySelector("#ana-main");

    // 他ビュー（書庫での削除・登録）に追随して再描画
    App.store.onChange(function(){
      if (App.currentView() === "anatomy") render();
    });
  }

  /* ==================================================================
     表示のたび：セレクタと本体を作り直す
     ================================================================== */
  function show(){
    // 他ビュー（全体検索・考察の根拠・タグ辞典の逆引き・比較統計の棒）から
    // 「この場面へ飛べ」と指定されて来た場合は、その節を選択状態にする。
    // 「なぜ必要か」: これが無いと作品までしか合わず、飛んだ先で目的の場面を
    // 自分で探し直すことになる（ジャンプの意味が半減する）。
    // 使い捨て（読んだら消す）＝次回以降の表示に持ち越さない。
    var jumpId = App.state && App.state.currentNodeId;
    if (jumpId){
      App.state.currentNodeId = null;
      var target = App.store.byId("nodes", jumpId);
      // 今表示する作品に属する節のときだけ選択する（作品違いの誤選択を防ぐ）
      if (target && target.workId === currentWorkId()) currentNodeId = jumpId;
    }
    render();
  }

  function render(){
    renderSelector();
    renderMain();
  }

  /* ------------------------------------------------------------------
     データ小道具（順序・階層の計算を1箇所に集約）
     ------------------------------------------------------------------ */

  /** 有効な現在作品id（存在する作品のみ）。無ければ null */
  function currentWorkId(){
    var id = App.state.currentWorkId;
    if (id && App.store.byId("works", id)) return id;
    return null;
  }

  /** 同じ親を持つ兄弟ノードを order 昇順で返す（parentId は null 可）*/
  function childrenOf(workId, parentId){
    return App.store.get().nodes.filter(function(n){
      return n.workId === workId && (n.parentId || null) === (parentId || null);
    }).sort(function(a, b){ return (a.order || 0) - (b.order || 0); });
  }

  /** 作品内を親子で深さ優先に平坦化し [{node, depth}] を返す（＝作品内の順）*/
  function flatten(workId){
    var out = [];
    (function walk(parentId, depth){
      childrenOf(workId, parentId).forEach(function(n){
        out.push({ node: n, depth: depth });
        walk(n.id, depth + 1);       // 子孫を続けて辿る
      });
    })(null, 0);
    return out;
  }

  /** 作品内の場面（type=="場面"）を作品内の順で返す */
  function scenesInOrder(workId){
    return flatten(workId).filter(function(x){ return x.node.type === "場面"; })
                          .map(function(x){ return x.node; });
  }

  /** 追加時に使う次の order（兄弟の最大+1）*/
  function nextOrder(workId, parentId){
    var sib = childrenOf(workId, parentId);
    return sib.length ? (sib[sib.length - 1].order || 0) + 1 : 0;
  }

  /* ------------------------------------------------------------------
     上部：作品セレクタ
     ------------------------------------------------------------------ */
  function renderSelector(){
    var works = App.store.get().works;
    var curId = currentWorkId();

    if (works.length === 0){
      els.top.innerHTML =
        '<div class="overline">作品がありません。まず「書庫」で登録してください。</div>';
      return;
    }

    var opts = works.map(function(w){
      var label = w.title + (w.author ? "／" + w.author : "");
      var sel = (w.id === curId) ? " selected" : "";
      return '<option value="' + App.util.esc(w.id) + '"' + sel + '>' +
             App.util.esc(label) + '</option>';
    }).join("");

    els.top.innerHTML =
      '<div class="field">' +
        '<label for="ana-work-select">分解する作品</label>' +
        '<select class="select" id="ana-work-select">' + opts + '</select>' +
      '</div>';

    els.top.querySelector("#ana-work-select").addEventListener("change", function(){
      App.state.currentWorkId = this.value;   // 選択を共有状態へ
      currentNodeId = null;                    // 作品が変われば選択場面は解除
      renderMain();
    });
  }

  /* ------------------------------------------------------------------
     本体：作品未選択なら空状態、選択済みならレイアウトを組む
     ------------------------------------------------------------------ */
  function renderMain(){
    var workId = currentWorkId();

    // 作品未選択（書庫からの導線を出す）
    if (!workId){
      laidOutWorkId = null;
      els.title.textContent = "分解";
      els.main.innerHTML =
        '<div class="ana-empty">' +
          '<p>分解する作品が選ばれていません。<br>「書庫」で作品カードを開くと、ここに分解画面が出ます。</p>' +
          '<button type="button" class="btn btn--primary" id="ana-goto-lib">書庫へ行く</button>' +
        '</div>';
      var b = els.main.querySelector("#ana-goto-lib");
      if (b) b.addEventListener("click", function(){ App.showView("library"); });
      return;
    }

    var work = App.store.byId("works", workId);
    els.title.textContent = "分解：" + work.title;

    // 作品が変わった時だけレイアウト骨組みを組み直す（毎回組むと入力欄が飛ぶ）
    if (laidOutWorkId !== workId || !els.main.querySelector(".ana-layout")){
      laidOutWorkId = workId;
      els.main.innerHTML =
        '<div class="ana-worktags" id="ana-worktags"></div>' +
        '<div class="arc-wrap" id="ana-arc"></div>' +
        '<div class="ana-layout">' +
          '<div class="tree-panel" id="ana-tree"></div>' +
          '<div class="editor-panel" id="ana-editor"></div>' +
        '</div>';
      els.worktags = els.main.querySelector("#ana-worktags");
      els.arc      = els.main.querySelector("#ana-arc");
      els.tree     = els.main.querySelector("#ana-tree");
      els.editor   = els.main.querySelector("#ana-editor");
    }

    renderBody();
  }

  /** 本体4パートをまとめて描く（構造変更や表示切替時に使う）*/
  function renderBody(){
    renderWorkTags();
    renderArc();
    renderTree();
    renderEditor();
  }

  /* ------------------------------------------------------------------
     作品全体への構成タグ（works.tagIds）
     ------------------------------------------------------------------ */
  function renderWorkTags(){
    var work = App.store.byId("works", currentWorkId());
    if (!work) return;
    var tagIds = Array.isArray(work.tagIds) ? work.tagIds : [];

    els.worktags.innerHTML =
      '<div class="ana-worktags__title">作品全体の構成タグ（三幕構成などの型）</div>' +
      '<div class="ed-tags" id="ana-worktag-chips">' + tagListHtml(tagIds, "wt") + '</div>' +
      '<div class="ed-tag-add">' +
        tagAddSelectHtml(tagIds, "ana-worktag-select") +
        '<button type="button" class="btn btn--sm" id="ana-worktag-add">＋ 付ける</button>' +
      '</div>';

    // × で外す
    els.worktags.querySelector("#ana-worktag-chips").addEventListener("click", function(ev){
      var x = ev.target.closest("[data-wt-remove]");
      if (!x) return;
      var next = tagIds.filter(function(t){ return t !== x.getAttribute("data-wt-remove"); });
      App.store.update("works", work.id, { tagIds: next });
      renderWorkTags();
    });
    // ＋ で付ける
    els.worktags.querySelector("#ana-worktag-add").addEventListener("click", function(){
      var sel = els.worktags.querySelector("#ana-worktag-select");
      if (!sel || !sel.value) return;
      if (tagIds.indexOf(sel.value) !== -1) return;   // 二重付与を防ぐ
      App.store.update("works", work.id, { tagIds: tagIds.concat(sel.value) });
      renderWorkTags();
    });
  }

  /* ------------------------------------------------------------------
     構成バー（場面の緊張度を高さで示す棒グラフ）
     ------------------------------------------------------------------ */
  function renderArc(){
    var workId = currentWorkId();
    var scenes = scenesInOrder(workId);

    if (scenes.length === 0){
      els.arc.innerHTML =
        '<div class="arc-title">構成バー（場面の起伏）</div>' +
        '<div class="arc-empty">場面（type=場面）を追加すると、場面の起伏がここに並びます。</div>';
      return;
    }

    var def = axisDef(arcAxis);
    arcAxis = def.key;                        // 不明キーの自己修復
    var title = arcOverlay
      ? "構成バー（4軸を重ねて表示・全" + scenes.length + "場面／棒クリックで選択）"
      : "構成バー（" + def.label + "の起伏・全" + scenes.length + "場面／棒クリックで選択）";

    var labels = "";
    scenes.forEach(function(n, i){
      var pol = polSign(n.polarity);
      labels += '<div class="arc-lab">' + (i + 1) +
                (pol ? '<span class="arc-pol">' + pol + '</span>' : "") + '</div>';
    });

    els.arc.innerHTML =
      '<div class="arc-title">' + App.util.esc(title) + '</div>' +
      axisSwitchHtml(arcAxis, arcOverlay) +
      (arcOverlay ? overlayBarHtml(scenes, currentNodeId)
                  : singleBarHtml(scenes, def, currentNodeId)) +
      '<div class="arc-labels">' + labels + '</div>';

    // 棒クリックでその場面を選択
    els.arc.querySelector(".arc-bar").addEventListener("click", function(ev){
      var seg = ev.target.closest("[data-scene]");
      if (seg) selectNode(seg.getAttribute("data-scene"));
    });
    bindAxisSwitch(els.arc, function(key, overlay){
      arcAxis = key; arcOverlay = overlay;
      renderArc();                            // グラフだけ描き直す（入力欄は触らない）
    });
  }

  /* ------------------------------------------------------------------
     軸の切替UI（分解・通読で同じ見た目・同じ操作にする）
     ★375px 対応: ボタンは flex-wrap で折り返し、横スクロールを出さない。
     ------------------------------------------------------------------ */
  function axisSwitchHtml(activeKey, overlay){
    var btns = axisDefs().map(function(a){
      var on = (!overlay && a.key === activeKey);
      // 選択中は色で示す（色だけに頼らず aria-pressed と枠でも示す）
      var style = on ? ' style="border-color:' + a.color + ';color:' + a.color + '"' : "";
      return '<button type="button" class="axis-btn' + (on ? " is-on" : "") + '"' +
             ' data-axis="' + App.util.esc(a.key) + '"' +
             ' aria-pressed="' + (on ? "true" : "false") + '"' + style + '>' +
             App.util.esc(a.label) + '</button>';
    }).join("");
    var hint = overlay ? "" :
      '<div class="axis-hint">' + App.util.esc(axisDef(activeKey).hint || "") + '</div>';
    return '<div class="axis-switch">' +
             '<div class="axis-btns">' + btns + '</div>' +
             '<label class="axis-overlay"><input type="checkbox" data-axis-overlay' +
               (overlay ? " checked" : "") + '> 重ねて見る</label>' +
           '</div>' +
           (overlay ? axisLegendHtml() : "") + hint;
  }

  /** 重ね表示の凡例（どの色がどの軸かを必ず出す＝色だけでは読めないため）*/
  function axisLegendHtml(){
    var items = axisDefs().map(function(a){
      return '<span class="axis-legend__item">' +
               '<i class="axis-legend__swatch" style="background:' + a.color + '"></i>' +
               App.util.esc(a.label) +
             '</span>';
    }).join("");
    return '<div class="axis-legend">' + items + '</div>';
  }

  function bindAxisSwitch(root, onChange){
    var sw = root.querySelector(".axis-switch");
    if (!sw) return;
    sw.addEventListener("click", function(ev){
      var b = ev.target.closest("[data-axis]");
      if (!b) return;
      onChange(b.getAttribute("data-axis"), false);   // 軸を選んだら単軸表示に戻す
    });
    var cb = sw.querySelector("[data-axis-overlay]");
    if (cb) cb.addEventListener("change", function(){
      onChange(arcAxis, cb.checked);
    });
  }

  /* 単軸の棒（従来の見た目を踏襲。色だけ軸ごとに変える）*/
  function singleBarHtml(scenes, def, currentId){
    var bars = scenes.map(function(n){
      var empty = isAxisNull(n, def.key);
      var cur = (currentId && n.id === currentId) ? " current" : "";
      var t = App.util.esc(n.title || "");
      if (empty){
        // ★未記入は「低い灰色棒」ではなく点線枠にする。
        // 「なぜ」: 多軸では未記入の軸が普通にある。0（測って低い）と同じ見た目に
        // すると「静かな場面」と「まだ測っていない場面」が区別できず研究が濁る。
        return '<div class="arc-seg is-empty' + cur + '" ' +
               'data-scene="' + App.util.esc(n.id) + '" ' +
               'title="' + t + '（' + App.util.esc(def.label) + ' 未記入）"></div>';
      }
      var v = axisVal(n, def.key);
      return '<div class="arc-seg' + cur + '" style="height:' + Math.max(4, v) + '%;' +
             'background:' + def.color + '" ' +
             'data-scene="' + App.util.esc(n.id) + '" ' +
             'title="' + t + '（' + App.util.esc(def.label) + ' ' + v + '）"></div>';
    }).join("");
    return '<div class="arc-bar">' + bars + '</div>';
  }

  /* 重ね表示：場面ごとに4本の細い棒を並べる（折れ線より狭幅で崩れにくい）*/
  function overlayBarHtml(scenes, currentId){
    var defs = axisDefs();
    var groups = scenes.map(function(n){
      var cur = (currentId && n.id === currentId) ? " current" : "";
      var inner = defs.map(function(a){
        if (isAxisNull(n, a.key)){
          return '<i class="arc-mini is-empty" title="' +
                 App.util.esc(a.label) + ' 未記入"></i>';
        }
        var v = axisVal(n, a.key);
        return '<i class="arc-mini" style="height:' + Math.max(3, v) + '%;' +
               'background:' + a.color + '" title="' +
               App.util.esc(a.label) + ' ' + v + '"></i>';
      }).join("");
      return '<div class="arc-group' + cur + '" data-scene="' + App.util.esc(n.id) + '" ' +
             'title="' + App.util.esc(n.title || "") + '">' + inner + '</div>';
    }).join("");
    return '<div class="arc-bar arc-bar--overlay">' + groups + '</div>';
  }

  /** 極性文字列から下ラベル用の記号（+ / − / =）を導く */
  function polSign(pol){
    if (!pol) return "";
    if (pol === "変化なし") return "=";
    var end = pol.split("→").pop();     // 矢印の後＝場面終了時の価値の向き
    if (end.indexOf("+") !== -1) return "+";
    if (end.indexOf("-") !== -1) return "−";
    return "";
  }

  /* ------------------------------------------------------------------
     左：階層ツリー（部/章/場面）＋ 改名・削除・上下移動・追加
     ------------------------------------------------------------------ */
  function renderTree(){
    var workId = currentWorkId();
    var flat = flatten(workId);

    var listHtml = "";
    if (flat.length === 0){
      listHtml = '<li class="tree-hint">まだ節がありません。下で「部／章／場面」を追加してください。</li>';
    } else {
      flat.forEach(function(x){
        var n = x.node;
        var sibs = childrenOf(workId, n.parentId);   // 上下移動の可否判定用
        var idx = sibs.findIndex(function(s){ return s.id === n.id; });
        var upDis  = (idx <= 0) ? " disabled" : "";
        var downDis= (idx >= sibs.length - 1) ? " disabled" : "";
        var cur = (n.id === currentNodeId) ? " current" : "";
        // 深さぶん字下げ（ツリーの階層を視覚化）
        var pad = 'style="margin-left:' + (x.depth * 14) + 'px"';
        listHtml +=
          '<li class="tree-node' + cur + '" ' + pad + '>' +
            '<div class="tree-node__row">' +
              '<span class="type-badge">' + App.util.esc(n.type) + '</span>' +
              '<button type="button" class="tree-node__name" data-select="' + App.util.esc(n.id) + '">' +
                App.util.esc(n.title || "（無題）") +
              '</button>' +
              '<span class="tree-node__ops">' +
                '<button type="button" class="icon-btn" data-up="' + App.util.esc(n.id) + '"' + upDis + '>▲</button>' +
                '<button type="button" class="icon-btn" data-down="' + App.util.esc(n.id) + '"' + downDis + '>▼</button>' +
                '<button type="button" class="icon-btn" data-rename="' + App.util.esc(n.id) + '">改</button>' +
                '<button type="button" class="icon-btn danger" data-delete="' + App.util.esc(n.id) + '">×</button>' +
              '</span>' +
            '</div>' +
          '</li>';
      });
    }

    // 追加フォーム：選択ノードの子として（未選択なら作品直下に）追加する
    var typeOpts = NODE_TYPES.map(function(t){
      return '<option value="' + t + '">' + t + '</option>';
    }).join("");
    var selectedNode = currentNodeId ? App.store.byId("nodes", currentNodeId) : null;
    var addWhere = selectedNode ?
      "「" + (selectedNode.title || "選択中の節") + "」の子として追加" :
      "作品の直下に追加（節を選ぶとその子に追加）";

    els.tree.innerHTML =
      '<div class="tree-title">階層ツリー（作品→部／章→場面）</div>' +
      '<ul class="tree-list">' + listHtml + '</ul>' +
      '<div class="tree-add">' +
        '<select class="select" id="ana-add-type">' + typeOpts + '</select>' +
        '<button type="button" class="btn btn--sm btn--primary" id="ana-add-btn">＋ 追加</button>' +
      '</div>' +
      '<div class="tree-hint">' + App.util.esc(addWhere) + '</div>';

    // クリック委譲（選択・上下・改名・削除）
    els.tree.querySelector(".tree-list").addEventListener("click", onTreeClick);
    els.tree.querySelector("#ana-add-btn").addEventListener("click", onAddNode);
  }

  function onTreeClick(ev){
    var t = ev.target;
    var sel = t.closest("[data-select]");
    if (sel){ selectNode(sel.getAttribute("data-select")); return; }

    var up = t.closest("[data-up]");
    if (up){ moveNode(up.getAttribute("data-up"), -1); return; }

    var down = t.closest("[data-down]");
    if (down){ moveNode(down.getAttribute("data-down"), +1); return; }

    var ren = t.closest("[data-rename]");
    if (ren){
      var n = App.store.byId("nodes", ren.getAttribute("data-rename"));
      if (!n) return;
      var name = window.prompt("新しい題名を入力してください。", n.title || "");
      if (name === null) return;                 // キャンセル
      App.store.update("nodes", n.id, { title: name.trim() });
      renderTree(); renderArc();
      if (n.id === currentNodeId) renderEditor(); // 選択中なら編集欄の題名も更新
      return;
    }

    var del = t.closest("[data-delete]");
    if (del){
      var node = App.store.byId("nodes", del.getAttribute("data-delete"));
      if (!node) return;
      var kids = flatten(currentWorkId()).some(function(x){ return x.node.parentId === node.id; });
      var msg = "「" + (node.title || "無題") + "」を削除します。" +
                (kids ? "\nこの節の下にある子孫（章・場面など）もすべて消えます。" : "") +
                "\n元に戻せません。よろしいですか？";
      if (!window.confirm(msg)) return;
      App.store.remove("nodes", node.id);         // 子孫掃除は store が行う
      if (currentNodeId === node.id) currentNodeId = null;
      renderBody();
      return;
    }
  }

  /** 節を選択（構成バー・ツリーの現在表示と編集欄を更新）*/
  function selectNode(id){
    currentNodeId = id;
    renderArc();
    renderTree();
    renderEditor();
  }

  /** 追加：選択ノードの子（未選択なら作品直下）に指定 type のノードを作る */
  function onAddNode(){
    var workId = currentWorkId();
    var type = els.tree.querySelector("#ana-add-type").value;
    var parentId = currentNodeId || null;
    var fields = {
      workId: workId,
      parentId: parentId,
      order: nextOrder(workId, parentId),
      type: type,
      title: "",
      summary: "",
      quoteText: "",
      quoteRef: "",
      tension: null,
      tagIds: [],
      valueStart: null,
      valueEnd: null,
      polarity: null,
      commandments: [],
      fullText: null
    };
    // 4軸はすべて null（＝未記入）で作る。定義から回すので軸が増えても追随する
    axisDefs().forEach(function(a){ fields[a.key] = null; });
    var node = App.store.add("nodes", fields);
    currentNodeId = node.id;   // 追加した節を選択状態に
    renderBody();
  }

  /** 上下移動：同じ親の兄弟内で order を隣と入替え、order を 0..n に正規化 */
  function moveNode(id, dir){
    var node = App.store.byId("nodes", id);
    if (!node) return;
    var sibs = childrenOf(currentWorkId(), node.parentId);
    var idx = sibs.findIndex(function(s){ return s.id === id; });
    var swap = idx + dir;
    if (swap < 0 || swap >= sibs.length) return;    // 端では動かせない
    // 配列上で入替えてから order を振り直す（order が疎でも確実に効く）
    var tmp = sibs[idx]; sibs[idx] = sibs[swap]; sibs[swap] = tmp;
    sibs.forEach(function(s, i){ App.store.update("nodes", s.id, { order: i }); });
    renderTree(); renderArc();
  }

  /* ------------------------------------------------------------------
     右：選択ノードの編集カード
     ------------------------------------------------------------------ */
  function renderEditor(){
    // 未選択：案内だけ
    if (!currentNodeId || !App.store.byId("nodes", currentNodeId)){
      currentNodeId = currentNodeId && App.store.byId("nodes", currentNodeId) ? currentNodeId : null;
      els.editor.innerHTML =
        '<div class="card"><div class="overline">左のツリーで節を選ぶか、新しく追加すると、ここで編集できます。</div></div>';
      return;
    }
    var n = App.store.byId("nodes", currentNodeId);
    var tagIds = Array.isArray(n.tagIds) ? n.tagIds : [];

    var typeOpts = NODE_TYPES.map(function(t){
      return '<option value="' + t + '"' + (n.type === t ? " selected" : "") + '>' + t + '</option>';
    }).join("");

    var polOpts = POLARITY_OPTS.map(function(p){
      var label = p === "" ? "（未設定）" : p;
      return '<option value="' + App.util.esc(p) + '"' + ((n.polarity || "") === p ? " selected" : "") +
             '>' + App.util.esc(label) + '</option>';
    }).join("");

    var cmds = Array.isArray(n.commandments) ? n.commandments : [];
    var cmdBoxes = COMMANDMENTS.map(function(c){
      var chk = cmds.indexOf(c) !== -1 ? " checked" : "";
      return '<label><input type="checkbox" class="ed-cmd" value="' + c + '"' + chk + '> ' + c + '</label>';
    }).join("");

    els.editor.innerHTML =
      '<div class="card">' +
        '<div class="field">' +
          '<label for="ed-title">題名</label>' +
          '<input class="input" type="text" id="ed-title" value="' + App.util.esc(n.title || "") + '">' +
        '</div>' +
        '<div class="ed-row">' +
          '<div class="field">' +
            '<label for="ed-type">種別</label>' +
            '<select class="select" id="ed-type">' + typeOpts + '</select>' +
          '</div>' +
        '</div>' +
        axisFieldsHtml(n) +
        '<div class="field">' +
          '<label for="ed-summary">要約</label>' +
          '<textarea class="textarea" id="ed-summary">' + App.util.esc(n.summary || "") + '</textarea>' +
        '</div>' +
        '<div class="field">' +
          '<label for="ed-quote">引用（短く。名著の全文は保持しない）</label>' +
          '<textarea class="textarea" id="ed-quote" placeholder="印象的な一節を短く">' +
            App.util.esc(n.quoteText || "") + '</textarea>' +
        '</div>' +
        '<div class="field">' +
          '<label for="ed-quoteref">引用の出典（例: 走れメロス／場面3）</label>' +
          '<input class="input" type="text" id="ed-quoteref" value="' + App.util.esc(n.quoteRef || "") + '">' +
        '</div>' +

        '<div class="field">' +
          '<label>タグ付け</label>' +
          '<div class="ed-tags" id="ed-tag-chips">' + tagListHtml(tagIds, "nt") + '</div>' +
          '<div class="ed-tag-add">' +
            tagAddSelectHtml(tagIds, "ed-tag-select") +
            '<button type="button" class="btn btn--sm" id="ed-tag-add-btn">＋ 付ける</button>' +
          '</div>' +
        '</div>' +

        '<details class="ed-research"' + (hasResearch(n) ? " open" : "") + '>' +
          '<summary>研究記録（価値の変化・極性・構造要素）</summary>' +
          '<div class="ed-research__body">' +
            '<p class="research-note">Story Grid 方式：場面で価値がどう振れたかを記録し、' +
              '平坦な区間＝物語が動いていない箇所を見つけるための任意欄です。</p>' +
            '<div class="ed-row">' +
              '<div class="field">' +
                '<label for="ed-vstart">開始時の価値（例: 安全）</label>' +
                '<input class="input" type="text" id="ed-vstart" value="' + App.util.esc(n.valueStart || "") + '">' +
              '</div>' +
              '<div class="field">' +
                '<label for="ed-vend">終了時の価値（例: 危険）</label>' +
                '<input class="input" type="text" id="ed-vend" value="' + App.util.esc(n.valueEnd || "") + '">' +
              '</div>' +
            '</div>' +
            '<div class="field">' +
              '<label for="ed-polarity">極性（価値の振れ）</label>' +
              '<select class="select" id="ed-polarity">' + polOpts + '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label>構造要素（この場面に在るもの）</label>' +
              '<div class="commandments">' + cmdBoxes + '</div>' +
            '</div>' +
          '</div>' +
        '</details>' +
      '</div>';

    bindEditor(n.id);
  }

  /** 場面の軸（4本のスライダー）。
      「なぜ4本か」: 緊張1本だと「静かで濃い場面」がすべて谷に見え、Scene and Sequel
      でいうシークエル（反応・逡巡・決断）を評価できない。軸ごとに「なし(null)」を
      選べるのは、測っていないことと 0 を区別するため。 */
  function axisFieldsHtml(n){
    var rows = axisDefs().map(function(a){
      var empty = isAxisNull(n, a.key);
      var v = empty ? 50 : axisVal(n, a.key);     // 未記入は中央から始める
      var id = "ed-ax-" + a.key;
      return '<div class="ed-axis" data-axis-field="' + App.util.esc(a.key) + '">' +
               '<div class="ed-axis__head">' +
                 '<label class="ed-axis__label" for="' + id + '" ' +
                   'style="color:' + a.color + '">' + App.util.esc(a.label) + '</label>' +
                 '<span class="ed-axis__val" data-axis-val>' +
                   (empty ? "なし" : v) + '</span>' +
                 '<label class="ed-axis__null"><input type="checkbox" data-axis-null' +
                   (empty ? " checked" : "") + '> なし</label>' +
               '</div>' +
               '<input type="range" min="0" max="100" step="1" id="' + id + '" ' +
                 'data-axis-range value="' + v + '"' + (empty ? " disabled" : "") + '>' +
               (a.hint ? '<div class="ed-axis__hint">' + App.util.esc(a.hint) + '</div>' : "") +
             '</div>';
    }).join("");
    return '<div class="field ed-axes">' +
             '<label>場面の軸（各 0〜100・測っていないものは「なし」）</label>' +
             rows +
           '</div>';
  }

  /** 研究記録に1つでも値があるか（初期表示で details を開くかの判定）*/
  function hasResearch(n){
    return !!(n.valueStart || n.valueEnd || n.polarity ||
              (Array.isArray(n.commandments) && n.commandments.length));
  }

  /** 編集欄の入力を配線（自動保存。text は blur・選択系は change で即保存）*/
  function bindEditor(nodeId){
    var e = els.editor;
    // 現在のノードから編集内容を読み取り patch を作って保存する
    function collect(){
      var cmds = [];
      e.querySelectorAll(".ed-cmd").forEach(function(cb){ if (cb.checked) cmds.push(cb.value); });
      var patch = {
        title: e.querySelector("#ed-title").value.trim(),
        type: e.querySelector("#ed-type").value,
        summary: e.querySelector("#ed-summary").value,
        quoteText: e.querySelector("#ed-quote").value,
        quoteRef: e.querySelector("#ed-quoteref").value.trim(),
        valueStart: e.querySelector("#ed-vstart").value.trim() || null,
        valueEnd: e.querySelector("#ed-vend").value.trim() || null,
        polarity: e.querySelector("#ed-polarity").value || null,
        commandments: cmds
      };
      // 軸は定義（scene-axes.js）から引いて動的に詰める＝軸が増えても collect は不変
      e.querySelectorAll("[data-axis-field]").forEach(function(box){
        var key = box.getAttribute("data-axis-field");
        var isNull = box.querySelector("[data-axis-null]").checked;
        patch[key] = isNull ? null : Number(box.querySelector("[data-axis-range]").value);
      });
      return patch;
    }
    function save(){
      if (App.store.byId("nodes", nodeId)) App.store.update("nodes", nodeId, collect());
    }
    // 消えると悲しいので入力途中も debounce で静かに保存（再描画はしない）
    var saveSoon = App.util.debounce(save, 400);

    // テキスト系：入力中は saveSoon、確定(blur)で保存＋ラベル反映（題名→ツリー/バー）
    ["#ed-title", "#ed-summary", "#ed-quote", "#ed-quoteref", "#ed-vstart", "#ed-vend"]
      .forEach(function(sel){
        var el = e.querySelector(sel);
        el.addEventListener("input", saveSoon);
        el.addEventListener("blur", function(){ save(); renderTree(); renderArc(); });
      });

    // 種別：即保存＋ツリー/バー更新（場面の増減で構成バーが変わる）
    e.querySelector("#ed-type").addEventListener("change", function(){
      save(); renderTree(); renderArc();
    });

    // 軸スライダー（4本）：動かすたびラベル更新、離したら保存＋構成バー反映。
    // ★renderEditor は呼ばない（入力中の欄が飛ぶため。従来の原則を踏襲）
    e.querySelectorAll("[data-axis-field]").forEach(function(box){
      var range  = box.querySelector("[data-axis-range]");
      var val    = box.querySelector("[data-axis-val]");
      var nullCb = box.querySelector("[data-axis-null]");
      range.addEventListener("input", function(){ val.textContent = range.value; });
      range.addEventListener("change", function(){ save(); renderArc(); });
      nullCb.addEventListener("change", function(){
        // 「なし」＝その軸は測っていない（null）。ONでスライダーを無効化する
        range.disabled = nullCb.checked;
        val.textContent = nullCb.checked ? "なし" : range.value;
        save(); renderArc();
      });
    });

    // 極性：即保存＋バー（下の +/− 記号が変わる）
    e.querySelector("#ed-polarity").addEventListener("change", function(){ save(); renderArc(); });
    // 構造要素チェック：即保存（表示は変わらない）
    e.querySelectorAll(".ed-cmd").forEach(function(cb){
      cb.addEventListener("change", save);
    });

    // タグの × 外し
    e.querySelector("#ed-tag-chips").addEventListener("click", function(ev){
      var x = ev.target.closest("[data-nt-remove]");
      if (!x) return;
      var node = App.store.byId("nodes", nodeId);
      var ids = (node.tagIds || []).filter(function(t){ return t !== x.getAttribute("data-nt-remove"); });
      App.store.update("nodes", nodeId, { tagIds: ids });
      renderEditor();
    });
    // タグの ＋ 付け
    e.querySelector("#ed-tag-add-btn").addEventListener("click", function(){
      var selEl = e.querySelector("#ed-tag-select");
      if (!selEl || !selEl.value) return;
      var node = App.store.byId("nodes", nodeId);
      var ids = node.tagIds || [];
      if (ids.indexOf(selEl.value) !== -1) return;   // 二重付与を防ぐ
      App.store.update("nodes", nodeId, { tagIds: ids.concat(selEl.value) });
      renderEditor();
    });
  }

  /* ------------------------------------------------------------------
     タグ描画の共通部品（チップ本体は必ず App.tagChipHtml を使う）
     ------------------------------------------------------------------ */

  /** 現在タグのチップ列（×付き）。removeKey で work/node の削除属性を切替 */
  function tagListHtml(tagIds, removeKey){
    if (!tagIds || !tagIds.length){
      return '<span class="overline">（まだタグがありません）</span>';
    }
    return tagIds.map(function(id){
      var chip = App.tagChipHtml(id);            // ←チップは共通部品に限る
      if (!chip) return "";                       // 削除済みタグは描かない
      return '<span class="ed-tag-item">' + chip +
             '<button type="button" class="chip-x" data-' + removeKey + '-remove="' +
             App.util.esc(id) + '" title="外す">×</button></span>';
    }).join("");
  }

  /** タグ追加セレクト（カテゴリ別 optgroup・既に付いているタグは除外）*/
  function tagAddSelectHtml(currentIds, selectId){
    var have = {};
    (currentIds || []).forEach(function(id){ have[id] = true; });
    var tags = App.store.get().tags;

    var groups = "";
    TAG_CATEGORIES.forEach(function(cat){
      var opts = tags.filter(function(t){ return t.category === cat && !have[t.id]; })
        .map(function(t){
          return '<option value="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</option>';
        }).join("");
      if (opts){
        groups += '<optgroup label="' + App.util.esc(cat) + '">' + opts + '</optgroup>';
      }
    });
    var placeholder = '<option value="">タグを選ぶ…</option>';
    return '<select class="select" id="' + selectId + '">' + placeholder + groups + '</select>';
  }

  // ビュー登録（設計 §4）。init=初回のみ、show=表示のたび
  App.registerView({ id: "anatomy", title: "分解", order: 20, init: init, show: show });

})();
