import { BOARD_SIZE } from '../utils/constants.js';

function checkLineForLiveThree(line, player) {
    const len = line.length; // 5
    // 连续三子
    for (let i = 0; i <= 2; i++) {
        if (line[i] === player && line[i+1] === player && line[i+2] === player) {
            const leftOk = (i > 0) ? (line[i-1] === 0) : false;
            const rightOk = (i+2 < len-1) ? (line[i+3] === 0) : false;
            if (leftOk && rightOk) return true;
        }
    }
    // 跳三 X0XX
    for (let i = 0; i <= 1; i++) {
        if (line[i] === player && line[i+2] === player && line[i+3] === player && line[i+1] === 0) {
            const leftOk = (i > 0) ? (line[i-1] === 0) : false;
            const rightOk = (i+3 < len-1) ? (line[i+4] === 0) : false;
            if (leftOk && rightOk) return true;
        }
    }
    // 跳三 XX0X
    for (let i = 0; i <= 1; i++) {
        if (line[i] === player && line[i+1] === player && line[i+3] === player && line[i+2] === 0) {
            const leftOk = (i > 0) ? (line[i-1] === 0) : false;
            const rightOk = (i+3 < len-1) ? (line[i+4] === 0) : false;
            if (leftOk && rightOk) return true;
        }
    }
    return false;
}

function hasLiveThreeInArea(board, centerRow, centerCol, player) {
    const half = 2;
    for (let r = centerRow - half; r <= centerRow + half; r++) {
        for (let c = centerCol - half; c <= centerCol + half; c++) {
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;

            // 水平
            if (c + 4 < BOARD_SIZE) {
                const line = [
                    board[r][c], board[r][c+1], board[r][c+2], board[r][c+3], board[r][c+4]
                ];
                if (checkLineForLiveThree(line, player)) return true;
            }

            // 垂直
            if (r + 4 < BOARD_SIZE) {
                const line = [
                    board[r][c], board[r+1][c], board[r+2][c], board[r+3][c], board[r+4][c]
                ];
                if (checkLineForLiveThree(line, player)) return true;
            }

            // 主对角线
            if (r + 4 < BOARD_SIZE && c + 4 < BOARD_SIZE) {
                const line = [
                    board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3], board[r+4][c+4]
                ];
                if (checkLineForLiveThree(line, player)) return true;
            }

            // 副对角线
            if (r + 4 < BOARD_SIZE && c - 4 >= 0) {
                const line = [
                    board[r][c], board[r+1][c-1], board[r+2][c-2], board[r+3][c-3], board[r+4][c-4]
                ];
                if (checkLineForLiveThree(line, player)) return true;
            }
        }
    }
    return false;
}

function detectFourOrFive(board, row, col, player) {
    const dirs = [[1,0],[0,1],[1,1],[1,-1]];
    for (let [dx, dy] of dirs) {
        let count = 1;
        let leftBlocked = false, rightBlocked = false;

        // 正方向延伸
        for (let step = 1; step < 5; step++) {
            const nr = row + dx * step, nc = col + dy * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
                rightBlocked = true;
                break;
            }
            if (board[nr][nc] === player) count++;
            else if (board[nr][nc] === 0) break;
            else {
                rightBlocked = true;
                break;
            }
        }

        // 负方向延伸
        for (let step = 1; step < 5; step++) {
            const nr = row - dx * step, nc = col - dy * step;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
                leftBlocked = true;
                break;
            }
            if (board[nr][nc] === player) count++;
            else if (board[nr][nc] === 0) break;
            else {
                leftBlocked = true;
                break;
            }
        }

        if (count >= 5) return 10000; // 连五
        if (count === 4) {
            // 活四：两端均无阻挡
            if (!leftBlocked && !rightBlocked) return 1060;
            // 冲四：一端有阻挡
            if ((leftBlocked && !rightBlocked) || (!leftBlocked && rightBlocked)) return 1100;
        }
    }
    return 0;
}

export function getThreatLevel(board, row, col, player) {
    if (board[row][col] !== 0) return 0;

    const tempBoard = board.map(r => [...r]);
    tempBoard[row][col] = player;

    const fourOrFive = detectFourOrFive(tempBoard, row, col, player);
    if (fourOrFive >= 10000) return fourOrFive;
    if (fourOrFive >= 1060) return fourOrFive;

    if (hasLiveThreeInArea(tempBoard, row, col, player)) {
        return 1050;
    }

    return 0;
}

export function hasExistingLiveThree(board, player) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c] !== player) continue;
            if (hasLiveThreeInArea(board, r, c, player)) {
                return true;
            }
        }
    }
    return false;
}