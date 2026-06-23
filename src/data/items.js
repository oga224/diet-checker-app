export const ITEMS_DATA = [
  { id: 1,  category: '飲み物',      name: '缶コーヒー / エナジードリンク',    defaultPrice:  160, kcal:  100 },
  { id: 2,  category: '飲み物',      name: 'カフェラテ / ジュース類',           defaultPrice:  250, kcal:  180 },
  { id: 3,  category: '飲み物',      name: 'フラペチーノ / 甘い専門店ドリンク', defaultPrice:  650, kcal:  400 },
  { id: 4,  category: '間食',        name: 'チョコレート / スナック菓子',        defaultPrice:  180, kcal:  350 },
  { id: 5,  category: '間食',        name: '菓子パン / 和菓子',                 defaultPrice:  200, kcal:  400 },
  { id: 6,  category: '間食',        name: 'アイスクリーム',                     defaultPrice:  220, kcal:  250 },
  { id: 7,  category: '食事',        name: 'ラーメン / 牛丼 / ファストフード',  defaultPrice:  800, kcal:  850 },
  { id: 8,  category: '食事',        name: 'コンビニ弁当 / 惣菜',               defaultPrice:  650, kcal:  700 },
  { id: 9,  category: '食事',        name: '夜食 / 深夜の出前',                 defaultPrice: 1500, kcal:  900 },
  { id: 10, category: 'アルコール',  name: 'ビール / チューハイ類',             defaultPrice:  300, kcal:  200 },
  { id: 11, category: 'アルコール',  name: '居酒屋 / 外食（アルコール含む）',   defaultPrice: 5000, kcal: 1200 },
]

export const CATEGORIES = ['飲み物', '間食', '食事', 'アルコール']

export const CAT_CONFIG = {
  '飲み物':     { color: '#C9A96E', bg: '#FFFCF5', badge: '#FEF3DC', icon: '☕' },
  '間食':       { color: '#C4897B', bg: '#FFF8F7', badge: '#FCEAE7', icon: '🍫' },
  '食事':       { color: '#3D5A8A', bg: '#F5F7FC', badge: '#E4EAF7', icon: '🍽️' },
  'アルコール': { color: '#7B98B2', bg: '#F4F7FA', badge: '#E1EAF3', icon: '🍺' },
}

export const fmt = (n) => Math.round(n).toLocaleString('ja-JP')
