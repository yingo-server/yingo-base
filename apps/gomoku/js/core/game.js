import Board from './board.js';
import Renderer from './renderer.js';
import { playDropSound } from '../utils/sound.js';
import { getBoardIndexFromClick } from '../utils/helpers.js';
import { BOARD_SIZE, ANIMATION_DURATION } from '../utils/constants.js';
import { showToast } from '../ui/toast.js';

export default class Game {
    constructor(canvas, resetBtn) {
        this.canvas = canvas;
        this.resetBtn = resetBtn;
        this.board = new Board();
        this.renderer = new Renderer(canvas);
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.animatingPiece = null;
        this.animationFrame = null;
        this.lastMove = null;
        this._firstTurnToast = true; // 标记首次显示

        this.initEventListeners();
        this.startAnimationLoop();
        this.render();
        this.showTurnToast(true); // 首次显示3秒
    }

    initEventListeners() {
        this.canvas.addEventListener('click', this.handleCanvasClick.bind(this));
        this.resetBtn.addEventListener('click', this.reset.bind(this));
    }

    showTurnToast(initial = false) {
        if (this.gameOver) return;
        const playerName = this.currentPlayer === 1 ? '黑方' : '白方';
        const duration = initial ? 3000 : 1000;
        showToast(`${playerName}回合`, 'success', duration);
    }

    showGameOverToast() {
        if (this.winner === 1) {
            showToast('黑方胜利', 'success', 3000);
        } else if (this.winner === 2) {
            showToast('白方胜利', 'success', 3000);
        } else if (this.winner === 'draw') {
            showToast('无人获胜', 'success', 3000);
        }
    }

    handleCanvasClick(e) {
        if (this.gameOver) return;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;
        const index = getBoardIndexFromClick(mouseX, mouseY);
        if (!index) return;

        const { row, col } = index;
        if (!this.board.isCellEmpty(row, col)) return;

        this.placePiece(row, col, this.currentPlayer);
    }

    placePiece(row, col, player) {
        this.board.setPiece(row, col, player);
        playDropSound();
        this.animatingPiece = { row, col, startTime: Date.now() };
        this.lastMove = { row, col };

        const winner = this.checkWinner(row, col);
        if (winner) {
            this.gameOver = true;
            this.winner = winner;
            this.showGameOverToast();
            this.render();
            return;
        }
        if (this.board.isFull()) {
            this.gameOver = true;
            this.winner = 'draw';
            this.showGameOverToast();
            this.render();
            return;
        }

        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.render();
        this.showTurnToast(!this._firstTurnToast ? false : (this._firstTurnToast = false));
    }

    checkWinner(row, col) {
        const player = this.board.getPiece(row, col);
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let [dx, dy] of directions) {
            let count = 1;
            for (let step = 1; step < 5; step++) {
                const nr = row + dx * step;
                const nc = col + dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || this.board.getPiece(nr, nc) !== player) break;
                count++;
            }
            for (let step = 1; step < 5; step++) {
                const nr = row - dx * step;
                const nc = col - dy * step;
                if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE || this.board.getPiece(nr, nc) !== player) break;
                count++;
            }
            if (count >= 5) return player;
        }
        return null;
    }

    render() {
        if (this.animatingPiece) {
            const elapsed = Date.now() - this.animatingPiece.startTime;
            if (elapsed >= ANIMATION_DURATION) {
                this.animatingPiece = null;
            }
        }
        this.renderer.draw(this.board.grid, this.currentPlayer, this.animatingPiece, this.lastMove);
    }

    startAnimationLoop() {
        const loop = () => {
            this.render();
            this.animationFrame = requestAnimationFrame(loop);
        };
        this.animationFrame = requestAnimationFrame(loop);
    }

    reset() {
        this.board.reset();
        this.currentPlayer = 1;
        this.gameOver = false;
        this.winner = null;
        this.animatingPiece = null;
        this.lastMove = null;
        this._firstTurnToast = true;
        this.render();
        this.showTurnToast(true);
    }
}