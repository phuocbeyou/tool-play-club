import chalk from "chalk";
import { startGame, stopGame } from "../socket/index.js";

// socketUtils.js
export function sendHeartbeat(connection, intervalRef, isCloseRef) {
    let _next_ive = 0;
    intervalRef.current = setInterval(() => {
      if (isCloseRef.current) return clearInterval(intervalRef.current);
      connection.sendUTF(`[7,"Simms",${++_next_ive},0]`);
    }, 5000);
  }
  
  export function sendInitData(connection, username,password,info, signature) {
    const initPayload = [
      1,
      "MiniGame",
      username,
      password,
      {
        info: JSON.stringify(info),
        signature,
      },
    ];
    connection.sendUTF(JSON.stringify(initPayload));
    connection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`);
    setTimeout(() => {
      connection.sendUTF(
        `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`
      );
    }, 200);
  }
  
  export function handleClose(description, intervals, log) {
    intervals.forEach((interval) => clearInterval(interval.current));
    log("close: " + description.toString());
    return new Error(description);
  }
  
  export function handleError(error, log) {
    log("Error: " + error.toString());
    return new Error(error);
  }
  
  export async function restartGame() {
    console.log(chalk.yellow('🔄 Hệ thống đang cập nhật lại dữ liệu sau thay đổi...'));
  
    console.log(chalk.yellow('🛑 Đang dừng game để áp dụng cấu hình mới...'));
    stopGame(); // không await được
    console.log(chalk.green('✅ Game đã dừng thành công.'));
  
    console.log(chalk.cyan('⏳ Đang chờ hệ thống ổn định trước khi khởi động lại...'));
  
    // Delay 500ms (có thể điều chỉnh)
    setTimeout(() => {
      console.log(chalk.cyan('🚀 Đang khởi động lại game với cấu hình mới...'));
      startGame();
      console.log(chalk.green('✅ Game đã khởi động lại và sẵn sàng hoạt động.'));
    }, 2000);
  }
  