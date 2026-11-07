(function (global) {
    'use strict';

    var STORAGE_KEY = 'splash_tutorial_done';

    var el = null;
    var timer = null;
    var isDone = false;
    var tutorialStep = 0;
    var typerTimer = null;

    var STEPS = [
        {
            zone: '1',
            label: '长按左上 — 打开设置',
            lines: [
                '更改背景壁纸，支持在线链接和本地上传',
                '切换背景音乐，内置 6 首精选曲目',
                '调整计时显示偏好',
                '查看版本与许可证信息'
            ]
        },
        {
            zone: '3',
            label: '长按左下 — 配置倒计时',
            lines: [
                '选择开始方式：即时开始 / 延时启动 / 定时启动',
                '设置倒计时时长后，选择结束方式：',
                '　折跃 — 按进度节点闪烁提醒，逐级强化',
                '　静默 — 结束时反色一次，持续 10 秒',
                '　心向自由 — 自定义结束方式，可跳转链接'
            ]
        },
        {
            zone: '2',
            label: '长按右上 — 快速调节时间',
            lines: [
                '倒计时运行中可用，精准到分钟',
                '拖拽或滚轮旋转中心轮盘',
                '顺时针增加，逆时针减少',
                '最多可调节 ±99 分钟'
            ]
        },
        {
            zone: '4',
            label: '长按右下 — 暂停或停止',
            lines: [
                '倒计时运行中可随时暂停',
                '停止后查看本次计时详情',
                '累计使用时长满 3 的倍数时',
                '有机会看到特别内容'
            ]
        }
    ];

    function clearTyper() {
        if (typerTimer) { clearTimeout(typerTimer); typerTimer = null; }
    }

    function typeText(el, text, idx, onDone) {
        clearTyper();
        if (idx >= text.length) {
            if (onDone) onDone();
            return;
        }
        el.textContent += text.charAt(idx);
        typerTimer = setTimeout(function () {
            typeText(el, text, idx + 1, onDone);
        }, 35);
    }

    function showTutorialStep(idx) {
        if (idx >= STEPS.length) {
            showDoneButton();
            return;
        }

        var step = STEPS[idx];

        var tutorialScreen = el.querySelector('.splash__screen--tutorial');
        tutorialScreen.setAttribute('data-active', step.zone);

        var prevZone = el.querySelector('.tutorial__zone.is-active');
        if (prevZone) prevZone.classList.remove('is-active');

        var zoneEl = el.querySelector('.tut-zone--' + step.zone);
        if (zoneEl) zoneEl.classList.add('is-active');

        var labelEl = el.querySelector('.tutorial__label');
        var typerEl = el.querySelector('.tutorial__typer');

        labelEl.style.opacity = '1';
        labelEl.textContent = step.label;

        typerEl.style.opacity = '1';
        typerEl.textContent = '';

        var fullText = step.lines.join('\n');
        typeText(typerEl, fullText, 0, function () {
            tutorialStep = idx;
        });
    }

    function showDoneButton() {
        var screen = el.querySelector('.splash__screen--tutorial');
        screen.removeAttribute('data-active');
        var prevZone = el.querySelector('.tutorial__zone.is-active');
        if (prevZone) prevZone.classList.remove('is-active');
        el.querySelector('.tutorial__label').style.opacity = '0';
        el.querySelector('.tutorial__typer').style.opacity = '0';
        el.querySelector('.tutorial__hint').style.display = 'none';
        el.querySelector('.splash__done').classList.add('is-visible');
    }

    function onTutorialClick() {
        if (typerTimer) {
            clearTyper();
            var typerEl = el.querySelector('.tutorial__typer');
            var step = STEPS[tutorialStep];
            typerEl.textContent = step.lines.join('\n');
            return;
        }

        tutorialStep++;
        showTutorialStep(tutorialStep);
    }

    function showScreen(name) {
        var prev = el.querySelector('.splash__screen.is-active');
        if (prev) prev.classList.remove('is-active');

        var screen = el.querySelector('[data-screen="' + name + '"]');
        if (screen) screen.classList.add('is-active');
    }

    function done() {
        if (isDone) return;
        isDone = true;
        clearTyper();
        if (timer) clearTimeout(timer);
        localStorage.setItem(STORAGE_KEY, '1');
        document.body.style.overflow = '';
        el.style.transition = 'opacity 0.5s ease';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        setTimeout(function () {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 500);
    }

    function init() {
        el = document.getElementById('splash');
        if (!el) return;

        document.body.style.overflow = 'hidden';

        var tutorialSeen = !!(localStorage.getItem(STORAGE_KEY));

        var doneBtn = el.querySelector('.splash__done');
        if (doneBtn) doneBtn.addEventListener('click', done);

        el.addEventListener('click', function (e) {
            if (e.target.closest('.splash__done')) return;
            var tutorialScreen = el.querySelector('.splash__screen--tutorial.is-active');
            if (tutorialScreen) onTutorialClick();
        });

        showScreen('brand');

        timer = setTimeout(function () {
            showScreen('logo');

            timer = setTimeout(function () {
                if (tutorialSeen) {
                    done();
                } else {
                    showScreen('tutorial');
                    tutorialStep = 0;
                    var lines = el.querySelector('.tutorial__lines');
                    if (lines) {
                        lines.classList.add('is-sweep');
                        setTimeout(function () {
                            lines.classList.remove('is-sweep');
                            showTutorialStep(0);
                        }, 750);
                    }
                }
            }, 2600);
        }, 2200);
    }

    if (document.getElementById('splash')) {
        init();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this);
