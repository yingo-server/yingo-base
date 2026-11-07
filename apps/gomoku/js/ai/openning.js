// 简易开局库：前3步固定走法 (假设AI为黑棋，人类为白棋)
export const openingBook = [
    { move: 1, black: [7, 7] },                // 第1步黑棋天元
    { move: 2, white: [7, 8] },                 // 第2步白棋常见
    { move: 3, black: [8, 7] }                  // 第3步黑棋
];

/**
 * 根据当前步数返回建议落子
 * @param {number} step 当前步数（从1开始）
 * @param {number} player 当前玩家 1黑 2白
 * @returns {Array|null} [row, col] 或 null
 */
export function getOpeningMove(step, player) {
    const entry = openingBook.find(e => e.move === step);
    if (!entry) return null;
    return player === 1 ? entry.black : entry.white;
}