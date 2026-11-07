// AI 模块 (Stockfish 引擎) - 直接 Worker 加载，带日志回调
(function() {
    let worker = null;
    let ready = false;
    let pendingResolve = null;
    let pendingFen = null;
    let logCallback = null;

    function log(msg) {
        if (logCallback) {
            logCallback(msg);
        } else {
            console.log('[AI]', msg);
        }
    }

    function init() {
        if (worker) {
            worker.terminate();
        }
        try {
            log('正在创建 Worker: wasm/stockfish-18-lite-single.js');
            worker = new Worker('wasm/stockfish-18-lite-single.js');
            worker.onmessage = (e) => {
                const msg = e.data;
                log('← ' + msg);
                if (msg === 'uciok') {
                    worker.postMessage('setoption name Skill Level value 12');
                    worker.postMessage('isready');
                    log('→ setoption name Skill Level value 12');
                    log('→ isready');
                } else if (msg === 'readyok') {
                    ready = true;
                    log('引擎就绪 (readyok)');
                    if (pendingFen) {
                        const fen = pendingFen;
                        const movetime = pendingResolve?.movetime || 5000;
                        pendingFen = null;
                        worker.postMessage(`position fen ${fen}`);
                        worker.postMessage(`go movetime ${movetime}`);
                        log(`→ position fen ${fen}`);
                        log(`→ go movetime ${movetime}`);
                    }
                } else if (msg && msg.startsWith('bestmove')) {
                    const parts = msg.split(' ');
                    const best = parts[1];
                    log(`最佳着法: ${best}`);
                    if (pendingResolve) {
                        pendingResolve.callback(best);
                        pendingResolve = null;
                    }
                }
            };
            worker.onerror = (err) => {
                log('Worker 错误: ' + (err.message || '未知错误'));
                if (pendingResolve) {
                    pendingResolve.callback(null);
                    pendingResolve = null;
                }
            };
            worker.postMessage('uci');
            log('→ uci');
        } catch(e) {
            log('初始化异常: ' + e.message);
        }
    }

    function getBestMove(fen, movetime = 5000) {
        return new Promise((resolve) => {
            if (!ready) {
                log('引擎未就绪，缓存请求: ' + fen);
                pendingResolve = { callback: resolve, movetime };
                pendingFen = fen;
                return;
            }
            pendingResolve = { callback: resolve, movetime };
            worker.postMessage(`position fen ${fen}`);
            worker.postMessage(`go movetime ${movetime}`);
            log(`→ position fen ${fen}`);
            log(`→ go movetime ${movetime}`);
        });
    }

    function setSkillLevel(level) {
        if (ready && worker) {
            const lvl = Math.min(20, Math.max(0, level));
            worker.postMessage(`setoption name Skill Level value ${lvl}`);
            log(`→ setoption name Skill Level value ${lvl}`);
        }
    }

    function newGame() {
        if (worker) worker.postMessage('ucinewgame');
        log('→ ucinewgame');
        ready = false;
        pendingResolve = null;
        pendingFen = null;
        init(); // 重新初始化
    }

    function terminate() {
        if (worker) {
            worker.terminate();
            worker = null;
        }
        ready = false;
        pendingResolve = null;
        pendingFen = null;
        log('引擎已终止');
    }

    function setLogCallback(callback) {
        logCallback = callback;
    }

    // 奇偶判断 (基于当前秒数)
    function isEvenSecond() {
        return new Date().getSeconds() % 2 === 0;
    }

    window.AiEngine = {
        init,
        getBestMove,
        setSkillLevel,
        newGame,
        terminate,
        setLogCallback,
        isEvenSecond,   // 公开方法用于 50% 概率
        get ready() { return ready; }
    };
})();