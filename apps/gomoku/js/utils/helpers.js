import { BOARD_SIZE, MARGIN, CELL_SIZE, CANVAS_SIZE } from './constants.js';

/**
 * 将画布点击坐标转换为行列索引，并验证是否靠近交叉点
 */
export function getBoardIndexFromClick(mouseX, mouseY) {
    if (mouseX < MARGIN - 10 || mouseX > CANVAS_SIZE - MARGIN + 10 ||
        mouseY < MARGIN - 10 || mouseY > CANVAS_SIZE - MARGIN + 10) {
        return null;
    }
    const colFloat = (mouseX - MARGIN) / CELL_SIZE;
    const rowFloat = (mouseY - MARGIN) / CELL_SIZE;
    let col = Math.round(colFloat);
    let row = Math.round(rowFloat);
    col = Math.min(BOARD_SIZE - 1, Math.max(0, col));
    row = Math.min(BOARD_SIZE - 1, Math.max(0, row));
    const crossX = MARGIN + col * CELL_SIZE;
    const crossY = MARGIN + row * CELL_SIZE;
    const dist = Math.hypot(mouseX - crossX, mouseY - crossY);
    const maxDist = CELL_SIZE * 0.4;
    if (dist > maxDist) return null;
    return { row, col };
}

/**
 * 将 UTF-8 字符串转换为 Base64 编码（支持中文）
 */
export function utf8ToBase64(str) {
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(str);
    let binaryString = '';
    utf8Bytes.forEach(byte => binaryString += String.fromCharCode(byte));
    return btoa(binaryString);
}

/**
 * 将 Base64 字符串正确解码为 UTF-8 字符串（解决中文乱码）
 * @param {string} base64 Base64编码的字符串
 * @returns {string} 解码后的UTF-8字符串
 */
export function base64ToUtf8(base64) {
    // 将 Base64 解码为二进制字符串
    const binaryString = atob(base64);
    // 将二进制字符串转换为 Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    // 使用 TextDecoder 将 UTF-8 字节解码为 JavaScript 字符串
    return new TextDecoder('utf-8').decode(bytes);
}