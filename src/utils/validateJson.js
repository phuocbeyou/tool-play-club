import { logError } from "../ui/display.js";

export function parseAndValidate(input) {
    const example = [
      1,
      "Simms",
      "use_name",
      "pass_word",
      {
        info: {
          ipAddress: "27.65.19.233",
          userId: "a7e3baa0-14fd-4a4b-bfe8-ea4f4b95e640",
          username: "use_name_in_game",
          timestamp: 1751074336280,
          refreshToken: "xxxxxxxxx"
        },
        signature: "xxxxxxxxxx",
        pid: 4,
        subi: true
      }
    ];
  
    try {
      const arr = JSON.parse(input);
  
      if (!Array.isArray(arr) || arr.length < 5) {
        throw new Error("Dữ liệu không phải mảng đúng định dạng hoặc thiếu phần tử.");
      }
  
      const data = arr[4];
  
      const requiredKeys = ["info", "signature"];
      for (const key of requiredKeys) {
        if (!(key in data)) {
          throw new Error(`Thiếu khóa '${key}' trong phần tử thứ 5.`);
        }
      }
      // Parse info
      if (typeof data.info === "string") {
        try {
          data.info = JSON.parse(data.info);
        } catch (e) {
          throw new Error("Trường 'info' không phải là chuỗi JSON hợp lệ.");
        }
      }
  
      const requiredInfoKeys = ["ipAddress", "userId", "username", "timestamp", "refreshToken"];
      for (const key of requiredInfoKeys) {
        if (!(key in data.info)) {
          throw new Error(`Thiếu khóa '${key}' trong 'info'.`);
        }
      }
  
      return arr;
    } catch (err) {
logError(  {
  error: err.message,
  example
})
     return null
    }
  }
  
  // Dùng thử
  export const inputUserExample = `[1,"Simms","MA_akay131","chanvl123",{"info":"{\\"ipAddress\\":\\"27.65.19.233\\",\\"userId\\":\\"a7e3baa0-14fd-4a4b-bfe8-ea4f4b95e640\\",\\"username\\":\\"MA_akay131\\",\\"timestamp\\":1751074336280,\\"refreshToken\\":\\"09cd706fe7994bfaab9c7fccdde99347.2dbb415441204326a02d20b41428b478\\"}","signature":"abc","pid":4,"subi":true}]`;
