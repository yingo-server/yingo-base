(function (global) {
    'use strict';

    var CM = global.CM = global.CM || {};

    var MAX_MIN = 99;
    var HIDE_DELAY = 3000;
    var NUM_TICKS = 36;
    var INERTIA_THRESHOLD = 0.003;
    var INERTIA_STOP_VEL = 0.0006;
    var INERTIA_DECAY = 0.0048;

    var el = null;
    var backdropEl = null;
    var ringEl = null;
    var labelEl = null;

    var active = false;
    var mode = 'idle';
    var totalAngle = 0;
    var prevAngle = null;
    var currentMin = 0;
    var hideTimer = null;
    var platform = 'material';
    var winFocused = false;
    var winWheelAccum = 0;
    var winCoastVel = 0;
    var winCoastTimer = null;

    var angularVelocity = 0;
    var lastMoveTime = 0;
    var inertiaAnimId = null;
    var inertiaVelocity = 0;
    var lastFrameTime = 0;

    var audioCtx = null;
    var lastSoundMin = null;
    var lastSoundTime = 0;

    function createEl() {
        backdropEl = document.createElement('div');
        backdropEl.className = 'qa-dial__backdrop';
        document.body.appendChild(backdropEl);

        el = document.createElement('div');
        el.className = 'quick-adj quick-adj--dial';
        el.innerHTML =
            '<div class="qa-dial__bg"></div>' +
            '<div class="qa-dial__ring"></div>' +
            '<div class="qa-dial__indicator"></div>' +
            '<div class="qa-dial__value"><span class="qa-dial__sign"></span><span class="qa-dial__num">0</span></div>';
        document.body.appendChild(el);
        ringEl = el.querySelector('.qa-dial__ring');
        labelEl = el.querySelector('.qa-dial__value');

        el.offsetHeight;
        var radius = getRadius();
        for (var i = 0; i < NUM_TICKS; i++) {
            var deg = i * (360 / NUM_TICKS);
            var tick = document.createElement('div');
            tick.className = 'qa-dial__tick' + (i % 6 === 0 ? ' qa-dial__tick--major' : '');
            tick.style.transform = 'rotate(' + deg + 'deg) translateY(-' + radius + 'px)';
            ringEl.appendChild(tick);
        }
    }

    function getRadius() {
        if (!el) return 110;
        var w = el.offsetWidth;
        return Math.max(80, w / 2 - 22);
    }

    function angleFromCenter(clientX, clientY) {
        var rect = el.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        return Math.atan2(clientX - cx, -(clientY - cy));
    }

    function show() {
        if (!el) createEl();
        totalAngle = 0;
        currentMin = 0;
        angularVelocity = 0;
        prevAngle = null;
        updateDial(0);
        updateLabel(0);
        document.body.classList.add('qa-dial-visible');
        if (backdropEl) backdropEl.classList.add('is-visible');
        el.classList.add('is-visible');
    }

    function hide() {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (!el) return;
        document.body.classList.remove('qa-dial-visible');
        if (backdropEl) backdropEl.classList.remove('is-visible');
        el.classList.remove('is-visible');
    }

    function scheduleHide() {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            winFocused = false;
            hide();
            resetState();
        }, HIDE_DELAY);
    }

    function resetState() {
        cancelInertia();
        angularVelocity = 0;
        lastMoveTime = 0;
        lastSoundMin = null;
        prevAngle = null;
        mode = 'idle';
        active = false;
        winWheelAccum = 0;
        winCoastVel = 0;
        if (winCoastTimer) { clearTimeout(winCoastTimer); winCoastTimer = null; }
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    function updateDial(angleRad) {
        if (!ringEl) return;
        ringEl.style.transform = 'rotate(' + (angleRad * 180 / Math.PI) + 'deg)';
    }

    function applyLabelClass(min) {
        if (!labelEl) return;
        labelEl.classList.remove('is-zero', 'is-minus', 'is-plus');
        if (min === 0) labelEl.classList.add('is-zero');
        else if (min < 0) labelEl.classList.add('is-minus');
        else labelEl.classList.add('is-plus');
    }

    function updateLabel(min) {
        if (!labelEl) return;
        var signEl = labelEl.querySelector('.qa-dial__sign');
        var numEl = labelEl.querySelector('.qa-dial__num');
        if (min === 0) {
            signEl.textContent = '';
            numEl.textContent = '0';
        } else {
            signEl.textContent = min > 0 ? '+' : '−';
            numEl.textContent = Math.abs(min);
        }
        applyLabelClass(min);
    }

    function computeMin(angleRad) {
        var m = Math.round(angleRad / (8 * Math.PI) * MAX_MIN);
        if (Math.abs(m) < 1 && Math.abs(angleRad / (8 * Math.PI) * MAX_MIN) > 0.0375) {
            m = m >= 0 ? 1 : -1;
        }
        return Math.max(-MAX_MIN, Math.min(MAX_MIN, m));
    }

    function applyAdjustment(min) {
        if (!CM.runtime || !CM.runtime.adjustRemaining) return;
        CM.runtime.adjustRemaining(min * 60);
    }

    /* ----- Audio ----- */

    function playClick() {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            var t = audioCtx.currentTime;

            var osc1 = audioCtx.createOscillator();
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(2800, t);
            osc1.frequency.exponentialRampToValueAtTime(1200, t + 0.03);

            var osc2 = audioCtx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(5600, t);

            var gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0.07, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);

            osc1.start(t);
            osc2.start(t);
            osc1.stop(t + 0.04);
            osc2.stop(t + 0.04);
        } catch (e) {}
    }

    function playSoundForMin(min) {
        if (min === lastSoundMin) return;
        var now = performance.now();
        if (now - lastSoundTime < 30) return;
        lastSoundMin = min;
        lastSoundTime = now;
        playClick();
    }

    /* ----- Inertia ----- */

    function cancelInertia() {
        if (inertiaAnimId) {
            cancelAnimationFrame(inertiaAnimId);
            inertiaAnimId = null;
        }
    }

    function startInertia(vel) {
        cancelInertia();
        active = false;
        angularVelocity = 0;
        inertiaVelocity = vel;
        lastFrameTime = performance.now();
        inertiaAnimId = requestAnimationFrame(inertiaTick);
    }

    function inertiaTick(now) {
        var dt = now - lastFrameTime;
        lastFrameTime = now;
        if (dt > 50) dt = 50;

        totalAngle += inertiaVelocity * dt;
        inertiaVelocity *= Math.exp(-INERTIA_DECAY * dt);

        currentMin = computeMin(totalAngle);
        updateDial(totalAngle);
        updateLabel(currentMin);
        playSoundForMin(currentMin);

        if (Math.abs(inertiaVelocity) > INERTIA_STOP_VEL) {
            inertiaAnimId = requestAnimationFrame(inertiaTick);
        } else {
            inertiaAnimId = null;
            resetState();
            scheduleHide();
        }
    }

    /* ----- Material pointer handlers ----- */

    function onPointerMove(e) {
        if (!active || mode !== 'adjust' || prevAngle === null) return;

        var now = performance.now();
        var currentAngle = angleFromCenter(e.clientX, e.clientY);
        var delta = currentAngle - prevAngle;

        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;

        var dt = now - lastMoveTime;
        if (dt > 0 && dt < 200) {
            var instVel = delta / dt;
            angularVelocity = angularVelocity * 0.8 + instVel * 0.2;
        }
        lastMoveTime = now;
        prevAngle = currentAngle;

        totalAngle += delta;
        currentMin = computeMin(totalAngle);
        updateDial(totalAngle);
        updateLabel(currentMin);
        playSoundForMin(currentMin);
        e.preventDefault();
    }

    function onPointerEnd(e) {
        if (!active || mode !== 'adjust') return;

        if (currentMin !== 0) {
            applyAdjustment(currentMin);
            currentMin = 0;
        }
        if (Math.abs(angularVelocity) > INERTIA_THRESHOLD) {
            startInertia(angularVelocity);
        } else {
            resetState();
            scheduleHide();
        }
    }

    /* ----- Win handlers ----- */

    function onWinFocusClick(e) {
        if (platform !== 'win') return;
        if (!CM.runtime || CM.runtime.getPhase() !== 'running') return;
        if (document.querySelector('.modal, .wizard.is-active, .settings.is-active')) return;
        e.preventDefault();

        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

        if (winFocused) {
            winFocused = false;
            hide();
            resetState();
        } else {
            winFocused = true;
            show();
            active = true;
            mode = 'ready';
            scheduleHide();
        }
    }

    function runWinCoast() {
        if (Math.abs(winCoastVel) < 0.02 || mode !== 'adjust') {
            winCoastVel = 0;
            winCoastTimer = null;
            return;
        }

        winWheelAccum += winCoastVel;
        var intPart = Math.round(winWheelAccum);
        if (intPart !== 0) {
            currentMin = Math.max(-MAX_MIN, Math.min(MAX_MIN, currentMin - intPart));
            winWheelAccum -= intPart;
            totalAngle = (currentMin / MAX_MIN) * 8 * Math.PI;
            updateLabel(currentMin);
            updateDial(totalAngle);
            playSoundForMin(currentMin);
        }

        winCoastVel *= 0.88;

        winCoastTimer = setTimeout(runWinCoast, 16);
    }

    function onWinWheel(e) {
        if (platform !== 'win') return;
        if (!winFocused) return;

        if (document.querySelector('.modal, .wizard.is-active, .settings.is-active')) return;
        if (!CM.runtime || CM.runtime.getPhase() !== 'running') return;
        e.preventDefault();
        if (e.deltaY === 0) return;

        if (mode !== 'adjust') {
            mode = 'adjust';
            if (!el || !el.classList.contains('is-visible')) {
                show();
            }
            prevAngle = null;
            angularVelocity = 0;
        }

        if (winCoastTimer) { clearTimeout(winCoastTimer); winCoastTimer = null; }

        var step = Math.max(1, Math.min(10, Math.round(Math.abs(e.deltaY) / 80)));
        var dir = e.deltaY > 0 ? 1 : -1;

        winWheelAccum += dir * step / 2;
        var intPart = Math.round(winWheelAccum);
        if (intPart !== 0) {
            currentMin = Math.max(-MAX_MIN, Math.min(MAX_MIN, currentMin - intPart));
            winWheelAccum -= intPart;
            totalAngle = (currentMin / MAX_MIN) * 8 * Math.PI;
            updateLabel(currentMin);
            updateDial(totalAngle);
            playSoundForMin(currentMin);
        }

        var impulse = dir * step * 0.02;
        if (winCoastVel !== 0 && (winCoastVel > 0) !== (impulse > 0)) {
            winCoastVel *= 0.3;
        }
        winCoastVel += impulse;
        winCoastVel = Math.max(-5, Math.min(5, winCoastVel));

        runWinCoast();
        scheduleHide();
    }

    function open() {
        cancelInertia();
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        show();
        active = true;
        mode = 'ready';
        scheduleHide();
    }

    function dismiss() {
        if (active) {
            winFocused = false;
            hide();
            resetState();
        }
    }

    function init() {
        var zone = document.querySelector('[data-zone="2"]');
        if (!zone) return;

        platform = (CM.setup && CM.setup.platform) || 'material';

        if (platform === 'material') {
            document.addEventListener('pointerdown', function (e) {
                if (e.button !== 0 && e.button !== undefined) return;
                var dialVisible = el && el.classList.contains('is-visible');
                if (dialVisible) {
                    cancelInertia();
                    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                    active = true;
                    mode = 'adjust';
                    angularVelocity = 0;
                    prevAngle = angleFromCenter(e.clientX, e.clientY);
                    lastMoveTime = performance.now();
                    e.preventDefault();
                }
            });
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerEnd);
            document.addEventListener('pointercancel', onPointerEnd);
        } else {
            zone.addEventListener('click', onWinFocusClick);
            document.addEventListener('wheel', onWinWheel, { passive: false });
        }
    }

    CM.quickadj = { init: init, open: open, dismiss: dismiss };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this);
