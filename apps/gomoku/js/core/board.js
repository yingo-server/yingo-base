import { BOARD_SIZE } from '../utils/constants.js';

export default class Board {
    constructor() {
        this.grid = this.createEmptyBoard();
    }
    createEmptyBoard() {
        return Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
    }
    reset() {
        this.grid = this.createEmptyBoard();
    }
    isCellEmpty(row, col) {
        return this.grid[row][col] === 0;
    }
    setPiece(row, col, player) {
        if (this.isCellEmpty(row, col)) {
            this.grid[row][col] = player;
            return true;
        }
        return false;
    }
    getPiece(row, col) {
        return this.grid[row][col];
    }
    isFull() {
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.grid[r][c] === 0) return false;
            }
        }
        return true;
    }
}