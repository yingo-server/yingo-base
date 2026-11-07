import { BOARD_SIZE, CANVAS_SIZE, MARGIN, CELL_SIZE, PIECE_RADIUS, ANIMATION_DURATION } from '../utils/constants.js';

export default class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
    }

    /**
     * 绘制棋盘
     * @param {Array} board 棋盘二维数组
     * @param {number} currentPlayer 当前玩家（用于回合显示，未使用）
     * @param {Object} animatingPiece 正在动画的棋子 {row, col, startTime}
     * @param {Object} lastMove 最后落子位置 {row, col}（用于显示标记）
     */
    draw(board, currentPlayer, animatingPiece = null, lastMove = null) {
        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.fillStyle = '#ecd5b0';
        this.ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.drawGrid();
        this.drawStars();
        this.drawPieces(board, animatingPiece, lastMove);
    }

    drawGrid() {
        this.ctx.lineWidth = 1.8;
        this.ctx.strokeStyle = '#6b4f32';
        for (let i = 0; i < BOARD_SIZE; i++) {
            const x = MARGIN + i * CELL_SIZE;
            this.ctx.beginPath();
            this.ctx.moveTo(x, MARGIN);
            this.ctx.lineTo(x, CANVAS_SIZE - MARGIN);
            this.ctx.stroke();
            const y = MARGIN + i * CELL_SIZE;
            this.ctx.beginPath();
            this.ctx.moveTo(MARGIN, y);
            this.ctx.lineTo(CANVAS_SIZE - MARGIN, y);
            this.ctx.stroke();
        }
    }

    drawStars() {
        const starPositions = [[3,3], [11,3], [7,7], [3,11], [11,11]];
        this.ctx.fillStyle = '#6b4f32';
        starPositions.forEach(([row, col]) => {
            const x = MARGIN + col * CELL_SIZE;
            const y = MARGIN + row * CELL_SIZE;
            this.ctx.beginPath();
            this.ctx.arc(x, y, CELL_SIZE * 0.1, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }

    drawPieces(board, animatingPiece, lastMove) {
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) {
                const player = board[row][col];
                if (player === 0) continue;

                let radius = PIECE_RADIUS;
                if (animatingPiece && animatingPiece.row === row && animatingPiece.col === col) {
                    const elapsed = Date.now() - animatingPiece.startTime;
                    if (elapsed < ANIMATION_DURATION) {
                        const progress = elapsed / ANIMATION_DURATION;
                        radius = PIECE_RADIUS * (1.3 - 0.3 * progress);
                    }
                }

                this.drawPiece(row, col, player, radius);

                // 如果是最后落子，加一个小圆点
                if (lastMove && lastMove.row === row && lastMove.col === col) {
                    this.drawLastMoveMarker(row, col, player);
                }
            }
        }
    }

    drawPiece(row, col, player, radius) {
        const x = MARGIN + col * CELL_SIZE;
        const y = MARGIN + row * CELL_SIZE;
        const isBlack = (player === 1);
        const gradient = this.ctx.createRadialGradient(x - 4, y - 4, 5, x, y, radius * 1.2);
        if (isBlack) {
            gradient.addColorStop(0, '#555');
            gradient.addColorStop(0.6, '#1a1a1a');
            gradient.addColorStop(1, '#111');
        } else {
            gradient.addColorStop(0, '#fefefe');
            gradient.addColorStop(0.5, '#dddddd');
            gradient.addColorStop(1, '#adadad');
        }
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
        this.ctx.strokeStyle = isBlack ? '#222' : '#777';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    drawLastMoveMarker(row, col, player) {
        const x = MARGIN + col * CELL_SIZE;
        const y = MARGIN + row * CELL_SIZE;
        const isBlack = (player === 1);
        const markerColor = isBlack ? '#ffffff' : '#000000';
        const markerRadius = PIECE_RADIUS * 0.25;

        this.ctx.beginPath();
        this.ctx.arc(x, y, markerRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = markerColor;
        this.ctx.fill();
        this.ctx.strokeStyle = '#888';
        this.ctx.lineWidth = 0.5;
        this.ctx.stroke();
    }
}