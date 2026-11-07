// js/ai/evaluator.js
// 移植自 gomoku.js 的 AI 逻辑，完全保留原算法

const BOARD_SIZE = 15;

// 工具函数：验证坐标是否有效
function valid(i) {
    return i >= 0 && i < BOARD_SIZE && typeof i === 'number' && !isNaN(i);
}

// 深度复制棋盘
function copyBoard(board) {
    return board.map(row => [...row]);
}

// 获取水平方向状态（原 _getHorizontalState）
function getHorizontalState(board, i, j, player) {
    if (!valid(i) || !valid(j)) return {};

    let m = 1,
        chessCount = 1,
        end = false,
        skip = 0,
        firstChess = { i: i, j: j },
        lastChess = { i: i, j: j },
        chessSpan = 0,
        aliveCount = 0,
        alive = true,
        aliveSidesCount = 0,
        available = [],
        chess = [];

    // 向右延伸
    while (valid(j + m)) {
        if (end) break;
        if (skip > 1) break;
        switch (board[i][j + m]) {
            case 0:
                if (skip === 0 || board[i][j + m - 1] !== 0) {
                    available.push({ i: i, j: j + m });
                }
                skip++;
                break;
            case player:
                chessCount++;
                chess.push({ i: i, j: j + m });
                lastChess = { i: i, j: j + m };
                break;
            default:
                end = true;
        }
        m++;
    }
    end = false;
    skip = 0;
    m = 1;
    // 向左延伸
    while (valid(j - m)) {
        if (end) break;
        if (skip > 1) break;
        switch (board[i][j - m]) {
            case 0:
                if (skip === 0 || board[i][j - m + 1] !== 0) {
                    available.push({ i: i, j: j - m });
                }
                skip++;
                break;
            case player:
                firstChess = { i: i, j: j - m };
                chessCount++;
                chess.push({ i: i, j: j - m });
                break;
            default:
                end = true;
        }
        m++;
    }
    chessSpan = lastChess.j - firstChess.j + 1;

    let connetedChessCount = [1],
        tmpCount = 1,
        invalidCount = 0;
    m = 1;
    while (valid(firstChess.j + m)) {
        if (board[firstChess.i][firstChess.j + m] !== player) {
            invalidCount++;
            if (invalidCount > 1) break;
            if (tmpCount < 10) tmpCount = 0;
            else break;
        } else {
            tmpCount++;
            connetedChessCount.push(tmpCount);
        }
        m++;
    }
    for (m = 0; m < chessSpan; m++) {
        if ([0, player].indexOf(board[firstChess.i][firstChess.j + m]) >= 0) {
            aliveCount++;
        }
    }
    try {
        if ([0, player].indexOf(board[firstChess.i][firstChess.j - 1]) >= 0) {
            aliveSidesCount++;
        }
    } catch (e) {}
    try {
        if ([0, player].indexOf(board[firstChess.i][firstChess.j + 1]) >= 0) {
            aliveSidesCount++;
        }
    } catch (e) {}
    if (aliveCount < 4) {
        alive = aliveSidesCount > 0;
    }
    return {
        alive: alive,
        aliveSidesCount: aliveSidesCount,
        available: available,
        chess: chess,
        chessCount: chessCount,
        connetedChessCount: Math.min(Math.max.apply(null, connetedChessCount), chessCount)
    };
}

// 获取对角线方向状态（原 _getDiagonalState）
function getDiagonalState(board, i, j, player) {
    if (!valid(i) || !valid(j)) return {};

    let chessCount = 1,
        end = false,
        skip = 0,
        alive = true,
        aliveCount = 0,
        aliveSidesCount = 0,
        firstChess = { i: i, j: j },
        lastChess = { i: i, j: j },
        chessSpan = 0,
        m = 1,
        available = [],
        chess = [];

    // 右下延伸
    while (valid(i + m) && valid(j + m)) {
        if (end) break;
        if (skip > 1) break;
        switch (board[i + m][j + m]) {
            case 0:
                if (skip === 0 || board[i + m - 1][j + m - 1] !== 0) {
                    available.push({ i: i + m, j: j + m });
                }
                skip++;
                break;
            case player:
                chessCount++;
                chess.push({ i: i + m, j: j + m });
                lastChess = { i: i + m, j: j + m };
                break;
            default:
                end = true;
        }
        m++;
    }
    end = false;
    skip = 0;
    m = 1;
    // 左上延伸
    while (valid(i - m) && valid(j - m)) {
        if (end) break;
        if (skip > 1) break;
        switch (board[i - m][j - m]) {
            case 0:
                if (skip === 0 || board[i - m + 1][j - m + 1] !== 0) {
                    available.push({ i: i - m, j: j - m });
                }
                skip++;
                break;
            case player:
                firstChess = { i: i - m, j: j - m };
                chessCount++;
                chess.push({ i: i - m, j: j - m });
                break;
            default:
                end = true;
        }
        m++;
    }
    chessSpan = lastChess.i - firstChess.i + 1;

    let connetedChessCount = [1],
        tmpCount = 1,
        invalidCount = 0;
    m = 1;
    while (valid(firstChess.i + m) && valid(firstChess.j + m)) {
        if (board[firstChess.i + m][firstChess.j + m] !== player) {
            invalidCount++;
            if (invalidCount > 1) break;
            if (tmpCount < 10) tmpCount = 0;
            else break;
        } else {
            tmpCount++;
            connetedChessCount.push(tmpCount);
        }
        m++;
    }
    for (m = 0; m < chessSpan; m++) {
        if ([0, player].indexOf(board[firstChess.i + m][firstChess.j + m]) >= 0) {
            aliveCount++;
        }
    }
    try {
        if ([0, player].indexOf(board[firstChess.i - 1][firstChess.j - 1]) >= 0) {
            aliveSidesCount++;
        }
    } catch (e) {}
    try {
        if ([0, player].indexOf(board[firstChess.i + 1][firstChess.j + 1]) >= 0) {
            aliveSidesCount++;
        }
    } catch (e) {}
    if (aliveCount < 4) {
        alive = aliveSidesCount > 0;
    }
    return {
        alive: alive,
        aliveSidesCount: aliveSidesCount,
        available: available,
        chess: chess,
        chessCount: chessCount,
        connetedChessCount: Math.min(Math.max.apply(null, connetedChessCount), chessCount)
    };
}

// 旋转棋盘（顺时针90度），原 _rotateChessStateClockwise90
function rotateClockwise(board, row, col) {
    let newBoard = [];
    for (let i = BOARD_SIZE - 1; i >= 0; i--) {
        let rowArr = [];
        for (let j = BOARD_SIZE - 1; j >= 0; j--) {
            rowArr.push(board[j][BOARD_SIZE - 1 - i]);
        }
        newBoard.push(rowArr);
    }
    if (row !== undefined && col !== undefined) {
        let newRow = col;
        let newCol = BOARD_SIZE - 1 - row;
        return { board: newBoard, row: newRow, col: newCol };
    }
    return { board: newBoard };
}

// 逆时针旋转90度，原 _rotateChessStateAnticlockwise90
function rotateAnticlockwise(board, row, col) {
    let newBoard = [];
    for (let i = BOARD_SIZE - 1; i >= 0; i--) {
        let rowArr = [];
        for (let j = BOARD_SIZE - 1; j >= 0; j--) {
            rowArr.push(board[BOARD_SIZE - 1 - j][i]);
        }
        newBoard.push(rowArr);
    }
    if (row !== undefined && col !== undefined) {
        let newRow = BOARD_SIZE - 1 - col;
        let newCol = row;
        return { board: newBoard, row: newRow, col: newCol };
    }
    return { board: newBoard };
}

// 获取四个方向的状态（原 _getState）
function getState(board, row, col, player) {
    // 水平状态
    let hState = getHorizontalState(board, row, col, player);
    // 对角线状态
    let dState = getDiagonalState(board, row, col, player);

    // 旋转后水平状态（原垂直方向）
    let rotated = rotateClockwise(board, row, col);
    let hState2 = getHorizontalState(rotated.board, rotated.row, rotated.col, player);
    // 将坐标转回原坐标系
    if (hState2.available) {
        hState2.available = hState2.available.map(p => {
            let r = p.i, c = p.j;
            // 逆时针旋转回去
            let anticlock = rotateAnticlockwise(rotated.board, r, c);
            return { i: anticlock.row, j: anticlock.col };
        });
    }

    // 旋转后对角线状态（原另一对角线）
    let dState2 = getDiagonalState(rotated.board, rotated.row, rotated.col, player);
    if (dState2.available) {
        dState2.available = dState2.available.map(p => {
            let r = p.i, c = p.j;
            let anticlock = rotateAnticlockwise(rotated.board, r, c);
            return { i: anticlock.row, j: anticlock.col };
        });
    }

    return [hState, hState2, dState, dState2];
}

// 计算优先级（原 _getPriority）
function getPriority(stateArray, player, aiPlayer, humanPlayer) {
    let chess = [
        null,
        { count: 0, aliveSidesCount: 0 },
        { count: 0, aliveSidesCount: 0 },
        { count: 0, aliveSidesCount: 0 },
        { count: 0, aliveSidesCount: 0 },
        { count: 0, aliveSidesCount: 0 }
    ];

    stateArray.forEach(v => {
        if (v.connetedChessCount >= 5) {
            chess[5].count++;
        } else {
            if (v.connetedChessCount === 4 && v.alive) {
                chess[4].count++;
                chess[4].aliveSidesCount = v.aliveSidesCount;
            } else {
                if (v.available && v.available.length > 1 && v.alive) {
                    chess[v.connetedChessCount].count++;
                    chess[v.connetedChessCount].aliveSidesCount = v.aliveSidesCount;
                }
            }
        }
    });

    let priority;
    if (chess[5].count > 0) {
        priority = player === aiPlayer ? 4 : 3;
    } else if (chess[4].count > 0 && chess[4].aliveSidesCount > 1) {
        priority = player === aiPlayer ? 2 : 1;
    } else if (chess[3].count >= 2) {
        priority = player === aiPlayer ? 0 : -1;
    } else if (chess[4].count > 0 && chess[4].aliveSidesCount === 1) {
        priority = player === aiPlayer ? -2 : -3;
    } else if (chess[3].count === 1) {
        priority = player === aiPlayer ? -4 : -5;
    } else if (chess[2].count > 0) {
        priority = player === aiPlayer ? -6 : -7;
    } else {
        priority = -100;
    }
    return priority;
}

// 主评估函数（原 _findPotentialDominantPosition）
function findBestMove(board, aiPlayer) {
    const humanPlayer = aiPlayer === 1 ? 2 : 1;
    let candidates = [];

    for (let i = 0; i < BOARD_SIZE; i++) {
        for (let j = 0; j < BOARD_SIZE; j++) {
            if (board[i][j] === 0) {
                // 评估AI下子
                let tempBoard = copyBoard(board);
                tempBoard[i][j] = aiPlayer;
                let stateAI = getState(tempBoard, i, j, aiPlayer);
                let priorityAI = getPriority(stateAI, aiPlayer, aiPlayer, humanPlayer);

                // 评估人类下子
                tempBoard = copyBoard(board);
                tempBoard[i][j] = humanPlayer;
                let stateHuman = getState(tempBoard, i, j, humanPlayer);
                let priorityHuman = getPriority(stateHuman, humanPlayer, aiPlayer, humanPlayer);

                candidates.push({ i, j, priority: priorityAI });
                candidates.push({ i, j, priority: priorityHuman });
            }
        }
    }

    if (candidates.length === 0) {
        // 无候选点，返回中心
        return [7, 7];
    }

    // 找到最大优先级
    let maxPriority = Math.max.apply(null, candidates.map(c => c.priority));
    for (let c of candidates) {
        if (c.priority === maxPriority) {
            return [c.i, c.j];
        }
    }
    return [7, 7];
}

/**
 * 导出评估函数
 * @param {Array} board 当前棋盘 (15x15)
 * @param {number} aiPlayer AI执子颜色 (1黑 2白)
 * @param {number} step 当前步数（未使用，保留接口）
 * @returns {Array} [row, col]
 */
export function evaluate(board, aiPlayer, step) {
    console.group(`===== AI 决策 (移植自 gomoku.js，AI 为 ${aiPlayer === 1 ? '黑方' : '白方'}) =====`);
    const start = Date.now();
    const move = findBestMove(board, aiPlayer);
    const elapsed = Date.now() - start;
    console.log(`选择: (${move[0]},${move[1]})，耗时 ${elapsed}ms`);
    console.groupEnd();
    return move;
}