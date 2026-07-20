/* ==========================================================================
   compare.js — 比較・統計ビュー（id:compare / order:70 / タブ「比較・統計」）
   研究の分析力を上げる中核。3つの道具を持つ:
     ① 作品間比較     … 2作の緊張度カーブ・基本情報・タグ構成を並べる
     ② タグ共起統計   … 技法タグ→効果タグ（およびその逆）の共起をデータで見る
     ③ モチーフ出現マップ … 作品内でキーワードがどこで再出現するかの帯
   設計.txt §4/§5/§6 準拠。ES Modules/外部CDN禁止＝グラフは div の高さ・幅で描く。
   ========================================================================== */
(function(){
  "use strict";

  var App = window.App;

  // ★ビュー間の選択共有：どのファイルが先に走っても壊れないよう毎回保証する
  App.state = App.state || {};

  // init で作った器への参照（再描画のたびに innerHTML を差し替える）
  var els = {};

  // ① 作品間比較の選択状態（null=未選択。init 時に currentWorkId を初期値に使う）
  var cmpA = null;
  var cmpB = null;

  // ② タグ共起統計の状態。dir="tech" は技法→効果、"effect" は効果→技法（逆引き）
  var coDir = "tech";
  var coTagId = null;

  // ③ モチーフ出現マップの状態
  var motifWorkId = null;
  var motifWords = "";

  // 技法タグのカテゴリ（設計 §5：技法＝構成/演出/言葉遣い、効果＝効果）
  var TECH_CATEGORIES = ["構成", "演出", "言葉遣い"];

  // タグ構成で並べる上限（多すぎると比較の見通しが悪くなるため上位10個）
  var TAG_TOP_N = 10;

  /* ==================================================================
     初回1回だけ：静的な骨組み
     ★root.className は上書きせず classList.add のみ（設計 §2 の既知バグ対策）
     ================================================================== */
  function init(root){
    root.classList.add("view-compare");
    root.innerHTML =
      '<section class="block">' +
        '<h2 class="section-title">作品間比較</h2>' +
        '<div id="cmp-panel"></div>' +
      '</section>' +
      '<section class="block">' +
        '<h2 class="section-title">タグ共起統計</h2>' +
        '<div id="cmp-cooc"></div>' +
      '</section>' +
      '<section class="block">' +
        '<h2 class="section-title">モチーフ出現マップ</h2>' +
        '<div id="cmp-motif"></div>' +
      '</section>';

    els.cmp   = root.querySelector("#cmp-panel");
    els.cooc  = root.querySelector("#cmp-cooc");
    els.motif = root.querySelector("#cmp-motif");

    // ★委譲リスナーは init で1回だけ張る。
    // 「なぜ」: 器（els.*）は使い回して中身だけ innerHTML で差し替えるため、
    // 再描画のたびに addEventListener すると同じ処理が多重実行される。
    els.cmp.addEventListener("click", onCompareClick);
    els.cooc.addEventListener("click", onCoocClick);
    els.motif.addEventListener("click", onMotifClick);

    // 他ビュー（分解でのタグ付け・書庫での削除等）に追随して再描画。
    // 表示中のときだけ描く＝隠れているビューの無駄な再計算を避ける。
    App.store.onChange(function(){
      if (App.currentView() === "compare") render();
    });
  }

  function show(){
    // 分解ビュー等で選んでいた作品を初期値にすると、タブを移った直後から
    // 「今研究している作品」が出ている＝選び直す手間が無い
    var cur = validWorkId(App.state.currentWorkId);
    if (!cmpA && cur) cmpA = cur;
    if (!motifWorkId) motifWorkId = cmpA || cur;
    render();
  }

  function render(){
    renderCompare();
    renderCooccurrence();
    renderMotif();
  }

  /* ------------------------------------------------------------------
     データ小道具（anatomy.js の階層走査と同じ考え方を共有する）
     ------------------------------------------------------------------ */

  /** 実在する作品idだけを通す（削除済みidが状態に残っても壊れないように）*/
  function validWorkId(id){
    return (id && App.store.byId("works", id)) ? id : null;
  }

  /** 同じ親を持つ兄弟ノードを order 昇順で返す */
  function childrenOf(workId, parentId){
    return App.store.get().nodes.filter(function(n){
      return n.workId === workId && (n.parentId || null) === (parentId || null);
    }).sort(function(a, b){ return (a.order || 0) - (b.order || 0); });
  }

  /** 作品内を親子で深さ優先に平坦化（＝作品内の読み順）。anatomy.js と同一方式 */
  function flatten(workId){
    var out = [];
    (function walk(parentId){
      childrenOf(workId, parentId).forEach(function(n){
        out.push(n);
        walk(n.id);
      });
    })(null);
    return out;
  }

  /** 作品内の場面（type=="場面"）を作品内の順で返す */
  function scenesInOrder(workId){
    return flatten(workId).filter(function(n){ return n.type === "場面"; });
  }

  /** 全作品の場面（作品をまたぐ統計用）*/
  function allScenes(){
    return App.store.get().nodes.filter(function(n){ return n.type === "場面"; });
  }

  /** 作品セレクタの option 群を作る（selectedId が選択済みになる）*/
  function workOptions(selectedId, emptyLabel){
    var html = '<option value="">' + App.util.esc(emptyLabel || "— 選択 —") + '</option>';
    App.store.get().works.forEach(function(w){
      var label = w.title + (w.author ? "／" + w.author : "");
      html += '<option value="' + App.util.esc(w.id) + '"' +
              (w.id === selectedId ? " selected" : "") + '>' +
              App.util.esc(label) + '</option>';
    });
    return html;
  }

  /** タグid配列 → {tagId: 件数} の集計（共通処理を1箇所に）*/
  function countTags(nodes, filterFn){
    var counts = {};
    nodes.forEach(function(n){
      (n.tagIds || []).forEach(function(id){
        var tag = App.store.byId("tags", id);
        if (!tag) return;                       // 削除済みタグのidは無視
        if (filterFn && !filterFn(tag)) return;
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return counts;
  }

  /** {id:件数} → [{id,n}] を多い順に */
  function sortedPairs(counts){
    return Object.keys(counts).map(function(id){
      return { id: id, n: counts[id] };
    }).sort(function(a, b){ return b.n - a.n; });
  }

  /** タグが技法タグか（構成/演出/言葉遣い）*/
  function isTech(tag){ return tag && TECH_CATEGORIES.indexOf(tag.category) !== -1; }
  /** タグが効果タグか */
  function isEffect(tag){ return tag && tag.category === "効果"; }

  /** チップHTMLに件数を添える（tagChipHtml を必ず経由する＝色分けを一元化）*/
  function chipWithCount(tagId, n, mark){
    var chip = App.tagChipHtml(tagId);
    if (!chip) return "";
    var suffix = (mark ? " " + mark : "") + " (" + n + ")";
    return chip.replace("</span>", App.util.esc(suffix) + "</span>");
  }

  /* ==================================================================
     ① 作品間比較
     ================================================================== */
  function renderCompare(){
    var works = App.store.get().works;
    if (!works.length){
      els.cmp.innerHTML =
        '<p class="overline">作品がありません。まず「書庫」で登録してください。</p>';
      return;
    }

    cmpA = validWorkId(cmpA);
    cmpB = validWorkId(cmpB);

    var html =
      '<div class="cmp-pickers">' +
        '<div class="field">' +
          '<label for="cmp-sel-a">作品A</label>' +
          '<select class="select" id="cmp-sel-a">' + workOptions(cmpA, "— 作品Aを選ぶ —") + '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label for="cmp-sel-b">作品B</label>' +
          '<select class="select" id="cmp-sel-b">' + workOptions(cmpB, "— 作品Bを選ぶ —") + '</select>' +
        '</div>' +
      '</div>';

    if (!cmpA && !cmpB){
      html += '<p class="overline">2作を選ぶと、4軸のカーブ（緊張・推進・密度・情動）・各軸の平均・' +
              '基本情報・タグ構成を並べて比較できます。</p>';
      els.cmp.innerHTML = html;
      bindCompare();
      return;
    }

    // 軸の切替はA/B共通なので、カードより前に1つだけ置く
    html += axisSwitchHtml();

    // タグ構成は A/B の突き合わせが要るので先に両方集計する
    var topA = cmpA ? sortedPairs(countTags(scenesInOrder(cmpA))).slice(0, TAG_TOP_N) : [];
    var topB = cmpB ? sortedPairs(countTags(scenesInOrder(cmpB))).slice(0, TAG_TOP_N) : [];
    var setA = {}; topA.forEach(function(p){ setA[p.id] = true; });
    var setB = {}; topB.forEach(function(p){ setB[p.id] = true; });

    // 上下に並べる＝375px幅でも横スクロールが出ない（縦積みが既定）
    html += '<div class="cmp-side">' + workPanelHtml("A", cmpA, setA, setB) + '</div>';
    html += '<div class="cmp-side">' + workPanelHtml("B", cmpB, setB, setA) + '</div>';
    html += '<p class="cmp-note">印の意味: ● = A・B 両方に付いているタグ／◀ = Aのみ／▶ = Bのみ。' +
            '緊張度カーブの横幅は場面数で正規化しているので、場面数の違う作品どうしでも形を比べられます。</p>';

    els.cmp.innerHTML = html;
    bindCompare();
  }

  /** 片側（A or B）のパネル。mine=自分側の上位タグ集合、other=相手側の集合 */
  function workPanelHtml(side, workId, mine, other){
    var label = "作品" + side;
    if (!workId){
      return '<div class="cmp-card card card--soft">' +
             '<div class="cmp-card__head">' + label + '</div>' +
             '<p class="overline">未選択です。</p></div>';
    }

    var work = App.store.byId("works", workId);
    var scenes = scenesInOrder(workId);

    var head = '<div class="cmp-card__head">' + label + '：' +
               App.util.esc(work.title || "（無題）") +
               (work.author ? '<span class="cmp-card__author">／' + App.util.esc(work.author) + '</span>' : "") +
               '</div>';

    if (!scenes.length){
      return '<div class="cmp-card card card--soft">' + head +
             '<p class="overline">まだ分解されていません。「分解」ビューで場面を追加すると比較できます。</p>' +
             '</div>';
    }

    return '<div class="cmp-card card card--soft">' + head +
           curveHtml(scenes) +
           axisAveragesHtml(scenes) +
           basicsHtml(work, scenes) +
           tagMixHtml(workId, side, mine, other) +
           '</div>';
  }

  /* ------------------------------------------------------------------
     場面の軸（緊張・推進・密度・情動）。定義は data/scene-axes.js が真実。
     「なぜハードコードしないか」: 軸が増えたとき比較だけ古い定義のままだと、
     同じ棒が分解ビューと別の意味になる（研究の道具として致命的）。
     scene-axes.js が無い環境でも従来どおり緊張だけで動くよう保険を持つ。
     ------------------------------------------------------------------ */
  var AXIS_FALLBACK = [{ key: "tension", label: "緊張", color: "var(--accent)" }];
  function axisDefs(){
    var d = (window.App && window.App.sceneAxes) || [];
    return (d && d.length) ? d : AXIS_FALLBACK;
  }
  function axisDef(key){
    var d = axisDefs();
    for (var i = 0; i < d.length; i++){ if (d[i].key === key) return d[i]; }
    return d[0];
  }
  // 表示中の軸（保存しない＝見方の一時的な好み。データではない）
  var curAxis = (window.App && App.sceneAxisDefault) || "tension";

  /** 未記入か（0＝測って低い／null＝測っていない を必ず区別する）*/
  function isNullAxis(n, key){
    var v = n[key];
    return (v === null || v === undefined || v === "" || isNaN(Number(v)));
  }

  /** 軸の切替ボタン列（A/B両方のカーブに同時に効く）*/
  function axisSwitchHtml(){
    var btns = axisDefs().map(function(a){
      var on = (a.key === curAxis) ? " is-on" : "";
      return '<button type="button" class="btn btn--sm cmp-axis-btn' + on + '"' +
             ' data-axis="' + App.util.esc(a.key) + '">' + App.util.esc(a.label) + '</button>';
    }).join("");
    return '<div class="cmp-axis-switch"><span class="overline">見る軸</span>' + btns + '</div>';
  }

  /** 選択中の軸のカーブ（棒グラフ）。場面数の違う作品を並べるため
      各棒の横幅は flex で100%に正規化する */
  function curveHtml(scenes){
    var def = axisDef(curAxis);
    var bars = "";
    scenes.forEach(function(n, i){
      var isNull = isNullAxis(n, curAxis);
      // null は低い点線枠＝「測っていない」ことを 0 と区別して見せる
      var h = isNull ? 8 : Math.max(4, Math.min(100, Number(n[curAxis])));
      var t = (i + 1) + ". " + (n.title || "（無題）") +
              (isNull ? "（" + def.label + "の記入なし）" : "（" + def.label + h + "）");
      bars += '<div class="cmp-seg' + (isNull ? " is-null" : "") + '"' +
              ' style="height:' + h + '%' + (isNull ? '' : ';background:' + def.color) + '"' +
              ' data-node-id="' + App.util.esc(n.id) + '"' +
              ' title="' + App.util.esc(t) + '"></div>';
    });
    return '<div class="cmp-curve">' +
             '<div class="cmp-sub">' + App.util.esc(def.label) +
               'のカーブ（全' + scenes.length + '場面／棒をタップすると分解へ）</div>' +
             '<div class="cmp-bar">' + bars + '</div>' +
           '</div>';
  }

  /** 4軸の平均値（作品の"体質"が一目で分かる。多軸化の主目的）。
      null は母数から除く＝測っていない場面に引きずられない */
  function axisAveragesHtml(scenes){
    var rows = axisDefs().map(function(a){
      var vals = scenes.filter(function(n){ return !isNullAxis(n, a.key); })
                       .map(function(n){ return Number(n[a.key]); });
      if (!vals.length){
        return '<div class="cmp-avg-row"><span class="cmp-avg-label">' +
               App.util.esc(a.label) + '</span><span class="cmp-avg-none">未記入</span></div>';
      }
      var avg = Math.round(vals.reduce(function(s, x){ return s + x; }, 0) / vals.length);
      return '<div class="cmp-avg-row">' +
               '<span class="cmp-avg-label">' + App.util.esc(a.label) + '</span>' +
               '<span class="cmp-avg-bar"><span style="width:' + avg + '%;background:' +
                 a.color + '"></span></span>' +
               '<span class="cmp-avg-num">' + avg + '</span>' +
               '<span class="cmp-avg-n">(' + vals.length + '場面)</span>' +
             '</div>';
    }).join("");
    return '<div class="cmp-averages">' +
             '<div class="cmp-sub">各軸の平均（作品の体質）</div>' + rows +
           '</div>';
  }

  /** 基本情報（種別/長さ/場面数/合計文字数/作品タグ）*/
  function basicsHtml(work, scenes){
    var axes = work.axes || {};
    // 合計文字数は自作品の fullText が主。名著は要約＋引用しか無いので
    // それらも足して「記録量」として見えるようにする（研究上の目安）
    var chars = 0;
    scenes.forEach(function(n){
      chars += (n.fullText || "").length;
      chars += (n.summary || "").length;
      chars += (n.quoteText || "").length;
    });

    var rows =
      row("種別", axes.kind || "—") +
      row("長さ", axes.length || "—") +
      row("場面数", String(scenes.length)) +
      row("合計文字数", chars.toLocaleString("ja-JP") + " 字（全文＋要約＋引用）");

    var wtags = (work.tagIds || []).map(function(id){ return App.tagChipHtml(id); })
                                   .filter(Boolean).join(" ");
    rows += '<tr><th>作品タグ</th><td>' +
            (wtags ? '<div class="tag-row">' + wtags + '</div>' : "—") + '</td></tr>';

    return '<div class="cmp-basics">' +
             '<div class="cmp-sub">基本情報</div>' +
             '<div class="table-wrap"><table class="table"><tbody>' + rows +
             '</tbody></table></div>' +
           '</div>';

    function row(k, v){
      return '<tr><th>' + App.util.esc(k) + '</th><td>' + App.util.esc(v) + '</td></tr>';
    }
  }

  /** タグ構成（上位10・共通/片方だけの印つき）*/
  function tagMixHtml(workId, side, mine, other){
    var pairs = sortedPairs(countTags(scenesInOrder(workId))).slice(0, TAG_TOP_N);
    if (!pairs.length){
      return '<div class="cmp-tags"><div class="cmp-sub">タグ構成</div>' +
             '<p class="overline">場面にタグがまだ付いていません。</p></div>';
    }
    var chips = pairs.map(function(p){
      // ● = 両方に登場／◀ = Aのみ／▶ = Bのみ。記号にしたのは
      // 色だけに頼らず（色覚差・白黒印刷でも）区別できるようにするため
      var mark = other[p.id] ? "●" : (side === "A" ? "◀" : "▶");
      return chipWithCount(p.id, p.n, mark);
    }).filter(Boolean).join(" ");
    return '<div class="cmp-tags">' +
             '<div class="cmp-sub">タグ構成（多い順・上位' + TAG_TOP_N + '）</div>' +
             '<div class="tag-row">' + chips + '</div>' +
           '</div>';
  }

  function bindCompare(){
    var selA = els.cmp.querySelector("#cmp-sel-a");
    var selB = els.cmp.querySelector("#cmp-sel-b");
    if (selA) selA.addEventListener("change", function(){
      cmpA = this.value || null;
      renderCompare();
    });
    if (selB) selB.addEventListener("change", function(){
      cmpB = this.value || null;
      renderCompare();
    });

  }

  /** 棒タップ→その場面を分解ビューで開く（ビュー間連携の契約どおり
      currentWorkId/currentNodeId を立ててから showView する）*/
  function onCompareClick(ev){
    // 軸の切替（A/B両方のカーブに同時に効く。棒の判定より先に処理する）
    var ab = ev.target.closest ? ev.target.closest(".cmp-axis-btn[data-axis]") : null;
    if (ab){
      curAxis = ab.getAttribute("data-axis");
      renderCompare();
      return;
    }
    var seg = ev.target.closest ? ev.target.closest(".cmp-seg[data-node-id]") : null;
    if (!seg) return;
    jumpToNode(seg.getAttribute("data-node-id"));
  }

  /** 指定ノードを分解ビューで開く（②③の帯からも使う共通処理）*/
  function jumpToNode(nodeId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    App.state.currentWorkId = node.workId;
    App.state.currentNodeId = node.id;
    App.showView("anatomy");
  }

  /* ==================================================================
     ② タグ共起統計（技法↔効果）
     ================================================================== */
  function renderCooccurrence(){
    var scenes = allScenes();
    if (!scenes.length){
      els.cooc.innerHTML =
        '<p class="overline">分解された場面がまだありません。「分解」ビューで場面を追加してください。</p>';
      return;
    }

    // 選べるタグは「実際に場面に付いているもの」だけに絞る。
    // 使われていないタグを並べても統計にならないため。
    var usedTech   = sortedPairs(countTags(scenes, isTech));
    var usedEffect = sortedPairs(countTags(scenes, isEffect));
    var list = (coDir === "tech") ? usedTech : usedEffect;

    // 方向を切り替えたとき、前の方向のタグidが残っていると空表示になるので補正
    if (coTagId && !list.some(function(p){ return p.id === coTagId; })) coTagId = null;
    if (!coTagId && list.length) coTagId = list[0].id;

    var html =
      '<p class="cmp-warn">件数が少ないうちは参考値。母数を見て判断すること。</p>' +
      '<div class="cmp-dir">' +
        dirBtn("tech",   "技法 → 効果") +
        dirBtn("effect", "効果 → 技法（逆引き）") +
      '</div>';

    if (!list.length){
      html += '<p class="overline">' +
              (coDir === "tech" ? "場面に付いた技法タグがありません。" : "場面に付いた効果タグがありません。") +
              '</p>';
      els.cooc.innerHTML = html;
      bindCooc();
      return;
    }

    html +=
      '<div class="field">' +
        '<label for="cmp-co-sel">' + (coDir === "tech" ? "技法タグ" : "効果タグ") + 'を選ぶ</label>' +
        '<select class="select" id="cmp-co-sel">' +
          list.map(function(p){
            var tag = App.store.byId("tags", p.id);
            return '<option value="' + App.util.esc(p.id) + '"' +
                   (p.id === coTagId ? " selected" : "") + '>' +
                   App.util.esc((tag ? tag.name : "?") + "（" + p.n + "場面）") + '</option>';
          }).join("") +
        '</select>' +
      '</div>';

    html += coocTableHtml(scenes);
    els.cooc.innerHTML = html;
    bindCooc();
  }

  function dirBtn(dir, label){
    var active = (coDir === dir) ? " btn--primary" : "";
    return '<button type="button" class="btn btn--sm' + active + '" data-dir="' + dir + '">' +
           App.util.esc(label) + '</button>';
  }

  /** 選択タグが付いた場面を母数に、反対カテゴリのタグの共起件数と割合を出す */
  function coocTableHtml(scenes){
    var base = scenes.filter(function(n){
      return (n.tagIds || []).indexOf(coTagId) !== -1;
    });
    var total = base.length;
    var tag = App.store.byId("tags", coTagId);
    if (!total){
      return '<p class="overline">このタグが付いた場面はありません。</p>';
    }

    // 技法を選んだら効果を集計、効果を選んだら技法を集計（逆引き）
    var wantFn = (coDir === "tech") ? isEffect : isTech;
    var pairs = sortedPairs(countTags(base, wantFn));
    var head = '<div class="cmp-sub">' +
               App.util.esc(tag ? tag.name : "") + ' が付いた場面：<strong>' + total + '</strong> 件' +
               '（母数）</div>';

    if (!pairs.length){
      return head + '<p class="overline">共起する' +
             (coDir === "tech" ? "効果" : "技法") + 'タグはありません。</p>';
    }

    var rows = pairs.map(function(p){
      var pct = Math.round((p.n / total) * 1000) / 10;   // 小数第1位まで
      return '<tr>' +
        '<td><div class="tag-row">' + App.tagChipHtml(p.id) + '</div></td>' +
        '<td class="num">' + p.n + '</td>' +
        '<td class="num">' + pct + '%</td>' +
        // 割合の棒。数字だけより「どれが突出しているか」が一目で分かる
        '<td><div class="cmp-ratio"><span style="width:' + pct + '%"></span></div></td>' +
      '</tr>';
    }).join("");

    return head +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>' + (coDir === "tech" ? "共起した効果タグ" : "この効果を生んでいる技法タグ") + '</th>' +
        '<th class="num">件数</th><th class="num">割合</th><th>　</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /** 方向切替ボタン（技法→効果 / 効果→技法）。委譲なので init で1回だけ結線 */
  function onCoocClick(ev){
    var btn = ev.target.closest ? ev.target.closest("[data-dir]") : null;
    if (!btn) return;
    coDir = btn.getAttribute("data-dir");
    coTagId = null;                 // 方向が変わればタグも選び直し
    renderCooccurrence();
  }

  function bindCooc(){
    var sel = els.cooc.querySelector("#cmp-co-sel");
    if (sel) sel.addEventListener("change", function(){
      coTagId = this.value || null;
      renderCooccurrence();
    });
  }

  /* ==================================================================
     ③ モチーフ出現マップ
     ================================================================== */
  function renderMotif(){
    var works = App.store.get().works;
    if (!works.length){
      els.motif.innerHTML = '<p class="overline">作品がありません。</p>';
      return;
    }
    motifWorkId = validWorkId(motifWorkId);

    var html =
      '<p class="cmp-note">同じモチーフ（言葉）が作中のどこで再出現するかを見る道具です。</p>' +
      '<div class="cmp-pickers">' +
        '<div class="field">' +
          '<label for="cmp-mo-work">作品</label>' +
          '<select class="select" id="cmp-mo-work">' + workOptions(motifWorkId, "— 作品を選ぶ —") + '</select>' +
        '</div>' +
        '<div class="field">' +
          '<label for="cmp-mo-words">キーワード（カンマ区切りで複数可）</label>' +
          '<input type="text" class="input" id="cmp-mo-words" placeholder="例: 氷, 雨" value="' +
            App.util.esc(motifWords) + '">' +
        '</div>' +
      '</div>' +
      '<div class="cmp-mo-actions"><button type="button" class="btn btn--primary btn--sm" id="cmp-mo-go">帯を描く</button></div>' +
      '<div id="cmp-mo-out"></div>';

    els.motif.innerHTML = html;
    bindMotif();
    renderMotifBands();
  }

  function renderMotifBands(){
    var out = els.motif.querySelector("#cmp-mo-out");
    if (!out) return;

    if (!motifWorkId){
      out.innerHTML = '<p class="overline">作品を選んでください。</p>';
      return;
    }
    var scenes = scenesInOrder(motifWorkId);
    if (!scenes.length){
      out.innerHTML = '<p class="overline">まだ分解されていません。「分解」ビューで場面を追加してください。</p>';
      return;
    }

    var words = motifWords.split(/[,、]/).map(function(s){ return s.trim(); })
                          .filter(function(s){ return s.length > 0; });
    if (!words.length){
      out.innerHTML = '<p class="overline">キーワードを入力してください（例: 氷, 雨）。</p>';
      return;
    }

    var html = "";
    words.forEach(function(w){
      var hitScenes = 0, hitTotal = 0, cells = "";
      scenes.forEach(function(n, i){
        // 要約・引用・全文をまとめて走査する（名著は要約/引用しか無いため）
        var hay = (n.summary || "") + "\n" + (n.quoteText || "") + "\n" + (n.fullText || "");
        var c = countOccurrences(hay, w);
        if (c > 0){ hitScenes++; hitTotal += c; }
        var t = (i + 1) + ". " + (n.title || "（無題）") + "：" + c + "回";
        cells += '<div class="cmp-mo-cell' + (c > 0 ? " hit" : "") + '"' +
                 ' data-node-id="' + App.util.esc(n.id) + '"' +
                 ' title="' + App.util.esc(t) + '">' +
                 (c > 0 ? '<span class="cmp-mo-n">' + c + '</span>' : "") +
                 '</div>';
      });
      html +=
        '<div class="cmp-mo-band">' +
          '<div class="cmp-sub">「' + App.util.esc(w) + '」— ' +
            hitScenes + '/' + scenes.length + ' 場面に出現（延べ ' + hitTotal + ' 回）</div>' +
          '<div class="cmp-mo-row">' + cells + '</div>' +
        '</div>';
    });

    out.innerHTML = html;
  }

  /** 文字列 hay の中の needle の出現回数。indexOf を進めて数える
      （正規表現だとユーザー入力の記号がメタ文字として誤爆するため）*/
  function countOccurrences(hay, needle){
    if (!hay || !needle) return 0;
    var n = 0, i = hay.indexOf(needle);
    while (i !== -1){
      n++;
      i = hay.indexOf(needle, i + needle.length);
    }
    return n;
  }

  function bindMotif(){
    var selW = els.motif.querySelector("#cmp-mo-work");
    if (selW) selW.addEventListener("change", function(){
      motifWorkId = this.value || null;
      renderMotifBands();
    });

    var input = els.motif.querySelector("#cmp-mo-words");
    if (input){
      // 入力のたびに全文走査すると重いので間引く（debounce は App.util の共通品）
      var run = App.util.debounce(function(){ renderMotifBands(); }, 300);
      input.addEventListener("input", function(){
        motifWords = this.value;
        run();
      });
    }

    var go = els.motif.querySelector("#cmp-mo-go");
    if (go) go.addEventListener("click", function(){
      var el = els.motif.querySelector("#cmp-mo-words");
      if (el) motifWords = el.value;
      renderMotifBands();
    });

  }

  /** 帯のマスをタップ→その場面を分解ビューで開く */
  function onMotifClick(ev){
    var cell = ev.target.closest ? ev.target.closest(".cmp-mo-cell[data-node-id]") : null;
    if (!cell) return;
    jumpToNode(cell.getAttribute("data-node-id"));
  }

  /* ==================================================================
     登録（設計 §4：id/order は本書と一致させる）
     ================================================================== */
  App.registerView({
    id: "compare",
    title: "比較・統計",
    order: 70,
    init: init,
    show: show
  });

})();
