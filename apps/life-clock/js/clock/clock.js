(function (global) {
    'use strict';

    var CM = global.CM = global.CM || {};

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                    'Thursday', 'Friday', 'Saturday'];

    var state = {
        el: null,
        dateEl: null,
        timeEl: null,
        weekEl: null,
        digits: null,
        timer: null,
        burnInTimer: null,
        burnInReturnTimer: null
    };

    var zoneHandlers = {};
    var longPressHandlers = {};
    var longPressConditions = {};
    var longPressTimer = null;
    var longPressRing = null;

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function render() {
        var now = new Date();
        var time = pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
        var date = MONTHS[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
        var week = WEEKDAYS[now.getDay()];
        if (state.digits) {
            for (var i = 0; i < 6; i++) {
                if (state.digits[i]) state.digits[i].textContent = time.charAt(i);
            }
        }
        if (state.dateEl) state.dateEl.textContent = date;
        if (state.weekEl) state.weekEl.textContent = week;
    }

    function applyBurnInShift() {
        if (!state.el) return;
        var dx = (Math.random() < 0.5 ? -1 : 1) * 2;
        var dy = (Math.random() < 0.5 ? -1 : 1) * 2;
        state.el.style.transition = 'transform 2s ease-out';
        state.el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        if (state.burnInReturnTimer) clearTimeout(state.burnInReturnTimer);
        state.burnInReturnTimer = setTimeout(function () {
            if (!state.el) return;
            state.el.style.transition = 'transform 2s ease-out';
            state.el.style.transform = 'translate(0, 0)';
            setTimeout(function () {
                if (state.el) state.el.style.transition = '';
            }, 2000);
        }, 30000);
    }

    function startBurnInProtection() {
        if (state.burnInTimer) clearInterval(state.burnInTimer);
        state.burnInTimer = setInterval(applyBurnInShift, 600000);
    }

    function createRing(x, y) {
        removeRing();
        longPressRing = document.createElement('div');
        longPressRing.className = 'long-press-ring';
        longPressRing.style.left = x + 'px';
        longPressRing.style.top = y + 'px';
        longPressRing.innerHTML =
            '<svg viewBox="0 0 48 48">' +
            '<circle class="ring-track" cx="24" cy="24" r="22"></circle>' +
            '<circle class="ring-progress" cx="24" cy="24" r="22"></circle>' +
            '</svg>';
        document.body.appendChild(longPressRing);
    }

    function removeRing() {
        if (longPressRing) {
            longPressRing.remove();
            longPressRing = null;
        }
    }

    function onZonePointerDown(e) {
        if (document.body.classList.contains('qa-dial-visible')) return;
        var n = e.currentTarget.getAttribute('data-zone');
        var lpHandler = longPressHandlers[n];
        var handler = zoneHandlers[n];
        if (lpHandler) {
            var cond = longPressConditions[n];
            if (cond && !cond()) return;
            createRing(e.clientX, e.clientY);
            longPressTimer = setTimeout(function () {
                removeRing();
                longPressTimer = null;
                lpHandler(n);
            }, 800);
        } else if (handler) {
            handler(n);
        }
    }

    function onZonePointerMove(e) {
        if (longPressRing) {
            longPressRing.style.left = e.clientX + 'px';
            longPressRing.style.top = e.clientY + 'px';
        }
    }

    function onZonePointerUp() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        removeRing();
    }

    function initZones() {
        var zones = document.querySelectorAll('.zone');
        for (var i = 0; i < zones.length; i++) {
            zones[i].addEventListener('pointerdown', onZonePointerDown);
        }
        document.addEventListener('pointermove', onZonePointerMove);
        document.addEventListener('pointerup', onZonePointerUp);
        document.addEventListener('pointercancel', onZonePointerUp);
    }

    function onZone(n, handler) {
        zoneHandlers[n] = handler;
    }

    function onZoneLongPress(n, handler, condition) {
        longPressHandlers[n] = handler;
        if (condition) {
            longPressConditions[n] = condition;
        } else {
            delete longPressConditions[n];
        }
    }

    function init() {
        state.el = document.getElementById('clock');
        if (!state.el) return;
        state.dateEl = document.getElementById('dateDisplay');
        state.timeEl = document.getElementById('timeDisplay');
        state.weekEl = document.getElementById('weekDisplay');
        state.digits = state.timeEl ? state.timeEl.querySelectorAll('.digit') : null;
        render();
        state.timer = setInterval(render, 1000);
        startBurnInProtection();
        initZones();
    }

    CM.clock = {
        init: init,
        render: render,
        onZone: onZone,
        onZoneLongPress: onZoneLongPress
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this);
