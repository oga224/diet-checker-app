// 店舗管理画面の「氏名非表示モード」状態（タブ単位のsessionStorageで保持）。
// 目的：来院中の顧客に他の顧客の一覧・詳細を見せる際、氏名・フリガナ・生年月日を伏せるため。
// 他店舗閲覧時の匿名化（isRestricted）とは別の、閲覧者側のローカル表示切替であり、
// DBの値は一切変更しない（表示のみを切り替える）。

const NAME_HIDDEN_KEY = 'dietchecker_admin_nameHidden'

export function readNameHidden() {
  try {
    return sessionStorage.getItem(NAME_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeNameHidden(hidden) {
  try {
    sessionStorage.setItem(NAME_HIDDEN_KEY, hidden ? 'true' : 'false')
  } catch {
    // sessionStorage が使えない環境では何もしない（表示はそのセッション中のみ反映）
  }
}
