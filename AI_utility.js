// ユーティリティ（スコアベース）AIロジック
// decideNextAction_utility(character, isNight) をエクスポート

export function decideNextAction_utility(character, isNight) {
    // Dummy: always wander (for toggle test)
    character.setNextAction('WANDER');
}
