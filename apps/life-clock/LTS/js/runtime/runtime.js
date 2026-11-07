(function (global) {
    'use strict';

    var CM = global.CM = global.CM || {};

    var STORAGE_KEY = 'clockme_usage';
    var DONATION_KEY = 'clockme_donation';
    var ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

    try {
        JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {}

    var state = {
        phase: 'idle',
        config: null,
        totalSec: 0,
        remainingSec: 0,
        startTs: 0,
        endTs: 0,
        tickTimer: null,
        delayTimer: null,
        reminderPoints: [],
        reminderIndex: 0
    };

    function calcReminderPoints(totalSec) {
        if (totalSec <= 0) return [];
        var points = [];
        var isLong = totalSec > 15 * 60;

        if (isLong) {
            points.push({ elapsed: 10 * 60, label: '运行 10 分钟' });
        } else if (totalSec >= 3 * 60) {
            points.push({ elapsed: 3 * 60, label: '运行 3 分钟' });
        }

        points.push({ elapsed: Math.floor(totalSec * 0.5), label: '进度过半' });
        points.push({ elapsed: Math.floor(totalSec * 0.75), label: '进度 3/4' });

        if (totalSec > 180) {
            points.push({ elapsed: totalSec - 180, label: '最后 3 分钟' });
        }

        points.push({ elapsed: totalSec, label: '结束' });

        points.sort(function (a, b) { return a.elapsed - b.elapsed; });

        var deduped = [];
        for (var i = 0; i < points.length; i++) {
            if (deduped.length === 0 || deduped[deduped.length - 1].elapsed !== points[i].elapsed) {
                deduped.push(points[i]);
            }
        }

        for (var j = 0; j < deduped.length; j++) {
            deduped[j].count = j + 1;
        }

        return deduped;
    }

    var usage = {
        lastFlush: 0,
        timer: null,

        start: function () {
            this.lastFlush = Date.now();
            var self = this;
            this.timer = setInterval(function () { self.flush(); }, 60000);
        },

        flush: function () {
            if (!this.lastFlush) return;
            var now = Date.now();
            var minutes = Math.floor((now - this.lastFlush) / 60000);
            if (minutes > 0) {
                try {
                    var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
                    data.minutes = (data.minutes || 0) + minutes;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                } catch (e) {}
                this.lastFlush += minutes * 60000;
            }
        },

        stop: function () {
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.flush();
            this.lastFlush = 0;
        }
    };

    function getUsageMinutes() {
        try {
            var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return data.minutes || 0;
        } catch (e) {
            return 0;
        }
    }

    function shouldShowDonation() {
        try {
            var last = localStorage.getItem(DONATION_KEY);
            if (!last) return true;
            return (Date.now() - parseInt(last, 10)) > ONE_MONTH;
        } catch (e) {
            return true;
        }
    }

    function markDonationShown() {
        try {
            localStorage.setItem(DONATION_KEY, String(Date.now()));
        } catch (e) {}
    }

    var audioCtx = null;

    function initAudio() {
        if (audioCtx) return;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var buffer = audioCtx.createBuffer(1, 1, 22050);
            var src = audioCtx.createBufferSource();
            src.buffer = buffer;
            src.connect(audioCtx.destination);
            src.start();
        } catch (e) {}
    }

    function playBeep() {
        if (!audioCtx) return;
        var now = audioCtx.currentTime;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.12;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc.stop(now + 0.12);
    }

    function flashInvert(count, onDone) {
        var i = 0;
        function step() {
            if (i >= count) {
                if (onDone) onDone();
                return;
            }
            document.body.classList.add('invert-flash');
            playBeep();
            setTimeout(function () {
                document.body.classList.remove('invert-flash');
                i++;
                if (i < count) setTimeout(step, 1000);
                else if (onDone) onDone();
            }, 1000);
        }
        step();
    }

    function silentEnd() {
        document.body.classList.add('invert-flash');
        setTimeout(function () {
            document.body.classList.remove('invert-flash');
        }, 10000);
    }

    function checkReminders(remaining, total) {
        if (state.config.endOption !== '1') return;
        var elapsed = total - remaining;

        while (state.reminderIndex < state.reminderPoints.length) {
            var point = state.reminderPoints[state.reminderIndex];
            if (elapsed >= point.elapsed && point.label !== '结束') {
                flashInvert(point.count);
                state.reminderIndex++;
            } else {
                break;
            }
        }
    }

    function start(config) {
        stop();
        initAudio();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

        state.config = config;
        var durSec = (config.duration.h || 0) * 3600 + (config.duration.m || 0) * 60 + (config.duration.s || 0);
        if (durSec <= 0) return false;

        state.totalSec = durSec;
        state.remainingSec = durSec;
        state.reminderPoints = [];
        state.reminderIndex = 0;

        if (config.startOption === '1') {
            beginCountdown();
        } else if (config.startOption === '2') {
            var delaySec = (config.delay.h || 0) * 3600 + (config.delay.m || 0) * 60 + (config.delay.s || 0);
            state.phase = 'pending';
            state.delayTimer = setTimeout(beginCountdown, Math.max(0, delaySec * 1000));
        } else if (config.startOption === '3') {
            var now = new Date();
            var target = new Date();
            target.setHours(config.schedule.h || 0, config.schedule.m || 0, 0, 0);
            if (target <= now) target.setDate(target.getDate() + 1);
            state.phase = 'pending';
            state.delayTimer = setTimeout(beginCountdown, Math.max(0, target - now));
        }
        return true;
    }

    function beginCountdown() {
        state.phase = 'running';
        state.startTs = Date.now();
        state.endTs = state.startTs + state.totalSec * 1000;
        state.reminderPoints = calcReminderPoints(state.totalSec);
        state.reminderIndex = 0;
        usage.start();
        document.body.classList.add('is-counting');
        state.tickTimer = setInterval(tick, 1000);
        tick();
    }

    function tick() {
        var now = Date.now();
        var remaining = Math.max(0, Math.round((state.endTs - now) / 1000));
        state.remainingSec = remaining;

        if (remaining <= 0) {
            endCountdown();
            return;
        }
        checkReminders(remaining, state.totalSec);
    }

    function endCountdown() {
        if (state.tickTimer) clearInterval(state.tickTimer);
        state.tickTimer = null;
        state.phase = 'ended';
        state.remainingSec = 0;
        usage.stop();
        document.body.classList.remove('is-counting');

        var endOpt = state.config.endOption;
        if (endOpt === '1') {
            var endCount = 1;
            if (state.reminderPoints && state.reminderPoints.length > 0) {
                endCount = state.reminderPoints[state.reminderPoints.length - 1].count;
            }
            flashInvert(endCount, showInfoDialog);
        } else if (endOpt === '2') {
            silentEnd();
            setTimeout(showInfoDialog, 10000);
        } else if (endOpt === '3') {
            if (state.config.link) {
                window.location.href = state.config.link;
            } else {
                flashInvert(1, showInfoDialog);
            }
        }
    }

    function stop() {
        if (state.tickTimer) clearInterval(state.tickTimer);
        if (state.delayTimer) clearTimeout(state.delayTimer);
        state.tickTimer = null;
        state.delayTimer = null;
        usage.stop();
        document.body.classList.remove('is-counting');
        state.phase = 'idle';
    }

    function adjustRemaining(deltaSec) {
        if (state.phase !== 'running') return false;
        var now = Date.now();
        state.endTs += deltaSec * 1000;
        var newRemaining = Math.max(0, Math.round((state.endTs - now) / 1000));
        state.remainingSec = newRemaining;
        if (newRemaining <= 0) {
            endCountdown();
        }
        return true;
    }

    function createModal(options) {
        var existing = document.querySelector('.modal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.className = 'modal';

        var headerHtml = options.title ?
            '<div class="modal__header"><h2 class="modal__title">' + options.title + '</h2></div>' : '';

        var buttonsHtml = '';
        if (options.buttons && options.buttons.length) {
            buttonsHtml = '<footer class="modal__footer">';
            for (var i = 0; i < options.buttons.length; i++) {
                var b = options.buttons[i];
                buttonsHtml += '<button class="modal__btn ' + (b.class || '') + '" data-idx="' + i + '">' + b.text + '</button>';
            }
            buttonsHtml += '</footer>';
        }

        modal.innerHTML =
            '<div class="modal__backdrop"></div>' +
            '<div class="modal__window">' +
            headerHtml +
            '<div class="modal__body">' + options.body + '</div>' +
            buttonsHtml +
            '</div>';

        document.body.appendChild(modal);

        if (options.buttons) {
            var btns = modal.querySelectorAll('.modal__btn');
            for (var j = 0; j < btns.length; j++) {
                btns[j].addEventListener('click', function (e) {
                    var idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
                    var cb = options.buttons[idx].onClick;
                    closeModal(modal);
                    if (cb) setTimeout(cb, 320);
                });
            }
        }

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                modal.classList.add('is-active');
            });
        });

        return modal;
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('is-active');
        setTimeout(function () {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 300);
    }

    function showPauseDialog() {
        if (state.phase !== 'running') return;
        createModal({
            title: '停下来试试？',
            body: '<div class="star-time">**:**:**</div>',
            buttons: [
                { text: '返回', class: 'modal__btn--light' },
                {
                    text: '停止并查看',
                    class: 'modal__btn--primary',
                    onClick: function () {
                        stop();
                        showInfoDialog();
                    }
                }
            ]
        });
    }

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function formatClockTime(ts) {
        var d = new Date(ts);
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function showInfoDialog() {
        var now = Date.now();
        var startStr = formatClockTime(state.startTs);
        var endStr = formatClockTime(now);

        var elapsedSec = (now - state.startTs) / 1000;
        var elapsedMin = (elapsedSec / 60).toFixed(2);
        var remainingMin = (state.remainingSec / 60).toFixed(2);
        var totalUsageMin = getUsageMinutes();

        var body =
            '<div class="info-line">本次计时从 ' + startStr + '-' + endStr + '，共计 ' + elapsedMin + ' 分钟</div>' +
            '<div class="info-line">剩余 ' + remainingMin + ' 分钟未完成</div>' +
            '<div class="info-line">您已使用本应用计时 ' + totalUsageMin + ' 分钟</div>';

        createModal({
            body: body,
            buttons: [
                { text: '关闭', class: 'modal__btn--primary', onClick: checkDonation }
            ]
        });
    }

    function checkDonation() {
        var totalMin = getUsageMinutes();
        if (totalMin > 0 && totalMin % 3 === 0 && shouldShowDonation()) {
            showDonationDialog();
        }
    }

    function showDonationDialog() {
        markDonationShown();
        var text = '您知道吗？三在议会中是公平的起点，在几何中是稳定的起点，在一周的工作日中是疲倦的起点，而今天，您的计时时长正好是三的倍数，若您愿意捐赠，对创作者和您来说也是更好的起点!';
        createModal({
            title: '捐赠！',
            body: '<div class="donation-text">' + text + '</div>',
            buttons: [
                { text: '但是我拒绝', class: 'modal__btn--light' },
                {
                    text: '捐赠？',
                    class: 'modal__btn--primary',
                    onClick: function () {
                        window.location.href = 'https://k.344977.xyz/love/';
                    }
                }
            ]
        });
    }

    CM.runtime = {
        start: start,
        stop: stop,
        adjustRemaining: adjustRemaining,
        showPauseDialog: showPauseDialog,
        calcReminderPoints: calcReminderPoints,
        getPhase: function () { return state.phase; },
        getRemaining: function () { return state.remainingSec; },
        getTotal: function () { return state.totalSec; },
        getStartTs: function () { return state.startTs; },
        getUsageMinutes: getUsageMinutes
    };
})(typeof window !== 'undefined' ? window : this);
