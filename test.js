/**
 * Giải mã chuỗi Base64 và cố gắng chuyển đổi nó thành chuỗi văn bản (UTF-8).
 * Nếu kết quả không phải là văn bản hợp lệ, nó sẽ trả về dữ liệu binary thô.
 * @param {string} base64String Chuỗi Base64 cần giải mã.
 * @returns {string} Chuỗi đã giải mã.
 */
function decodeBase64Full(base64String) {
    try {
        const binaryString = atob(base64String);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        // Thử decode thành UTF-8 để hiển thị tiếng Việt
        return new TextDecoder('utf-8').decode(bytes);

    } catch (error) {
        return "Lỗi giải mã Base64.";
    }
}

// --- CÁCH SỬ DỤNG VỚI DỮ LIỆU CỦA BẠN ---

const encodedData = "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"
const result = decodeBase64Full(encodedData);

console.log(result);