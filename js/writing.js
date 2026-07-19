/* ==========================================================================
   writing.js — 執筆ビュー（id: writing / order: 50）
   設計.txt §4「執筆」を実装する。
   思想: 自作品も名著と同じ works/nodes/tags で扱う。研究で見つけた技法を
   自分の場面にタグとして貼り、名著と同じ物差しで比較できることが独自性。
   ========================================================================== */
(function(){
  "use strict";

  window.App = window.App || {};
  var App = window.App;
  // ビュー間の選択共有（設計 §12 の掟）。他ビューより先に読み込まれても
  // 壊れないよう、このファイル冒頭でも保証しておく。
  App.state = App.state || {};

  /* ------------------------------------------------------------------
     このビューだけのローカル状態
     「なぜ再描画方針を分けるか」: 原稿の自動保存中に全体を作り直すと
     textarea のフォーカス・カーソル位置が消える（致命的なUX事故）。
     そのため「構造が変わる操作（章/場面の追加・改名・削除・並び替え・
     作品選択・モード切替）」だけ再描画し、文字入力中は文字数表示の
     直接更新とデバウンス保存のみを行う。
     ------------------------------------------------------------------ */
  var st = {
    workId: null,   // 選択中の自作品
    nodeId: null,   // 選択中の場面（編集対象）
    mode: "edit",   // "edit"=執筆 / "read"=読み返し / "board"=俯瞰（カード計画）
    vertical: false,  // 読み返しの縦書きトグル（新人賞応募＝縦書きで確かめる実務）
    checkOpen: false, // 推敲チェック結果パネルの開閉（renderMain 再構築でも保持）
    snapOpen: false   // 「版の一覧」<details> の開閉（再描画で閉じ戻らないよう記憶）
  };

  // 版履歴の上限（設計 §5）。超えたら古い順に間引く。「書き直す前の安全網」で
  // あって完全な履歴ではない、をデータ量の暴走防止と両立させるための上限。
  var SNAP_MAX = 30;

  // 集中執筆モードの状態。body に "focus-mode" を付けている間だけ非null。
  // Esc の keydown ハンドラを解除するために参照を保持する（リーク防止）。
  var focusNodeId = null;
  var focusKeyHandler = null;

  var rootEl = null;

  /* ------------------------------------------------------------------
     データ取得の小道具
     ------------------------------------------------------------------ */
  function ownWorks(){
    return App.store.find("works", function(w){ return !!w.isOwn; })
      .slice()
      .sort(function(a, b){ return (a.createdAt || 0) - (b.createdAt || 0); });
  }
  function nodesOfWork(workId){
    return App.store.find("nodes", function(n){ return n.workId === workId; });
  }
  function byOrder(a, b){ return (a.order || 0) - (b.order || 0); }
  function topNodes(workId){
    return nodesOfWork(workId).filter(function(n){ return !n.parentId; }).sort(byOrder);
  }
  function childNodes(workId, parentId){
    return nodesOfWork(workId).filter(function(n){ return n.parentId === parentId; }).sort(byOrder);
  }
  function nextOrder(list){
    if (!list.length) return 0;
    var max = 0;
    list.forEach(function(n){ if ((n.order || 0) > max) max = n.order || 0; });
    return max + 1;
  }
  // 章/部だけを作品順に返す（「章へ移動」セレクトの選択肢用）
  function containerNodes(workId){
    return nodesOfWork(workId).filter(function(n){ return n.type !== "場面"; }).sort(byOrder);
  }
  /* 作品内の全場面を「作品順（深さ優先）」で返す。各要素に所属コンテナ
     （章/部。作品直下なら null）を添える。俯瞰・読み返しが章あり/章なしの
     場面を漏れなく同じ順で扱えるようにするための単一の走査。
     「なぜ再帰か」: 設計 §5 で階層は自由（部→章→場面など深くなりうる）。
     anatomy.js の flatten と同じ深さ優先で、作品直下の場面も取りこぼさない。 */
  function scenesInOrder(workId){
    var out = [];
    (function walk(parentId, container){
      childNodes(workId, parentId).forEach(function(n){
        if (n.type === "場面"){
          out.push({ scene: n, chapter: container });
        } else {
          // この節（章/部）を所属コンテナとして子孫を辿る
          walk(n.id, n);
        }
      });
    })(null, null);
    return out;
  }

  /* ------------------------------------------------------------------
     文字数集計（機能1・4の共通化）
     「なぜ1関数に集約するか」: 進捗バー・俯瞰・読み返しが別々に合計を
     数えると値がずれる（＝ユーザーが混乱する）。合計の定義はここ1箇所。
     章(type=="章")の fullText は null なので、全 nodes の fullText を
     足すことは実質「全場面の本文合計」と一致する。
     ------------------------------------------------------------------ */
  function totalCharsOfWork(workId){
    var sum = 0;
    nodesOfWork(workId).forEach(function(n){ sum += (n.fullText || "").length; });
    return sum;
  }
  // 文字入力中の合計（＝保存前）を、再描画せずに算出するための版。
  // 編集中ノードだけは textarea の生値を使い、他は保存済み値を足す。
  function liveTotalChars(workId, curNodeId, curText){
    var sum = 0;
    nodesOfWork(workId).forEach(function(n){
      if (n.id === curNodeId) sum += (curText || "").length;
      else sum += (n.fullText || "").length;
    });
    return sum;
  }
  // 3桁区切り（進捗の可読性。負値＝今日削った場合も "-1,234" になる）
  function fmtNum(n){
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  // 今日のローカル日付キー "YYYY-MM-DD"（UTCずれを避けるため getFullYear 等を使う）
  function todayKey(){
    var d = new Date();
    function pad(x){ return (x < 10 ? "0" : "") + x; }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  /* 「今日書いた量」の基準（その日最初に観測した合計）を記録して返す。
     初回観測時のみ記録し、以後その日は基準を動かさない（設計 §5）。
     settings は get() で直接触るスキーマなので、書き換えたら save() する。 */
  function ensureDailyBaseline(workId){
    var settings = App.store.get().settings;
    if (!settings.dailyProgress) settings.dailyProgress = {};
    var key = todayKey();
    if (!settings.dailyProgress[key]) settings.dailyProgress[key] = {};
    var day = settings.dailyProgress[key];
    if (typeof day[workId] !== "number"){
      day[workId] = totalCharsOfWork(workId); // 初回観測のみ記録
      App.store.save();
    }
    return day[workId];
  }
  // 記録済みの基準を読むだけ（ライブ更新用。無ければ現合計＝今日+0）
  function readDailyBaseline(workId){
    var settings = App.store.get().settings;
    var key = todayKey();
    var day = settings.dailyProgress && settings.dailyProgress[key];
    if (day && typeof day[workId] === "number") return day[workId];
    return totalCharsOfWork(workId);
  }
  // 目標が有効な数値なら返す（null=未設定 / 0以下は未設定扱い）
  function goalOf(work){
    return (typeof work.goalChars === "number" && work.goalChars > 0) ? work.goalChars : null;
  }

  /* ------------------------------------------------------------------
     版履歴（スナップショット・設計 §5）— 書き直す前の安全網
     「なぜ手動か」: 自動で毎回残すと30版がすぐ埋まり、本当に残したい
     「書き直す直前の形」が流れてしまう。残す瞬間は書き手が決める。
     ------------------------------------------------------------------ */
  // 場面の版を新しい順に返す（一覧表示用）
  function snapshotsOfNode(nodeId){
    return App.store.find("snapshots", function(s){ return s.nodeId === nodeId; })
      .slice()
      .sort(function(a, b){ return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  /* エディタ textarea の未保存分（debounce 500ms 待ちの入力）を確定させる。
     版を残す/戻す前に必ず呼ぶ＝「見えている原稿」と「保存済み原稿」のずれを
     無くしてから控える（ずれたまま控えると安全網が古い原稿を守ってしまう）。 */
  function flushEditorText(nodeId){
    var ta = rootEl && rootEl.querySelector("#ww-fulltext");
    if (ta && ta.getAttribute("data-node-id") === nodeId){
      App.store.update("nodes", nodeId, { fullText: ta.value });
    }
  }
  /* 版を1件追加し、上限 SNAP_MAX を超えた分を古い順に間引く。
     add は store が save 済み（契約）。remove も同様。 */
  function addSnapshot(nodeId, text, label){
    var node = App.store.byId("nodes", nodeId);
    App.store.add("snapshots", {
      workId: node ? node.workId : st.workId,
      nodeId: nodeId,
      text: text,
      chars: text.length,
      label: label || ""
    });
    var snaps = App.store.find("snapshots", function(s){ return s.nodeId === nodeId; })
      .slice()
      .sort(function(a, b){ return (a.createdAt || 0) - (b.createdAt || 0); }); // 古い順
    while (snaps.length > SNAP_MAX){
      App.store.remove("snapshots", snaps.shift().id);
    }
  }

  /* ------------------------------------------------------------------
     ルビ記法 → <ruby> 変換（読み返し表示専用）
     記法: 「｜親文字《るび》」または「漢字《るび》」（｜無しは直前の
     連続する漢字を親文字とする＝小説投稿サイトの標準記法に合わせる）。
     ⚠ XSS安全の順序（厳守）: 先に全体を esc() でエスケープし、
     「エスケープ済み文字列」の上で記法を検出して ruby タグに置換する。
     挿入するのは自前の固定タグと、既にエスケープ済みの捕獲文字列だけ
     ＝ユーザー入力が生HTMLとして通る経路を作らない。
     （｜《》は非ASCIIなので esc() で変化せず、エスケープ後も検出できる）
     ------------------------------------------------------------------ */
  function rubyHtml(rawText){
    var escaped = App.util.esc(rawText || "");
    // ｜あり: ｜の直後から《まで何でも親文字にできる（ひらがな等もルビ可）
    // ｜なし: 《 の直前に連続する漢字（々〆ヶ・CJK統合漢字）だけを親文字にする
    return escaped.replace(
      /(?:｜([^《》｜\n]+)|([々〆ヶ〻㐀-䶿一-鿿]+))《([^《》\n]+)》/g,
      function(m, piped, kanji, rt){
        var base = piped || kanji;
        return '<ruby>' + base + '<rt>' + rt + '</rt></ruby>';
      }
    );
  }

  /* ------------------------------------------------------------------
     推敲チェック（読み返しモード）— 文末の単調・段落頭の重複のみ検査
     「なぜ2項目だけか」: 表記ゆれ等の高度な検査は誤検出が多く、
     機械の指摘を信じすぎる害の方が大きい（研究の道具の思想）。
     検出できる範囲を正直に絞り、結果パネルにもその旨を明記する。
     ------------------------------------------------------------------ */
  /* 会話文（「」内）を除いた地の文を文単位に割る。
     会話文を除くのは「〜だ。」等のセリフ口調が文末チェックの誤検出源になるため。 */
  function splitSentences(text){
    var noDialog = (text || "").replace(/「[^」]*」/g, "");
    // 「。！？」の連続＋直後の閉じ括弧までを1文とする（簡易。字下げ等は無視）
    return noDialog.match(/[^。！？]*[。！？]+[」）』]*/g) || [];
  }
  // 文末2文字（句読点・閉じ括弧・空白を除いた末尾2字）。2字未満なら null
  function sentenceEnding(sentence){
    var body = sentence.replace(/[。！？\s]+$/g, "").replace(/[」）』]+$/g, "").replace(/[。！？\s]+$/g, "");
    if (body.length < 2) return null;
    return body.slice(-2);
  }
  /* 作品全体（場面順）を走査して指摘リストを作る。
     返り値: { endings:[{scene,count,ending}], heads:[{scene,count,head}] } */
  function runProofCheck(work){
    var result = { endings: [], heads: [] };
    scenesInOrder(work.id).forEach(function(e){
      var sceneName = e.scene.title || "（無題の場面）";
      var text = e.scene.fullText || "";

      // a) 文末の単調: 同一文末2文字が3文連続以上
      var ends = splitSentences(text).map(sentenceEnding);
      var run = 1;
      for (var i = 1; i <= ends.length; i++){
        if (i < ends.length && ends[i] !== null && ends[i] === ends[i - 1]){
          run++;
        } else {
          if (run >= 3 && ends[i - 1] !== null){
            result.endings.push({ scene: sceneName, count: run, ending: ends[i - 1] });
          }
          run = 1;
        }
      }

      // b) 段落頭の重複: 連続する（空行を挟まない実質の）段落の書き出し2文字が同じ
      var heads = text.split(/\n/)
        .map(function(p){ return p.replace(/^[\s　]+/, ""); }) // 字下げ（全角空白含む）を除いて比べる
        .filter(function(p){ return p.length >= 2; })
        .map(function(p){ return p.slice(0, 2); });
      var hrun = 1;
      for (var j = 1; j <= heads.length; j++){
        if (j < heads.length && heads[j] === heads[j - 1]){
          hrun++;
        } else {
          if (hrun >= 2){
            result.heads.push({ scene: sceneName, count: hrun, head: heads[j - 1] });
          }
          hrun = 1;
        }
      }
    });
    return result;
  }

  /* ------------------------------------------------------------------
     init — 一度だけ骨格を作る
     ------------------------------------------------------------------ */
  function init(root){
    rootEl = root;
    // className の上書き禁止（掟）。classList.add のみ使う
    root.classList.add("view--writing");
    root.innerHTML =
      '<section class="block">' +
        '<h2 class="section-title">執筆</h2>' +
        '<div class="ww-layout">' +
          '<div class="card ww-worklist" id="ww-worklist"></div>' +
          '<div class="ww-main" id="ww-main"></div>' +
        '</div>' +
      '</section>';

    // 作品一覧パネルは構造操作（追加・削除・選択）でのみ再描画するので
    // ここでイベント委譲を1回だけ結線する
    var listPanel = root.querySelector("#ww-worklist");
    listPanel.addEventListener("click", onWorklistClick);
    listPanel.addEventListener("submit", onWorklistSubmit);

    var main = root.querySelector("#ww-main");
    main.addEventListener("click", onMainClick);
    main.addEventListener("change", onMainChange);
  }

  /** 表示のたびに呼ばれる（他ビューでのデータ変更を確実に反映する）*/
  function show(){
    // 集中モードの残留を防ぐ（他ビューから戻ってきた／再表示のたびに掃除）。
    // ⚠ body クラスを付けっぱなしで別画面に行かないための保険。
    exitFocusMode();
    // 選択中の作品/場面が削除済みなら選択を外す（参照切れ対策）
    if (st.workId && !App.store.byId("works", st.workId)) {
      st.workId = null; st.nodeId = null;
    }
    if (st.nodeId && !App.store.byId("nodes", st.nodeId)) {
      st.nodeId = null;
    }
    renderWorklist();
    renderMain();
  }

  /* ------------------------------------------------------------------
     作品一覧パネル
     ------------------------------------------------------------------ */
  function renderWorklist(){
    var panel = rootEl.querySelector("#ww-worklist");
    var works = ownWorks();
    var html = '<p class="overline">自作品</p>';
    if (!works.length){
      html += '<p class="ww-empty">まだ自作品がありません。下のフォームから題名だけで作れます。</p>';
    } else {
      html += '<ul class="ww-work-ul">';
      works.forEach(function(w){
        var cur = (w.id === st.workId) ? " current" : "";
        html +=
          '<li class="ww-work-li' + cur + '" data-work-id="' + App.util.esc(w.id) + '">' +
            '<button type="button" class="ww-work-select" data-work-id="' + App.util.esc(w.id) + '">' +
              App.util.esc(w.title || "（無題）") +
            '</button>' +
            '<button type="button" class="ww-icon-btn ww-work-delete" data-work-id="' + App.util.esc(w.id) + '" aria-label="作品を削除">×</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    html +=
      '<form class="ww-new-work-form" id="ww-new-work-form">' +
        '<div class="field">' +
          '<label>新規作品</label>' +
          '<input type="text" class="input" id="ww-new-work-title" placeholder="題名（後から決めてもよい）">' +
        '</div>' +
        '<button type="submit" class="btn btn--primary btn--sm">＋ 新規作品</button>' +
        '<p class="ww-new-work-hint">題名は空でも作れます（「無題」で作成）。あとで書庫や執筆ヘッダの「改題」で変えられます。</p>' +
      '</form>';
    panel.innerHTML = html;
  }

  function onWorklistSubmit(ev){
    if (ev.target && ev.target.id === "ww-new-work-form"){
      ev.preventDefault();
      var input = rootEl.querySelector("#ww-new-work-title");
      // 「小説はどこから決まるか難しい」＝題名を強制しない。空なら「無題」で作る
      // （題名からでも本文からでも始められるようにするための緩和）。
      var title = (input.value || "").trim() || "無題";
      var work = App.store.add("works", {
        title: title,
        author: "",
        year: null,
        isOwn: true,
        axes: { length: "", reception: "", form: "" },
        note: "",
        tagIds: []
      });
      // 手数削減（強制順序の緩和・機能3）：作品を作ったら白紙の場面を1つ
      // 作品直下に自動作成し選択状態にする＝「＋新規作品」1回で原稿が開く。
      var first = App.store.add("nodes", {
        workId: work.id,
        parentId: null,
        order: 0,
        type: "場面",
        title: "場面 1",
        summary: "", quoteText: "", quoteRef: "", tension: null,
        tagIds: [], valueStart: null, valueEnd: null, polarity: null,
        commandments: [], fullText: ""
      });
      st.workId = work.id;
      st.nodeId = first.id;
      st.mode = "edit";
      renderWorklist();
      renderMain();
    }
  }

  function onWorklistClick(ev){
    var selectBtn = ev.target.closest && ev.target.closest(".ww-work-select");
    if (selectBtn){
      st.workId = selectBtn.getAttribute("data-work-id");
      st.nodeId = null;
      st.mode = "edit";
      renderWorklist();
      renderMain();
      return;
    }
    var delBtn = ev.target.closest && ev.target.closest(".ww-work-delete");
    if (delBtn){
      var id = delBtn.getAttribute("data-work-id");
      var w = App.store.byId("works", id);
      var name = w ? w.title : "";
      var ok = window.confirm(
        "作品「" + name + "」を削除します。章・場面もすべて削除されます。よろしいですか？"
      );
      if (!ok) return;
      App.store.remove("works", id);
      if (st.workId === id){ st.workId = null; st.nodeId = null; }
      renderWorklist();
      renderMain();
    }
  }

  /* ------------------------------------------------------------------
     メイン領域（章・場面ツリー＋原稿エディタ／読み返し）
     ------------------------------------------------------------------ */
  function renderMain(){
    var main = rootEl.querySelector("#ww-main");
    if (!st.workId){
      main.innerHTML = '<div class="card ww-placeholder">左の一覧から作品を選ぶか、新規作成してください。</div>';
      return;
    }
    var work = App.store.byId("works", st.workId);
    if (!work){
      main.innerHTML = '<div class="card ww-placeholder">作品が見つかりません。</div>';
      return;
    }

    var html = '';
    html += '<div class="card ww-work-head">';
    html += '<div class="ww-work-head-row">';
    // 題名は後から変えられる（強制順序の緩和）。クリックで prompt 改題。
    html += '<span class="ww-work-title-wrap">';
    html += '<span class="card__title">' + App.util.esc(work.title || "（無題）") + '</span>';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="ww-work-rename">改題</button>';
    html += '</span>';
    html += '<div class="ww-mode-switch">';
    html += modeBtn("edit", "執筆");
    html += modeBtn("board", "俯瞰");
    html += modeBtn("read", "読み返し");
    html += '<button type="button" class="btn btn--ghost btn--sm" id="ww-goto-anatomy">分解で見る</button>';
    html += '</div></div>';
    // 進捗バー（機能1）。ヘッダ内に置き、どのモードでも常時見えるようにする
    html += renderProgress(work);
    html += '</div>';

    if (st.mode === "read"){
      html += renderReadback(work);
    } else if (st.mode === "board"){
      html += renderBoard(work);
    } else {
      html += '<div class="ww-editor-layout">';
      html += renderTreePanel(work);
      html += renderEditorPanel(work);
      html += '</div>';
    }

    main.innerHTML = html;
    bindEditorInputs();
  }

  function modeBtn(mode, label){
    var cls = "btn btn--sm " + (st.mode === mode ? "btn--primary" : "btn--ghost");
    return '<button type="button" class="' + cls + ' ww-mode-btn" data-mode="' + mode + '">' + label + '</button>';
  }

  /* --- 進捗バー＋執筆目標＋今日書いた量（機能1）--- */
  function renderProgress(work){
    var total = totalCharsOfWork(work.id);
    var goal = goalOf(work);
    // 今日の基準を（初回のみ）記録。renderMain のたびに呼ばれるが2回目以降は素通り
    var baseline = ensureDailyBaseline(work.id);
    var todayDelta = total - baseline;

    var h = '<div class="ww-progress" id="ww-progress">';
    if (goal){
      var pct = Math.min(100, Math.round(total / goal * 1000) / 10);
      h += '<div class="ww-progress-head">';
      h += '<span class="overline">執筆目標</span>';
      h += '<span class="ww-progress-nums" id="ww-progress-nums">' +
             fmtNum(total) + ' / ' + fmtNum(goal) + ' 文字（' + pct + '%）</span>';
      h += '</div>';
      h += '<div class="ww-progressbar" role="progressbar">' +
             '<div class="ww-progressbar-fill" id="ww-progressbar-fill" style="width:' + pct + '%;"></div>' +
           '</div>';
    } else {
      // 目標未設定：合計のみ表示し「目標を設定」導線を出す（バーは非表示）
      h += '<div class="ww-progress-head">';
      h += '<span class="ww-progress-nums" id="ww-progress-nums">合計 ' + fmtNum(total) + ' 文字</span>';
      h += '</div>';
    }
    // 「今日書いた量」（その日最初の合計との差）
    var sign = todayDelta >= 0 ? '+' : '';
    h += '<div class="ww-today" id="ww-today">今日 ' + sign + fmtNum(todayDelta) + ' 文字</div>';

    // 目標の設定UI（数値入力）。目標ありでも変更・クリアできる
    h += '<div class="ww-goal-edit">';
    h += '<input type="number" class="input ww-goal-input" id="ww-goal-input" min="0" step="100" ' +
           'placeholder="目標文字数" value="' + (goal ? String(goal) : '') + '">';
    h += '<button type="button" class="btn btn--sm" id="ww-goal-save">目標を保存</button>';
    if (goal){
      h += '<button type="button" class="btn btn--ghost btn--sm" id="ww-goal-clear">目標をクリア</button>';
    }
    h += '</div>';
    h += '</div>';
    return h;
  }

  /* --- カード俯瞰モード（機能3・プロット計画）--- */
  function renderBoard(work){
    // 章あり/章なしの場面を作品順で漏れなく俯瞰（共通走査 scenesInOrder）。
    var entries = scenesInOrder(work.id);
    var html = '<div class="ww-board">';
    html += '<p class="overline">全場面を作品順にカードで俯瞰します。あらすじの抜けを見つけ、先に構成を組んでから書くための画面です。</p>';

    html += '<div class="ww-board-grid">';
    entries.forEach(function(e){
      html += renderBoardCard(work, e.chapter, e.scene);
    });
    html += '</div>';

    if (!entries.length){
      html += '<p class="ww-empty">まだ場面がありません。「執筆」に切り替えて「＋場面」から書き始められます。</p>';
    }
    html += '</div>';
    return html;
  }

  function renderBoardCard(work, ch, sc){
    var text = sc.fullText || "";
    var summary = (sc.summary || "").trim();
    // ▲▼の端無効化のため、この場面の「真の兄弟」内での位置を求める
    // （作品直下なら topNodes、章内なら childNodes）。並べ替えは moveNode が
    // node.parentId から兄弟を再計算するので、混在でも整合する。
    var siblings = (sc.parentId == null) ? topNodes(work.id) : childNodes(work.id, sc.parentId);
    var idx = 0, total = siblings.length;
    for (var i = 0; i < siblings.length; i++){ if (siblings[i].id === sc.id){ idx = i; break; } }
    var h = '<div class="card ww-board-card" data-node-id="' + App.util.esc(sc.id) + '">';
    // ヘッダ：章名（章なしは明示）・場面名・並べ替え（既存 moveNode を流用）
    h += '<div class="ww-board-card-head">';
    h += '<div class="ww-board-titles">';
    h += '<span class="ww-board-chapter">' + App.util.esc(ch ? (ch.title || "（無題の章）") : "（章なし）") + '</span>';
    h += '<span class="ww-board-scene">' + App.util.esc(sc.title || "（無題の場面）") + '</span>';
    h += '</div>';
    h += nodeControls(sc.id, idx, total, "scene");
    h += '</div>';

    // メタ：緊張度・文字数
    h += '<div class="ww-board-meta">';
    h += '<span class="ww-board-metaitem">緊張度 ' +
           (typeof sc.tension === "number" ? App.util.esc(String(sc.tension)) : "—") + '</span>';
    h += '<span class="ww-board-metaitem">' + fmtNum(text.length) + ' 文字</span>';
    h += '</div>';

    // あらすじ（クイック編集。空なら抜けを薄く可視化）
    h += '<div class="field ww-board-summary-field">';
    h += '<label>あらすじ</label>';
    h += '<textarea class="textarea ww-board-summary" data-node-id="' + App.util.esc(sc.id) + '" rows="2" ' +
           'placeholder="あらすじ未記入">' + App.util.esc(sc.summary || "") + '</textarea>';
    if (!summary){
      h += '<p class="ww-board-summary-missing">あらすじ未記入</p>';
    }
    h += '</div>';

    // タグチップ
    var tagIds = sc.tagIds || [];
    if (tagIds.length){
      h += '<div class="tag-row ww-board-tags">';
      tagIds.forEach(function(tagId){
        var chip = App.tagChipHtml(tagId);
        if (chip) h += chip;
      });
      h += '</div>';
    }

    // この場面を書く（＝edit へ遷移）。カード全体クリックでも遷移するが、
    // テキスト編集領域と衝突しないよう明示ボタンも用意する
    h += '<button type="button" class="btn btn--ghost btn--sm ww-board-open" data-node-id="' + App.util.esc(sc.id) + '">✎ この場面を書く</button>';
    h += '</div>';
    return h;
  }

  /* --- 章・場面ツリー --- */
  function renderTreePanel(work){
    // 作品直下のノード（章/部/場面が混在しうる）を order 順にまとめて扱う。
    // これで「章立てから」でも「一場面から」でも同じツリーに並べられる。
    var tops = topNodes(work.id);
    var html = '<div class="card ww-tree-panel">';
    html += '<div class="ww-tree-panel-head">';
    html += '<span class="overline">章・場面</span>';
    // 「＋場面」＝作品直下に場面を直接作る（章を作らずに書き始められる）。
    // 「＋章」＝章立てから始めたい人用。両方を残して順序を強制しない。
    html += '<span class="ww-tree-add-btns">';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="ww-add-scene-top">＋場面</button>';
    html += '<button type="button" class="btn btn--ghost btn--sm" id="ww-add-chapter">＋章</button>';
    html += '</span>';
    html += '</div>';

    if (!tops.length){
      html += '<p class="ww-empty">まだ何もありません。「＋場面」で一場面から、または「＋章」で章立てから始められます。</p>';
    } else {
      html += '<ul class="ww-tree-ul">';
      tops.forEach(function(n, idx){
        // 混在ツリー：作品直下が場面ならそのまま場面行、章/部なら子場面ごと描画。
        if (n.type === "場面"){
          html += renderTopSceneLi(work, n, idx, tops.length);
        } else {
          html += renderChapterLi(work, n, idx, tops.length);
        }
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  // 作品直下の場面を1行として描画（選択・▲▼・改名・削除つき）。
  // ▲▼ は topNodes（章と場面の混在リスト）の中で入れ替わる＝混在でも正しく並ぶ。
  function renderTopSceneLi(work, sc, idx, total){
    var cur = (sc.id === st.nodeId) ? " current" : "";
    var html = '<li class="ww-scene-li ww-scene-li--top' + cur + '">';
    html += '<div class="ww-node-row">';
    html += '<button type="button" class="ww-scene-select" data-node-id="' + App.util.esc(sc.id) + '">' +
            App.util.esc(sc.title || "（無題の場面）") + '</button>';
    html += nodeControls(sc.id, idx, total, "scene");
    html += '</div>';
    html += '</li>';
    return html;
  }

  function renderChapterLi(work, ch, idx, total){
    var html = '<li class="ww-chapter-li">';
    html += '<div class="ww-node-row">';
    html += '<span class="ww-node-title">' + App.util.esc(ch.title || "（無題の章）") + '</span>';
    html += nodeControls(ch.id, idx, total, "chapter");
    html += '</div>';

    var scenes = childNodes(work.id, ch.id);
    html += '<ul class="ww-scene-ul">';
    scenes.forEach(function(sc, scIdx){
      var cur = (sc.id === st.nodeId) ? " current" : "";
      html += '<li class="ww-scene-li' + cur + '">';
      html += '<div class="ww-node-row">';
      html += '<button type="button" class="ww-scene-select" data-node-id="' + App.util.esc(sc.id) + '">' +
              App.util.esc(sc.title || "（無題の場面）") + '</button>';
      html += nodeControls(sc.id, scIdx, scenes.length, "scene");
      html += '</div>';
      html += '</li>';
    });
    html += '</ul>';
    html += '<button type="button" class="btn btn--ghost btn--sm ww-add-scene" data-chapter-id="' + App.util.esc(ch.id) + '">＋場面</button>';
    html += '</li>';
    return html;
  }

  function nodeControls(nodeId, idx, total, kind){
    var html = '<span class="ww-node-controls">';
    html += '<button type="button" class="ww-icon-btn ww-move-up" data-node-id="' + App.util.esc(nodeId) + '"' + (idx === 0 ? " disabled" : "") + '>▲</button>';
    html += '<button type="button" class="ww-icon-btn ww-move-down" data-node-id="' + App.util.esc(nodeId) + '"' + (idx === total - 1 ? " disabled" : "") + '>▼</button>';
    html += '<button type="button" class="ww-icon-btn ww-rename" data-node-id="' + App.util.esc(nodeId) + '">改名</button>';
    html += '<button type="button" class="ww-icon-btn ww-delete-node" data-node-id="' + App.util.esc(nodeId) + '">削除</button>';
    html += '</span>';
    return html;
  }

  /* --- 原稿エディタ --- */
  function renderEditorPanel(work){
    var html = '<div class="card ww-editor-panel">';
    var node = st.nodeId ? App.store.byId("nodes", st.nodeId) : null;
    if (!node || node.type !== "場面"){
      html += '<p class="ww-empty">左のツリーから場面を選ぶと、ここで原稿を書けます。</p>';
      html += '</div>';
      return html;
    }

    html += '<div class="ww-editor-head">';
    html += '<p class="overline">編集中：' + App.util.esc(node.title || "（無題の場面）") + '</p>';
    // 集中執筆モードへ（機能2）。原稿に没頭できるよう周囲を隠す
    html += '<button type="button" class="btn btn--ghost btn--sm ww-focus-enter" data-node-id="' + App.util.esc(node.id) + '">🖊 集中</button>';
    html += '</div>';

    html += '<div class="field">';
    html += '<label>あらすじ（任意・小さく添える）</label>';
    html += '<textarea class="textarea ww-summary" id="ww-summary" data-node-id="' + App.util.esc(node.id) + '" rows="2">' +
            App.util.esc(node.summary || "") + '</textarea>';
    html += '</div>';

    html += '<div class="field">';
    html += '<label>原稿</label>';
    html += '<textarea class="textarea ww-fulltext" id="ww-fulltext" data-node-id="' + App.util.esc(node.id) + '" rows="16">' +
            App.util.esc(node.fullText || "") + '</textarea>';
    html += '</div>';
    html += '<div class="overline" id="ww-charcount">' + String((node.fullText || "").length) + ' 文字</div>';

    // ルビ記法の案内（変換は読み返しモードでのみ行う＝エディタは生記法のまま）
    html += '<p class="ww-ruby-hint">ルビは ｜漢字《かんじ》 と書く（｜は省略可・読み返しで表示されます）</p>';

    html += renderSnapshotSection(node);

    // 後から章に整理したくなった時のため「章へ移動」を用意（順序を強制しない）。
    // 選択肢は作品内の章/部＋「作品直下」。章がまだ無ければ出さない。
    var chapters = containerNodes(work.id);
    if (chapters.length){
      html += '<div class="field ww-move-chapter-field">';
      html += '<label for="ww-move-chapter">章へ移動（整理したくなったら）</label>';
      html += '<select class="select ww-move-chapter" id="ww-move-chapter" data-node-id="' + App.util.esc(node.id) + '">';
      var atTop = (node.parentId == null);
      html += '<option value=""' + (atTop ? " selected" : "") + '>（作品直下）</option>';
      chapters.forEach(function(ch){
        var sel = (ch.id === node.parentId) ? " selected" : "";
        html += '<option value="' + App.util.esc(ch.id) + '"' + sel + '>' + App.util.esc(ch.title || "（無題の章）") + '</option>';
      });
      html += '</select>';
      html += '</div>';
    }

    html += renderTagSection(node);

    html += '</div>';
    return html;
  }

  function renderTagSection(node){
    var tagIds = node.tagIds || [];
    var html = '<div class="ww-tag-section">';
    html += '<p class="overline">研究で見つけた技法を、自分の場面に貼ってみましょう。</p>';
    html += '<div class="tag-row" id="ww-tag-row">';
    if (!tagIds.length){
      html += '<span class="ww-empty">まだタグがありません。</span>';
    } else {
      tagIds.forEach(function(tagId){
        var chip = App.tagChipHtml(tagId);
        if (!chip) return; // 削除済みタグは描画しない
        html += '<span class="ww-tag-wrap">' + chip +
                '<button type="button" class="ww-tag-remove" data-node-id="' + App.util.esc(node.id) + '" data-tag-id="' + App.util.esc(tagId) + '" aria-label="タグを外す">×</button></span>';
      });
    }
    html += '</div>';

    var allTags = App.store.get().tags;
    var categories = ["構成", "演出", "言葉遣い", "効果"];
    html += '<div class="ww-tag-add-row">';
    html += '<select class="select ww-tag-category" id="ww-tag-category">';
    categories.forEach(function(c){ html += '<option value="' + App.util.esc(c) + '">' + App.util.esc(c) + '</option>'; });
    html += '</select>';

    var currentCat = rootEl.querySelector("#ww-tag-category") ?
      rootEl.querySelector("#ww-tag-category").value : categories[0];
    var candidates = allTags.filter(function(t){
      return t.category === currentCat && tagIds.indexOf(t.id) === -1;
    });
    html += '<select class="select ww-tag-select" id="ww-tag-select">';
    if (!candidates.length){
      html += '<option value="">（このカテゴリに追加できるタグがありません）</option>';
    } else {
      candidates.forEach(function(t){
        html += '<option value="' + App.util.esc(t.id) + '">' + App.util.esc(t.name) + '</option>';
      });
    }
    html += '</select>';
    html += '<button type="button" class="btn btn--sm" id="ww-tag-add" data-node-id="' + App.util.esc(node.id) + '">＋追加</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* --- 版履歴セクション（エディタ内・設計 §5）--- */
  function renderSnapshotSection(node){
    var snaps = snapshotsOfNode(node.id);
    var html = '<div class="ww-snap-section">';
    html += '<div class="ww-snap-head">';
    // 「◎ 版を残す」＝書き直す前に現在形を控える（安全網の入口）
    html += '<button type="button" class="btn btn--ghost btn--sm ww-snap-save" data-node-id="' + App.util.esc(node.id) + '">◎ 版を残す</button>';
    html += '<span class="ww-snap-note">書き直す前に控えを残せます（1場面 ' + SNAP_MAX + ' 版まで・古い版から自動削除）</span>';
    html += '</div>';

    // 版の一覧（折りたたみ）。開閉状態は st.snapOpen に記憶し再描画で戻さない
    html += '<details class="ww-snap-details" id="ww-snap-details"' + (st.snapOpen ? ' open' : '') + '>';
    html += '<summary>版の一覧（' + snaps.length + '）</summary>';
    if (!snaps.length){
      html += '<p class="ww-empty">まだ版がありません。「◎ 版を残す」で現在の原稿を控えられます。</p>';
    } else {
      html += '<ul class="ww-snap-ul">';
      snaps.forEach(function(s){
        var head = (s.text || "").slice(0, 20);
        html += '<li class="ww-snap-li">';
        html += '<div class="ww-snap-meta">';
        html += '<span class="ww-snap-date">' + App.util.esc(App.util.fmtDate(s.createdAt)) + '</span>';
        html += '<span class="ww-snap-chars">' + fmtNum(s.chars || 0) + ' 文字</span>';
        if (s.label) html += '<span class="ww-snap-label">' + App.util.esc(s.label) + '</span>';
        html += '</div>';
        if (head) html += '<div class="ww-snap-headtext">' + App.util.esc(head) + '…</div>';
        html += '<div class="ww-snap-actions">';
        html += '<button type="button" class="ww-icon-btn ww-snap-restore" data-snap-id="' + App.util.esc(s.id) + '" data-node-id="' + App.util.esc(node.id) + '">戻す</button>';
        html += '<button type="button" class="ww-icon-btn ww-snap-delete" data-snap-id="' + App.util.esc(s.id) + '">削除</button>';
        html += '</div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</details>';
    html += '</div>';
    return html;
  }

  /* --- 読み返しモード（全文の通し表示・編集不可）--- */
  function renderReadback(work){
    // 章あり/章なしの場面を作品順で通し表示（共通走査 scenesInOrder）。
    // 合計は共通関数に一本化（ヘッダ進捗・俯瞰と齟齬を出さない＝機能4）
    var entries = scenesInOrder(work.id);
    var totalChars = totalCharsOfWork(work.id);
    var body = '';
    var lastChapterId = undefined; // 章見出しは章が切り替わった時だけ出す
    entries.forEach(function(e){
      var ch = e.chapter;
      var chId = ch ? ch.id : null;
      if (chId !== lastChapterId){
        // 章なしの場面が続く塊には見出しを出さない（作品直下の連続を素直に表示）
        if (ch) body += '<h3 class="ww-read-chapter">' + App.util.esc(ch.title || "（無題の章）") + '</h3>';
        lastChapterId = chId;
      }
      var text = e.scene.fullText || "";
      body += '<h4 class="ww-read-scene">' + App.util.esc(e.scene.title || "（無題の場面）") + '</h4>';
      // ルビ記法を <ruby> に変換して表示（rubyHtml 内で esc 済み＝XSS安全）
      body += '<div class="ww-read-text">' + rubyHtml(text) + '</div>';
    });

    // 原稿用紙換算（新人賞応募の実務）。÷400 の単純換算である旨を正直に添える
    var pages = Math.ceil(totalChars / 400);

    var html = '<div class="card ww-readback">';
    html += '<div class="overline">読み返しモード（編集不可のプレビュー）／合計 ' + fmtNum(totalChars) + ' 文字／約 ' + fmtNum(pages) + ' 枚（400字詰め換算）</div>';
    html += '<p class="ww-read-pages-note">※枚数は文字数÷400の単純換算。実際の応募規定（20字×20行等）では改行の分だけ増えます。</p>';

    // 縦書きトグル・推敲チェック（読み返し専用の道具）
    html += '<div class="ww-read-controls">';
    html += '<button type="button" class="btn btn--sm ' + (st.vertical ? 'btn--primary' : 'btn--ghost') + '" id="ww-vertical-toggle">縦書き' + (st.vertical ? ' ON' : ' OFF') + '</button>';
    html += '<button type="button" class="btn btn--sm ' + (st.checkOpen ? 'btn--primary' : 'btn--ghost') + '" id="ww-check-btn">🔍 推敲チェック</button>';
    html += '</div>';

    // 推敲チェック結果（ボタンで開閉。開いている間は本文より先に見せる）
    if (st.checkOpen){
      html += renderCheckPanel(work);
    }

    html += '<div class="ww-read-body' + (st.vertical ? ' ww-read-body--vertical' : '') + '">';
    html += body || '<p class="ww-empty">まだ本文がありません。</p>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  /* --- 推敲チェック結果パネル --- */
  function renderCheckPanel(work){
    var r = runProofCheck(work);
    var html = '<div class="ww-check-panel">';
    html += '<p class="overline">推敲チェック（文末と段落頭のみ検査）</p>';
    if (!r.endings.length && !r.heads.length){
      html += '<p class="ww-check-ok">単調な連続は見つかりませんでした。</p>';
    } else {
      if (r.endings.length){
        html += '<p class="ww-check-title">文末の単調（同じ文末2文字が3文以上連続）</p>';
        html += '<ul class="ww-check-ul">';
        r.endings.forEach(function(x){
          html += '<li>' + App.util.esc(x.scene) + '：「〜' + App.util.esc(x.ending) + '」が ' + x.count + ' 文連続</li>';
        });
        html += '</ul>';
      }
      if (r.heads.length){
        html += '<p class="ww-check-title">段落頭の重複（連続する段落の書き出し2文字が同じ）</p>';
        html += '<ul class="ww-check-ul">';
        r.heads.forEach(function(x){
          html += '<li>' + App.util.esc(x.scene) + '：「' + App.util.esc(x.head) + '〜」で始まる段落が ' + x.count + ' 連続</li>';
        });
        html += '</ul>';
      }
    }
    // 機械的な参考である旨（研究の道具の思想＝道具を信じすぎない）
    html += '<p class="ww-check-note">※機械的な検出です。会話文（「」内）は文末チェックから除外しています。意図した反復（畳みかけ等）は指摘されても直す必要はありません。</p>';
    html += '</div>';
    return html;
  }

  /* ------------------------------------------------------------------
     原稿エディタの input 結線（構造再描画を伴わない部分更新）
     ------------------------------------------------------------------ */
  var debouncedSaveFullText = App.util.debounce(function(nodeId, value){
    App.store.update("nodes", nodeId, { fullText: value });
  }, 500);
  var debouncedSaveSummary = App.util.debounce(function(nodeId, value){
    App.store.update("nodes", nodeId, { summary: value });
  }, 500);

  /* 進捗バー・今日書いた量を、再描画せずに直接更新する（文字入力中用）。
     保存前なので liveTotalChars（編集中ノードは textarea 生値）で数える。 */
  function updateProgressLive(nodeId, text){
    if (!st.workId) return;
    var work = App.store.byId("works", st.workId);
    if (!work) return;
    var total = liveTotalChars(st.workId, nodeId, text);
    var goal = goalOf(work);
    var numsEl = rootEl.querySelector("#ww-progress-nums");
    var fillEl = rootEl.querySelector("#ww-progressbar-fill");
    var todayEl = rootEl.querySelector("#ww-today");
    if (goal){
      var pct = Math.min(100, Math.round(total / goal * 1000) / 10);
      if (numsEl) numsEl.textContent = fmtNum(total) + ' / ' + fmtNum(goal) + ' 文字（' + pct + '%）';
      if (fillEl) fillEl.style.width = pct + '%';
    } else {
      if (numsEl) numsEl.textContent = '合計 ' + fmtNum(total) + ' 文字';
    }
    if (todayEl){
      var delta = total - readDailyBaseline(st.workId);
      todayEl.textContent = '今日 ' + (delta >= 0 ? '+' : '') + fmtNum(delta) + ' 文字';
    }
  }

  /* ------------------------------------------------------------------
     集中執筆モード（機能2）
     body に "focus-mode" を付け、画面全面を覆う専用オーバーレイ（#views や
     ナビより前面）に大きな textarea を表示する。原稿は集中用 textarea から
     同じ fullText へ debounce＋blur 保存する（保存3経路の思想を踏襲）。
     ------------------------------------------------------------------ */
  function ensureFocusOverlay(){
    var overlay = document.getElementById("ww-focus-overlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "ww-focus-overlay";
    overlay.innerHTML =
      '<div class="ww-focus-inner">' +
        '<div class="ww-focus-bar">' +
          '<span class="ww-focus-count" id="ww-focus-count">0 文字</span>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="ww-focus-exit">集中を終える（Esc）</button>' +
        '</div>' +
        '<textarea class="ww-focus-textarea" id="ww-focus-textarea" placeholder="ここに没頭して書く"></textarea>' +
      '</div>';
    document.body.appendChild(overlay);

    var ta = overlay.querySelector("#ww-focus-textarea");
    // 集中用 textarea → fullText 保存（同じ debounce 関数を使い保存経路を共通化）
    ta.addEventListener("input", function(){
      var c = overlay.querySelector("#ww-focus-count");
      if (c) c.textContent = String(ta.value.length) + " 文字";
      if (focusNodeId) debouncedSaveFullText(focusNodeId, ta.value);
    });
    // blur でも即時保存（原稿は最も消えてはいけないデータ）
    ta.addEventListener("blur", function(){
      if (focusNodeId) App.store.update("nodes", focusNodeId, { fullText: ta.value });
    });
    overlay.querySelector("#ww-focus-exit").addEventListener("click", function(){
      exitFocusMode();
      renderMain();
    });
    return overlay;
  }

  function enterFocusMode(nodeId){
    var node = App.store.byId("nodes", nodeId);
    if (!node || node.type !== "場面") return;
    // 集中に入る前に、本編 textarea の未保存入力を確定させる（取りこぼし防止）
    var mainTa = rootEl.querySelector("#ww-fulltext");
    if (mainTa && mainTa.getAttribute("data-node-id") === nodeId){
      App.store.update("nodes", nodeId, { fullText: mainTa.value });
      node = App.store.byId("nodes", nodeId);
    }
    var overlay = ensureFocusOverlay();
    var ta = overlay.querySelector("#ww-focus-textarea");
    var count = overlay.querySelector("#ww-focus-count");
    ta.value = node.fullText || "";
    if (count) count.textContent = String(ta.value.length) + " 文字";
    focusNodeId = nodeId;
    document.body.classList.add("focus-mode");
    // Esc で抜ける。解除時に必ず removeEventListener する（リーク防止）
    focusKeyHandler = function(ev){
      if (ev.key === "Escape" || ev.keyCode === 27){
        exitFocusMode();
        renderMain();
      }
    };
    document.addEventListener("keydown", focusKeyHandler);
    // フォーカスを当てて即入力できるように
    ta.focus();
  }

  /* 集中モードを解除する（冪等）。他ビューへ切替時・ビューを抜ける時にも
     必ず呼び、body クラスの付けっぱなしを防ぐ。 */
  function exitFocusMode(){
    if (!document.body.classList.contains("focus-mode") && !focusNodeId) return;
    var overlay = document.getElementById("ww-focus-overlay");
    if (overlay && focusNodeId){
      var ta = overlay.querySelector("#ww-focus-textarea");
      if (ta) App.store.update("nodes", focusNodeId, { fullText: ta.value }); // 抜ける前に確定保存
    }
    document.body.classList.remove("focus-mode");
    if (focusKeyHandler){
      document.removeEventListener("keydown", focusKeyHandler);
      focusKeyHandler = null;
    }
    focusNodeId = null;
  }

  function bindEditorInputs(){
    var fulltext = rootEl.querySelector("#ww-fulltext");
    if (fulltext){
      fulltext.addEventListener("input", function(){
        var count = rootEl.querySelector("#ww-charcount");
        if (count) count.textContent = String(fulltext.value.length) + " 文字";
        // 進捗バーもライブ更新する（renderMain を呼ばない＝カーソルを飛ばさない）
        updateProgressLive(fulltext.getAttribute("data-node-id"), fulltext.value);
        debouncedSaveFullText(fulltext.getAttribute("data-node-id"), fulltext.value);
      });
      // blur でも即時保存（debounce の500ms以内にタブを閉じると原稿の
      // 直近入力が失われるため。原稿は最も消えてはいけないデータ）
      fulltext.addEventListener("blur", function(){
        App.store.update("nodes", fulltext.getAttribute("data-node-id"),
                         { fullText: fulltext.value });
      });
    }
    // 「版の一覧」<details> の開閉を st に記憶する（版の削除・戻す等で
    // renderMain しても一覧が勝手に閉じないように）。toggle は click では
    // 拾えないためここで個別に結線する（renderMain のたびに張り直される）。
    var snapDetails = rootEl.querySelector("#ww-snap-details");
    if (snapDetails){
      snapDetails.addEventListener("toggle", function(){
        st.snapOpen = snapDetails.open;
      });
    }
    var summary = rootEl.querySelector("#ww-summary");
    if (summary){
      summary.addEventListener("input", function(){
        debouncedSaveSummary(summary.getAttribute("data-node-id"), summary.value);
      });
      summary.addEventListener("blur", function(){
        App.store.update("nodes", summary.getAttribute("data-node-id"),
                         { summary: summary.value });
      });
    }
  }

  // タブを閉じる直前の最終保存（blur すら挟まらない閉じ方への保険）。
  // pagehide は beforeunload より確実に発火する（モバイル含む）
  if (window.addEventListener) window.addEventListener("pagehide", function(){
    var fulltext = rootEl && rootEl.querySelector("#ww-fulltext");
    if (fulltext && fulltext.getAttribute("data-node-id")){
      App.store.update("nodes", fulltext.getAttribute("data-node-id"),
                       { fullText: fulltext.value });
    }
    // 集中モードで閉じられた場合、集中用 textarea も最終保存する
    var focusTa = document.getElementById("ww-focus-textarea");
    if (focusNodeId && focusTa){
      App.store.update("nodes", focusNodeId, { fullText: focusTa.value });
    }
  });

  /* ------------------------------------------------------------------
     メイン領域のクリック/変更イベント（章・場面の追加/改名/削除/並替え・
     モード切替・タグ追加削除・分解へ遷移）
     ------------------------------------------------------------------ */
  function onMainClick(ev){
    var t = ev.target;

    var modeBtnEl = t.closest && t.closest(".ww-mode-btn");
    if (modeBtnEl){
      st.mode = modeBtnEl.getAttribute("data-mode");
      renderMain();
      return;
    }

    // 執筆目標の保存/クリア（機能1）。works.goalChars は update で save 済み
    if (t.closest && t.closest("#ww-goal-save")){
      var gi = rootEl.querySelector("#ww-goal-input");
      var gv = gi ? parseInt(gi.value, 10) : NaN;
      var goal = (isFinite(gv) && gv > 0) ? gv : null;
      App.store.update("works", st.workId, { goalChars: goal });
      renderMain();
      return;
    }
    if (t.closest && t.closest("#ww-goal-clear")){
      App.store.update("works", st.workId, { goalChars: null });
      renderMain();
      return;
    }

    // 集中執筆モードへ入る（機能2）
    var focusBtn = t.closest && t.closest(".ww-focus-enter");
    if (focusBtn){
      enterFocusMode(focusBtn.getAttribute("data-node-id"));
      return;
    }

    // 版を残す（版履歴・設計 §5）
    var snapSaveBtn = t.closest && t.closest(".ww-snap-save");
    if (snapSaveBtn){
      saveSnapshotManual(snapSaveBtn.getAttribute("data-node-id"));
      return;
    }
    // 版に戻す（現原稿を自動でもう1版残してから置換＝戻す操作で原稿を失わない）
    var snapRestoreBtn = t.closest && t.closest(".ww-snap-restore");
    if (snapRestoreBtn){
      restoreSnapshot(snapRestoreBtn.getAttribute("data-snap-id"),
                      snapRestoreBtn.getAttribute("data-node-id"));
      return;
    }
    // 版の削除
    var snapDeleteBtn = t.closest && t.closest(".ww-snap-delete");
    if (snapDeleteBtn){
      deleteSnapshot(snapDeleteBtn.getAttribute("data-snap-id"));
      return;
    }

    // 読み返し：縦書きトグル／推敲チェック開閉（どちらも文字入力中ではないので再描画可）
    if (t.closest && t.closest("#ww-vertical-toggle")){
      st.vertical = !st.vertical;
      renderMain();
      return;
    }
    if (t.closest && t.closest("#ww-check-btn")){
      st.checkOpen = !st.checkOpen;
      renderMain();
      return;
    }

    if (t.closest && t.closest("#ww-goto-anatomy")){
      App.state.currentWorkId = st.workId;
      App.showView("anatomy");
      return;
    }

    // 執筆ヘッダからの改題（題名は後から変えられる＝順序を強制しない）
    if (t.closest && t.closest("#ww-work-rename")){
      renameWork();
      return;
    }

    if (t.closest && t.closest("#ww-add-chapter")){
      addChapter();
      return;
    }
    // 作品直下に場面を直接作る（章を作らずに書き始められる）
    if (t.closest && t.closest("#ww-add-scene-top")){
      addSceneDirect();
      return;
    }
    var addSceneBtn = t.closest && t.closest(".ww-add-scene");
    if (addSceneBtn){
      addScene(addSceneBtn.getAttribute("data-chapter-id"));
      return;
    }

    var sceneSelectBtn = t.closest && t.closest(".ww-scene-select");
    if (sceneSelectBtn){
      st.nodeId = sceneSelectBtn.getAttribute("data-node-id");
      renderMain();
      return;
    }

    var renameBtn = t.closest && t.closest(".ww-rename");
    if (renameBtn){
      renameNode(renameBtn.getAttribute("data-node-id"));
      return;
    }
    var delBtn = t.closest && t.closest(".ww-delete-node");
    if (delBtn){
      deleteNode(delBtn.getAttribute("data-node-id"));
      return;
    }
    var upBtn = t.closest && t.closest(".ww-move-up");
    if (upBtn && !upBtn.disabled){
      moveNode(upBtn.getAttribute("data-node-id"), -1);
      return;
    }
    var downBtn = t.closest && t.closest(".ww-move-down");
    if (downBtn && !downBtn.disabled){
      moveNode(downBtn.getAttribute("data-node-id"), 1);
      return;
    }

    var tagRemoveBtn = t.closest && t.closest(".ww-tag-remove");
    if (tagRemoveBtn){
      removeTagFromNode(tagRemoveBtn.getAttribute("data-node-id"), tagRemoveBtn.getAttribute("data-tag-id"));
      return;
    }
    var tagAddBtn = t.closest && t.closest("#ww-tag-add");
    if (tagAddBtn){
      var select = rootEl.querySelector("#ww-tag-select");
      var tagId = select ? select.value : "";
      if (tagId) addTagToNode(tagAddBtn.getAttribute("data-node-id"), tagId);
      return;
    }

    // 俯瞰カード → 編集へ遷移（機能3）。「✎ この場面を書く」ボタン、または
    // カード地の余白クリックで遷移。あらすじ編集領域・操作ボタンでは遷移しない
    var boardOpen = t.closest && t.closest(".ww-board-open");
    if (boardOpen){
      openSceneInEdit(boardOpen.getAttribute("data-node-id"));
      return;
    }
    var boardCard = t.closest && t.closest(".ww-board-card");
    if (boardCard){
      if ((t.closest && (t.closest(".ww-board-summary-field") || t.closest("button") || t.closest("textarea")))) return;
      openSceneInEdit(boardCard.getAttribute("data-node-id"));
      return;
    }
  }

  // 俯瞰カードから該当場面を編集モードで開く
  function openSceneInEdit(nodeId){
    st.mode = "edit";
    st.nodeId = nodeId;
    renderMain();
  }

  function onMainChange(ev){
    // カテゴリ選択を切り替えたら、タグ選択の候補を絞り直すため再描画
    if (ev.target && ev.target.id === "ww-tag-category"){
      renderMain();
      return;
    }
    // 俯瞰カードのあらすじクイック編集（機能3）。change=blur時に発火するので
    // 保存＋再描画してもカーソルは飛ばない（「あらすじ未記入」表示も更新）
    if (ev.target && ev.target.classList && ev.target.classList.contains("ww-board-summary")){
      App.store.update("nodes", ev.target.getAttribute("data-node-id"), { summary: ev.target.value });
      renderMain();
      return;
    }
    // 「章へ移動」セレクト（change=選択確定で発火。文字入力中ではないので再描画可）
    if (ev.target && ev.target.id === "ww-move-chapter"){
      moveSceneToChapter(ev.target.getAttribute("data-node-id"), ev.target.value || null);
      return;
    }
  }

  /* --- 章・場面の追加/改名/削除/並び替え --- */
  function addChapter(){
    var title = window.prompt("章の題名を入力してください。", "");
    if (title === null) return; // キャンセル
    var chapters = topNodes(st.workId);
    App.store.add("nodes", {
      workId: st.workId,
      parentId: null,
      order: nextOrder(chapters),
      type: "章",
      title: title.trim() || "新しい章",
      summary: "", quoteText: "", quoteRef: "", tension: null,
      tagIds: [], valueStart: null, valueEnd: null, polarity: null,
      commandments: [], fullText: null
    });
    renderMain();
  }

  // 執筆ヘッダからの改題（空入力は無視して現題名を保つ）
  function renameWork(){
    var work = App.store.byId("works", st.workId);
    if (!work) return;
    var title = window.prompt("作品の題名を入力してください。", work.title || "");
    if (title === null) return; // キャンセル
    var trimmed = title.trim();
    App.store.update("works", st.workId, { title: trimmed || work.title || "無題" });
    renderWorklist();
    renderMain();
  }

  // 作品直下に場面を直接作る（章立てを前提にしない＝一場面から始められる）
  function addSceneDirect(){
    var title = window.prompt("場面の題名を入力してください（空でも作れます）。", "");
    if (title === null) return;
    var tops = topNodes(st.workId);
    var node = App.store.add("nodes", {
      workId: st.workId,
      parentId: null,
      order: nextOrder(tops),
      type: "場面",
      title: title.trim() || "新しい場面",
      summary: "", quoteText: "", quoteRef: "", tension: null,
      tagIds: [], valueStart: null, valueEnd: null, polarity: null,
      commandments: [], fullText: ""
    });
    st.nodeId = node.id;
    renderMain();
  }

  // 場面を章へ移動（または作品直下へ戻す）。parentId と order を付け替える。
  function moveSceneToChapter(nodeId, chapterId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var newParent = chapterId || null;
    if ((node.parentId || null) === newParent) return; // 変化なし
    // 移動先の末尾に置く（既存の並びを壊さない）
    var siblings = newParent ? childNodes(st.workId, newParent) : topNodes(st.workId);
    App.store.update("nodes", nodeId, { parentId: newParent, order: nextOrder(siblings) });
    renderMain();
  }

  function addScene(chapterId){
    var title = window.prompt("場面の題名を入力してください。", "");
    if (title === null) return;
    var scenes = childNodes(st.workId, chapterId);
    var node = App.store.add("nodes", {
      workId: st.workId,
      parentId: chapterId,
      order: nextOrder(scenes),
      type: "場面",
      title: title.trim() || "新しい場面",
      summary: "", quoteText: "", quoteRef: "", tension: null,
      tagIds: [], valueStart: null, valueEnd: null, polarity: null,
      commandments: [], fullText: ""
    });
    st.nodeId = node.id;
    renderMain();
  }

  function renameNode(nodeId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var title = window.prompt("新しい題名を入力してください。", node.title || "");
    if (title === null) return;
    App.store.update("nodes", nodeId, { title: title.trim() || node.title });
    renderMain();
  }

  function deleteNode(nodeId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var msg = (node.type === "章") ?
      "章「" + (node.title || "") + "」を削除します。中の場面もすべて削除されます。よろしいですか？" :
      "場面「" + (node.title || "") + "」を削除します。よろしいですか？";
    if (!window.confirm(msg)) return;
    App.store.remove("nodes", nodeId);
    if (st.nodeId === nodeId) st.nodeId = null;
    renderMain();
  }

  function moveNode(nodeId, dir){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var siblings = (node.parentId === null) ?
      topNodes(node.workId) : childNodes(node.workId, node.parentId);
    var idx = -1;
    for (var i = 0; i < siblings.length; i++){ if (siblings[i].id === nodeId){ idx = i; break; } }
    var swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
    var a = siblings[idx], b = siblings[swapIdx];
    var aOrder = a.order || 0, bOrder = b.order || 0;
    App.store.update("nodes", a.id, { order: bOrder });
    App.store.update("nodes", b.id, { order: aOrder });
    renderMain();
  }

  /* --- 版履歴の操作（設計 §5）--- */
  // 「◎ 版を残す」: textarea の未保存分を確定 → 空チェック → ラベル入力 → 追加
  function saveSnapshotManual(nodeId){
    flushEditorText(nodeId); // 見えている原稿をそのまま控えるための確定
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var text = node.fullText || "";
    if (!text){
      window.alert("空の版は残せません。原稿を書いてから「版を残す」を押してください。");
      return;
    }
    var label = window.prompt("この版に一言（空でもかまいません）。\n例：「初稿」「冒頭を書き直す前」", "");
    if (label === null) return; // キャンセル＝残さない
    addSnapshot(nodeId, text, label.trim());
    st.snapOpen = true; // 残した直後は一覧を開いて「残った」ことを見せる
    renderMain();
  }

  /* 「戻す」: confirm → 現在の原稿を自動でもう1版残す → 置換。
     「なぜ自動で控えるか」: 戻す操作そのものが上書きなので、戻した直後に
     「やっぱり戻す前の方が良かった」となっても往復できるようにする（安全網の要）。 */
  function restoreSnapshot(snapId, nodeId){
    var snap = App.store.byId("snapshots", snapId);
    var node = App.store.byId("nodes", nodeId);
    if (!snap || !node) return;
    var ok = window.confirm(
      "この版（" + fmtNum(snap.chars || 0) + " 文字）に戻します。\n" +
      "現在の原稿は自動でもう1版として控えられます。よろしいですか？"
    );
    if (!ok) return;
    flushEditorText(nodeId); // 現在の「見えている原稿」を確定してから控える
    var current = (App.store.byId("nodes", nodeId) || {}).fullText || "";
    // 空の現原稿は控えない（無内容の版で30枠を埋めない）。失うものが無いため安全網も不要
    if (current){
      addSnapshot(nodeId, current, "戻す前の自動控え");
    }
    App.store.update("nodes", nodeId, { fullText: snap.text || "" });
    st.snapOpen = true;
    renderMain();
  }

  function deleteSnapshot(snapId){
    var snap = App.store.byId("snapshots", snapId);
    if (!snap) return;
    if (!window.confirm("この版（" + fmtNum(snap.chars || 0) + " 文字）を削除します。よろしいですか？")) return;
    App.store.remove("snapshots", snapId);
    st.snapOpen = true; // 削除後も一覧を開いたままにする（続けて整理できるように）
    renderMain();
  }

  /* --- タグの付け外し --- */
  function addTagToNode(nodeId, tagId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var tagIds = (node.tagIds || []).slice();
    if (tagIds.indexOf(tagId) === -1) tagIds.push(tagId);
    App.store.update("nodes", nodeId, { tagIds: tagIds });
    renderMain();
  }
  function removeTagFromNode(nodeId, tagId){
    var node = App.store.byId("nodes", nodeId);
    if (!node) return;
    var tagIds = (node.tagIds || []).filter(function(id){ return id !== tagId; });
    App.store.update("nodes", nodeId, { tagIds: tagIds });
    renderMain();
  }

  /* ------------------------------------------------------------------
     登録
     ------------------------------------------------------------------ */
  App.registerView({
    id: "writing",
    title: "執筆",
    order: 50,
    init: init,
    show: show
  });

})();
