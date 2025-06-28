import chalk from "chalk";
import websocket from "websocket";
import fs from "fs";

import { readUsers } from "../logic/dataManager.js";
import { logError } from "../ui/display.js";
import { config } from "../../rule.js";

const WebSocketClient = websocket.client;

/*------- CẤU HÌNH ĐƯỢC TẢI TỪ FILE JSON ----------------*/

/**
 * @constant {number} DEFAULT_BET_AMOUNT - Số tiền đặt cược mặc định nếu quy tắc không có betAmount riêng.
 */
const DEFAULT_BET_AMOUNT = config.gameSettings.BET_AMOUNT;

/**
 * @constant {number} JACKPOT_THRESHOLD - Giá trị hũ tối thiểu để tiếp tục chơi, lấy từ config.json.
 * Nếu hũ xuống dưới mức này, trò chơi sẽ dừng.
 */
const JACKPOT_THRESHOLD = config.gameSettings.JACKPOT_THRESHOLD;

/*------- HÀM TIỆN ÍCH --------------------*/

/**
 * Ghi thông báo ra console và thêm vào file 'game.log'.
 * Xóa các mã màu ANSI khỏi thông báo trước khi ghi vào file để log sạch hơn.
 * @param {string} message - Thông báo cần ghi.
 */
const Log = function (message) {
  console.log(message);
  try {
    fs.appendFile(
      "./game.log",
      message.replace(/ \[\d+m/gm, "") + "\n",
      () => {}
    );
  } catch (error) {
    fs.appendFile("./game.log", message + "\n", () => {});
  }
};

/*------- LỚP QUẢN LÝ TRÒ CHƠI --------------------*/

/**
 * Quản lý các kết nối WebSocket và logic trò chơi cho một người dùng.
 */
class GameWorker {
  /**
   * @param {object} options - Các tùy chọn cấu hình cho quản lý trò chơi.
   * @param {string} options.username - Tên người dùng.
   * @param {string} options.password - Mật khẩu người dùng.
   * @param {object} options.info - Thông tin bổ sung của người dùng.
   * @param {string} options.signature - Chữ ký xác thực của người dùng.
   */
  constructor({ username, password, info, signature }) {
    this.username = username;
    this.password = password;
    this.info = info;
    this.signature = signature;

    this.mainGameClient = new WebSocketClient();
    this.simmsClient = new WebSocketClient();
    this.mainGameConnection = null;
    this.simmsConnection = null;

    this.isStopped = false;
    this.isBettingAllowed = true;
    this.shouldRequestBudget = true;

    this.latestGameResult = null;
    this.secondLatestGameResult = null;
    this.currentSessionId = null;
    this.previousSessionId = null;
    this.bettingChoice = null;
    this.currentBetAmount = DEFAULT_BET_AMOUNT; // Thêm biến để lưu số tiền cược hiện tại
    this.currentBudget = null;
    this.currentJackpot = 0;

    this.gameHistory = []; // Lưu trữ lịch sử kết quả TAI/XIU (ví dụ: ["TAI", "XIU", "TAI"])

    this.activeIntervals = [];
    this.pingCounter = 0;

    // Gắn các hàm xử lý sự kiện vào ngữ cảnh 'this'
    this.handleConnectFailed = this.handleConnectFailed.bind(this);
    this.handleConnectionClose = this.handleConnectionClose.bind(this);
    this.handleConnectionError = this.handleConnectionError.bind(this);
    this.handleMainGameMessage = this.handleMainGameMessage.bind(this);
    this.handleSimmsMessage = this.handleSimmsMessage.bind(this);
  }

  /**
   * Thêm một interval và lưu ID của nó để dọn dẹp sau này.
   * @param {Function} callback - Hàm sẽ được thực thi.
   * @param {number} delay - Độ trễ tính bằng mili giây.
   * @returns {NodeJS.Timeout} ID của interval.
   */
  addManagedInterval(callback, delay) {
    const id = setInterval(callback, delay);
    this.activeIntervals.push(id);
    return id;
  }

  /**
   * Xử lý lỗi kết nối WebSocket.
   * @param {Error} error - Lỗi kết nối.
   * @param {string} clientName - Tên client (ví dụ: "MainGame", "Simms").
   */
  handleConnectFailed(error, clientName) {
    Log(chalk.red(`Kết nối thất bại (${clientName}): ${error.toString()}`));
    this.stop();
  }

  /**
   * Xử lý việc đóng kết nối WebSocket.
   * @param {number} reasonCode - Mã lý do đóng.
   * @param {string} description - Mô tả việc đóng.
   * @param {string} clientName - Tên client.
   */
  handleConnectionClose(reasonCode, description, clientName) {
    Log(chalk.yellow(`Kết nối đã đóng (${clientName}): ${description.toString()}`));
    this.stop();
  }

  /**
   * Xử lý lỗi kết nối WebSocket.
   * @param {Error} error - Lỗi kết nối.
   * @param {string} clientName - Tên client.
   */
  handleConnectionError(error, clientName) {
    Log(chalk.red(`Lỗi (${clientName}): ${error.toString()}`));
    this.stop();
  }

  /**
   * Xử lý các tin nhắn nhận được từ kết nối WebSocket trò chơi chính.
   * @param {object} msg - Đối tượng tin nhắn thô từ thư viện websocket.
   */
  handleMainGameMessage(msg) {
    if (msg.type !== 'utf8') {
      Log(chalk.yellow(`Nhận tin nhắn không phải UTF8 từ MainGame: ${msg.type}. Bỏ qua.`));
      return;
    }
    const messageString = msg.utf8Data;
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(messageString);
    } catch (e) {
      Log(chalk.red(`Lỗi phân tích tin nhắn MainGame (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`));
      return;
    }

    // Lệnh 2000: Trạng thái trò chơi ban đầu hoặc lịch sử
    if (messageString.includes(`"cmd":2000`)) {
      if (parsedMessage[1] && parsedMessage[1].htr && parsedMessage[1].htr.length >= 2) {
        this.latestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 1];
        this.secondLatestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 2];
        // Cập nhật lịch sử trò chơi khi nhận được lịch sử ban đầu
        this.gameHistory = parsedMessage[1].htr.map(r => (r.d1 + r.d2 + r.d3 > 10 ? "TAI" : "XIU"));
        // Giới hạn độ dài lịch sử
        if (this.gameHistory.length > 10) {
          this.gameHistory = this.gameHistory.slice(-10);
        }
      }
    }
    // Lệnh 2006: Cập nhật kết quả trò chơi
    else if (messageString.includes(`"cmd":2006`)) {
      this.secondLatestGameResult = this.latestGameResult;
      this.latestGameResult = parsedMessage[1];
      const sumResult = parsedMessage[1].d1 + parsedMessage[1].d2 + parsedMessage[1].d3;
      const resultType = sumResult > 10 ? "TAI" : "XIU";
      Log(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Kết quả phiên ${chalk.cyan(`#${parsedMessage[1].sid}`)}: ` +
        chalk.green(`${resultType} (${sumResult} điểm)`)
      );
      // Thêm kết quả mới vào lịch sử và giới hạn độ dài
      this.gameHistory.push(resultType);
      if (this.gameHistory.length > 10) {
        this.gameHistory.shift(); // Xóa phần tử cũ nhất
      }
      Log(chalk.gray(`Lịch sử gần đây: [${this.gameHistory.join(', ')}]`));
    }
    // Lệnh 2002: Xác nhận đặt cược thành công
    else if (messageString.includes(`"cmd":2002`)) {
      Log(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Phiên ${chalk.cyan(`#${this.currentSessionId}`)} - ` +
        chalk.green(`Người dùng: ${this.username}`) +
        ` - Đặt cược: ${chalk.red(this.currentBetAmount)} đ. ` + // Sử dụng currentBetAmount
        chalk.magenta(`Cược thành công cửa: `) +
        chalk.yellow(this.bettingChoice)
      );
      this.isBettingAllowed = true;
      this.shouldRequestBudget = true;
    }
    // Lệnh 2011: Cập nhật hũ
    else if (messageString.includes(`"cmd":2011`)) {
      const newJackpot = parsedMessage[1].J;
      if (newJackpot !== this.currentJackpot) {
        Log(
          chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          chalk.magenta(`Hũ hiện tại: `) +
          chalk.green(`${newJackpot} đ`)
        );
        this.currentJackpot = newJackpot;
        if (this.currentJackpot < JACKPOT_THRESHOLD) {
          Log(chalk.red("Giá trị hũ dưới ngưỡng dừng. Đang dừng trò chơi."));
          this.stop();
        }
      }
    }
    // Lệnh 2005: Phiên trò chơi mới bắt đầu
    else if (messageString.includes(`"cmd":2005`)) {
      if (parsedMessage[1].sid !== this.previousSessionId) {
        this.currentSessionId = parsedMessage[1].sid;
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) + `Phiên mới bắt đầu: ${chalk.cyan(`#${this.currentSessionId}`)}. Đang chờ đặt cược...`);
        setTimeout(() => {
          this.executeBettingLogic(this.currentSessionId);
        }, Math.floor(Math.random() * 20000) + 10000); // Đặt cược sau 10-30 giây ngẫu nhiên
      }
    }
  }

  /**
   * Xử lý các tin nhắn nhận được từ kết nối WebSocket Simms (để cập nhật số dư).
   * @param {object} msg - Đối tượng tin nhắn thô từ thư viện websocket.
   */
  handleSimmsMessage(msg) {
    if (msg.type !== 'utf8') {
      Log(chalk.yellow(`Nhận tin nhắn không phải UTF8 từ Simms: ${msg.type}. Bỏ qua.`));
      return;
    }
    const messageString = msg.utf8Data;
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(messageString);
    } catch (e) {
      Log(chalk.red(`Lỗi phân tích tin nhắn Simms (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`));
      return;
    }

    // Lệnh 310: Cập nhật số dư
    if (messageString.includes(`"cmd":310`)) {
      if (parsedMessage[1] && parsedMessage[1].As && typeof parsedMessage[1].As.gold === 'number') {
        this.currentBudget = parsedMessage[1].As.gold;
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) + `Số dư ví: ${chalk.green(this.currentBudget + " đ")}`);
      }
    }
  }

  /**
   * Xác định lựa chọn đặt cược (TÀI hoặc XỈU) và số tiền cược dựa trên các quy tắc đã định nghĩa và lịch sử trò chơi.
   * Ưu tiên các quy tắc có độ ưu tiên cao hơn (priority thấp hơn).
   * @returns {boolean} True nếu xác định được lựa chọn đặt cược hợp lệ, ngược lại là false.
   */
  determineBettingChoice() {
    this.bettingChoice = null; // Reset lựa chọn cược
    this.currentBetAmount = DEFAULT_BET_AMOUNT; // Reset số tiền cược về mặc định
    let selectedRule = null;

    // Lấy lịch sử trò chơi gần nhất (đảo ngược để dễ so khớp mẫu từ cuối)
    const recentHistory = [...this.gameHistory].reverse();

    // Lọc các quy tắc đang hoạt động và sắp xếp theo độ ưu tiên
    const activeRules = config.bettingRules
      .filter(rule => rule.active)
      .sort((a, b) => a.priority - b.priority); // Sắp xếp tăng dần theo priority (ưu tiên thấp nhất là cao nhất)

    for (const rule of activeRules) {
      // Nếu pattern rỗng, đây là quy tắc dự phòng, luôn khớp
      if (rule.pattern.length === 0) {
        selectedRule = rule;
        break; // Chọn quy tắc dự phòng và thoát (vì nó có priority cao nhất trong số các quy tắc dự phòng)
      }

      // Kiểm tra xem lịch sử có đủ dài để khớp với pattern của quy tắc không
      if (recentHistory.length >= rule.pattern.length) {
        const historySlice = recentHistory.slice(0, rule.pattern.length);
        const reversedPattern = [...rule.pattern].reverse();
        const patternMatches = reversedPattern.every((val, index) => val === historySlice[index]);

        if (patternMatches) {
          selectedRule = rule;
          break; // Tìm thấy quy tắc khớp có độ ưu tiên cao nhất, thoát vòng lặp
        }
      }
    }

    if (selectedRule) {
      this.bettingChoice = selectedRule.betOn;
      // Sử dụng betAmount của rule nếu có, nếu không thì dùng DEFAULT_BET_AMOUNT
      this.currentBetAmount = selectedRule.betAmount || DEFAULT_BET_AMOUNT;
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] `) + `Đã chọn quy tắc: ${chalk.yellow(selectedRule.name)} - Đặt cược: ${chalk.yellow(this.bettingChoice)} với số tiền ${chalk.red(this.currentBetAmount)} đ.`);
      return true;
    } else {
      Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) + "Không tìm thấy quy tắc đặt cược phù hợp trong lịch sử gần đây.");
      return false;
    }
  }

  /**
   * Thực thi logic đặt cược cho một phiên trò chơi mới.
   * @param {number} sessionId - ID phiên trò chơi hiện tại.
   */
  executeBettingLogic(sessionId) {
    // Chỉ đặt cược nếu hũ trên ngưỡng và tìm thấy mẫu đặt cược
    if (this.currentJackpot > JACKPOT_THRESHOLD && this.determineBettingChoice()) {
      if (!this.isBettingAllowed) {
        Log(chalk.yellow("Chưa được phép đặt cược, đang chờ xác nhận cược trước đó."));
        return;
      }

      // Kiểm tra số dư trước khi đặt cược
      if (this.currentBudget !== null && this.currentBetAmount > this.currentBudget) {
        Log(chalk.red(`[${new Date().toLocaleTimeString()}] `) + `Không đủ số dư để đặt cược ${this.currentBetAmount} đ. Số dư hiện tại: ${this.currentBudget} đ. Đang dừng trò chơi.`);
        this.stop();
        return;
      }

      let betCommand;
      // eid: 1 cho TAI, 2 cho XIU
      const betId = this.bettingChoice === "TAI" ? 1 : 2;
      betCommand = `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${this.currentBetAmount},"aid":1,"sid":${sessionId},"eid":${betId}}]`; // Sử dụng currentBetAmount

      if (betCommand && this.mainGameConnection && this.mainGameConnection.connected) {
        this.mainGameConnection.sendUTF(betCommand);
        this.isBettingAllowed = false;
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) + `Đang cố gắng đặt ${this.currentBetAmount} đ vào cửa ${chalk.yellow(this.bettingChoice)} cho phiên ${chalk.cyan(`#${sessionId}`)}.`);
      } else {
        Log(chalk.red("Không thể gửi lệnh đặt cược: Kết nối chưa sẵn sàng hoặc lệnh không hợp lệ."));
      }
      this.previousSessionId = sessionId;
    } else {
      Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) + `Bỏ qua đặt cược cho phiên ${chalk.cyan(`#${sessionId}`)}: Hũ quá thấp hoặc không có mẫu rõ ràng.`);
    }
  }

  /**
   * Khởi tạo kết nối WebSocket trò chơi chính và gửi dữ liệu ban đầu.
   */
  initializeMainGameConnection() {
    const initialData = [
      1,
      "MiniGame",
      this.username,
      this.password,
      {
        info: JSON.stringify(this.info),
        signature: this.signature,
      },
    ];
    this.mainGameConnection.sendUTF(JSON.stringify(initialData));
    this.mainGameConnection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`);
    setTimeout(() => {
      this.mainGameConnection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`);
    }, 200);

    this.addManagedInterval(() => {
      if (this.isStopped) return;
      if (this.mainGameConnection && this.mainGameConnection.connected) {
        this.mainGameConnection.sendUTF(`[7,"Simms",${++this.pingCounter},0]`);
      }
    }, 5000);
  }

  /**
   * Khởi tạo kết nối WebSocket Simms và gửi dữ liệu ban đầu.
   */
  initializeSimmsConnection() {
    const initialData = [
      1,
      "Simms",
      this.username,
      this.password,
      {
        info: JSON.stringify(this.info),
        signature: this.signature,
        pid: 4,
        subi: true,
      },
    ];
    this.simmsConnection.sendUTF(JSON.stringify(initialData));

    this.addManagedInterval(() => {
      if (this.isStopped) return;
      if (this.simmsConnection && this.simmsConnection.connected) {
        if (this.shouldRequestBudget) {
          this.simmsConnection.sendUTF(`[6,"Simms","channelPlugin",{"cmd":310}]`);
          this.shouldRequestBudget = false;
        }
        this.simmsConnection.sendUTF(`[7,"Simms",${++this.pingCounter},0]`);
      }
    }, 5000);
  }

  /**
   * Bắt đầu quản lý trò chơi bằng cách thiết lập các kết nối WebSocket.
   * @returns {Promise<void>} Một promise sẽ được giải quyết khi các kết nối được thiết lập hoặc bị từ chối khi thất bại.
   */
  async start() {
    if (this.isStopped) {
      Log(chalk.yellow("Quản lý trò chơi đã dừng hoặc đang dừng. Không thể bắt đầu."));
      return Promise.reject(new Error("Worker đã dừng."));
    }

    return new Promise((resolve, reject) => {
      this.mainGameClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "MainGame");
        reject(new Error(`Kết nối MainGame thất bại: ${error.message}`));
      });
      this.mainGameClient.on("connect", (connection) => {
        this.mainGameConnection = connection;
        Log(chalk.cyan("Kết nối MainGame thành công."));
        this.initializeMainGameConnection();
        this.mainGameConnection.on("message", this.handleMainGameMessage);
        this.mainGameConnection.on("error", (error) => this.handleConnectionError(error, "MainGame"));
        this.mainGameConnection.on("close", (reasonCode, description) => this.handleConnectionClose(reasonCode, description, "MainGame"));
        if (this.simmsConnection || !this.simmsClient.connected) {
          resolve();
        }
      });

      this.simmsClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "Simms");
        if (!this.mainGameConnection || !this.mainGameConnection.connected) {
          reject(new Error(`Kết nối Simms thất bại: ${error.message}`));
        }
      });
      this.simmsClient.on("connect", (connection) => {
        this.simmsConnection = connection;
        Log(chalk.cyan("Kết nối Simms thành công."));
        this.initializeSimmsConnection();
        this.simmsConnection.on("message", this.handleSimmsMessage);
        this.simmsConnection.on("error", (error) => this.handleConnectionError(error, "Simms"));
        this.simmsClient.on("close", (reasonCode, description) => this.handleConnectionClose(reasonCode, description, "Simms"));
        if (this.mainGameConnection || !this.mainGameClient.connected) {
          resolve();
        }
      });

      this.mainGameClient.connect("wss://websocket.mangee.io/websocket");
      this.simmsClient.connect("wss://websocket.mangee.io/websocket2");
    });
  }

  /**
   * Dừng quản lý trò chơi bằng cách đóng các kết nối WebSocket và xóa tất cả các interval.
   */
  stop() {
    if (this.isStopped) {
      Log(chalk.yellow("Quản lý trò chơi đã dừng."));
      return;
    }
    Log(chalk.red("Đang dừng quản lý trò chơi..."));
    this.isStopped = true;

    this.activeIntervals.forEach(clearInterval);
    this.activeIntervals = [];

    if (this.mainGameConnection && this.mainGameConnection.connected) {
      this.mainGameConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.");
    }
    if (this.simmsConnection && this.simmsConnection.connected) {
      this.simmsConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.");
    }
    Log(chalk.green("Quản lý trò chơi đã dừng thành công."));
  }
}

/*------- CÁC HÀM ĐIỀU KHIỂN TRÒ CHƠI TOÀN CỤC --------*/

let activeGameWorker = null;

/**
 * Bắt đầu trò chơi bằng cách khởi tạo một thể hiện GameWorker mới.
 * Nếu trò chơi đang chạy, nó sẽ ghi lỗi.
 * @returns {Promise<void>} Một promise sẽ được giải quyết khi trò chơi bắt đầu hoặc bị từ chối khi có lỗi.
 */
export const startGame = async () => {
  if (activeGameWorker) {
    logError("Trò chơi đang chạy. Vui lòng dừng nó trước.");
    return;
  }

  const users = await readUsers();
  const selectedUser = users.find(u => u.selected);

  if (!selectedUser) {
    return logError("Không tìm thấy người dùng được chọn. Vui lòng chọn một người dùng trong trình quản lý dữ liệu của bạn.");
  }

  const { name: username, password, infoData, signature } = selectedUser;
  const userInfo = infoData && infoData[4] ? infoData[4].info : null;

  if (!username || !signature || !userInfo) {
    return logError("Thiếu thông tin tài khoản bắt buộc (tên người dùng, chữ ký hoặc dữ liệu thông tin). Vui lòng kiểm tra cấu hình người dùng của bạn.");
  }

  try {
    activeGameWorker = new GameWorker({
      username,
      password,
      info: userInfo,
      signature,
    });
    await activeGameWorker.start();
    Log(chalk.green("Trò chơi đã bắt đầu thành công!"));

    // Log các quy tắc trò chơi và đặt cược từ config.json
    Log(chalk.yellow("\n--- Quy tắc trò chơi ---"));
    config.gameRules.forEach((rule, index) => Log(chalk.yellow(`${index + 1}. ${rule}`)));
    Log(chalk.yellow("\n--- Quy tắc đặt cược đang hoạt động ---"));
    config.bettingRules
      .filter(rule => rule.active)
      .sort((a, b) => a.priority - b.priority) // Sắp xếp để hiển thị theo ưu tiên
      .forEach((rule, index) => Log(chalk.yellow(`${index + 1}. [Ưu tiên: ${rule.priority}] ${rule.name}: ${rule.description} (Cược: ${rule.betAmount || DEFAULT_BET_AMOUNT} đ)`)));
    Log(chalk.yellow(`Số tiền đặt cược mặc định: ${chalk.green(DEFAULT_BET_AMOUNT + " đ")}`));
    Log(chalk.yellow(`Ngưỡng hũ để tiếp tục chơi: ${chalk.green(JACKPOT_THRESHOLD + " đ")}`));

  } catch (error) {
    logError(`Không thể bắt đầu trò chơi: ${error.message}`);
    console.error(error);
    activeGameWorker = null;
  }
};

/**
 * Dừng trò chơi đang chạy.
 * Nếu không có trò chơi nào đang hoạt động, nó sẽ ghi thông báo.
 */
export const stopGame = () => {
  if (activeGameWorker) {
    activeGameWorker.stop();
    activeGameWorker = null;
    Log(chalk.green("Trò chơi đã dừng bởi người dùng."));
  } else {
    logError("Không có trò chơi nào đang hoạt động để dừng.");
  }
};