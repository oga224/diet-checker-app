// お客さん一覧（ClientListPage）と顧客詳細（ClientDetailPage）の間で
// 選択中の店舗・スクロール位置の復元をやり取りするための共通キー定義

export const STORE_QUERY_PARAM = 'store'
export const STORE_ALL_VALUE = 'all'

// 直接URLアクセスなど「戻り先の一覧が履歴に無い」場合に使う、選択中店舗のフォールバック保存先
export const SELECTED_STORE_STORAGE_KEY = 'dietchecker_admin_selectedStore'

// 「顧客詳細から戻ってきた」ことを示す一度きりのフラグ（一覧マウント時に読み取って消費する）
export const RETURN_FLAG_STORAGE_KEY = 'dietchecker_clientsReturnFlag'

// 店舗ごとに一覧のスクロール位置を分けて保存する
export function scrollPosKey(storeId) {
  return `dietchecker_clientsScrollPos_${storeId || 'ALL'}`
}
