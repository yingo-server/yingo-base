// 浮动消息提示组件
const toastContainerId = 'toast-container';
let container;

function initContainer() {
    if (!container) {
        container = document.getElementById(toastContainerId);
        if (!container) {
            container = document.createElement('div');
            container.id = toastContainerId;
            container.className = 'md2-toast-container';
            document.body.appendChild(container);
        }
    }
}

/**
 * 显示一条消息
 * @param {string} message 消息内容
 * @param {string} type 类型：'info' | 'success' | 'warning' | 'error'，默认 'info'
 * @param {number} duration 显示时长（毫秒），默认 3000，设为 0 则需手动关闭
 */
export function showToast(message, type = 'info', duration = 3000) {
    initContainer();

    const toast = document.createElement('div');
    toast.className = `md2-toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <span class="toast-icon material-icons">${getIcon(type)}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close material-icons" aria-label="关闭">close</button>
    `;

    container.appendChild(toast);

    // 关闭按钮
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        toast.remove();
    });

    // 自动关闭
    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, duration);
    }
}

function getIcon(type) {
    switch (type) {
        case 'success': return 'check_circle';
        case 'warning': return 'warning';
        case 'error': return 'error';
        default: return 'info';
    }
}

/**
 * 显示错误，自动从 Error 对象中提取 code 和 message
 * @param {Error} error 错误对象，应包含 code 和 message 属性
 * @param {string} fallbackMessage 后备消息
 */
export function showError(error, fallbackMessage = '操作失败') {
    const code = error.code ? `[${error.code}] ` : '';
    const msg = error.message || fallbackMessage;
    showToast(`${code}${msg}`, 'error', 5000);
}