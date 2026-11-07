(function (global) {
    'use strict';

    var CM = global.CM = global.CM || {};

    var el = null;
    var blobCache = {};
    var loadTimer = null;
    var audioEl = null;
    var audioBlobCache = {};
    var currentTrackIdx = -1;

    var BUILTIN = [];

    var MUSIC_BUILTIN = [];

    var BG_KEY = 'clockme_bg_enabled';
    var WP_KEY = 'clockme_wallpaper';
    var CUSTOM_KEY = 'clockme_custom_wp';
    var SHOWTIME_KEY = 'clockme_timer_showtime';
    var SHOWTIME_DELAY_KEY = 'clockme_timer_showtime_delay';
    var MUSIC_KEY = 'clockme_music_enabled';
    var MUSIC_LOOP_KEY = 'clockme_music_loop';
    var MUSIC_CUSTOM_KEY = 'clockme_custom_music';
    var MUSIC_TRACK_KEY = 'clockme_music_track';
    var DEV_KEY = 'clockme_dev_mode';
    var DEV_HEAD_KEY = 'clockme_dev_head';
    var DEV_BODY_KEY = 'clockme_dev_body';
    var DB_NAME = 'clockme_files';
    var DB_STORE = 'files';

    /* ==================== 通用工具 ==================== */

    function getBGEnabled() { return localStorage.getItem(BG_KEY) !== '0'; }
    function setBGEnabled(on) { localStorage.setItem(BG_KEY, on ? '1' : '0'); applyBG(); }

    function getShowTime() {
        var d = parseInt(localStorage.getItem(SHOWTIME_DELAY_KEY), 10) || 0;
        if (d > 0) return false;
        return localStorage.getItem(SHOWTIME_KEY) === '1';
    }
    function setShowTime(on) {
        localStorage.setItem(SHOWTIME_KEY, on ? '1' : '0');
        localStorage.setItem(SHOWTIME_DELAY_KEY, '2');
    }

    /* ==================== 壁纸 ==================== */

    function getWallpaperIdx() {
        var v = parseInt(localStorage.getItem(WP_KEY), 10);
        var total = BUILTIN.length + getCustomWpList().length;
        return (v >= 0 && v < total) ? v : 0;
    }
    function setWallpaperIdx(idx) { localStorage.setItem(WP_KEY, String(idx)); applyBG(); updateThumbs(); }
    function getAllWallpapers() { return BUILTIN.concat(getCustomWpList()); }
    function getCustomWpList() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { return []; } }
    function saveCustomWpList(list) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); }

    function showLoader() {
        var l = document.getElementById('bgLoader');
        if (!l) return;
        if (loadTimer) clearTimeout(loadTimer);
        l.querySelector('.bg-loader__bar').style.width = '0';
        l.classList.add('is-loading');
        setTimeout(function () { l.querySelector('.bg-loader__bar').style.width = '25%'; }, 50);
    }
    function tickLoader(pct) {
        var l = document.getElementById('bgLoader');
        if (!l || !l.classList.contains('is-loading')) return;
        l.querySelector('.bg-loader__bar').style.width = pct + '%';
    }
    function hideLoader() {
        var l = document.getElementById('bgLoader');
        if (!l) return;
        l.querySelector('.bg-loader__bar').style.width = '100%';
        loadTimer = setTimeout(function () { l.classList.remove('is-loading'); }, 400);
    }

    function fetchAndCache(url, type, cb) {
        if (type === 'image') {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () {
                var c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                c.toBlob(function (b) { var u = URL.createObjectURL(b); blobCache[url] = u; cb(null, u); });
            };
            img.onerror = function () { cb('err'); };
            img.src = url;
        } else {
            fetch(url).then(function (r) { tickLoader(60); return r.blob(); }).then(function (b) {
                tickLoader(85); var u = URL.createObjectURL(b); blobCache[url] = u; cb(null, u);
            }).catch(function (e) { cb(e); });
        }
    }

    function applyBG() {
        var bgV = document.querySelector('.bg-video'), bgI = document.getElementById('bgImg');
        if (!bgV || !bgI) return;
        if (!getBGEnabled()) { bgV.style.display = 'none'; bgI.style.display = 'none'; return; }
        var all = getAllWallpapers(), wp = all[getWallpaperIdx()];
        if (!wp) return;
        if (wp.type === 'image') {
            bgV.style.display = 'none'; bgI.style.display = '';
            var s = blobCache[wp.url] || wp._blobUrl || wp.url;
            if (bgI.getAttribute('data-src') !== s) { bgI.setAttribute('data-src', s); bgI.src = s; }
            return;
        }
        bgI.style.display = 'none'; bgV.style.display = '';
        bgV.volume = 0; bgV.muted = true;
        var cached = blobCache[wp.url] || wp._blobUrl;
        if (cached) {
            if (bgV.getAttribute('data-wp') !== wp.url) { bgV.src = cached; bgV.setAttribute('data-wp', wp.url); bgV.play(); }
            return;
        }
        showLoader();
        fetchAndCache(wp.url, 'video', function (err, u) {
            if (err) { hideLoader(); return; }
            bgV.src = u; bgV.setAttribute('data-wp', wp.url); bgV.play(); hideLoader();
        });
    }

    function addUrlWallpaper(url) {
        var ext = url.split('?')[0].split('.').pop().toLowerCase();
        var type = ['mp4','webm','mov'].indexOf(ext) >= 0 ? 'video' : 'image';
        var name = url.split('/').pop().split('?')[0].slice(0, 30);
        showLoader();
        fetchAndCache(url, type, function (err) {
            hideLoader();
            if (err) { alert('加载失败，请检查链接是否允许跨域 (CORS)'); return; }
            var list = getCustomWpList();
            list.push({ name: name, url: url, type: type });
            saveCustomWpList(list);
            setWallpaperIdx(BUILTIN.length + list.length - 1);
            rebuildWp();
        });
    }

    function addFileWallpaper(file) {
        var type = file.type.startsWith('video/') ? 'video' : 'image';
        var name = file.name.slice(0, 30), id = 'file_' + Date.now();
        var u = URL.createObjectURL(file); blobCache[id] = u;
        storeFile(id, file);
        var list = getCustomWpList();
        list.push({ name: name, url: id, type: type, _blobUrl: u });
        saveCustomWpList(list);
        setWallpaperIdx(BUILTIN.length + list.length - 1);
        rebuildWp();
    }

    function removeCustomWallpaper(idx) {
        var list = getCustomWpList();
        if (idx < 0 || idx >= list.length) return;
        var item = list[idx];
        if (item._blobUrl) URL.revokeObjectURL(item._blobUrl);
        delete blobCache[item.url];
        if (item.url.indexOf('file_') === 0) deleteFile(item.url);
        list.splice(idx, 1); saveCustomWpList(list);
        var cur = getWallpaperIdx();
        if (cur >= BUILTIN.length + list.length) setWallpaperIdx(Math.max(0, BUILTIN.length + list.length - 1));
        rebuildWp();
    }

    function updateThumbs() {
        var g = el.querySelector('.settings__wallpapers'); if (!g) return;
        var a = getWallpaperIdx();
        g.querySelectorAll('.settings__thumb').forEach(function (t, i) { t.classList.toggle('is-active', i === a); });
    }

    function buildWallpaperGrid() {
        var g = el.querySelector('.settings__wallpapers'); if (!g) return;
        g.innerHTML = '';
        var all = getAllWallpapers(), a = getWallpaperIdx();
        for (var i = 0; i < all.length; i++) {
            var w = all[i], elm;
            if (w.type === 'image' || (w._blobUrl && w.type === 'image')) {
                elm = document.createElement('img'); elm.src = w._blobUrl || w.url;
            } else {
                elm = document.createElement('video'); elm.muted = true; elm.playsInline = true; elm.loop = true; elm.volume = 0;
                elm.disablePictureInPicture = true;
                elm.disableRemotePlayback = true;
                elm.src = w._blobUrl || w.url; elm.play().catch(function () {});
            }
            elm.className = 'settings__thumb' + (i === a ? ' is-active' : '');
            elm.setAttribute('data-idx', String(i));
            g.appendChild(elm);
        }
    }

    function buildWpCustomList() {
        var c = el.querySelector('.settings__custom-list'); if (!c) return;
        c.innerHTML = '';
        getCustomWpList().forEach(function (item, i) {
            var d = document.createElement('div'); d.className = 'settings__custom-item';
            d.innerHTML = '<span class="settings__custom-name">' + item.name + '</span><button class="settings__custom-remove" data-idx="' + i + '"></button>';
            c.appendChild(d);
        });
    }

    function rebuildWp() { buildWallpaperGrid(); buildWpCustomList(); updateThumbs(); }

    /* ==================== 音乐 ==================== */

    function getMusicEnabled() { return localStorage.getItem(MUSIC_KEY) === '1'; }
    function setMusicEnabled(on) {
        localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
        if (!on) stopMusic();
    }

    function getMusicLoop() { return localStorage.getItem(MUSIC_LOOP_KEY) === '1'; }
    function setMusicLoop(on) { localStorage.setItem(MUSIC_LOOP_KEY, on ? '1' : '0'); }

    function getAllMusic() { return MUSIC_BUILTIN.concat(getCustomMusicList()); }
    function getCustomMusicList() { try { return JSON.parse(localStorage.getItem(MUSIC_CUSTOM_KEY) || '[]'); } catch (e) { return []; } }
    function saveCustomMusicList(list) { localStorage.setItem(MUSIC_CUSTOM_KEY, JSON.stringify(list)); }

    function getMusicTrackIdx() {
        var raw = localStorage.getItem(MUSIC_TRACK_KEY);
        if (raw === null) {
            var total = getAllMusic().length;
            return total > 0 ? total - 1 : -1;
        }
        var v = parseInt(raw, 10);
        var total = getAllMusic().length;
        return (v >= 0 && v < total) ? v : (total > 0 ? total - 1 : -1);
    }
    function setMusicTrackIdx(idx) { localStorage.setItem(MUSIC_TRACK_KEY, String(idx)); }

    function playTrack(idx) {
        var all = getAllMusic();
        if (idx < 0 || idx >= all.length) return;
        if (!getMusicEnabled()) return;
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.addEventListener('ended', function () { nextTrack(); });
        }
        currentTrackIdx = idx;
        setMusicTrackIdx(idx);
        updateMusicUI();

        var track = all[idx];
        var cached = audioBlobCache[track.url] || track._blobUrl;
        if (cached) {
            audioEl.src = cached;
            audioEl.play();
            updateMusicUI();
            return;
        }

        fetch(track.url).then(function (r) { return r.blob(); }).then(function (b) {
            var u = URL.createObjectURL(b); audioBlobCache[track.url] = u;
            if (idx !== currentTrackIdx) return;
            audioEl.src = u;
            audioEl.play();
            updateMusicUI();
        }).catch(function () {});
    }

    function stopMusic() {
        if (audioEl) { audioEl.pause(); audioEl.src = ''; }
        currentTrackIdx = -1;
        setMusicTrackIdx(-1);
        updateMusicUI();
    }

    function togglePlayPause() {
        if (currentTrackIdx < 0) {
            var idx = getMusicTrackIdx();
            if (idx < 0) idx = 0;
            var all = getAllMusic();
            if (!all.length) return;
            playTrack(idx);
            return;
        }
        if (audioEl && !audioEl.paused) { audioEl.pause(); } else { playTrack(currentTrackIdx); }
    }

    function nextTrack() {
        if (getMusicLoop() && currentTrackIdx >= 0) {
            playTrack(currentTrackIdx);
            return;
        }
        var all = getAllMusic();
        if (!all.length) return;
        var next = currentTrackIdx + 1;
        if (next >= all.length) next = 0;
        playTrack(next);
    }

    function updateMusicUI() {
        var pp = el.querySelector('.music__playpause');
        var tn = el.querySelector('.music__trackname');
        var playing = audioEl && !audioEl.paused;
        if (pp) pp.classList.toggle('is-playing', playing);
        if (tn) {
            if (currentTrackIdx >= 0) {
                tn.textContent = getAllMusic()[currentTrackIdx].name;
            } else {
                tn.textContent = '未选择';
            }
        }
        var tracks = el.querySelectorAll('.music__track');
        for (var i = 0; i < tracks.length; i++) {
            tracks[i].classList.toggle('is-active', i === currentTrackIdx);
        }
    }

    function buildMusicPlaylist() {
        var list = el.querySelector('.music__playlist'); if (!list) return;
        list.innerHTML = '';
        var all = getAllMusic();
        for (var i = 0; i < all.length; i++) {
            var d = document.createElement('div'); d.className = 'music__track';
            d.innerHTML = '<span class="music__track-name">' + all[i].name + '</span>' +
                (i >= MUSIC_BUILTIN.length ? '<button class="music__track-remove" data-idx="' + (i - MUSIC_BUILTIN.length) + '"></button>' : '');
            d.setAttribute('data-idx', String(i));
            list.appendChild(d);
        }
        currentTrackIdx = getMusicTrackIdx();
        updateMusicUI();
    }

    function addUrlMusic(url) {
        var name = decodeURIComponent(url.split('/').pop().split('?')[0])
            .replace(/\.[^.]+$/, '').replace(/^HOYO-MiX - /, '').slice(0, 30);
        fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
            var u = URL.createObjectURL(b); audioBlobCache[url] = u;
            var list = getCustomMusicList();
            list.push({ name: name, url: url });
            saveCustomMusicList(list);
            buildMusicPlaylist();
        }).catch(function () { alert('加载失败，请检查链接是否允许跨域'); });
    }

    function addFileMusic(file) {
        var name = file.name.replace(/\.[^.]+$/, '').slice(0, 30), id = 'music_' + Date.now();
        var u = URL.createObjectURL(file); audioBlobCache[id] = u;
        storeFile(id, file);
        var list = getCustomMusicList();
        list.push({ name: name, url: id, _blobUrl: u });
        saveCustomMusicList(list);
        buildMusicPlaylist();
    }

    function removeCustomMusic(idx) {
        var list = getCustomMusicList();
        if (idx < 0 || idx >= list.length) return;
        var item = list[idx];
        if (item._blobUrl) URL.revokeObjectURL(item._blobUrl);
        delete audioBlobCache[item.url];
        if (item.url.indexOf('music_') === 0) deleteFile(item.url);
        list.splice(idx, 1); saveCustomMusicList(list);
        if (currentTrackIdx >= MUSIC_BUILTIN.length + list.length) stopMusic();
        else if (currentTrackIdx === MUSIC_BUILTIN.length + idx) stopMusic();
        buildMusicPlaylist();
    }

    /* ==================== IndexedDB ==================== */

    function openDB(cb) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) { e.target.result.createObjectStore(DB_STORE, { keyPath: 'id' }); };
        req.onsuccess = function (e) { cb(null, e.target.result); };
        req.onerror = function (e) { cb(e.target.error); };
    }
    function storeFile(id, file) {
        openDB(function (err, db) {
            if (err) return; var tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put({ id: id, file: file, ts: Date.now() }); db.close();
        });
    }
    function getAllFiles(cb) {
        openDB(function (err, db) {
            if (err) { cb(err); return; } var tx = db.transaction(DB_STORE, 'readonly');
            var req = tx.objectStore(DB_STORE).getAll();
            req.onsuccess = function () { cb(null, req.result); }; req.onerror = function (e) { cb(e.target.error); }; db.close();
        });
    }
    function deleteFile(id) {
        openDB(function (err, db) {
            if (err) return; var tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).delete(id); db.close();
        });
    }

    /* ==================== 界面 ==================== */

    function initToggles() {
        el.querySelectorAll('.settings__toggle').forEach(function (t) {
            var k = t.getAttribute('data-key');
            if (k === 'bg_enabled') t.classList.toggle('is-on', getBGEnabled());
            else if (k === 'timer_showtime') t.classList.toggle('is-on', getShowTime());
            else if (k === 'music_enabled') t.classList.toggle('is-on', getMusicEnabled());
            else if (k === 'music_loop') t.classList.toggle('is-on', getMusicLoop());
            t.addEventListener('click', function (e) {
                var key = e.currentTarget.getAttribute('data-key');
                var on = e.currentTarget.classList.toggle('is-on');
                if (key === 'bg_enabled') setBGEnabled(on);
                else if (key === 'timer_showtime') setShowTime(on);
                else if (key === 'music_enabled') setMusicEnabled(on);
                else if (key === 'music_loop') setMusicLoop(on);
            });
        });
    }

    function switchTab(name) {
        var t = el.querySelector('.settings__tab.is-active'); if (t) t.classList.remove('is-active');
        var nt = el.querySelector('[data-tab="' + name + '"]'); if (nt) nt.classList.add('is-active');
        var p = el.querySelector('.settings__panel.is-active'); if (p) p.classList.remove('is-active');
        var np = el.querySelector('[data-panel="' + name + '"]'); if (np) np.classList.add('is-active');
    }
    function open() { if (el) el.classList.add('is-active'); }
    function close() { if (el) el.classList.remove('is-active'); }

    function populateAbout() {
        var b = document.getElementById('aboutBrowser');
        if (!b) return;
        var ua = navigator.userAgent || '';
        var plat = navigator.platform || '';
        var lang = navigator.language || '';
        var w = window.screen.width, h = window.screen.height;
        var online = navigator.onLine ? '在线' : '离线';
        b.innerHTML =
            '<p>平台 <span>' + plat + '</span></p>' +
            '<p>语言 <span>' + lang + '</span></p>' +
            '<p>分辨率 <span>' + w + ' × ' + h + '</span></p>' +
            '<p>网络 <span>' + online + '</span></p>' +
            '<p style="flex-direction:column;"><span style="font-size:0.62rem;word-break:break-all;color:var(--w-text-tertiary)">' + ua + '</span></p>';
    }

    function initDevMode() {
        var verEl = document.getElementById('aboutVer');
        if (!verEl) return;
        var clicks = 0;
        verEl.style.cursor = 'default';
        verEl.addEventListener('click', function () {
            if (localStorage.getItem(DEV_KEY) === '1') return;
            clicks++;
            if (clicks >= 7) {
                localStorage.setItem(DEV_KEY, '1');
                enableDevMode();
            }
        });
        if (localStorage.getItem(DEV_KEY) === '1') enableDevMode();
    }

    function enableDevMode() {
        var tab = document.getElementById('devTab');
        if (tab) tab.style.display = '';
        var verEl = document.getElementById('aboutVer');
        if (verEl) { verEl.style.cursor = 'default'; verEl.title = '开发者模式已解锁'; }

        var preview = document.getElementById('devCssPreview');
        if (preview && !preview.value) {
            preview.value =
                '/* =============================================\n' +
                '   MineClock 自定义样式模板\n' +
                '   上传 .css 文件后即时生效\n' +
                '   ============================================= */\n\n' +
                '/* --- 通用变量调整 --- */\n' +
                ':root {\n    /* --bg-base: #000; */\n}\n\n' +
                '/* --- Windows / macOS 端 --- */\n' +
                '.platform-win .clock__time .digit {\n    /* color: #4CC2FF; */\n}\n\n' +
                '/* --- Android 端 --- */\n' +
                '.platform-material .clock__time .digit {\n    /* color: #2E6B31; */\n}\n\n' +
                '/* --- 时钟面板 --- */\n' +
                '/* .clock { ... } */\n' +
                '.clock__date { /* 日期 */ }\n' +
                '.clock__time { /* 时间 */ }\n' +
                '.clock__week { /* 星期 */ }\n\n' +
                '/* --- 设置面板 --- */\n' +
                '/* .settings { ... } */\n' +
                '.settings__window { /* 设置窗口 */ }\n' +
                '.settings__tab { /* 标签按钮 */ }\n\n' +
                '/* --- 快速调节拨盘 --- */\n' +
                '.quick-adj--dial { /* 拨盘容器 */ }\n' +
                '.qa-dial__bg { /* 拨盘背景 */ }\n' +
                '.qa-dial__value { /* 中心数值 */ }\n\n' +
                '/* --- 向导弹窗 --- */\n' +
                '.wizard__window { /* 向导窗口 */ }\n' +
                '.wizard__btn--primary { /* 主按钮 */ }\n\n' +
                '/* --- 暂停/信息弹窗 --- */\n' +
                '.modal__window { /* 弹窗窗口 */ }\n' +
                '.modal__btn--primary { /* 主按钮 */ }\n\n' +
                '/* --- 片头动画 --- */\n' +
                '.splash__brand { /* 品牌文字 */ }\n' +
                '.splash__logo-svg { /* Logo */ }\n\n' +
                '/* --- 教程屏 --- */\n' +
                '.tutorial__zone span { /* 区域标签 */ }\n' +
                '.tutorial__hint { /* 底部提示 */ }\n\n' +
                '/* --- 加载进度条 --- */\n' +
                '.bg-loader__bar { /* 进度条 */ }\n';
        }

        var cssFile = document.getElementById('devCssFile');
        if (cssFile) {
            cssFile.addEventListener('change', function () {
                var f = cssFile.files[0];
                if (!f) return;
                var reader = new FileReader();
                reader.onload = function () {
                    var preview = document.getElementById('devCssPreview');
                    if (preview) preview.value = reader.result;
                    applyDevCSS(reader.result);
                };
                reader.readAsText(f);
                cssFile.value = '';
            });
        }

        var headEl = document.getElementById('devHeadCode');
        var bodyEl = document.getElementById('devBodyCode');
        if (headEl) {
            headEl.value = localStorage.getItem(DEV_HEAD_KEY) || '';
            headEl.addEventListener('input', function () { localStorage.setItem(DEV_HEAD_KEY, headEl.value); });
        }
        if (bodyEl) {
            bodyEl.value = localStorage.getItem(DEV_BODY_KEY) || '';
            bodyEl.addEventListener('input', function () { localStorage.setItem(DEV_BODY_KEY, bodyEl.value); });
        }

        applyDevScripts();
    }

    function applyDevCSS(css) {
        var old = document.getElementById('devCustomCSS');
        if (old) old.remove();
        if (!css) return;
        var style = document.createElement('style');
        style.id = 'devCustomCSS';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function applyDevScripts() {
        var headCode = localStorage.getItem(DEV_HEAD_KEY);
        if (headCode) {
            var s = document.createElement('script');
            s.textContent = headCode;
            document.head.appendChild(s);
        }
        var bodyCode = localStorage.getItem(DEV_BODY_KEY);
        if (bodyCode) {
            try { (new Function(bodyCode))(); } catch (e) { console.warn('Dev script error:', e); }
        }
    }

    function init() {
        el = document.getElementById('settings'); if (!el) return;

        buildWallpaperGrid(); buildWpCustomList(); buildMusicPlaylist(); initToggles();

        getAllFiles(function (err, files) {
            if (err || !files.length) return;
            var wList = getCustomWpList(), mList = getCustomMusicList(), wUp = false, mUp = false;
            for (var i = 0; i < files.length; i++) {
                var f = files[i], u = URL.createObjectURL(f.file);
                if (f.id.indexOf('file_') === 0) {
                    blobCache[f.id] = u;
                    for (var j = 0; j < wList.length; j++) { if (wList[j].url === f.id) { wList[j]._blobUrl = u; wUp = true; } }
                } else if (f.id.indexOf('music_') === 0) {
                    audioBlobCache[f.id] = u;
                    for (var k = 0; k < mList.length; k++) { if (mList[k].url === f.id) { mList[k]._blobUrl = u; mUp = true; } }
                }
            }
            if (wUp) { saveCustomWpList(wList); rebuildWp(); }
            if (mUp) { saveCustomMusicList(mList); buildMusicPlaylist(); }
        });

        // wallpaper events
        var grid = el.querySelector('.settings__wallpapers');
        if (grid) grid.addEventListener('click', function (e) { var t = e.target.closest('.settings__thumb'); if (t) setWallpaperIdx(parseInt(t.getAttribute('data-idx'), 10)); });
        var wcList = el.querySelector('.settings__custom-list');
        if (wcList) wcList.addEventListener('click', function (e) { var b = e.target.closest('.settings__custom-remove'); if (b) removeCustomWallpaper(parseInt(b.getAttribute('data-idx'), 10)); });

        // music events
        var ppBtn = el.querySelector('.music__playpause');
        if (ppBtn) ppBtn.addEventListener('click', togglePlayPause);
        var playlist = el.querySelector('.music__playlist');
        if (playlist) playlist.addEventListener('click', function (e) {
            var tr = e.target.closest('.music__track'); if (!tr) return;
            var rm = e.target.closest('.music__track-remove'); if (rm) { removeCustomMusic(parseInt(rm.getAttribute('data-idx'), 10)); return; }
            playTrack(parseInt(tr.getAttribute('data-idx'), 10));
        });

        // advanced toggles
        el.querySelectorAll('.settings__adv-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () { btn.parentElement.classList.toggle('is-open'); });
        });

        // URL & file inputs
        var urlBtn = el.querySelector('.settings__url-btn');
        var urlInput = el.querySelector('.settings__url-input');
        if (urlBtn && urlInput) urlBtn.addEventListener('click', function () {
            var v = urlInput.value.trim(); if (!v) return;
            var ext = v.split('?')[0].split('.').pop().toLowerCase();
            if (['mp4','webm','mov','jpg','jpeg','png','gif','webp'].indexOf(ext) >= 0) { addUrlWallpaper(v); urlInput.value = ''; }
            else alert('仅支持 mp4/webm/mov/jpg/jpeg/png/gif/webp');
        });

        var fileInput = el.querySelector('.settings__upload-btn input[type=file]');
        if (fileInput) fileInput.addEventListener('change', function () { if (fileInput.files[0]) { addFileWallpaper(fileInput.files[0]); fileInput.value = ''; } });

        var mUrlBtn = el.querySelector('.music__url-btn');
        var mUrlInput = el.querySelector('.music__url-input');
        if (mUrlBtn && mUrlInput) mUrlBtn.addEventListener('click', function () {
            var v = mUrlInput.value.trim(); if (!v) return;
            addUrlMusic(v); mUrlInput.value = '';
        });

        var mc = el.querySelector('.music__custom');
        if (mc) {
            var mFileInput = mc.parentElement.querySelector('.settings__upload-btn input[type=file]');
            if (mFileInput) mFileInput.addEventListener('change', function () { if (mFileInput.files[0]) { addFileMusic(mFileInput.files[0]); mFileInput.value = ''; } });
        }

        el.querySelectorAll('.settings__tab').forEach(function (t) { t.addEventListener('click', function (e) { switchTab(e.currentTarget.getAttribute('data-tab')); }); });
        var cb = el.querySelector('.settings__close'); if (cb) cb.addEventListener('click', close);
        var bd = el.querySelector('.settings__backdrop'); if (bd) bd.addEventListener('click', close);
        if (CM.clock && CM.clock.onZoneLongPress) CM.clock.onZoneLongPress(1, open);

        populateAbout();
        initDevMode();
    }

    CM.settings = { init: init, open: open, close: close, switchTab: switchTab, getShowTime: getShowTime, applyBG: applyBG };

    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
    else { init(); }
})(typeof window !== 'undefined' ? window : this);
