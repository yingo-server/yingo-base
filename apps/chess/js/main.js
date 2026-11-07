// 主逻辑：棋盘渲染、事件处理、本地/在线/AI 游戏控制
(function() {
    let engine = null;
    let net = new NetworkManager();
    let gameMode = 'local';
    let myColor = 'white';
    let selectedIdx = -1;
    let legalMoves = [];
    let lastFrom = -1, lastTo = -1;
    let gameOver = false;
    let animPiece = null, animRook = null, rafId = null;
    let pollTimer = null;
    let isMoving = false;
    let lastPolledFen = null;
    let pendingDrawOffer = false;
    let pendingDrawResponse = false;
    let deadMode = false;
    let deadModeRequestSent = false;
    let currentRoomStatus = 'waiting';

    // 白方语音历史记录
    let whiteConsecutiveMoves = 0;
    let whiteConsecutiveChecks = 0;
    let totalMoveCount = 0;      // 总步数（双方移动次数）
    let opponentTimeoutTriggered = false;
    let lastMoveTimestamp = Date.now();

    // AI 相关变量
    let aiSide = 'black';
    let aiThinking = false;

    const canvas = document.getElementById('boardCanvas');
    const ctx = canvas.getContext('2d');
    const transitionOverlay = document.getElementById('transitionOverlay');
    const lobby = document.getElementById('lobby');
    const gameContainer = document.getElementById('gameContainer');
    const promoOverlay = document.getElementById('promoOverlay');
    const promoOpts = document.getElementById('promoOpts');
    const notifContainer = document.getElementById('notifContainer');

    const opponentAvatar = document.getElementById('avatarOpponent');
    const selfAvatar = document.getElementById('avatarSelf');
    const opponentBubble = document.querySelector('.opponent-bubble');
    const selfBubble = document.querySelector('.self-bubble');

    function playSound(url) {
        try {
            const audio = new Audio(url);
            audio.play().catch(e => console.warn('音频播放失败:', url, e));
        } catch(e) {
            console.warn('创建Audio对象失败', e);
        }
    }

    function setLocalAvatars() {
        if (selfAvatar) selfAvatar.src = 'img/head/right.jpg';
        if (opponentAvatar) opponentAvatar.src = 'img/head/left.png';
    }

    function updateAvatars() {
        if (gameMode !== 'online') return;
        const whiteAvatarSrc = 'img/head/left.png';
        const blackAvatarSrc = 'img/head/right.jpg';
        if (myColor === 'white') {
            selfAvatar.src = whiteAvatarSrc;
            opponentAvatar.src = blackAvatarSrc;
        } else {
            selfAvatar.src = blackAvatarSrc;
            opponentAvatar.src = whiteAvatarSrc;
        }
    }

    function setAIAvatars() {
        if (gameMode !== 'ai') return;
        const whiteAvatarSrc = 'img/head/left.png';
        const blackAvatarSrc = 'img/head/right.jpg';
        if (myColor === 'white') {
            selfAvatar.src = whiteAvatarSrc;
            opponentAvatar.src = blackAvatarSrc;
        } else {
            selfAvatar.src = blackAvatarSrc;
            opponentAvatar.src = whiteAvatarSrc;
        }
    }

    function showBubble(message, isOpponent) {
        const bubble = isOpponent ? opponentBubble : selfBubble;
        if (!bubble) return;
        bubble.textContent = message;
        bubble.style.display = 'block';
        setTimeout(() => {
            bubble.style.display = 'none';
        }, 3000);
    }

    function showModal(title, message, buttons) {
        const existing = document.querySelector('.custom-modal');
        if (existing) existing.remove();
        const modalDiv = document.createElement('div');
        modalDiv.className = 'custom-modal';
        modalDiv.innerHTML = `
            <div class="modal-box">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(message)}</p>
                <div class="modal-buttons"></div>
            </div>
        `;
        const btnContainer = modalDiv.querySelector('.modal-buttons');
        for (const btn of buttons) {
            const btnEl = document.createElement('button');
            btnEl.textContent = btn.label;
            if (btn.primary) btnEl.classList.add('primary');
            else btnEl.classList.add('secondary');
            btnEl.addEventListener('click', () => {
                modalDiv.remove();
                if (btn.callback) btn.callback();
            });
            btnContainer.appendChild(btnEl);
        }
        document.body.appendChild(modalDiv);
    }

    function escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    async function transitionTo(showElement, hideElements = []) {
        transitionOverlay.classList.add('active');
        await new Promise(resolve => setTimeout(resolve, 300));
        hideElements.forEach(el => { if (el) el.style.display = 'none'; });
        if (showElement) showElement.style.display = 'block';
        transitionOverlay.offsetHeight;
        transitionOverlay.classList.remove('active');
    }

    function sfxMove() { playSound('img/落子.mp3'); }
    function sfxCapture() { beep(280, 0.09, 'triangle', 0.18); setTimeout(() => beep(180, 0.06, 'triangle', 0.12), 40); }
    function sfxCheck() { beep(500, 0.1, 'square', 0.12); setTimeout(() => beep(750, 0.12, 'square', 0.12), 80); }
    function sfxPromote() { beep(360, 0.06, 'sine', 0.12); setTimeout(() => beep(540, 0.06, 'sine', 0.12), 50); setTimeout(() => beep(800, 0.08, 'sine', 0.14), 100); }
    function sfxEnd() { beep(200, 0.2, 'triangle', 0.16); setTimeout(() => beep(300, 0.25, 'triangle', 0.14), 150); }

    function beep(f, d, t='sine', v=0.15) {
        try {
            const a = getAudioCtx();
            const o = a.createOscillator(), g = a.createGain();
            o.type = t; o.frequency.value = f; g.gain.value = v;
            o.connect(g); g.connect(a.destination);
            o.start(); o.stop(a.currentTime + d);
        } catch(e) {}
    }

    function displayToStandard(r, c) {
        const standardR = myColor === 'black' ? (7 - r) : r;
        return standardR * 8 + c;
    }
    function standardToDisplay(idx) {
        const r = Math.floor(idx / 8), c = idx % 8;
        const displayR = myColor === 'black' ? (7 - r) : r;
        return { r: displayR, c };
    }

    function setupCanvasSize() {
        const maxW = Math.min(480, window.innerWidth - 32);
        const maxH = Math.min(480, window.innerHeight - 200);
        const size = Math.min(maxW, maxH);
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    }

    function drawPiece(ctx, piece, cx, cy, size) {
        const ch = FA_CHESS[piece.type];
        if (!ch) return;
        ctx.save();
        ctx.font = `900 ${size}px "Font Awesome 6 Free"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const shadowOffset = size * 0.06;
        if (piece.color === 'white') {
            ctx.fillStyle = '#b8956e';
            ctx.fillText(ch, cx + shadowOffset, cy + shadowOffset);
            ctx.fillStyle = '#faf3e0';
            ctx.fillText(ch, cx, cy);
        } else {
            ctx.fillStyle = '#8a724b';
            ctx.fillText(ch, cx + shadowOffset, cy + shadowOffset);
            ctx.fillStyle = '#1a1008';
            ctx.fillText(ch, cx, cy);
        }
        ctx.restore();
    }

    function render() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (!engine || !canvas.style.width) return;
            const sq = parseFloat(canvas.style.width) / 8;
            ctx.clearRect(0, 0, sq*8, sq*8);
            const now = performance.now();
            let pieceAnimDone = false, rookAnimDone = false;
            if (animPiece && now - animPiece.startTime >= 220) pieceAnimDone = true;
            if (animRook && now - animRook.startTime >= 220) rookAnimDone = true;

            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    const x = c * sq, y = r * sq;
                    const standardIdx = displayToStandard(r, c);
                    const light = (r + c) % 2 === 0;
                    let fill = light ? '#c8c4bc' : '#5b5a56';
                    if (standardIdx === lastFrom || standardIdx === lastTo) {
                        fill = light ? 'rgba(0,122,180,0.22)' : 'rgba(0,122,180,0.28)';
                    }
                    if (standardIdx === selectedIdx) fill = '#007acc';
                    if (!gameOver && engine.isKingInCheck(engine.turn)) {
                        const ki = engine.turn === 'white' ? engine.wkIdx : engine.bkIdx;
                        if (standardIdx === ki) fill = 'rgba(215,50,50,0.55)';
                    }
                    ctx.fillStyle = fill;
                    ctx.fillRect(x, y, sq, sq);

                    const lm = legalMoves.find(m => m.toIdx === standardIdx);
                    if (lm) {
                        const cx = x + sq / 2, cy = y + sq / 2;
                        if (lm.isCap || lm.isEP) {
                            ctx.strokeStyle = 'rgba(200,50,50,0.7)';
                            ctx.lineWidth = sq * 0.08;
                            ctx.beginPath(); ctx.arc(cx, cy, sq * 0.38, 0, Math.PI * 2); ctx.stroke();
                        } else {
                            ctx.fillStyle = 'rgba(0,0,0,0.25)';
                            ctx.beginPath(); ctx.arc(cx, cy, sq * 0.12, 0, Math.PI * 2); ctx.fill();
                        }
                    }

                    const isPieceAnimTarget = animPiece && animPiece.idx === standardIdx;
                    const isRookAnimTarget = animRook && animRook.idx === standardIdx;
                    if ((!isPieceAnimTarget || pieceAnimDone) && (!isRookAnimTarget || rookAnimDone)) {
                        const piece = engine.board[standardIdx];
                        if (piece) drawPiece(ctx, piece, x + sq / 2, y + sq / 2, sq * 0.75);
                    }
                }
            }

            if (animPiece && !pieceAnimDone && engine.board[animPiece.idx]) {
                const { r, c } = standardToDisplay(animPiece.idx);
                const x = c * sq + sq / 2, y = r * sq + sq / 2;
                const elapsed = now - animPiece.startTime;
                const t = Math.min(elapsed / 220, 1);
                const scale = 0.55 + 0.45 * (1 - Math.pow(1 - t, 3)) + Math.sin(t * Math.PI * 2) * 0.08 * (1 - t);
                ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
                drawPiece(ctx, engine.board[animPiece.idx], 0, 0, sq * 0.75);
                ctx.restore();
            } else if (animPiece && pieceAnimDone) animPiece = null;

            if (animRook && !rookAnimDone && engine.board[animRook.idx]) {
                const { r, c } = standardToDisplay(animRook.idx);
                const x = c * sq + sq / 2, y = r * sq + sq / 2;
                const elapsed = now - animRook.startTime;
                const t = Math.min(elapsed / 220, 1);
                const scale = 0.55 + 0.45 * (1 - Math.pow(1 - t, 3));
                ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
                drawPiece(ctx, engine.board[animRook.idx], 0, 0, sq * 0.75);
                ctx.restore();
            } else if (animRook && rookAnimDone) animRook = null;

            if (animPiece || animRook) {
                if (!rafId) rafId = requestAnimationFrame(() => { rafId = null; render(); });
            }
        });
    }

    function getClickIndex(e) {
        const rect = canvas.getBoundingClientRect();
        const sq = parseFloat(canvas.style.width) / 8;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const col = Math.floor(mx / sq);
        const row = Math.floor(my / sq);
        if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
        return displayToStandard(row, col);
    }

    function canMoveOnline() {
        if (gameMode !== 'online') return true;
        if (gameOver) return false;
        if (engine.turn !== myColor) return false;
        return currentRoomStatus === 'playing';
    }

    function handleClick(i) {
        getAudioCtx();
        if (gameOver || !engine) return;
        if (gameMode === 'online') {
            if (!canMoveOnline()) {
                if (currentRoomStatus !== 'playing') {
                    notify('等待对手加入...', 'warn');
                } else if (engine.turn !== myColor) {
                    notify('等待对方走棋', 'warn');
                }
                return;
            }
        }
        if (gameMode === 'ai' && (gameOver || engine.turn !== myColor)) {
            if (engine.turn !== myColor) notify('等待AI走棋', 'info');
            return;
        }
        if (selectedIdx === i) {
            selectedIdx = -1;
            legalMoves = [];
            render();
            return;
        }
        if (selectedIdx >= 0) {
            const move = legalMoves.find(m => m.toIdx === i);
            if (move) {
                if (move.isPromo) { showPromo(selectedIdx, i, move); return; }
                executeMove(selectedIdx, move);
            } else if (engine.board[i]?.color === engine.turn) {
                selectedIdx = i;
                legalMoves = engine.getLegalMoves(i);
            } else {
                notify('不合法的移动', 'warn');
                selectedIdx = -1;
                legalMoves = [];
            }
        } else {
            if (engine.board[i]?.color === engine.turn) {
                selectedIdx = i;
                legalMoves = engine.getLegalMoves(i);
            } else {
                if (engine.board[i]) notify('现在不是该方走棋', 'warn');
                else notify('请先选中棋子', 'warn');
            }
        }
        render();
    }

    // 统一评估白方语音条件（传入移动前的总步数）
    function evaluateWhiteVoice(movingColor, isCapture, isCheckAfterMove, isOpponentBubble, beforeMoveCount) {
        if (movingColor !== 'white') {
            whiteConsecutiveMoves = 0;
            return;
        }
        whiteConsecutiveMoves++;
        // 十步内吃子：beforeMoveCount 取值范围 0~9 对应第1~10步
        if (isCapture && beforeMoveCount <= 9) {
            if (whiteConsecutiveMoves <= 3) {
                if (window.WbyW) window.WbyW.onCaptureWithinThreeMoves(isOpponentBubble);
            }
            whiteConsecutiveMoves = 0;
        }
        if (isCheckAfterMove) {
            whiteConsecutiveChecks++;
            if (whiteConsecutiveChecks >= 2) {
                if (window.WbyW) window.WbyW.onDoubleCheck(isOpponentBubble);
                whiteConsecutiveChecks = 0;
            }
        } else {
            whiteConsecutiveChecks = 0;
        }
    }

    async function executeMove(fromIdx, move, promoType = null) {
        if (isMoving) return;
        isMoving = true;
        const result = engine.makeMove(fromIdx, move, promoType);
        if (move.isPromo) sfxPromote();
        else if (result.captured || move.isEP) sfxCapture();
        else sfxMove();
        lastFrom = fromIdx;
        lastTo = move.toIdx;
        animPiece = { idx: move.toIdx, startTime: performance.now() };
        if (move.isCastle) animRook = { idx: move.rookTo, startTime: performance.now() };
        selectedIdx = -1;
        legalMoves = [];
        render();
        updateStatus();
        lastMoveTimestamp = Date.now();

        const movedPiece = engine.board[lastTo];
        const movingColor = movedPiece ? movedPiece.color : null;
        const isCapture = !!(result.captured || move.isEP);
        const isCheckAfterMove = engine.isKingInCheck(engine.turn);
        const beforeMoveCount = totalMoveCount; // 移动前的总步数
        totalMoveCount++;

        let isOpponentBubble = false;
        if (movingColor === 'white') {
            if (gameMode === 'ai') {
                isOpponentBubble = (myColor === 'black');
            } else if (gameMode === 'online') {
                isOpponentBubble = false;
            } else {
                isOpponentBubble = false;
            }
        }
        evaluateWhiteVoice(movingColor, isCapture, isCheckAfterMove, isOpponentBubble, beforeMoveCount);

        // 死战模式发起（白方第一步后，即 totalMoveCount === 1 且移动的是白方）
        if (gameMode === 'ai' && !deadMode && !deadModeRequestSent && totalMoveCount === 1 && movingColor === 'white') {
            proposeDeadModeAI();
        }

        if (gameMode === 'online') {
            try {
                const status = engine.getGameStatus();
                const resultStr = status.over ? (status.result === 'white' ? 'white' : status.result === 'black' ? 'black' : 'draw') : null;
                await net.updateData(engine.getFEN(), [], resultStr, status.over ? 'finished' : 'playing');
                lastPolledFen = engine.getFEN();

                if (status.over) {
                    gameOver = true;
                    if (status.result === 'white') {
                        let winBubble = (myColor === 'black');
                        if (window.WbyW) window.WbyW.onWhiteWin(winBubble);
                    }
                    showResult(status.result);
                    setTimeout(() => { clearInterval(pollTimer); }, 5000);
                    sfxEnd();
                }
                if (!gameOver && engine.isKingInCheck(engine.turn)) sfxCheck();

                if (!deadMode && !deadModeRequestSent && myColor === 'white' && engine.fullMove === 1 && !status.over) {
                    deadModeRequestSent = true;
                    await net.updateGameData({ deadModeRequest: true });
                    showBubble('请求开启死战模式', false);
                }
            } catch(e) {
                notify('同步失败，请重试', 'err');
            }
        } else if (gameMode === 'ai') {
            const status = engine.getGameStatus();
            if (status.over) {
                gameOver = true;
                if (status.result === 'white') {
                    let winBubble = (myColor === 'black');
                    if (window.WbyW) window.WbyW.onWhiteWin(winBubble);
                }
                showResult(status.result);
                sfxEnd();
            } else if (engine.isKingInCheck(engine.turn)) {
                sfxCheck();
            }

            if (!gameOver && engine.turn === aiSide && !aiThinking) {
                requestAIMove();
            }
        } else {
            const st = engine.getGameStatus();
            if (st.over) {
                gameOver = true;
                if (st.result === 'white') {
                    let winBubble = false;
                    if (window.WbyW) window.WbyW.onWhiteWin(winBubble);
                }
                showResult(st.result);
                updateStatus();
                sfxEnd();
            } else if (engine.isKingInCheck(engine.turn)) {
                sfxCheck();
            }
        }
        isMoving = false;
    }

    // AI 模式下死战模式发起（真人白方弹窗，AI白方50%概率）
    function proposeDeadModeAI() {
        const isWhitePlayer = (myColor === 'white');
        const isWhiteAI = (aiSide === 'white');
        if (isWhitePlayer) {
            showModal('死战模式', '是否向AI发起死战模式？此模式下无法求和或认输。', [
                { label: '发起', primary: true, callback: () => {
                    requestDeadModeAI();
                }},
                { label: '算了', primary: false, callback: () => {} }
            ]);
        } else if (isWhiteAI) {
            const willPropose = !window.AiEngine.isEvenSecond();
            if (willPropose) {
                requestDeadModeAI();
            } else {
                notify('AI 决定不开启死战模式', 'info');
            }
        }
    }

    function requestDeadModeAI() {
        deadModeRequestSent = true;
        const isBlackPlayer = (myColor === 'black');
        const isBlackAI = (aiSide === 'black');
        if (isBlackPlayer) {
            showModal('死战模式请求', '白方请求开启死战模式，是否接受？', [
                { label: '接受', primary: true, callback: () => {
                    acceptDeadModeAI();
                }},
                { label: '拒绝', primary: false, callback: () => {
                    notify('已拒绝死战模式', 'info');
                }}
            ]);
        } else if (isBlackAI) {
            const willAccept = !window.AiEngine.isEvenSecond();
            if (willAccept) {
                acceptDeadModeAI();
            } else {
                notify('AI 拒绝了死战模式', 'info');
            }
        }
    }

    function acceptDeadModeAI() {
        deadMode = true;
        let isOpponent = (myColor === 'black');
        if (window.WbyW) window.WbyW.onDeadModeAccepted(isOpponent);
        showBubble('死战模式已开启！', isOpponent);
        notify('死战模式已开启！', 'warn');
    }

    function showPromo(fromIdx, toIdx, move) {
        const color = engine.turn;
        promoOpts.innerHTML = '';
        for (const t of ['queen', 'rook', 'bishop', 'knight']) {
            const btn = document.createElement('button');
            btn.textContent = FA_CHESS[t];
            btn.style.color = color === 'white' ? '#faf3e0' : '#1a1008';
            btn.style.textShadow = color === 'white' ? '2px 2px 0 #b8956e' : '2px 2px 0 #8a724b';
            btn.onclick = () => {
                promoOverlay.style.display = 'none';
                executeMove(fromIdx, move, t);
            };
            promoOpts.appendChild(btn);
        }
        promoOverlay.style.display = 'flex';
    }

    function updateStatus() {
        if (!engine) return;
        const dot = document.getElementById('turnDot');
        const text = document.getElementById('turnText');
        const statusDot = document.getElementById('statusDot');
        if (gameOver) {
            dot.className = 'tdot'; dot.style.background = '#888';
            text.textContent = gameResult === 'draw' ? '和棋' : (gameResult === 'w' ? '白方获胜' : '黑方获胜');
        } else {
            dot.className = 'tdot ' + (engine.turn === 'white' ? 'w' : 'b');
            dot.style.background = '';
            if (gameMode === 'online') {
                if (currentRoomStatus !== 'playing') {
                    text.textContent = '等待对手加入...';
                } else {
                    text.textContent = engine.turn === myColor ? '你的回合' : '对方回合';
                }
            } else if (gameMode === 'ai') {
                if (engine.turn === myColor) {
                    text.textContent = '你的回合';
                } else {
                    text.textContent = aiThinking ? 'AI思考中...' : 'AI走棋';
                }
            } else {
                text.textContent = engine.turn === 'white' ? '白方走棋' : '黑方走棋';
            }
            statusDot.className = 'dot' + (engine.isKingInCheck(engine.turn) ? ' warn' : '');
        }
        document.getElementById('moveCount').textContent = '第' + engine.fullMove + '步';
    }

    function showResult(winner) {
        let msg = '';
        if (gameMode === 'local') {
            msg = winner === 'draw' ? '和棋' : (winner === 'white' ? '白方获胜' : '黑方获胜');
        } else if (gameMode === 'ai') {
            if (winner === 'draw') msg = '和棋';
            else if (winner === myColor) msg = '你赢了！';
            else msg = '你输了';
        } else {
            msg = winner === 'draw' ? '和棋' : (winner === myColor ? '你赢了！' : '你输了');
        }
        notify(`<strong>${msg}</strong>`, winner === 'draw' ? 'warn' : (winner === myColor ? 'warn' : 'err'));
        gameResult = winner;
    }

    function notify(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = 'notif ' + (type === 'err' ? 'err' : type === 'warn' ? 'warn' : '');
        el.innerHTML = `<span style="display:block; padding-right:2px;">${msg}</span><button class="close">✕</button>`;
        el.querySelector('.close').onclick = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
        notifContainer.appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3000);
    }

    // ========== 在线模式专用函数 ==========
    function detectOpponentMove(oldFen, newFen) {
        if (!oldFen || !newFen) return { fromIdx: -1, toIdx: -1, isCapture: false, isCastle: false, rookToIdx: -1, isPromo: false, promoType: null };
        function parseBoardFromFEN(fen) {
            const boardPart = fen.split(' ')[0];
            const board = Array(64).fill(null);
            let row = 0, col = 0;
            for (const ch of boardPart) {
                if (ch === '/') { row++; col = 0; continue; }
                if (ch >= '1' && ch <= '8') { col += parseInt(ch); continue; }
                const color = (ch === ch.toUpperCase()) ? 'white' : 'black';
                const typeMap = { 'K':'king','Q':'queen','R':'rook','B':'bishop','N':'knight','P':'pawn',
                                  'k':'king','q':'queen','r':'rook','b':'bishop','n':'knight','p':'pawn' };
                board[row*8 + col] = { type: typeMap[ch], color };
                col++;
            }
            return board;
        }
        const oldBoard = parseBoardFromFEN(oldFen);
        const newBoard = parseBoardFromFEN(newFen);
        let fromIdx = -1, toIdx = -1;
        let isCapture = false, isCastle = false, rookToIdx = -1;
        let isPromo = false, promoType = null;
        const changedIndices = [];
        for (let i = 0; i < 64; i++) {
            const oldPiece = oldBoard[i];
            const newPiece = newBoard[i];
            if ((oldPiece && !newPiece) || (!oldPiece && newPiece) ||
                (oldPiece && newPiece && (oldPiece.type !== newPiece.type || oldPiece.color !== newPiece.color))) {
                changedIndices.push(i);
            }
        }
        if (changedIndices.length === 0) return { fromIdx: -1, toIdx: -1, isCapture: false, isCastle: false, rookToIdx: -1, isPromo: false, promoType: null };
        if (changedIndices.length === 4) {
            for (const idx of changedIndices) {
                const newPiece = newBoard[idx];
                if (newPiece && newPiece.type === 'king') {
                    toIdx = idx;
                    for (const j of changedIndices) {
                        if (oldBoard[j] && oldBoard[j].type === 'king' && !newBoard[j]) {
                            fromIdx = j;
                            break;
                        }
                    }
                    if (fromIdx !== -1 && Math.abs((toIdx % 8) - (fromIdx % 8)) === 2) {
                        isCastle = true;
                        const rookNewIdx = changedIndices.find(i => newBoard[i] && newBoard[i].type === 'rook' && i !== toIdx);
                        if (rookNewIdx !== undefined) rookToIdx = rookNewIdx;
                    }
                    break;
                }
            }
        }
        if (fromIdx === -1) {
            for (const idx of changedIndices) {
                if (newBoard[idx] && !oldBoard[idx]) { toIdx = idx; break; }
            }
            for (const idx of changedIndices) {
                if (oldBoard[idx] && !newBoard[idx]) { fromIdx = idx; break; }
            }
            if (fromIdx !== -1 && toIdx !== -1 && oldBoard[fromIdx] && oldBoard[fromIdx].type === 'pawn' &&
                newBoard[toIdx] && newBoard[toIdx].type !== 'pawn') {
                isPromo = true;
                promoType = newBoard[toIdx].type;
            }
            for (const idx of changedIndices) {
                if (oldBoard[idx] && !newBoard[idx] && idx !== fromIdx) { isCapture = true; break; }
            }
            if (!isCapture && fromIdx !== -1 && toIdx !== -1 && oldBoard[fromIdx] && oldBoard[fromIdx].type === 'pawn' &&
                Math.abs((toIdx % 8) - (fromIdx % 8)) === 1 && !oldBoard[toIdx]) {
                isCapture = true;
            }
        }
        return { fromIdx, toIdx, isCapture, isCastle, rookToIdx, isPromo, promoType };
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        lastPolledFen = engine.getFEN();
        pollTimer = setInterval(async () => {
            if (isMoving) return;
            try {
                const { data } = await net.pollData();
                if (!data || !data.fen) return;

                currentRoomStatus = data.status;
                if (data.deadMode && !deadMode) {
                    deadMode = true;
                    let isOpponent = (myColor === 'black');
                    if (window.WbyW) window.WbyW.onDeadModeAccepted(isOpponent);
                    showBubble('死战模式已开启！', true);
                    notify('本局已进入【死战模式】，无法求和或认输！', 'warn');
                }

                if (data.deadModeMessage && !gameOver) {
                    let isOpponent = (myColor === 'black');
                    if (window.WbyW) window.WbyW.onDeadModeMessage(isOpponent);
                    showBubble(data.deadModeMessage, true);
                    await net.updateGameData({ deadModeMessage: null });
                }

                const remoteFen = data.fen;
                const localFen = engine.getFEN();

                if (!deadMode && data.deadModeRequest && myColor === 'black' && !gameOver && !deadModeRequestSent) {
                    deadModeRequestSent = true;
                    showModal('死战模式', '白方请求开启“死战模式”，此模式下无法求和或认输，是否接受？', [
                        { label: '接受', primary: true, callback: async () => {
                            await net.updateGameData({ deadMode: true, deadModeRequest: false });
                            deadMode = true;
                            let isOpponent = true;
                            if (window.WbyW) window.WbyW.onDeadModeAccepted(isOpponent);
                            showBubble('死战模式已开启！', false);
                            notify('死战模式已开启！', 'warn');
                        }},
                        { label: '拒绝', primary: false, callback: async () => {
                            await net.updateGameData({ deadModeRequest: false });
                            showBubble('拒绝死战模式', false);
                            notify('已拒绝死战模式，对局正常进行', 'info');
                        }}
                    ]);
                }

                if (data.drawOffer && data.drawOffer !== myColor && !gameOver && !pendingDrawResponse && !deadMode) {
                    pendingDrawResponse = true;
                    showModal('求和请求', '对手请求和棋，是否接受？', [
                        { label: '接受', primary: true, callback: async () => {
                            try {
                                await net.updateGameData({ result: 'draw', status: 'finished' });
                                gameOver = true;
                                showResult('draw');
                                clearPolling();
                                sfxEnd();
                                updateStatus();
                                showBubble('接受和棋', false);
                            } catch(e) { notify('和棋失败', 'err'); }
                            pendingDrawResponse = false;
                        }},
                        { label: '拒绝', primary: false, callback: async () => {
                            try {
                                await net.updateGameData({ drawOffer: null });
                                pendingDrawResponse = false;
                                showBubble('拒绝和棋', false);
                                notify('已拒绝和棋', 'info');
                            } catch(e) { notify('操作失败', 'err'); }
                        }}
                    ]);
                }

                if (pendingDrawOffer && (data.drawOffer !== myColor)) {
                    pendingDrawOffer = false;
                    showBubble('拒绝了和棋', true);
                    notify('对方拒绝了和棋请求', 'warn');
                }

                if (!gameOver && currentRoomStatus === 'playing') {
                    const now = Date.now();
                    const lastMove = new Date(data.lastMoveTime).getTime();
                    if (!isNaN(lastMove) && now - lastMove > 10000) {
                        if (myColor === 'white' && engine.turn !== myColor && !opponentTimeoutTriggered) {
                            opponentTimeoutTriggered = true;
                            if (window.WbyW) window.WbyW.onOpponentTimeout(false);
                        }
                        if (myColor === 'black' && engine.turn === myColor && !opponentTimeoutTriggered) {
                            opponentTimeoutTriggered = true;
                            if (window.WbyW) window.WbyW.onOpponentTimeout(true);
                        }
                    } else if (now - lastMove <= 10000) {
                        opponentTimeoutTriggered = false;
                    }
                }

                if (gameOver) return;

                if (remoteFen !== localFen && remoteFen !== lastPolledFen) {
                    const moveInfo = detectOpponentMove(localFen, remoteFen);
                    engine.loadFEN(remoteFen);
                    selectedIdx = -1;
                    legalMoves = [];
                    lastFrom = moveInfo.fromIdx >= 0 ? moveInfo.fromIdx : -1;
                    lastTo = moveInfo.toIdx >= 0 ? moveInfo.toIdx : -1;
                    if (moveInfo.toIdx >= 0) {
                        animPiece = { idx: moveInfo.toIdx, startTime: performance.now() };
                        if (moveInfo.isCastle && moveInfo.rookToIdx >= 0) animRook = { idx: moveInfo.rookToIdx, startTime: performance.now() };
                        if (moveInfo.isPromo) sfxPromote();
                        else if (moveInfo.isCapture) sfxCapture();
                        else sfxMove();
                    }

                    let movingColor = null;
                    if (moveInfo.fromIdx !== -1) {
                        const oldBoard = (() => {
                            const boardPart = localFen.split(' ')[0];
                            const boardArr = Array(64).fill(null);
                            let row = 0, col = 0;
                            for (const ch of boardPart) {
                                if (ch === '/') { row++; col = 0; continue; }
                                if (ch >= '1' && ch <= '8') { col += parseInt(ch); continue; }
                                const color = (ch === ch.toUpperCase()) ? 'white' : 'black';
                                const typeMap = { 'K':'king','Q':'queen','R':'rook','B':'bishop','N':'knight','P':'pawn',
                                                  'k':'king','q':'queen','r':'rook','b':'bishop','n':'knight','p':'pawn' };
                                boardArr[row*8 + col] = { type: typeMap[ch], color };
                                col++;
                            }
                            return boardArr;
                        })();
                        const piece = oldBoard[moveInfo.fromIdx];
                        movingColor = piece ? piece.color : null;
                    }
                    const isCaptureAfter = moveInfo.isCapture;
                    const isCheckAfterMove = engine.isKingInCheck(engine.turn);
                    let isOpponentBubble = (myColor === 'black');
                    evaluateWhiteVoice(movingColor, isCaptureAfter, isCheckAfterMove, isOpponentBubble, totalMoveCount);
                    totalMoveCount++;

                    render();
                    updateStatus();
                    lastPolledFen = remoteFen;
                    if (data.status === 'finished') {
                        gameOver = true;
                        if (data.result === 'white') {
                            let winBubble = (myColor === 'black');
                            if (window.WbyW) window.WbyW.onWhiteWin(winBubble);
                        }
                        showResult(data.result);
                        clearPolling();
                        sfxEnd();
                    }
                    if (!gameOver && engine.isKingInCheck(engine.turn)) sfxCheck();
                }

                if (data.status === 'playing') {
                    const lastMoveDate = new Date(data.lastMoveTime);
                    if (!isNaN(lastMoveDate.getTime()) && (Date.now() - lastMoveDate.getTime()) > 120000) {
                        if (engine.turn !== myColor && !gameOver) {
                            await net.updateGameData({ result: myColor === 'white' ? 'white' : 'black', status: 'finished' });
                        }
                    }
                }
            } catch(e) {}
        }, 1500);
    }

    function clearPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function offerDraw() {
        if (deadMode) {
            let isOpponent = (myColor === 'black');
            const msg = '弃子求和，绝无可能';
            showBubble(msg, isOpponent);
            if (window.WbyW) window.WbyW.onDeadModeMessage(isOpponent);
            try {
                await net.updateGameData({ deadModeMessage: msg });
            } catch(e) {}
            return;
        }
        if (gameMode !== 'online' || gameOver) return;
        if (pendingDrawOffer) {
            notify('已发出求和请求，请等待对方回复', 'warn');
            return;
        }
        try {
            const { data } = await net.pollData();
            if (data.drawOffer) {
                notify('对方正在请求和棋，请查看弹窗', 'warn');
                return;
            }
            await net.updateGameData({ drawOffer: myColor });
            pendingDrawOffer = true;
            showBubble('请求和棋', false);
            notify('已向对方发出求和请求', 'info');
            setTimeout(async () => {
                if (pendingDrawOffer) {
                    const fresh = await net.pollData();
                    if (fresh.data.drawOffer === myColor) {
                        await net.updateGameData({ drawOffer: null });
                        pendingDrawOffer = false;
                        notify('求和请求已超时取消', 'warn');
                    }
                }
            }, 60000);
        } catch(e) { notify('发送求和失败', 'err'); }
    }

    async function resignGame() {
        if (deadMode) {
            let isOpponent = (myColor === 'black');
            const msg = '弃子求和，绝无可能';
            showBubble(msg, isOpponent);
            if (window.WbyW) window.WbyW.onDeadModeMessage(isOpponent);
            try {
                await net.updateGameData({ deadModeMessage: msg });
            } catch(e) {}
            return;
        }
        if (gameMode !== 'online' || gameOver) return;
        showModal('确认认输', '确定要认输吗？', [
            { label: '确定', primary: true, callback: async () => {
                const winner = myColor === 'white' ? 'black' : 'white';
                await net.updateGameData({ result: winner, status: 'finished' });
                setTimeout(async () => {
                    await net.deleteRoom();
                    clearCache();
                }, 5000);
                gameOver = true;
                showResult(winner);
                clearPolling();
                updateStatus();
                sfxEnd();
                showBubble('认输', false);
                notify('您已认输', 'err');
            }},
            { label: '取消', primary: false, callback: () => {} }
        ]);
    }

    // ========== AI 模式专用函数 ==========
    async function requestAIMove() {
        if (gameMode !== 'ai' || gameOver) return;
        if (engine.turn !== aiSide) return;
        if (aiThinking) return;
        if (!window.AiEngine || !window.AiEngine.ready) {
            setTimeout(() => requestAIMove(), 500);
            return;
        }
        aiThinking = true;
        updateStatus();
        const fen = engine.getFEN();
        const uciMove = await window.AiEngine.getBestMove(fen, 5000);
        aiThinking = false;
        if (!uciMove) {
            notify('AI 思考超时或出错', 'err');
            return;
        }
        const fromFile = uciMove.charCodeAt(0) - 97;
        const fromRank = 8 - parseInt(uciMove[1]);
        const toFile = uciMove.charCodeAt(2) - 97;
        const toRank = 8 - parseInt(uciMove[3]);
        const promoChar = uciMove.length === 5 ? uciMove[4] : null;
        const fromIdx = fromRank * 8 + fromFile;
        const toIdx = toRank * 8 + toFile;
        const piece = engine.board[fromIdx];
        if (!piece) {
            notify('AI 返回非法着法: 起始格无棋子', 'err');
            return;
        }
        let move = null;
        const movesFromPiece = engine.getLegalMoves(fromIdx);
        for (const m of movesFromPiece) {
            if (m.toIdx === toIdx) {
                move = m;
                break;
            }
        }
        if (!move) {
            notify('AI 返回非法着法: 目标格不可达', 'err');
            return;
        }
        let promoType = null;
        if (move.isPromo && promoChar) {
            const promoMap = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
            promoType = promoMap[promoChar];
        }
        executeMove(fromIdx, move, promoType);
    }

    async function aiOfferDraw() {
        if (deadMode) {
            let isOpponent = (myColor === 'black');
            notify('死战模式：弃子求和，绝无可能', 'warn');
            if (window.WbyW) window.WbyW.onDeadModeMessage(isOpponent);
            return;
        }
        if (gameMode !== 'ai' || gameOver) return;
        const accept = !window.AiEngine.isEvenSecond();
        if (accept) {
            notify('AI 接受了和棋请求', 'info');
            gameOver = true;
            gameResult = 'draw';
            showResult('draw');
            updateStatus();
            sfxEnd();
        } else {
            notify('AI 拒绝了和棋请求', 'warn');
        }
    }

    async function aiResign() {
        if (deadMode) {
            let isOpponent = (myColor === 'black');
            notify('死战模式：弃子求和，绝无可能', 'warn');
            if (window.WbyW) window.WbyW.onDeadModeMessage(isOpponent);
            return;
        }
        if (gameMode !== 'ai' || gameOver) return;
        const winner = myColor === 'white' ? 'black' : 'white';
        gameOver = true;
        gameResult = winner;
        showResult(winner);
        updateStatus();
        sfxEnd();
        if (winner === 'white') {
            let winBubble = (myColor === 'black');
            if (window.WbyW) window.WbyW.onWhiteWin(winBubble);
        }
        notify('您已认输', 'err');
    }

    // ========== 模式启动函数 ==========
    function startLocalGame() {
        clearPolling();
        gameMode = 'local'; myColor = 'white';
        engine = new ChessEngine();
        setLocalAvatars();
        lastPolledFen = null;
        deadMode = false;
        deadModeRequestSent = false;
        whiteConsecutiveMoves = 0;
        whiteConsecutiveChecks = 0;
        totalMoveCount = 0;
        const logBtn = document.getElementById('toggleLogBtn');
        const logArea = document.getElementById('engineLogArea');
        if (logBtn) logBtn.style.display = 'none';
        if (logArea) logArea.style.display = 'none';
        document.getElementById('onlineButtons').style.display = 'none';
        document.getElementById('resetBtn').style.display = 'inline-block';
        transitionTo(gameContainer, [lobby, onlineMenu]).then(() => {
            document.getElementById('gameModeLabel').textContent = '本地对战';
            document.getElementById('roomDisplayInGame').textContent = '';
            setupCanvasSize();
            resetBoard();
            render();
            updateStatus();
        });
    }

    function startOnlineGame() {
        clearPolling();
        pendingDrawOffer = false;
        pendingDrawResponse = false;
        deadMode = false;
        deadModeRequestSent = false;
        currentRoomStatus = 'waiting';
        lastPolledFen = engine.getFEN();
        updateAvatars();
        whiteConsecutiveMoves = 0;
        whiteConsecutiveChecks = 0;
        totalMoveCount = 0;
        opponentTimeoutTriggered = false;
        lastMoveTimestamp = Date.now();
        const logBtn = document.getElementById('toggleLogBtn');
        const logArea = document.getElementById('engineLogArea');
        if (logBtn) logBtn.style.display = 'none';
        if (logArea) logArea.style.display = 'none';
        document.getElementById('onlineButtons').style.display = 'inline-flex';
        document.getElementById('resetBtn').style.display = 'none';
        transitionTo(gameContainer, [lobby, onlineMenu]).then(() => {
            document.getElementById('gameModeLabel').textContent = '在线对战';
            document.getElementById('roomDisplayInGame').textContent = `房间 ${net.roomId}`;
            setupCanvasSize();
            resetBoard();
            render();
            updateStatus();
            startPolling();
        });
    }

    function startAIGame() {
        clearPolling();
        gameMode = 'ai';
        const choice = confirm('请选择您执子颜色：\n确定 = 执白（AI执黑）\n取消 = 执黑（AI执白）');
        if (choice) {
            myColor = 'white';
            aiSide = 'black';
        } else {
            myColor = 'black';
            aiSide = 'white';
        }
        if (window.AiEngine) {
            window.AiEngine.terminate();
            window.AiEngine.setLogCallback(function(msg) {
                const logDiv = document.getElementById('engineLogContent');
                if (logDiv) {
                    const time = new Date().toLocaleTimeString();
                    const entry = document.createElement('div');
                    entry.className = 'engine-log-entry';
                    entry.innerHTML = `<span style="color:#888;">[${time}]</span> ${escapeHtml(msg)}`;
                    entry.style.opacity = '0';
                    logDiv.insertBefore(entry, logDiv.firstChild);
                    while (logDiv.children.length > 50) {
                        logDiv.removeChild(logDiv.lastChild);
                    }
                    requestAnimationFrame(() => {
                        entry.style.transition = 'opacity 0.2s';
                        entry.style.opacity = '1';
                    });
                    const logArea = document.getElementById('engineLogArea');
                    if (logArea) logArea.scrollTop = 0;
                }
            });
            window.AiEngine.init();
            window.AiEngine.setSkillLevel(12);
        } else {
            notify('AI 引擎加载失败', 'err');
            return;
        }
        engine = new ChessEngine();
        setAIAvatars();
        whiteConsecutiveMoves = 0;
        whiteConsecutiveChecks = 0;
        totalMoveCount = 0;
        aiThinking = false;
        deadMode = false;
        deadModeRequestSent = false;
        const logBtn = document.getElementById('toggleLogBtn');
        const logArea = document.getElementById('engineLogArea');
        if (logBtn) logBtn.style.display = 'inline-block';
        if (logArea) logArea.style.display = 'block';
        document.getElementById('onlineButtons').style.display = 'inline-flex';
        document.getElementById('resetBtn').style.display = 'inline-block';
        transitionTo(gameContainer, [lobby, onlineMenu]).then(() => {
            document.getElementById('gameModeLabel').textContent = 'AI对战';
            document.getElementById('roomDisplayInGame').textContent = '';
            setupCanvasSize();
            resetBoard();
            render();
            updateStatus();
            if (myColor !== 'white') {
                setTimeout(() => requestAIMove(), 500);
            }
        });
    }

    function resetBoard() {
        selectedIdx = -1; legalMoves = []; lastFrom = -1; lastTo = -1;
        gameOver = false; isMoving = false;
        animPiece = animRook = null;
        whiteConsecutiveMoves = 0;
        whiteConsecutiveChecks = 0;
        totalMoveCount = 0;
        deadMode = false;
        deadModeRequestSent = false;
        if (gameMode === 'ai' && window.AiEngine) {
            window.AiEngine.newGame();
        }
    }

    function saveCache() {
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem('chess_cache') || '{}'); } catch(e) {}
        cache[net.roomId] = { role: net.role, password: net.password, uuid: net.uuid, lastActive: Date.now() };
        localStorage.setItem('chess_cache', JSON.stringify(cache));
    }
    function clearCache() {
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem('chess_cache') || '{}'); } catch(e) {}
        delete cache[net.roomId];
        localStorage.setItem('chess_cache', JSON.stringify(cache));
    }

    canvas.addEventListener('click', e => { const i = getClickIndex(e); if (i >= 0) handleClick(i); });
    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const i = getClickIndex(e.touches[0]);
        if (i >= 0) handleClick(i);
    }, { passive: false });

    document.getElementById('localBtn').addEventListener('click', startLocalGame);
    document.getElementById('aiBtn').addEventListener('click', startAIGame);
    document.getElementById('backToLobbyBtn').addEventListener('click', () => {
        clearPolling();
        transitionTo(lobby, [gameContainer]);
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (gameMode === 'ai') {
            resetBoard();
            render();
            updateStatus();
            if (myColor !== 'white') {
                setTimeout(() => requestAIMove(), 500);
            }
        } else if (gameMode === 'local') {
            engine = new ChessEngine();
            resetBoard();
            render();
            updateStatus();
        } else {
            notify('在线对局无法重置', 'warn');
        }
    });
    document.getElementById('resignBtn').addEventListener('click', () => {
        if (gameMode === 'ai') aiResign();
        else if (gameMode === 'online') resignGame();
        else notify('当前模式不支持认输', 'warn');
    });
    document.getElementById('drawBtn').addEventListener('click', () => {
        if (gameMode === 'ai') aiOfferDraw();
        else if (gameMode === 'online') offerDraw();
        else notify('当前模式不支持求和', 'warn');
    });
    document.getElementById('copyRoomBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(net.roomId).then(() => notify('房间号已复制'));
    });
    promoOverlay.addEventListener('click', (e) => {
        if (e.target === promoOverlay) promoOverlay.style.display = 'none';
    });
    window.addEventListener('resize', () => {
        if (gameContainer.style.display === 'block') {
            setupCanvasSize();
            render();
        }
    });

    document.getElementById('toggleLogBtn').addEventListener('click', function() {
        const logArea = document.getElementById('engineLogArea');
        if (logArea) {
            if (logArea.style.display === 'none') {
                logArea.style.display = 'block';
                this.textContent = '隐藏';
            } else {
                logArea.style.display = 'none';
                this.textContent = '日志';
            }
        }
    });

    function checkReconnect() {
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem('chess_cache') || '{}'); } catch(e) {}
        const now = Date.now();
        const valid = Object.entries(cache).filter(([id, v]) => now - v.lastActive < 300000);
        if (valid.length === 0) {
            transitionTo(lobby, []);
            return;
        }
        valid.sort((a,b) => b[1].lastActive - a[1].lastActive);
        const [roomId, info] = valid[0];
        document.getElementById('reconnectList').textContent = `房间 ${roomId} (角色: ${info.role})`;
        reconnectModal.style.display = 'flex';
        document.getElementById('reconnectBtn').onclick = async () => {
            try {
                net.roomId = roomId; net.role = info.role; net.password = info.password; net.uuid = info.uuid;
                if (!await net.verifyPassword(info.role)) throw new Error('验证失败');
                const { data } = await net.pollData();
                engine = new ChessEngine(data.fen);
                myColor = info.role;
                gameMode = 'online';
                deadMode = data.deadMode || false;
                deadModeRequestSent = false;
                currentRoomStatus = data.status;
                updateAvatars();
                whiteConsecutiveMoves = 0;
                whiteConsecutiveChecks = 0;
                totalMoveCount = 0;
                opponentTimeoutTriggered = false;
                const logBtn = document.getElementById('toggleLogBtn');
                const logArea = document.getElementById('engineLogArea');
                if (logBtn) logBtn.style.display = 'none';
                if (logArea) logArea.style.display = 'none';
                reconnectModal.style.display = 'none';
                transitionTo(gameContainer, [lobby, onlineMenu]).then(() => {
                    document.getElementById('gameModeLabel').textContent = '在线对战';
                    document.getElementById('roomDisplayInGame').textContent = `房间 ${net.roomId}`;
                    document.getElementById('resignBtn').style.display = 'inline-block';
                    setupCanvasSize();
                    render();
                    updateStatus();
                    startPolling();
                });
            } catch(e) {
                delete cache[roomId]; localStorage.setItem('chess_cache', JSON.stringify(cache));
                reconnectModal.style.display = 'none';
                transitionTo(lobby, []);
            }
        };
        document.getElementById('ignoreReconnectBtn').onclick = () => {
            delete cache[roomId]; localStorage.setItem('chess_cache', JSON.stringify(cache));
            reconnectModal.style.display = 'none';
            transitionTo(lobby, []);
        };
    }

    function doInit() {
        if (window.splashReady) {
            setTimeout(() => {
                const splash = document.getElementById('splash');
                const piece = document.getElementById('splashPiece');
                piece.style.animation = '';
                splash.style.opacity = '0';
                setTimeout(() => {
                    splash.style.display = 'none';
                    checkReconnect();
                }, 500);
            }, 1000);
        } else {
            window.tryInitApp = doInit;
        }
    }

    window.initApp = doInit;
    window.addEventListener('beforeunload', () => { if (audioCtx) audioCtx.close(); });
    if (window.splashReady) doInit(); else window.tryInitApp = doInit;
})();