// ─── 選択肢テンプレート ───────────────────────────────────────────
export const WEEKLY_OPTS = [
  { label: 'ほとんどない',  sub: '月0〜1回',      value: 0   },
  { label: '週1〜2回',      sub: '月4〜8回ほど',   value: 1.5 },
  { label: '週3〜4回',      sub: '月12〜16回ほど', value: 3.5 },
  { label: 'ほぼ毎日',      sub: '月25回以上',     value: 7   },
]

export const MEDICAL_OPTS = [
  { label: '通っていない',  sub: '',               value: 0 },
  { label: '月1回',         sub: '',               value: 1 },
  { label: '月2回',         sub: '',               value: 2 },
  { label: '月4回以上',     sub: '週1以上のペース', value: 4 },
]

export const SHOPPING_OPTS = [
  { label: 'ほとんどない',  sub: '年にあるかどうか',  value: 0     },
  { label: 'たまにある',    sub: '月2,000円ほど',     value: 2000  },
  { label: '毎月ある',      sub: '月5,000円ほど',     value: 5000  },
  { label: 'よくある',      sub: '月10,000円ほど',    value: 10000 },
]

export const TIMELOSS_OPTS = [
  { label: 'ほぼない',       sub: '',                    value: 0 },
  { label: '月1時間ほど',    sub: '移動・待合を含む',     value: 1 },
  { label: '月3時間ほど',    sub: '移動・待合を含む',     value: 3 },
  { label: '月5時間以上',    sub: 'かなりの時間を使っている', value: 5 },
]

// ─── 質問一覧 (20問) ─────────────────────────────────────────────
// type: 'drink' | 'food' | 'medical' | 'timeLoss' | 'costOnly'
// drink/food → options値 = 週回数、計算: price × value × 4.3
// medical    → options値 = 月回数、計算: price × value
// costOnly   → options値 = 月額（円）、そのまま加算
// timeLoss   → options値 = 月時間数

export const QUESTIONS = [
  {
    id: 1, type: 'drink', icon: '☕',
    category: '飲み物',
    question: 'コンビニやカフェで\nコーヒー・カフェラテを買う頻度は？',
    hint: 'ノンシュガーでも「毎日の習慣出費」として振り返ってみましょう',
    options: WEEKLY_OPTS,
    defaultPrice: 250, kcal: 100,
  },
  {
    id: 2, type: 'drink', icon: '🧴',
    category: '飲み物',
    question: 'ペットボトル飲料を\n購入する頻度は？',
    hint: 'お茶・水・スポーツドリンクなど購入しているものすべて',
    options: WEEKLY_OPTS,
    defaultPrice: 160, kcal: 60,
  },
  {
    id: 3, type: 'drink', icon: '🧋',
    category: '飲み物',
    question: '甘い飲み物・ジュース・\nフラペチーノを買う頻度は？',
    hint: 'スターバックスなどの高カロリードリンクも含みます',
    options: WEEKLY_OPTS,
    defaultPrice: 500, kcal: 350,
  },
  {
    id: 4, type: 'drink', icon: '⚡',
    category: '飲み物',
    question: 'エナジードリンクを\n飲む頻度は？',
    hint: '眠気覚ましや仕事中の習慣的な一本として',
    options: WEEKLY_OPTS,
    defaultPrice: 250, kcal: 150,
  },
  {
    id: 5, type: 'food', icon: '🍫',
    category: '間食',
    question: 'お菓子・チョコ・スナックを\n食べる頻度は？',
    hint: 'ちょっとしたご褒美タイムも含めて振り返ってみましょう',
    options: WEEKLY_OPTS,
    defaultPrice: 250, kcal: 350,
  },
  {
    id: 6, type: 'food', icon: '🍦',
    category: '間食',
    question: 'コンビニスイーツ・アイスを\n食べる頻度は？',
    hint: '疲れた日の甘いものも習慣として含めてみましょう',
    options: WEEKLY_OPTS,
    defaultPrice: 350, kcal: 350,
  },
  {
    id: 7, type: 'food', icon: '🥐',
    category: '間食',
    question: '菓子パン・惣菜パンを\n食べる頻度は？',
    hint: '朝食や昼食代わりにもなる習慣の一つとして',
    options: WEEKLY_OPTS,
    defaultPrice: 220, kcal: 400,
  },
  {
    id: 8, type: 'food', icon: '🍔',
    category: '外食',
    question: 'ファストフードを\n食べる頻度は？',
    hint: '忙しい日のランチや気分転換の外食として',
    options: WEEKLY_OPTS,
    defaultPrice: 800, kcal: 850,
  },
  {
    id: 9, type: 'food', icon: '🍜',
    category: '外食',
    question: 'ラーメン・丼もの・カレーを\n食べる頻度は？',
    hint: '外食・出前・テイクアウトを含みます',
    options: WEEKLY_OPTS,
    defaultPrice: 950, kcal: 900,
  },
  {
    id: 10, type: 'food', icon: '🌙',
    category: '外食',
    question: '夜食・深夜の出前・\nフードデリバリーを利用する頻度は？',
    hint: 'Uber Eatsや出前館なども含みます',
    options: WEEKLY_OPTS,
    defaultPrice: 1500, kcal: 900,
  },
  {
    id: 11, type: 'drink', icon: '🍺',
    category: 'アルコール',
    question: 'お酒を飲む頻度は？',
    hint: '自宅での晩酌も含みます',
    options: WEEKLY_OPTS,
    defaultPrice: 500, kcal: 250,
  },
  {
    id: 12, type: 'food', icon: '🥂',
    category: 'アルコール',
    question: '飲み会・居酒屋など\n外食（お酒あり）の頻度は？',
    hint: '交際費や付き合いの飲みも含めてください',
    options: WEEKLY_OPTS,
    defaultPrice: 5000, kcal: 1200,
  },
  {
    id: 13, type: 'medical', icon: '💆',
    category: '体のケア',
    question: '腰痛・肩こり・疲労感で\n整体やマッサージに通っていますか？',
    hint: '体の不調を和らげるためのケア費用として',
    options: MEDICAL_OPTS,
    defaultPrice: 5000,
  },
  {
    id: 14, type: 'medical', icon: '🦵',
    category: '体のケア',
    question: '膝の痛み・足の疲れで\n治療やケアにお金を使っていますか？',
    hint: '整骨院・クリニック・セルフケアグッズなど',
    options: MEDICAL_OPTS,
    defaultPrice: 4000,
  },
  {
    id: 15, type: 'medical', icon: '🏥',
    category: '体のケア',
    question: '血圧・コレステロール・血糖値など\n病院や薬に費用がかかっていますか？',
    hint: '定期通院・薬代・検査費用を含みます',
    options: MEDICAL_OPTS,
    defaultPrice: 3000,
  },
  {
    id: 16, type: 'timeLoss', icon: '⏰',
    category: '時間の損失',
    question: '病院・薬局・整体などへの\n移動や待ち時間は月にどれくらい？',
    hint: '往復の移動時間と待合室での時間を合わせて',
    options: TIMELOSS_OPTS,
  },
  {
    id: 17, type: 'costOnly', icon: '👗',
    category: '体型カバー',
    question: '体型を隠すための服や\nインナーを買うことがありますか？',
    hint: '「着やせ効果」を意識して選ぶ服も含みます',
    options: SHOPPING_OPTS,
  },
  {
    id: 18, type: 'costOnly', icon: '👔',
    category: '体型カバー',
    question: '本当は着たい服ではなく\n体型カバー優先で服を選んでいますか？',
    hint: 'なりたい自分の服より「今の体型に合わせた服」選び',
    options: SHOPPING_OPTS,
  },
  {
    id: 19, type: 'costOnly', icon: '💊',
    category: '過去の出費',
    question: '続かなかったサプリ・ダイエット食品・\n器具にお金を使ったことがありますか？',
    hint: '効果が出る前にやめてしまったものも含みます',
    options: SHOPPING_OPTS,
  },
  {
    id: 20, type: 'costOnly', icon: '🚕',
    category: '体の重さによる出費',
    question: '疲れやすさや体の重さで\nタクシーや配送サービスが増えていますか？',
    hint: '「歩くのがつらい」と感じてサービスを使う機会として',
    options: SHOPPING_OPTS,
  },
]

// ─── カテゴリカラー設定 ──────────────────────────────────────────
export const PIE_CATEGORIES = [
  { key: 'drink',    label: '飲み物',     color: '#C9A96E' },
  { key: 'food',     label: '食べ物',     color: '#C4897B' },
  { key: 'medical',  label: '医療・ケア', color: '#7B98B2' },
  { key: 'costOnly', label: '習慣出費',   color: '#D4856A' },
  { key: 'timeLoss', label: '時間の損失', color: '#9B8EA8' },
]

// ─── 計算ロジック ─────────────────────────────────────────────────
export function calcResults(answers) {
  const monthly = { drink: 0, food: 0, medical: 0, costOnly: 0, timeLoss: 0 }
  let monthlyKcal = 0
  let monthlyTimeLossHours = 0

  QUESTIONS.forEach((q) => {
    const val = answers[q.id]
    if (val === undefined || val === null) return

    switch (q.type) {
      case 'drink':
        monthly.drink  += q.defaultPrice * val * 4.3
        monthlyKcal    += (q.kcal || 0) * val * 4.3
        break
      case 'food':
        monthly.food   += q.defaultPrice * val * 4.3
        monthlyKcal    += (q.kcal || 0) * val * 4.3
        break
      case 'medical':
        monthly.medical += q.defaultPrice * val
        break
      case 'costOnly':
        monthly.costOnly += val
        break
      case 'timeLoss':
        monthlyTimeLossHours += val
        monthly.timeLoss      += val * 1500
        break
      default:
        break
    }
  })

  const totalMonthly = Object.values(monthly).reduce((a, b) => a + b, 0)

  return {
    monthly,
    totalMonthly,
    annualTotal:   totalMonthly * 12,
    fiveYearTotal: totalMonthly * 12 * 5,
    monthlyKcal,
    monthlyFatKg:        monthlyKcal / 7200,
    monthlyTimeLossHours,
    annualTimeLossHours: monthlyTimeLossHours * 12,
    annualTimeLossValue: monthlyTimeLossHours * 12 * 1500,
  }
}

export const fmt = (n) => Math.round(n).toLocaleString('ja-JP')
