(function (global) {
    'use strict';

    var CM = global.CM = global.CM || {};

    function detectPlatform() {
        var ua = navigator.userAgent || '';
        var maxTouch = navigator.maxTouchPoints || 0;
        if (/android/i.test(ua)) return 'material';
        if (/iphone|ipod/i.test(ua)) return 'material';
        if (/ipad/i.test(ua)) return 'material';
        if (/macintosh/i.test(ua) && maxTouch > 0) return 'material';
        return 'win';
    }

    var STEP_TITLES = {
        'start-select': '开始倒计时',
        'duration': '设置倒计时',
        'delay': '延时启动',
        'schedule': '定时启动',
        'end-select': '结束倒计时',
        'link': '跳转链接',
        'summary': '配置小结'
    };

    var START_SUMMARIES = {
        '1': '即时开始 — 设置时长后立即启动倒计时',
        '2': '延时启动 — 设置时长并延时一段时间后启动',
        '3': '定时启动 — 设置时长并到指定时间点启动'
    };

    var END_SUMMARIES = {
        '1': '折跃 — 按进度反色闪烁提醒（50%/75%/节点/结束），逐级强化',
        '2': '静默 — 仅在结束时反色一次，持续 10 秒',
        '3': '心向自由 — 自定义方式结束，可跳转指定链接'
    };

    var wizard = {
        el: null,
        steps: ['start-select'],
        currentIndex: 0,
        startOption: null,
        selections: {}
    };

    function buildSteps(option) {
        var s = ['start-select', 'duration'];
        if (option === '2') s.push('delay');
        if (option === '3') s.push('schedule');
        s.push('end-select');
        return s;
    }

    function pad(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function getInputValues(panelName) {
        var panel = wizard.el.querySelector('[data-panel="' + panelName + '"]');
        if (!panel) return [0, 0, 0];
        var inputs = panel.querySelectorAll('input[type=number]');
        var values = [];
        for (var i = 0; i < inputs.length; i++) {
            values.push(parseInt(inputs[i].value, 10) || 0);
        }
        return values;
    }

    function formatDuration(totalSec) {
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        var parts = [];
        if (h > 0) parts.push(h + '小时');
        if (m > 0) parts.push(m + '分钟');
        if (s > 0 || parts.length === 0) parts.push(s + '秒');
        return parts.join('') || '0秒';
    }

    function formatTime(totalSec) {
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
        return pad(m) + ':' + pad(s);
    }

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

    function getSummaryText() {
        var startOpt = wizard.startOption;
        var endOpt = wizard.selections.endOption;
        var lines = [];

        var durVals = getInputValues('duration');
        var durSec = (durVals[0] || 0) * 3600 + (durVals[1] || 0) * 60 + (durVals[2] || 0);

        lines.push('选择方案' + startOpt + '：' + (START_SUMMARIES[startOpt] || ''));
        lines.push('倒计时时长：' + formatDuration(durSec));

        if (startOpt === '2') {
            var delVals = getInputValues('delay');
            var delSec = (delVals[0] || 0) * 3600 + (delVals[1] || 0) * 60 + (delVals[2] || 0);
            lines.push('延时时长：' + formatDuration(delSec));
        } else if (startOpt === '3') {
            var schVals = getInputValues('schedule');
            lines.push('启动时间：' + pad(schVals[0] || 0) + ':' + pad(schVals[1] || 0));
        }

        lines.push('');

        lines.push(END_SUMMARIES[endOpt] || '');
        if (endOpt === '1' && durSec > 0) {
            var points = calcReminderPoints(durSec);
            lines.push('提醒时刻（自倒计时起）：');
            for (var i = 0; i < points.length; i++) {
                lines.push('  ' + formatTime(points[i].elapsed) + ' — 闪烁 ' + points[i].count + ' 次（' + points[i].label + '）');
            }
        } else if (endOpt === '2') {
            lines.push('结束时反色一次，持续 10 秒');
        } else if (endOpt === '3') {
            var linkInput = wizard.el.querySelector('[data-panel="link"] input');
            var link = linkInput ? linkInput.value : '';
            lines.push('跳转链接：' + (link || '未设置'));
        }

        return lines.join('\n');
    }

    function showPanel(panelName, direction) {
        var panels = wizard.el.querySelectorAll('.wizard__panel');
        var currentActive = null;
        var newPanel = null;

        for (var i = 0; i < panels.length; i++) {
            if (panels[i].classList.contains('is-active')) currentActive = panels[i];
            if (panels[i].getAttribute('data-panel') === panelName) newPanel = panels[i];
        }

        if (currentActive === newPanel && newPanel) {
            if (panelName === 'summary') {
                var t = newPanel.querySelector('.summary__text');
                if (t) t.textContent = getSummaryText();
            }
            return;
        }

        if (currentActive) {
            var leaving = currentActive;
            leaving.classList.remove('is-back');
            if (direction === 'back') leaving.classList.add('is-back');
            leaving.classList.remove('is-active');
            leaving.classList.add('is-leaving');
            setTimeout(function () {
                leaving.classList.remove('is-leaving', 'is-back');
            }, 300);
        }

        if (newPanel) {
            newPanel.classList.remove('is-back');
            if (direction === 'back') newPanel.classList.add('is-back');
            newPanel.classList.add('is-active');
            if (panelName === 'summary') {
                var textEl = newPanel.querySelector('.summary__text');
                if (textEl) textEl.textContent = getSummaryText();
            }
        }
    }

    function updateStepper() {
        var stepper = wizard.el.querySelector('.wizard__stepper');
        if (!stepper) return;
        var needed = wizard.steps.length;

        var realNodes = [];
        for (var c = 0; c < stepper.children.length; c++) {
            if (!stepper.children[c].classList.contains('is-removing')) {
                realNodes.push(stepper.children[c]);
            }
        }

        while (realNodes.length > needed) {
            var node = realNodes.pop();
            node.classList.add('is-removing');
            (function (n) {
                setTimeout(function () {
                    if (n.parentNode) n.parentNode.removeChild(n);
                }, 250);
            })(node);
        }

        while (realNodes.length < needed) {
            var dot = document.createElement('div');
            dot.className = 'wizard__step';
            stepper.appendChild(dot);
            realNodes.push(dot);
            (function (d) {
                void d.offsetWidth;
                d.classList.add('is-visible');
            })(dot);
        }

        for (var i = 0; i < realNodes.length; i++) {
            realNodes[i].classList.toggle('is-active', i === wizard.currentIndex);
            realNodes[i].classList.toggle('is-done', i < wizard.currentIndex);
            realNodes[i].classList.add('is-visible');
        }
    }

    function updateTitle() {
        var panelName = wizard.steps[wizard.currentIndex];
        var titleEl = wizard.el.querySelector('.wizard__title');
        if (titleEl) titleEl.textContent = STEP_TITLES[panelName] || '';
    }

    function updateButtons() {
        var backBtn = wizard.el.querySelector('.wizard__btn--back');
        var nextBtn = wizard.el.querySelector('.wizard__btn--next');
        if (backBtn) backBtn.classList.toggle('is-hidden', wizard.currentIndex <= 0);
        if (nextBtn) {
            var isLast = wizard.currentIndex >= wizard.steps.length - 1;
            nextBtn.textContent = isLast ? '完成' : '下一步';
        }
    }

    function showCurrentStep(direction) {
        showPanel(wizard.steps[wizard.currentIndex], direction);
        updateStepper();
        updateTitle();
        updateButtons();
    }

    function openWizard() {
        if (!wizard.el) return;
        wizard.steps = ['start-select'];
        wizard.currentIndex = 0;
        wizard.startOption = null;
        wizard.selections = {};
        var cards = wizard.el.querySelectorAll('.option-card.is-selected');
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.remove('is-selected');
        }
        wizard.el.classList.add('is-active');
        showCurrentStep();
    }

    function closeWizard() {
        if (wizard.el) wizard.el.classList.remove('is-active');
    }

    function collectConfig() {
        var durVals = getInputValues('duration');
        var config = {
            startOption: wizard.startOption,
            duration: { h: durVals[0] || 0, m: durVals[1] || 0, s: durVals[2] || 0 },
            endOption: wizard.selections.endOption
        };
        if (wizard.startOption === '2') {
            var delVals = getInputValues('delay');
            config.delay = { h: delVals[0] || 0, m: delVals[1] || 0, s: delVals[2] || 0 };
        } else if (wizard.startOption === '3') {
            var schVals = getInputValues('schedule');
            config.schedule = { h: schVals[0] || 0, m: schVals[1] || 0 };
        }
        if (wizard.selections.endOption === '3') {
            var linkInput = wizard.el.querySelector('[data-panel="link"] input');
            config.link = linkInput ? linkInput.value : '';
        }
        return config;
    }

    function nextStep() {
        if (wizard.currentIndex === 0 && !wizard.startOption) return;
        if (wizard.currentIndex < wizard.steps.length - 1) {
            wizard.currentIndex++;
            showCurrentStep('forward');
        } else {
            var config = collectConfig();
            closeWizard();
            if (CM.runtime) CM.runtime.start(config);
        }
    }

    function prevStep() {
        if (wizard.currentIndex > 0) {
            wizard.currentIndex--;
            showCurrentStep('back');
        }
    }

    function selectOption(card) {
        var panel = card.closest('.wizard__panel');
        if (!panel) return;
        var siblings = panel.querySelectorAll('.option-card');
        for (var i = 0; i < siblings.length; i++) {
            siblings[i].classList.remove('is-selected');
        }
        card.classList.add('is-selected');
        var option = card.getAttribute('data-option');
        var panelName = panel.getAttribute('data-panel');
        if (panelName === 'start-select') {
            wizard.startOption = option;
            wizard.steps = buildSteps(option);
            updateStepper();
        } else if (panelName === 'end-select') {
            wizard.selections.endOption = option;
            var endIdx = wizard.steps.indexOf('end-select');
            wizard.steps = wizard.steps.slice(0, endIdx + 1);
            if (option === '3') {
                wizard.steps.push('link');
            }
            wizard.steps.push('summary');
            updateStepper();
        }
    }

    function init() {
        var platform = detectPlatform();
        document.body.classList.add('platform-' + platform);

        wizard.el = document.getElementById('wizard');
        if (!wizard.el) return;

        var nextBtn = wizard.el.querySelector('.wizard__btn--next');
        var backBtn = wizard.el.querySelector('.wizard__btn--back');
        var cancelBtn = wizard.el.querySelector('.wizard__btn--cancel');
        var backdrop = wizard.el.querySelector('.wizard__backdrop');

        if (nextBtn) nextBtn.addEventListener('click', nextStep);
        if (backBtn) backBtn.addEventListener('click', prevStep);
        if (cancelBtn) cancelBtn.addEventListener('click', closeWizard);
        if (backdrop) backdrop.addEventListener('click', closeWizard);

        var cards = wizard.el.querySelectorAll('.option-card');
        for (var i = 0; i < cards.length; i++) {
            cards[i].addEventListener('click', function (e) {
                selectOption(e.currentTarget);
            });
        }

        if (CM.clock && CM.clock.onZoneLongPress) {
            CM.clock.onZoneLongPress(2, openWizard);
            CM.clock.onZoneLongPress(3, function () {
                if (CM.runtime) CM.runtime.showPauseDialog();
            });
        }
    }

    CM.setup = {
        init: init,
        open: openWizard,
        close: closeWizard,
        platform: detectPlatform()
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this);
