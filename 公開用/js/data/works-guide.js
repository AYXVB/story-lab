// 作品案内所: 書庫の「案内所から自動入力」が参照する内蔵データ。
// 有名作品のみ収録。あらすじは研究用途（構造に触れる・ネタバレ許容）。
// tagIds は tags-seed.js の安定ID（t_xxx）のみを使用。捏造禁止のため、
// あらすじに自信が持てない作品は収録しない方針（2026-07-18 作成）。
window.App = window.App || {};
App.worksGuide = [
  {
    titles: ["金閣寺"],
    author: "三島由紀夫",
    year: 1956,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "吃音に悩む青年僧・溝口が、幼少期から抱いてきた美への強迫的な憧れの果てに、金閣寺への放火に至るまでの心理を一人称で描く。実際の金閣寺放火事件（1950年）を素材にしており、美への嫉妬と破壊衝動が内面から語られる。",
    tagIds: ["t_first_person_narration", "t_symbol_motif", "t_unreliable_narrator", "t_sublime"]
  },
  {
    titles: ["こころ"],
    author: "夏目漱石",
    year: 1914,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "前半は「私」が鎌倉で出会った謎めいた「先生」との交流を描き、後半は先生から届いた長い手紙がそのまま挿入され、親友Kの自殺に関わる先生自身の過去の罪が明かされる。上・中・下の三部構成で語り手が交代し、告白の形式そのものが主題化されている。",
    tagIds: ["t_first_person_narration", "t_epistolary_form", "t_omission", "t_foreshadowing"]
  },
  {
    titles: ["人間失格"],
    author: "太宰治",
    year: 1948,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "「はしがき」と「あとがき」に挟まれる形で、主人公・葉蔵の手記が提示される額縁構造を持つ。葉蔵は人間社会への恐怖から道化を演じ続け、薬物や自殺未遂を繰り返しながら「人間、失格」と自らを断じるに至る。",
    tagIds: ["t_frame_story", "t_first_person_narration", "t_unreliable_narrator", "t_pathos"]
  },
  {
    titles: ["羅生門"],
    author: "芥川龍之介",
    year: 1915,
    axes: { length: "短編", reception: "読解", form: "文字" },
    synopsis: "平安京の荒廃した羅生門で、職を失った下人が老婆の死体から髪を抜く行為を目撃し、生きるための悪の是非を自問する。『今昔物語集』を典拠とした翻案で、下人の心理の揺れが外側からの淡々とした描写とともに描かれる。",
    tagIds: ["t_external_focalization", "t_contrast", "t_symbol_motif"]
  },
  {
    titles: ["藪の中"],
    author: "芥川龍之介",
    year: 1922,
    axes: { length: "短編", reception: "読解", form: "文字" },
    synopsis: "山中で見つかった男の死体をめぐり、木樵り・旅法師・盗人・妻・死者本人（巫女の口を借りて）など複数の証言が食い違ったまま並置され、真相は最後まで明かされない。映画『羅生門』（黒澤明）の原作の一つ。",
    tagIds: ["t_multiple_internal_focalization", "t_unreliable_narrator", "t_omission"]
  },
  {
    titles: ["雪国", "Snow Country"],
    author: "川端康成",
    year: 1935,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "東京の有閑な男・島村が、雪深い温泉町で芸者・駒子と出会い、関係を重ねていく様子を、抒情的な自然描写とともに描く。感覚的な文体と余情の表現が特徴で、川端のノーベル文学賞受賞理由の一つとされた。",
    tagIds: ["t_symbol_motif", "t_metaphor", "t_pathos", "t_showing"]
  },
  {
    titles: ["砂の女"],
    author: "安部公房",
    year: 1962,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "昆虫採集に訪れた男が、砂丘の底の一軒家に閉じ込められ、そこに住む女とともに砂を掻き出し続ける生活を強いられる。脱出を試みるが徐々に状況を受け入れていく過程を通じ、日常労働の不条理を寓話的に描く。",
    tagIds: ["t_dream_logic", "t_symbol_motif", "t_discomfort", "t_foreboding"]
  },
  {
    titles: ["吾輩は猫である"],
    author: "夏目漱石",
    year: 1905,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "名前のない飼い猫「吾輩」が、教師・苦沙弥の家庭とその周辺の人々を観察者として語る風刺的な連作形式の長編。猫という語り手を通した人間社会への滑稽な批評が特徴で、明確な筋よりも挿話の積み重ねで構成される。",
    tagIds: ["t_nonhuman_narrator", "t_humor", "t_fragmentary"]
  },
  {
    titles: ["走れメロス"],
    author: "太宰治",
    year: 1940,
    axes: { length: "短編", reception: "読解", form: "文字" },
    synopsis: "友を人質に王のもとへ処刑覚悟で戻ると誓ったメロスが、様々な障害を乗り越えて約束の時刻に走り抜く。信実と友情を主題にした短編で、疾走感のある文体とクライマックスへ向かう緊張が特徴。",
    tagIds: ["t_tension", "t_pacing", "t_catharsis"]
  },
  {
    titles: ["銀河鉄道の夜"],
    author: "宮沢賢治",
    year: 1934,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "貧しい少年ジョバンニが、親友カムパネルラとともに銀河を走る幻想的な汽車に乗り込み、様々な乗客や星座の情景に出会う旅をする。旅の終わりにカムパネルラの死が示唆され、冒頭の日常描写と幻想の旅とが円環的に響き合う。",
    tagIds: ["t_circular_structure", "t_dream_logic", "t_symbol_motif", "t_sublime"]
  },
  {
    titles: ["デミアン"],
    author: "ヘルマン・ヘッセ",
    year: 1919,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "平凡な家庭に育った少年シンクレールが、謎めいた転校生デミアンとの出会いを通じて、善悪二元論を超えた自己の内なる神性（アプラクサス）に目覚めていく過程を一人称で描く教養小説。",
    tagIds: ["t_first_person_narration", "t_symbol_motif", "t_foreshadowing"]
  },
  {
    titles: ["氷", "ice", "Ice", "アイス"],
    author: "アンナ・カヴァン",
    year: 1967,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "名前を持たない語り手が、同じく名を持たない「少女」を、崩壊しつつある世界の中で追い続ける。追跡の場面が形を変えながら繰り返され、夢と現実の境界が曖昧なまま進行する、三幕構成では捉えきれない反復的・悪夢的な作品。",
    tagIds: ["t_repetition_variation", "t_dream_logic", "t_anonymity", "t_foreboding"]
  },
  {
    titles: ["変身"],
    author: "フランツ・カフカ",
    year: 1915,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "ある朝、外交販売員グレゴール・ザムザが巨大な虫に変わっていることに気づく。誰もその変化の理由を説明せず、家族もやがて彼を疎み負担として扱うようになる、不条理な状況を淡々とした筆致で描く。",
    tagIds: ["t_dream_logic", "t_external_focalization", "t_discomfort"]
  },
  {
    titles: ["城"],
    author: "フランツ・カフカ",
    year: 1926,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "測量士Kと呼ばれる男が、村を支配する謎めいた「城」への到達を試みるが、村の官僚制と不条理な規則に阻まれ続ける。物語は未完のまま中断しており、目的への到達も解決も与えられない。",
    tagIds: ["t_dream_logic", "t_anonymity", "t_anti_narrative"]
  },
  {
    titles: ["審判"],
    author: "フランツ・カフカ",
    year: 1925,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "銀行員ヨーゼフ・Kが、ある朝理由も告げられぬまま逮捕される。裁判所への出頭を重ねるが、罪状も裁判の実態も最後まで明かされないまま、Kは処刑される。名前を伏せられた不条理な権力機構への恐怖を描く。",
    tagIds: ["t_anonymity", "t_dream_logic", "t_foreboding", "t_fixed_internal_focalization"]
  },
  {
    titles: ["異邦人"],
    author: "アルベール・カミュ",
    year: 1942,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "母の死に際しても涙を流さない主人公ムルソーが、太陽の眩しさゆえの衝動的な殺人によって裁判にかけられ、その人間性ではなく「母の死に涙しなかったこと」を理由に断罪されていく。感情を抑えた乾いた一人称の語りが特徴。",
    tagIds: ["t_first_person_narration", "t_discomfort", "t_foreboding"]
  },
  {
    titles: ["ペスト"],
    author: "アルベール・カミュ",
    year: 1947,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "北アフリカの町オランがペストに封鎖され、医師リウーを中心とした人々が疫病と闘う日々を、抑制された記録的な文体で描く。物語の語り手が誰であるかは終盤まで伏せられている。",
    tagIds: ["t_external_focalization", "t_tension", "t_catharsis"]
  },
  {
    titles: ["罪と罰"],
    author: "フョードル・ドストエフスキー",
    year: 1866,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "貧しい元学生ラスコーリニコフが、独自の「非凡人思想」に基づいて金貸しの老婆を殺害するが、その後の良心の呵責と警察の追及の中で苦悩し、最終的に自首と信仰による再生へ向かう。彼の内面に密着した語りが特徴。",
    tagIds: ["t_fixed_internal_focalization", "t_crisis", "t_tension", "t_catharsis"]
  },
  {
    titles: ["カラマーゾフの兄弟"],
    author: "フョードル・ドストエフスキー",
    year: 1880,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "好色な父フョードルの殺害事件をめぐり、信仰と理性の間で揺れる三兄弟（ドミートリイ・イワン・アリョーシャ）それぞれの思想と葛藤が語られる。異母兄弟スメルジャコフの存在も絡み、罪と信仰の問題を多面的に描く。",
    tagIds: ["t_multiple_internal_focalization", "t_crisis", "t_foreshadowing"]
  },
  {
    titles: ["1984年", "1984"],
    author: "ジョージ・オーウェル",
    year: 1949,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "全体主義国家オセアニアで生きる党員ウィンストン・スミスが、「ビッグ・ブラザー」による監視・思想統制に疑問を抱き、禁じられた恋と反抗を試みるが、最終的に体制に屈服させられる。ウィンストンの視点に密着した語りでディストピアの息苦しさを描く。",
    tagIds: ["t_fixed_internal_focalization", "t_foreboding", "t_symbol_motif", "t_discomfort"]
  },
  {
    titles: ["すばらしい新世界", "素晴らしい新世界"],
    author: "オルダス・ハクスリー",
    year: 1932,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "遺伝子操作と条件付けによって階級と幸福が管理された未来社会に、「野蛮人保護区」出身のジョンが持ち込まれ、シェイクスピアに親しんだ彼の価値観と管理社会の価値観が衝突する。ディストピア文学の古典。",
    tagIds: ["t_variable_internal_focalization", "t_contrast", "t_discomfort"]
  },
  {
    titles: ["老人と海", "The Old Man and the Sea", "Old Man and the Sea"],
    author: "アーネスト・ヘミングウェイ",
    year: 1952,
    axes: { length: "中編", reception: "読解", form: "文字" },
    synopsis: "キューバの老漁師サンチャゴが、80日以上不漁が続いた末に巨大なカジキと格闘し、ようやく仕留めるが、帰路でサメに食い荒らされてしまう。心理描写を最小限に抑え、行動と情景そのもので語る文体で知られる。",
    tagIds: ["t_external_focalization", "t_showing", "t_sublime", "t_pathos"]
  },
  {
    titles: ["グレート・ギャツビー"],
    author: "F・スコット・フィッツジェラルド",
    year: 1925,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "語り手ニックが、隣人である謎めいた大富豪ギャツビーと、彼がかつて愛したデイジーとの再会・破局を見届ける。対岸に灯る緑の光に象徴される、届かない過去への憧れが物語全体を貫く。",
    tagIds: ["t_first_person_narration", "t_symbol_motif", "t_foreshadowing", "t_nostalgia"]
  },
  {
    titles: ["嵐が丘"],
    author: "エミリー・ブロンテ",
    year: 1847,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "荒野の館ワザリング・ハイツを舞台に、ヒースクリフとキャサリンの激しい愛憎とその後の世代への影響が、訪問者ロックウッドが聞いた家政婦ネリーの回想という入れ子の語りを通じて明かされる。",
    tagIds: ["t_frame_story", "t_multiple_internal_focalization", "t_pathos"]
  },
  {
    titles: ["百年の孤独"],
    author: "ガブリエル・ガルシア=マルケス",
    year: 1967,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "ブエンディア一族7世代にわたる興亡を、架空の村マコンドを舞台に描く。同じ名前や出来事が世代を超えて反復され、現実と幻想が地続きに語られる魔術的リアリズムの代表作で、円環的な構成を持つ。",
    tagIds: ["t_circular_structure", "t_repetition_variation", "t_symbol_motif", "t_dream_logic"]
  },
  {
    titles: ["ユリシーズ"],
    author: "ジェイムズ・ジョイス",
    year: 1922,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "ダブリンでのある一日を、広告取りブルーム・青年スティーヴン・妻モリーら複数人物の視点から、意識の流れの手法を駆使して描く。『オデュッセイア』の構造を下敷きにしつつ、章ごとに文体が大きく変化する実験的な長編。",
    tagIds: ["t_stream_of_consciousness", "t_variable_internal_focalization", "t_long_sentence_flow"]
  },
  {
    titles: ["ダロウェイ夫人"],
    author: "ヴァージニア・ウルフ",
    year: 1925,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "パーティーの準備をするクラリッサ・ダロウェイの一日と、戦争のトラウマを抱える退役軍人セプティマスの一日が交差しながら、両者の意識の流れと過去への回想を行き来しつつ語られる。",
    tagIds: ["t_stream_of_consciousness", "t_free_indirect_discourse", "t_variable_internal_focalization", "t_time_manipulation"]
  },
  {
    titles: ["心変わり"],
    author: "ミシェル・ビュトール",
    year: 1957,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "妻子ある男レオンが、愛人と暮らすためパリからローマへ向かう列車の中で、「あなた」という二人称で自らの内面を綴られながら、旅の途中で心変わりしていく過程を描くヌーヴォー・ロマンの代表作。1957年ルノードー賞受賞。",
    tagIds: ["t_second_person_narration", "t_anti_narrative"]
  },
  {
    titles: ["冬の夜ひとりの旅人が"],
    author: "イタロ・カルヴィーノ",
    year: 1979,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "「あなた」という読者自身が主人公として登場し、『冬の夜ひとりの旅人が』という小説を読み始めるが、印刷ミスなどにより次々と別の未完の小説の冒頭に読み替えられていく、メタフィクションの実験作。",
    tagIds: ["t_second_person_narration", "t_metafiction", "t_fragmentary"]
  },
  {
    titles: ["ハザール事典"],
    author: "ミロラド・パヴィチ",
    year: 1984,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "中世に消滅したとされるハザール族の改宗をめぐる伝承を、キリスト教・イスラム教・ユダヤ教それぞれの視点からの項目として辞書形式で並べた小説。読む順序を読者に委ねる構成を持つ。",
    tagIds: ["t_lexicon_form", "t_fragmentary", "t_nonlinear_time"]
  },
  {
    titles: ["青白い炎"],
    author: "ウラジーミル・ナボコフ",
    year: 1962,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "亡命詩人シェイドの999行の詩と、それに付された隣人キンボートによる長大な注釈から構成される。注釈は次第に詩の解釈から逸脱し、キンボート自身の妄想的な物語（自らを亡国の王だと語る）を語り出す。",
    tagIds: ["t_annotative_narrative", "t_unreliable_narrator", "t_frame_story"]
  },
  {
    titles: ["ドラキュラ"],
    author: "ブラム・ストーカー",
    year: 1897,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "トランシルヴァニアの吸血鬼ドラキュラ伯爵とその脅威を、弁護士ハーカーの日記、ミナやルーシーの手紙、新聞記事、蓄音機の記録など複数の書き手による文書を集めた書簡体形式で描くゴシック小説。",
    tagIds: ["t_epistolary_form", "t_multiple_internal_focalization", "t_foreboding"]
  },
  {
    titles: ["フランケンシュタイン"],
    author: "メアリー・シェリー",
    year: 1818,
    axes: { length: "長編", reception: "読解", form: "文字" },
    synopsis: "北極探検家ウォルトンの手紙の中に科学者フランケンシュタインの物語が語られ、さらにその中で彼が創造した怪物自身の物語が語られるという三重の入れ子構造を持つ。生命創造の代償と孤独を描くゴシック小説の古典。",
    tagIds: ["t_epistolary_form", "t_frame_story", "t_sublime", "t_pathos"]
  }
];
