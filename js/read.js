/* ==========================================================================
   read.js — 通読ビュー（id:read / order:25 / タブ「通読」）
   分解(anatomy)で記録した結果を「読むため」の読み取り専用ビュー。
   「なぜ必要か」: 分解ビューはツリー＋編集フォームという密度の高い“記録の道具”
   であり、蓄積した場面を通しで読む用途には向かない。研究ノートとして頭から
   読める場所を分けることで、記録と読解を別の姿勢で行えるようにする。
   ★このビューはデータを一切変更しない（store の add/update/remove を呼ばない）。
   設計.txt §4/§5/§6 準拠。
   ========================================================================== */
(function(){
  "use strict";

  var App = window.App;

  // ★ビュー間の選択共有：どのファイルが先に走っても壊れないよう毎回保証する
  App.state = App.state || {};

  // init で作った器への参照
  var els = {};

  /* 表示の調整（保存はしない＝読むための一時的な好み。設計上データに残す価値が
     無く、localStorage を汚さない方が読み取り専用の性格に合う）。
     density: "summary"（要約のみ）/ "quote"（引用も見る・既定）/ "research"（研究記録も） */
  var st = {
    density: "quote",
    // 構成バーで見ている軸と重ね表示（表示の好みなので保存しない）
    axis: (window.App && App.sceneAxisDefault) || "tension",
    overlay: false
  };

  /* ------------------------------------------------------------------
     場面の軸（緊張・推進・密度・情動）— 定義は data/scene-axes.js が真実。
     「なぜここでも書くか」: このビューは読み取り専用で anatomy.js の内部関数に
     触れられない（公開APIが無い）。ただし定義そのものは必ず App.sceneAxes から
     読む＝軸の一覧・色・順序が分解とズレることは無い。
     ★scene-axes.js が無い環境でも従来どおり「緊張だけ」で動く（後方互換）。
     ------------------------------------------------------------------ */
  var AXIS_FALLBACK = [
    { key: "tension", label: "緊張", hint: "", color: "var(--accent)" }
  ];
  function axisDefs(){
    var defs = (window.App && window.App.sceneAxes) || [];
    return (defs && defs.length) ? defs : AXIS_FALLBACK;
  }
  function axisDef(key){
    var defs = axisDefs();
    for (var i = 0; i < defs.length; i++){ if (defs[i].key === key) return defs[i]; }
    return defs[0];
  }
  /** その軸が未記入か（0＝測って低い、と厳密に区別する）*/
  function isAxisNull(n, key){
    var v = n ? n[key] : null;
    return (v === null || v === undefined || v === "" || isNaN(Number(v)));
  }
  function axisVal(n, key){ return Math.max(0, Math.min(100, Number(n[key]))); }

  // 密度トグルの選択肢（値・ラベル・そのモードで見えるもの）
  var DENSITY_OPTS = [
    { key: "summary",  label: "要約のみ" },
    { key: "quote",    label: "引用も見る" },
    { key: "research", label: "研究記録も見る" }
  ];

  // 作品カード見出しに出す軸（library.js の AXIS_LABELS と同じ並び・同じ呼び名）
  var AXIS_LABELS = {
    kind: "種別", length: "長さ", reception: "受容形態", form: "表現形式"
  };

  /* ==================================================================
     初回1回だけ：静的な骨組み
     ★root.className は上書きせず classList.add のみ（設計 §2 の既知バグ対策）
     ================================================================== */
  function init(root){
    root.classList.add("view-read");
    root.innerHTML =
      '<div class="block">' +
        '<h2 class="section-title" id="rd-title">通読</h2>' +
        '<div id="rd-top"></div>' +
        '<div id="rd-body"></div>' +
      '</div>';

    els.title = root.querySelector("#rd-title");
    els.top   = root.querySelector("#rd-top");
    els.body  = root.querySelector("#rd-body");

    // 「編集」ボタンの委譲は init で1回だけ結ぶ。
    // 「なぜ」: 描画のたびに addEventListener すると同じ器にリスナーが積み上がり、
    // 再描画の回数だけ showView が多重に走る（過去の典型的な事故）。
    els.body.addEventListener("click", onBodyClick);

    // 他ビューでの編集（分解での場面追加・書庫での削除等）に追随する。
    // 表示中のときだけ描き直す＝裏で無駄な再描画をしない。
    App.store.onChange(function(){
      if (App.currentView() === "read") render();
    });
  }

  /* 表示のたび：全部作り直す（読み取り専用＝入力欄が飛ぶ心配が無いので単純でよい）*/
  function show(){ render(); }

  function render(){
    renderTop();
    renderBody();
  }

  /* ------------------------------------------------------------------
     データ小道具（anatomy.js の走査規則をそのまま踏襲する。
     「なぜ複製するか」: anatomy.js は内部関数として閉じており公開APIが無い。
     順序の定義（order 昇順・深さ優先）が両ビューでズレると通読と分解で場面
     番号が食い違うため、同じ規則をここでも厳密に守る）
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
        walk(n.id, depth + 1);
      });
    })(null, 0);
    return out;
  }

  /** 作品内の場面（type=="場面"）を作品内の順で返す */
  function scenesInOrder(workId){
    return flatten(workId).filter(function(x){ return x.node.type === "場面"; })
                          .map(function(x){ return x.node; });
  }

  /** 緊張度が未設定か（null/undefined/空文字を等しく「なし」とみなす）*/
  function isTensionNull(n){
    return (n.tension === null || n.tension === undefined || n.tension === "");
  }

  /** 要約を「本文」と「★以降の分析文」に割る。
      「なぜ」: 蓄積データでは ★ 以降が観察・分析の私見という書き分けになって
      いる。読むときに事実の要約と分析が地続きだと頭に入りにくいので分けて出す。
      ★が無ければ全文が本文（＝従来どおり素直に出る）。 */
  function splitSummary(summary){
    var s = String(summary || "");
    var i = s.indexOf("★");
    if (i === -1) return { main: s, note: "" };
    return { main: s.slice(0, i).trim(), note: s.slice(i + 1).trim() };
  }

  /* ------------------------------------------------------------------
     上部：作品セレクタ＋作品の見出し＋緊張度カーブ＋集計
     ------------------------------------------------------------------ */
  function renderTop(){
    var works = App.store.get().works;

    if (works.length === 0){
      els.title.textContent = "通読";
      els.top.innerHTML =
        '<div class="rd-empty">' +
          '<p>まだ作品がありません。<br>「書庫」で作品を登録してください。</p>' +
          '<button type="button" class="btn btn--primary" id="rd-goto-lib">書庫へ行く</button>' +
        '</div>';
      var b = els.top.querySelector("#rd-goto-lib");
      if (b) b.addEventListener("click", function(){ App.showView("library"); });
      return;
    }

    var curId = currentWorkId() || works[0].id;
    // 初期値が未設定なら先頭作品を共有状態に入れておく（他ビューと選択を揃える）
    App.state.currentWorkId = curId;

    // 選択肢に場面数を添える＝「どれが分解済みか」を選ぶ前に分かるようにする
    var opts = works.map(function(w){
      var count = scenesInOrder(w.id).length;
      var label = w.title + (w.author ? "／" + w.author : "") + "（" + count + "場面）";
      return '<option value="' + App.util.esc(w.id) + '"' +
             (w.id === curId ? " selected" : "") + '>' +
             App.util.esc(label) + '</option>';
    }).join("");

    var work = App.store.byId("works", curId);
    els.title.textContent = "通読：" + work.title;

    els.top.innerHTML =
      '<div class="field">' +
        '<label for="rd-work-select">読む作品</label>' +
        '<select class="select" id="rd-work-select">' + opts + '</select>' +
      '</div>' +
      workHeadHtml(work) +
      arcHtml(curId) +
      statsHtml(curId) +
      densityHtml() +
      '<div class="rd-tools">' +
        '<button type="button" class="btn btn--sm" id="rd-export-btn">⇩ 研究ノートを書き出し</button>' +
      '</div>' +
      (st.exportOpen ? exportPanelHtml() : "");

    els.top.querySelector("#rd-work-select").addEventListener("change", function(){
      App.state.currentWorkId = this.value;
      st.exportOpen = false;      // 作品が変われば書き出しパネルは畳む（誤爆防止）
      render();
    });

    // 緊張度カーブ：棒をタップで該当場面へスクロール（読むための画面なので選択でなく移動）
    var bar = els.top.querySelector(".rd-arc .arc-bar");
    if (bar){
      bar.addEventListener("click", function(ev){
        var seg = ev.target.closest("[data-scene]");
        if (seg) scrollToScene(seg.getAttribute("data-scene"));
      });
    }

    // 密度トグル
    var dens = els.top.querySelector("#rd-density");
    if (dens){
      dens.addEventListener("click", function(ev){
        var b2 = ev.target.closest("[data-density]");
        if (!b2) return;
        st.density = b2.getAttribute("data-density");
        render();
      });
    }

    // 書き出しパネルの開閉（confirm を重ねず選択肢を並べて見せる＝writing.js と同じ流儀）
    els.top.querySelector("#rd-export-btn").addEventListener("click", function(){
      st.exportOpen = !st.exportOpen;
      renderTop();
    });
    var txtBtn = els.top.querySelector("#rd-export-txt");
    if (txtBtn) txtBtn.addEventListener("click", function(){ exportNoteText(work); });
    var htmlBtn = els.top.querySelector("#rd-export-html");
    if (htmlBtn) htmlBtn.addEventListener("click", function(){ exportNoteHtml(work); });
  }

  /** 作品の見出し（題名・著者・年・軸チップ・作品タグ・あらすじ）*/
  function workHeadHtml(work){
    var meta = [];
    if (work.author) meta.push(App.util.esc(work.author));
    if (work.year)   meta.push(App.util.esc(work.year));
    if (work.isOwn)  meta.push("自作");

    var axes = work.axes || {};
    var axisChips = Object.keys(AXIS_LABELS).map(function(k){
      if (!axes[k]) return "";
      return '<span class="rd-axis">' + App.util.esc(AXIS_LABELS[k]) + "：" +
             App.util.esc(axes[k]) + '</span>';
    }).join("");

    // 作品全体の構成タグ（チップは共通部品 App.tagChipHtml のみを使う）
    var tags = (Array.isArray(work.tagIds) ? work.tagIds : [])
      .map(function(id){ return App.tagChipHtml(id); }).join("");

    var html = '<div class="rd-workhead">';
    html += '<div class="rd-workhead__title">' + App.util.esc(work.title || "（無題）") + '</div>';
    if (meta.length) html += '<div class="rd-workhead__meta">' + meta.join("／") + '</div>';
    if (axisChips) html += '<div class="rd-axes">' + axisChips + '</div>';
    if (tags) html += '<div class="tag-row rd-worktags">' + tags + '</div>';
    if (work.note){
      // あらすじは長いことがあるので折りたたむ（既定は開＝読むための画面だから）
      html += '<details class="rd-note" open><summary>あらすじ・メモ</summary>' +
              '<div class="rd-note__body">' + App.util.esc(work.note) + '</div></details>';
    }
    html += '</div>';
    return html;
  }

  /** 構成カーブ（anatomy の構成バーと同じ考え方。ここでは棒＝該当場面への移動）*/
  function arcHtml(workId){
    var scenes = scenesInOrder(workId);
    if (scenes.length === 0) return "";

    var def = axisDef(st.axis);
    st.axis = def.key;                        // 不明キーの自己修復
    var title = st.overlay
      ? "構成カーブ（4軸を重ねて表示・全" + scenes.length + "場面／棒をタップでその場面へ移動）"
      : def.label + "カーブ（全" + scenes.length + "場面／棒をタップでその場面へ移動）";

    var labels = "";
    scenes.forEach(function(n, i){
      var pol = polSign(n.polarity);
      labels += '<div class="arc-lab">' + (i + 1) +
                (pol ? '<span class="arc-pol">' + pol + '</span>' : "") + '</div>';
    });

    return '<div class="arc-wrap rd-arc">' +
      '<div class="arc-title">' + App.util.esc(title) + '</div>' +
      axisSwitchHtml(st.axis, st.overlay) +
      (st.overlay ? overlayBarHtml(scenes) : singleBarHtml(scenes, def)) +
      '<div class="arc-labels">' + labels + '</div>' +
      '</div>';
  }

  /* 軸の切替UI（分解ビューと同じ見た目・同じ操作＝迷わないように揃える）*/
  function axisSwitchHtml(activeKey, overlay){
    var btns = axisDefs().map(function(a){
      var on = (!overlay && a.key === activeKey);
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

  function axisLegendHtml(){
    var items = axisDefs().map(function(a){
      return '<span class="axis-legend__item">' +
               '<i class="axis-legend__swatch" style="background:' + a.color + '"></i>' +
               App.util.esc(a.label) +
             '</span>';
    }).join("");
    return '<div class="axis-legend">' + items + '</div>';
  }

  /* 単軸の棒（未記入は点線の空枠＝0 と区別する）*/
  function singleBarHtml(scenes, def){
    var bars = scenes.map(function(n){
      var t = App.util.esc(n.title || "");
      if (isAxisNull(n, def.key)){
        return '<div class="arc-seg is-empty" data-scene="' + App.util.esc(n.id) + '" ' +
               'title="' + t + '（' + App.util.esc(def.label) + ' 未記入）"></div>';
      }
      var v = axisVal(n, def.key);
      return '<div class="arc-seg" style="height:' + Math.max(4, v) + '%;' +
             'background:' + def.color + '" data-scene="' + App.util.esc(n.id) + '" ' +
             'title="' + t + '（' + App.util.esc(def.label) + ' ' + v + '）"></div>';
    }).join("");
    return '<div class="arc-bar">' + bars + '</div>';
  }

  /* 重ね表示：場面ごとに4本の細い棒を並べる */
  function overlayBarHtml(scenes){
    var defs = axisDefs();
    var groups = scenes.map(function(n){
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
      return '<div class="arc-group" data-scene="' + App.util.esc(n.id) + '" ' +
             'title="' + App.util.esc(n.title || "") + '">' + inner + '</div>';
    }).join("");
    return '<div class="arc-bar arc-bar--overlay">' + groups + '</div>';
  }

  /** 軸ごとの平均（null は母数から除く）。値が1つも無ければ null */
  function axisAverage(scenes, key){
    var vals = scenes.filter(function(n){ return !isAxisNull(n, key); })
                     .map(function(n){ return axisVal(n, key); });
    if (!vals.length) return null;
    return Math.round(vals.reduce(function(a, b){ return a + b; }, 0) / vals.length);
  }

  /** 極性文字列から下ラベル用の記号（+ / − / =）を導く（anatomy と同じ規則）*/
  function polSign(pol){
    if (!pol) return "";
    if (pol === "変化なし") return "=";
    var end = pol.split("→").pop();
    if (end.indexOf("+") !== -1) return "+";
    if (end.indexOf("-") !== -1) return "−";
    return "";
  }

  /** 集計の一行（総場面数・記入済み・平均緊張度・よく使うタグ上位5）*/
  function statsHtml(workId){
    var scenes = scenesInOrder(workId);
    if (scenes.length === 0) return "";

    var written = scenes.filter(function(n){
      return String(n.summary || "").trim() !== "";
    }).length;

    // 集計は「今見ている軸」に追随させる（重ね表示のときは4軸すべて並べる）。
    // 「なぜ」: グラフが推進なのに平均だけ緊張、では読み違える。
    var avgText;
    if (st.overlay){
      avgText = axisDefs().map(function(a){
        var v = axisAverage(scenes, a.key);
        return "平均" + a.label + " " + (v === null ? "—" : v);
      }).join("／");
    } else {
      var def = axisDef(st.axis);
      var avg = axisAverage(scenes, def.key);
      avgText = "平均" + def.label + " " + (avg === null ? "—" : avg);
    }

    // タグ出現数を数えて上位5件（研究の関心がどこに寄っているかの見取り図）
    var counts = {};
    scenes.forEach(function(n){
      (Array.isArray(n.tagIds) ? n.tagIds : []).forEach(function(id){
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    var top = Object.keys(counts)
      .sort(function(a, b){ return counts[b] - counts[a]; })
      .slice(0, 5)
      .map(function(id){
        var chip = App.tagChipHtml(id);      // 削除済みタグは空文字＝描かない
        return chip ? '<span class="rd-topchip">' + chip +
               '<span class="rd-topcount">×' + counts[id] + '</span></span>' : "";
      }).join("");

    var line = '総場面数 ' + scenes.length +
               '／記入済み ' + written +
               '／' + avgText;

    return '<div class="rd-stats">' +
             // 軸ラベルはデータ由来なので必ず esc を通す
             '<span class="rd-stats__line">' + App.util.esc(line) + '</span>' +
             (top ? '<span class="rd-stats__tags">よく使うタグ：' + top + '</span>' : "") +
           '</div>';
  }

  /** 密度トグル（3段階）*/
  function densityHtml(){
    var btns = DENSITY_OPTS.map(function(o){
      var on = (st.density === o.key);
      return '<button type="button" class="btn btn--sm ' +
             (on ? "btn--primary" : "btn--ghost") + '" data-density="' + o.key + '"' +
             (on ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + o.label + '</button>';
    }).join("");
    return '<div class="rd-density" id="rd-density">' +
             '<span class="overline">表示の詳しさ</span>' + btns +
           '</div>';
  }

  function exportPanelHtml(){
    return '<div class="rd-export-panel">' +
      '<p class="overline">形式を選んで書き出します</p>' +
      '<div class="rd-export-btns">' +
        '<button type="button" class="btn btn--sm" id="rd-export-txt">テキスト（.txt）</button>' +
        '<button type="button" class="btn btn--sm" id="rd-export-html">印刷用HTML（.html）</button>' +
      '</div>' +
      '<p class="rd-export-note">' +
        'テキストはUTF-8（BOM付き＝Windowsのメモ帳で文字化けしません）。<br>' +
        '印刷用HTMLは外部に一切依存しない1ファイルです。ブラウザで開いて印刷（Ctrl+P）→' +
        '「PDFとして保存」でPDF化できます。' +
      '</p>' +
    '</div>';
  }

  /* ------------------------------------------------------------------
     本体：連続した研究ノートとして読む
     ------------------------------------------------------------------ */
  function renderBody(){
    var workId = currentWorkId();
    if (!workId){ els.body.innerHTML = ""; return; }

    var scenes = scenesInOrder(workId);
    if (scenes.length === 0){
      els.body.innerHTML =
        '<div class="rd-empty">' +
          '<p>この作品はまだ分解されていません。<br>「分解」タブで場面を作れます。</p>' +
          '<button type="button" class="btn btn--primary" id="rd-goto-ana">分解へ行く</button>' +
        '</div>';
      var b = els.body.querySelector("#rd-goto-ana");
      if (b) b.addEventListener("click", function(){ App.showView("anatomy"); });
      return;
    }

    // 場面の通し番号は「作品内の順（深さ優先）」で振る＝緊張度カーブの番号と一致させる
    var counter = { n: 0 };
    els.body.innerHTML = '<div class="rd-doc">' + childrenHtml(workId, null, 0, counter) + '</div>';
  }

  /** 再帰描画：部/章は <details> の見出し、場面はカード。
      「なぜ再帰か」: 階層の深さは作品ごとに違う（作品直下に場面がある作品もある）。
      平坦化して見出しを挟む方式だと入れ子の折りたたみが作れないため、
      木のままたどって <details> を入れ子にする。 */
  function childrenHtml(workId, parentId, depth, counter){
    return childrenOf(workId, parentId).map(function(n){
      if (n.type === "場面"){
        counter.n += 1;
        return sceneCardHtml(n, counter.n);
      }
      // 部・章：折りたたみ（既定は開＝長編でも最初は全部読める状態にする）
      var inner = childrenHtml(workId, n.id, depth + 1, counter);
      var sum = splitSummary(n.summary);
      var lead = "";
      if (sum.main) lead += '<p class="rd-chapter__lead">' + App.util.esc(sum.main) + '</p>';
      if (sum.note) lead += '<p class="rd-chapter__note">' + App.util.esc(sum.note) + '</p>';
      return '<details class="rd-chapter rd-depth-' + Math.min(depth, 3) + '" open>' +
               '<summary class="rd-chapter__head">' +
                 '<span class="type-badge">' + App.util.esc(n.type) + '</span>' +
                 '<span class="rd-chapter__title">' + App.util.esc(n.title || "（無題）") + '</span>' +
               '</summary>' +
               '<div class="rd-chapter__body">' + lead + inner + '</div>' +
             '</details>';
    }).join("");
  }

  /** 場面カード（読むための表示。編集はしない）*/
  function sceneCardHtml(n, no){
    var sum = splitSummary(n.summary);
    var html = '<article class="card card--soft rd-scene" id="' + sceneDomId(n.id) + '">';

    // 見出し行：通し番号・題名・（右上に小さく）編集ボタン
    html += '<div class="rd-scene__head">' +
              '<span class="card__no">場面 ' + no + '</span>' +
              '<h3 class="rd-scene__title">' + App.util.esc(n.title || "（無題の場面）") + '</h3>' +
              '<button type="button" class="btn btn--sm btn--ghost rd-edit" ' +
                'data-edit="' + App.util.esc(n.id) + '">編集</button>' +
            '</div>';

    // 緊張度（数値＋小さなバー）。未設定なら「なし」とだけ出す
    if (isTensionNull(n)){
      html += '<div class="rd-tension rd-tension--null"><span class="rd-tension__val">緊張度 なし</span></div>';
    } else {
      var t = Math.max(0, Math.min(100, Number(n.tension)));
      html += '<div class="rd-tension">' +
                '<span class="rd-tension__val">緊張度 ' + t + '</span>' +
                '<span class="rd-tension__track"><span class="rd-tension__fill" style="width:' + t + '%"></span></span>' +
              '</div>';
    }

    // 要約（★以降は分析として字下げ・色を変える）
    if (sum.main) html += '<p class="rd-summary">' + App.util.esc(sum.main) + '</p>';
    if (sum.note) html += '<p class="rd-analysis">' + App.util.esc(sum.note) + '</p>';
    if (!sum.main && !sum.note) html += '<p class="rd-blank">（要約はまだ書かれていません）</p>';

    // 引用（「引用も見る」以上のときだけ）
    if (st.density !== "summary" && n.quoteText){
      html += '<blockquote class="quote">' + App.util.esc(n.quoteText) +
              (n.quoteRef ? '<cite>' + App.util.esc(n.quoteRef) + '</cite>' : "") +
              '</blockquote>';
    }

    // タグ（チップは共通部品のみ）
    var tags = (Array.isArray(n.tagIds) ? n.tagIds : [])
      .map(function(id){ return App.tagChipHtml(id); }).join("");
    if (tags) html += '<div class="tag-row rd-scene__tags">' + tags + '</div>';

    // 研究記録（「研究記録も見る」のときだけ・値のある行だけ出す）
    if (st.density === "research"){
      var rows = "";
      if (n.valueStart || n.valueEnd){
        rows += researchRow("価値", (n.valueStart || "—") + " → " + (n.valueEnd || "—"));
      }
      if (n.polarity) rows += researchRow("極性", n.polarity);
      var cmds = Array.isArray(n.commandments) ? n.commandments : [];
      if (cmds.length) rows += researchRow("構造要素", cmds.join("・"));
      if (rows) html += '<div class="rd-research">' + rows + '</div>';
    }

    html += '</article>';
    return html;
  }

  function researchRow(label, value){
    return '<div class="rd-research__row">' +
             '<span class="rd-research__label">' + App.util.esc(label) + '</span>' +
             '<span class="rd-research__val">' + App.util.esc(value) + '</span>' +
           '</div>';
  }

  /** 場面カードの DOM id（カーブからのスクロール先）*/
  function sceneDomId(nodeId){ return "rd-scene-" + nodeId; }

  function scrollToScene(nodeId){
    var el = document.getElementById(sceneDomId(nodeId));
    if (!el) return;
    // 章を畳んでいると移動先が存在しない扱いになるので、先に祖先の <details> を開く
    var p = el.parentNode;
    while (p && p !== document.body){
      if (p.tagName === "DETAILS") p.open = true;
      p = p.parentNode;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // 移動先が分かるよう一瞬だけ縁を光らせる（色だけに頼らず枠で示す）
    el.classList.add("rd-scene--flash");
    setTimeout(function(){ el.classList.remove("rd-scene--flash"); }, 1200);
  }

  function onBodyClick(ev){
    var btn = ev.target.closest("[data-edit]");
    if (!btn) return;
    var id = btn.getAttribute("data-edit");
    var node = App.store.byId("nodes", id);
    if (!node) return;
    // 分解ビューが読み取る受け渡し口（anatomy.show が currentNodeId を消費する）
    App.state.currentWorkId = node.workId;
    App.state.currentNodeId = node.id;
    App.showView("anatomy");
  }

  /* ------------------------------------------------------------------
     書き出し（研究ノートとして持ち出す）
     writing.js と同じ方式（Blob＋a.download）に揃える。外部CDN禁止。
     ------------------------------------------------------------------ */

  // ファイル名に使えない文字を落とす（Windows禁止文字＋制御文字）
  function safeFileName(name){
    var s = String(name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[\u0000-\u001f]/g, "")
      .trim();
    return s || "無題";
  }
  // "YYYYMMDD"（ローカル日付。UTC ずれで前日になる事故を避ける）
  function todayCompact(){
    var d = new Date();
    function pad(x){ return (x < 10 ? "0" : "") + x; }
    return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }
  /* Blob を作ってダウンロードさせる。
     click 直後の revoke に失敗するブラウザがあるため解放は遅らせる。 */
  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  /** 書き出し用に木をたどり [{kind:"heading"|"scene", node, depth, no}] を作る。
      「なぜ共通化するか」: txt と html で並び・番号がズレると研究ノートとして
      信用できなくなるため、順序の決定は1箇所に閉じる。 */
  function outlineOf(workId){
    var out = [];
    var counter = { n: 0 };
    (function walk(parentId, depth){
      childrenOf(workId, parentId).forEach(function(n){
        if (n.type === "場面"){
          counter.n += 1;
          out.push({ kind: "scene", node: n, depth: depth, no: counter.n });
        } else {
          out.push({ kind: "heading", node: n, depth: depth });
          walk(n.id, depth + 1);
        }
      });
    })(null, 0);
    return out;
  }

  /** 研究記録の行を [ラベル, 値] の配列で返す（値のあるものだけ）*/
  function researchPairs(n){
    var pairs = [];
    if (n.valueStart || n.valueEnd){
      pairs.push(["価値", (n.valueStart || "—") + " → " + (n.valueEnd || "—")]);
    }
    if (n.polarity) pairs.push(["極性", n.polarity]);
    var cmds = Array.isArray(n.commandments) ? n.commandments : [];
    if (cmds.length) pairs.push(["構造要素", cmds.join("・")]);
    return pairs;
  }

  /** タグ名の配列（削除済みタグは飛ばす）*/
  function tagNames(tagIds){
    return (Array.isArray(tagIds) ? tagIds : []).map(function(id){
      var t = App.store.byId("tags", id);
      return t ? t.name : "";
    }).filter(Boolean);
  }

  /** テキスト版の研究ノート（書き出しは密度トグルに関わらず全部入り＝持ち出す価値を最大化）*/
  function buildNoteText(work){
    var lines = [];
    lines.push(work.title || "無題");
    var meta = [];
    if (work.author) meta.push(work.author);
    if (work.year) meta.push(work.year);
    if (meta.length) lines.push(meta.join("／"));
    var axes = work.axes || {};
    var axisLine = Object.keys(AXIS_LABELS).filter(function(k){ return axes[k]; })
      .map(function(k){ return AXIS_LABELS[k] + "：" + axes[k]; }).join("／");
    if (axisLine) lines.push(axisLine);
    var wt = tagNames(work.tagIds);
    if (wt.length) lines.push("作品タグ：" + wt.join("・"));
    if (work.note){ lines.push(""); lines.push(work.note); }
    lines.push("");
    lines.push("――――――――――――――――");
    lines.push("");

    outlineOf(work.id).forEach(function(item){
      var n = item.node;
      if (item.kind === "heading"){
        lines.push("");
        lines.push("【" + n.type + "】" + (n.title || "（無題）"));
        var hs = splitSummary(n.summary);
        if (hs.main) lines.push(hs.main);
        if (hs.note) lines.push("★" + hs.note);
        lines.push("");
        return;
      }
      lines.push("■ 場面" + item.no + "　" + (n.title || "（無題の場面）"));
      lines.push("緊張度：" + (isTensionNull(n) ? "なし" : n.tension));
      var s = splitSummary(n.summary);
      if (s.main) lines.push(s.main);
      if (s.note) lines.push("★" + s.note);
      if (n.quoteText){
        lines.push("引用：「" + n.quoteText + "」" + (n.quoteRef ? "（" + n.quoteRef + "）" : ""));
      }
      var tn = tagNames(n.tagIds);
      if (tn.length) lines.push("タグ：" + tn.join("・"));
      researchPairs(n).forEach(function(p){ lines.push(p[0] + "：" + p[1]); });
      lines.push("");
    });

    // 改行コードは CRLF（Windows のメモ帳で1行に潰れて見えるのを防ぐ）
    return lines.join("\n").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  }

  function exportNoteText(work){
    // BOM を先頭に付ける＝メモ帳が UTF-8 と判定できず文字化けする事故を防ぐ
    var blob = new Blob(["\uFEFF" + buildNoteText(work)],
                        { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, safeFileName(work.title) + "_研究ノート_" + todayCompact() + ".txt");
  }

  /* 印刷用HTML。外部CDN禁止＝CSSは全て内側に持つ自己完結ファイル。
     ユーザー入力は全て App.util.esc を通してから埋める（生HTMLが通る経路を作らない）。
     研究ノートなので横書きでよい（縦書きは原稿用。用途が違う）。 */
  function buildNoteHtml(work){
    var esc = App.util.esc;
    var title = esc(work.title || "無題");

    var head = '<h1>' + title + '</h1>';
    var meta = [];
    if (work.author) meta.push(esc(work.author));
    if (work.year) meta.push(esc(work.year));
    if (meta.length) head += '<p class="meta">' + meta.join("／") + '</p>';
    var axes = work.axes || {};
    var axisLine = Object.keys(AXIS_LABELS).filter(function(k){ return axes[k]; })
      .map(function(k){ return esc(AXIS_LABELS[k]) + "：" + esc(axes[k]); }).join("／");
    if (axisLine) head += '<p class="meta">' + axisLine + '</p>';
    var wt = tagNames(work.tagIds);
    if (wt.length) head += '<p class="tags">作品タグ：' + esc(wt.join("・")) + '</p>';
    if (work.note) head += '<p class="note">' + esc(work.note) + '</p>';

    var body = "";
    outlineOf(work.id).forEach(function(item){
      var n = item.node;
      if (item.kind === "heading"){
        var hs = splitSummary(n.summary);
        body += '<h2>' + esc(n.type) + '　' + esc(n.title || "（無題）") + '</h2>';
        if (hs.main) body += '<p class="lead">' + esc(hs.main) + '</p>';
        if (hs.note) body += '<p class="analysis">' + esc(hs.note) + '</p>';
        return;
      }
      var s = splitSummary(n.summary);
      body += '<section class="scene">';
      body += '<h3><span class="no">場面' + item.no + '</span>' + esc(n.title || "（無題の場面）") + '</h3>';
      body += '<p class="tension">緊張度：' + (isTensionNull(n) ? "なし" : esc(String(n.tension))) + '</p>';
      if (s.main) body += '<p>' + esc(s.main) + '</p>';
      if (s.note) body += '<p class="analysis">' + esc(s.note) + '</p>';
      if (n.quoteText){
        body += '<blockquote>' + esc(n.quoteText) +
                (n.quoteRef ? '<cite>' + esc(n.quoteRef) + '</cite>' : "") + '</blockquote>';
      }
      var tn = tagNames(n.tagIds);
      if (tn.length) body += '<p class="tags">タグ：' + esc(tn.join("・")) + '</p>';
      var pairs = researchPairs(n);
      if (pairs.length){
        body += '<p class="research">' + pairs.map(function(p){
          return esc(p[0]) + "：" + esc(p[1]);
        }).join("／") + '</p>';
      }
      body += '</section>';
    });
    if (!body) body = '<p>（まだ分解されていません）</p>';

    return '<!DOCTYPE html>\n' +
      '<html lang="ja"><head><meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + title + ' 研究ノート</title>\n' +
      '<style>\n' +
      // フォント指定はローカル名のみ（Webフォント取得＝外部依存を作らない）
      'html,body{margin:0;padding:0;background:#fff;color:#111;}\n' +
      'body{font-family:"游明朝","Yu Mincho","YuMincho","Hiragino Mincho ProN","MS PMincho",serif;' +
      'line-height:1.8;font-size:15px;}\n' +
      '.sheet{max-width:760px;margin:0 auto;padding:32px 24px;}\n' +
      'h1{font-size:22px;margin:0 0 4px;letter-spacing:.1em;}\n' +
      'h2{font-size:17px;margin:32px 0 8px;padding-bottom:4px;border-bottom:1px solid #bbb;}\n' +
      'h3{font-size:15px;margin:0 0 6px;}\n' +
      '.no{display:inline-block;font-size:11px;color:#666;margin-right:8px;letter-spacing:.1em;}\n' +
      '.meta,.tags,.tension,.research{font-size:12px;color:#555;margin:2px 0;}\n' +
      '.note{font-size:13px;color:#444;background:#f6f3ec;padding:10px 12px;}\n' +
      '.lead{margin:4px 0;}\n' +
      // ★以降の分析文は字下げ＋色で本文と区別する（画面表示と同じ扱い）
      '.analysis{margin:4px 0 4px 1.5em;color:#5a4a3a;font-size:14px;}\n' +
      '.scene{margin:0 0 20px;padding:12px 14px;border:1px solid #ddd;}\n' +
      'blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #a6412e;' +
      'background:#faf4f2;font-size:13px;color:#444;}\n' +
      'blockquote cite{display:block;margin-top:4px;font-size:11px;color:#777;font-style:normal;}\n' +
      '@media print{\n' +
      '  @page{size:A4;margin:16mm;}\n' +
      '  html,body{background:#fff;}\n' +
      '  .sheet{max-width:none;padding:0;}\n' +
      // 章の切れ目で改ページ／場面カードは途中で割らない（読み返しやすさ）
      '  h2{break-before:page;page-break-before:always;}\n' +
      '  h2:first-of-type{break-before:auto;page-break-before:auto;}\n' +
      '  .scene{break-inside:avoid;page-break-inside:avoid;}\n' +
      '}\n' +
      '</style></head>\n' +
      '<body><div class="sheet">' + head + body + '</div></body></html>\n';
  }

  function exportNoteHtml(work){
    var blob = new Blob([buildNoteHtml(work)], { type: "text/html;charset=utf-8" });
    downloadBlob(blob, safeFileName(work.title) + "_研究ノート_" + todayCompact() + ".html");
    // 「保存しただけで終わり」にしないよう、PDF化の手順をその場で案内する
    window.alert(
      "研究ノート（印刷用HTML）を保存しました。\n\n" +
      "PDFにするには：\n" +
      "1. 保存したファイルをダブルクリックしてブラウザで開く\n" +
      "2. 印刷（Ctrl+P）を開く\n" +
      "3. 送信先／プリンターで「PDFとして保存」を選ぶ"
    );
  }

  // ビュー登録（設計 §4）。init=初回のみ、show=表示のたび
  App.registerView({ id: "read", title: "通読", order: 25, init: init, show: show });

})();
