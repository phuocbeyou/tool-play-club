import chalk from "chalk"
import websocket from "websocket"
import fs from "fs"
import { fileURLToPath } from "url"
import { dirname } from "path"
import path from "path"
import { readUsers } from "../logic/dataManager.js"
import { logError } from "../ui/display.js"
import { sendTelegramAlert } from "../utils/bot.js"
import { convertVnd } from "../utils/bet.js"

const WebSocketClient = websocket.client
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const configPath = path.resolve(__dirname, "../../rule.json")

/*------- HÀM TIỆN ÍCH --------------------*/
/**
 * Ghi thông báo ra console và thêm vào file 'game.log'.
 * Xóa các mã màu ANSI khỏi thông báo trước khi ghi vào file để log sạch hơn.
 * @param {string} message - Thông báo cần ghi.
 */
const Log = (message) => {
  console.log(message)
  try {
    fs.appendFile("./game.log", message.replace(/ \[\d+m/gm, "") + "\n", () => {})
  } catch (error) {
    fs.appendFile("./game.log", message + "\n", () => {})
  }
}

/*------- CẤU HÌNH ĐƯỢC TẢI TỪ FILE JSON ----------------*/
let config
let DEFAULT_BET_AMOUNT
let JACKPOT_THRESHOLD
let BET_STOP
let ZOMBIE_MODE // Thêm biến zombie mode
// Các biến này sẽ được cập nhật khi config thay đổi
let IS_MARTINGALE
let RATE_MARTINGALE
let configReloadTimeout // Biến để quản lý debounce

/**
 * Tải cấu hình từ file rule.json và cập nhật các hằng số liên quan.
 */
const loadConfigAndConstants = () => {
  try {
    const newConfig = JSON.parse(fs.readFileSync(configPath, "utf8"))
    config = newConfig // Gán lại đối tượng config
    DEFAULT_BET_AMOUNT = config.gameSettings.BET_AMOUNT
    JACKPOT_THRESHOLD = config.gameSettings.JACKPOT_THRESHOLD
    BET_STOP = config.gameSettings.BET_STOP
    IS_MARTINGALE = config.gameSettings.IS_MARTINGALE // Cập nhật biến Martingale
    RATE_MARTINGALE = config.gameSettings.RATE_MARTINGALE // Cập nhật biến Martingale Rate
    ZOMBIE_MODE = config.gameSettings.ZOMBIE || false // Thêm zombie mode
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Cấu hình rule.json đã được tải lại.`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Chế độ Zombie: ${ZOMBIE_MODE ? "BẬT" : "TẮT"}`))
    if (IS_MARTINGALE) {
      Log(chalk.yellow(`Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
  } catch (error) {
    console.error(chalk.red(`Lỗi khi đọc hoặc phân tích cú pháp rule.json: ${error.message}`))
  }
}

// Tải cấu hình lần đầu khi ứng dụng khởi động
loadConfigAndConstants()

// Theo dõi sự thay đổi của file rule.json
fs.watch(configPath, (eventType, filename) => {
  if (filename) {
    Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Phát hiện thay đổi trong rule.json (${eventType}). Đang tải lại...`))
    clearTimeout(configReloadTimeout)
    configReloadTimeout = setTimeout(() => {
      loadConfigAndConstants()
      // Khi cấu hình được tải lại, các GameWorker đang chạy sẽ tự động sử dụng các giá trị mới
      // vì chúng truy cập các biến global như IS_MARTINGALE, RATE_MARTINGALE, DEFAULT_BET_AMOUNT.
      // Tuy nhiên, martingaleCurrentBet của các instance hiện tại cần được reset nếu IS_MARTINGALE bị tắt
      // hoặc nếu baseBetAmount thay đổi. Để đơn giản, chúng ta sẽ reset martingaleCurrentBet về baseBetAmount
      // khi config được tải lại, đảm bảo trạng thái sạch.
      if (activeGameWorker) {
        activeGameWorker.resetMartingaleState()
      }
    }, 300) // Thời gian debounce 300ms
  }
})

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
    this.username = username
    this.password = password
    this.info = info
    this.signature = signature
    this.mainGameClient = new WebSocketClient()
    this.simmsClient = new WebSocketClient()
    this.mainGameConnection = null
    this.simmsConnection = null
    this.isStopped = false // Indicates if the game is explicitly stopped by user or max reconnects
    this.isBettingAllowed = true
    this.shouldRequestBudget = true
    this.latestGameResult = null
    this.secondLatestGameResult = null
    this.currentSessionId = null
    this.previousSessionId = null
    this.bettingChoice = null // Lựa chọn cược cho phiên hiện tại (TAI/XIU)
    this.currentBetAmount = DEFAULT_BET_AMOUNT // Số tiền cược cho phiên hiện tại
    this.currentBudget = null
    this.currentJackpot = 0
    this.gameHistory = [] // Lưu trữ lịch sử kết quả TAI/XIU (ví dụ: ["TAI", "XIU", "TAI"])
    this.activeIntervals = []
    this.pingCounter = 0

    // Biến cho chế độ Martingale
    this.baseBetAmount = DEFAULT_BET_AMOUNT // Số tiền cược cơ sở, không đổi trong một chuỗi Martingale
    this.martingaleCurrentBet = this.baseBetAmount // Số tiền cược hiện tại theo Martingale
    this.lastBetAmount = 0 // Số tiền đã cược ở phiên trước
    this.lastBetChoice = null // Cửa đã cược ở phiên trước (TAI/XIU)

    // Reconnection properties
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 5000 // 5 seconds
    this.reconnectTimeout = null

    // Zombie mode properties
    this.zombieReconnectAttempts = 0 // Đếm số lần kết nối lại trong zombie mode
    this.zombieReconnectDelay = 5 * 60 * 1000 // 5 phút
    this.zombieReconnectTimeout = null
    this.zombieFailureCount = 0 // Đếm số lần kết nối thất bại liên tiếp

    // Gắn các hàm xử lý sự kiện vào ngữ cảnh 'this'
    this.handleConnectFailed = this.handleConnectFailed.bind(this)
    this.handleConnectionClose = this.handleConnectionClose.bind(this)
    this.handleConnectionError = this.handleConnectionError.bind(this)
    this.handleMainGameMessage = this.handleMainGameMessage.bind(this)
    this.handleSimmsMessage = this.handleSimmsMessage.bind(this)
  }

  /**
   * Reset trạng thái Martingale về ban đầu.
   * Được gọi khi cấu hình được tải lại hoặc khi bắt đầu một phiên mới nếu cần.
   */
  resetMartingaleState() {
    this.baseBetAmount = DEFAULT_BET_AMOUNT // Đảm bảo baseBetAmount được cập nhật theo config mới
    this.martingaleCurrentBet = this.baseBetAmount
    this.lastBetAmount = 0
    this.lastBetChoice = null
    if (IS_MARTINGALE) {
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Trạng thái Martingale đã được reset.`))
    }
  }

  /**
   * Thêm một interval và lưu ID của nó để dọn dẹp sau này.
   * @param {Function} callback - Hàm sẽ được thực thi.
   * @param {number} delay - Độ trễ tính bằng mili giây.
   * @returns {NodeJS.Timeout} ID của interval.
   */
  addManagedInterval(callback, delay) {
    const id = setInterval(callback, delay)
    this.activeIntervals.push(id)
    return id
  }

  /**
   * Force kill tất cả connections và cleanup
   */
  forceKillConnections() {
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Force killing all connections...`))
    
    // Clear tất cả intervals
    this.activeIntervals.forEach(clearInterval)
    this.activeIntervals = []

    // Clear timeouts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.zombieReconnectTimeout) {
      clearTimeout(this.zombieReconnectTimeout)
      this.zombieReconnectTimeout = null
    }

    // Force close connections
    try {
      if (this.mainGameConnection) {
        this.mainGameConnection.close()
        this.mainGameConnection = null
      }
    } catch (e) {
      Log(chalk.yellow(`Warning: Error closing mainGame connection: ${e.message}`))
    }

    try {
      if (this.simmsConnection) {
        this.simmsConnection.close()
        this.simmsConnection = null
      }
    } catch (e) {
      Log(chalk.yellow(`Warning: Error closing simms connection: ${e.message}`))
    }

    // Create new clients
    this.mainGameClient = new WebSocketClient()
    this.simmsClient = new WebSocketClient()
  }

  /**
   * Xử lý lỗi kết nối WebSocket.
   * @param {Error} error - Lỗi kết nối.
   * @param {string} clientName - Tên client (ví dụ: "MainGame", "Simms").
   */
  handleConnectFailed(error, clientName) {
    Log(chalk.red(`Kết nối thất bại (${clientName}): ${error.toString()}`))
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, error)
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.yellow(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  /**
   * Xử lý việc đóng kết nối WebSocket.
   * @param {number} reasonCode - Mã lý do đóng.
   * @param {string} description - Mô tả việc đóng.
   * @param {string} clientName - Tên client.
   */
  handleConnectionClose(reasonCode, description, clientName) {
    Log(chalk.yellow(`Kết nối đã đóng (${clientName}): ${description.toString()}`))
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, new Error(`Connection closed: ${description}`))
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.yellow(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  /**
   * Xử lý lỗi kết nối WebSocket.
   * @param {Error} error - Lỗi kết nối.
   * @param {string} clientName - Tên client.
   */
  handleConnectionError(error, clientName) {
    Log(chalk.red(`Lỗi (${clientName}): ${error.toString()}`))
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, error)
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.red(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  /**
   * Xử lý zombie reconnect - kết nối lại vô hạn với delay 5 phút
   * @param {string} clientName - Tên client
   * @param {Error} error - Lỗi gây ra việc kết nối lại
   */
  handleZombieReconnect(clientName, error) {
    this.zombieFailureCount++
    Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Lần thất bại thứ ${this.zombieFailureCount} cho ${clientName}`))

    // Gửi telegram alert mỗi 3 lần thất bại
    if (this.zombieFailureCount % 3 === 0) {
      sendTelegramAlert({
        type: "error",
        title: "Zombie Mode: Kết nối thất bại liên tiếp",
        content: `Đã thất bại ${this.zombieFailureCount} lần kết nối. Hệ thống vẫn đang cố gắng kết nối lại.`,
        metadata: {
          user: this.username,
          client: clientName,
          error: error.message,
          failureCount: this.zombieFailureCount,
          lastFailure: new Date().toLocaleString(),
        },
      })
    }

    // Force kill và tạo kết nối mới
    this.forceKillConnections()

    // Delay 5 phút trước khi thử lại
    Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Sẽ thử kết nối lại sau 5 phút...`))
    this.zombieReconnectTimeout = setTimeout(() => {
      this.zombieReconnectAttempts++
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Đang thử kết nối lại lần ${this.zombieReconnectAttempts}...`))
      this.start().catch((startError) => {
        Log(chalk.red(`Zombie reconnect failed: ${startError.message}`))
        // Sẽ tự động trigger handleConnectFailed và tiếp tục zombie cycle
      })
    }, this.zombieReconnectDelay)
  }

  /**
   * Cố gắng kết nối lại sau một khoảng thời gian.
   * @param {string} clientName - Tên client đang cố gắng kết nối lại.
   */
  tryReconnect(clientName) {
    if (this.isStopped) {
      Log(chalk.yellow(`Không thể tự động kết nối lại ${clientName}: Trò chơi đã dừng.`))
      return
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Đang cố gắng kết nối lại ${clientName} (Lần ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`))
      this.reconnectTimeout = setTimeout(() => {
        this.start() // Attempt to restart the worker
      }, this.reconnectDelay)
    } else {
      Log(chalk.red(`[${new Date().toLocaleTimeString()}] Đã đạt số lần kết nối lại tối đa (${this.maxReconnectAttempts}) cho ${clientName}.`))
      
      if (ZOMBIE_MODE) {
        Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Chuyển sang Zombie Mode...`))
        this.handleZombieReconnect(clientName, new Error("Max reconnect attempts reached"))
      } else {
        Log(chalk.red(`[${new Date().toLocaleTimeString()}] Đang dừng trò chơi.`))
        sendTelegramAlert({
          type: "error",
          title: "Kết nối lại thất bại",
          content: `Đã đạt số lần kết nối lại tối đa (${this.maxReconnectAttempts}) cho ${clientName}.`,
          metadata: {
            user: this.username,
            reason: "Max reconnect attempts reached",
          },
        })
        this.stop(true) // Pass a flag to indicate it's an auto-stop, not user-initiated
      }
    }
  }

  /**
   * Xử lý các tin nhắn nhận được từ kết nối WebSocket trò chơi chính.
   * @param {object} msg - Đối tượng tin nhắn thô từ thư viện websocket.
   */
  handleMainGameMessage(msg) {
    if (msg.type !== "utf8") {
      Log(chalk.yellow(`Nhận tin nhắn không phải UTF8 từ MainGame: ${msg.type}. Bỏ qua.`))
      return
    }
    const messageString = msg.utf8Data
    let parsedMessage
    try {
      parsedMessage = JSON.parse(messageString)
    } catch (e) {
      Log(
        chalk.red(
          `Lỗi phân tích tin nhắn MainGame (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`,
        ),
      )
      return
    }

    // Lệnh 2000: Trạng thái trò chơi ban đầu hoặc lịch sử
    if (messageString.includes(`"cmd":2000`)) {
      if (parsedMessage[1] && parsedMessage[1].htr && parsedMessage[1].htr.length >= 2) {
        this.latestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 1]
        this.secondLatestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 2]
        // Cập nhật lịch sử trò chơi khi nhận được lịch sử ban đầu
        this.gameHistory = parsedMessage[1].htr.map((r) => (r.d1 + r.d2 + r.d3 > 10 ? "TAI" : "XIU"))
        // Giới hạn độ dài lịch sử
        if (this.gameHistory.length > 10) {
          this.gameHistory = this.gameHistory.slice(-10)
        }
      }
    }
    // Lệnh 2006: Cập nhật kết quả trò chơi
    else if (messageString.includes(`"cmd":2006`)) {
      this.secondLatestGameResult = this.latestGameResult
      this.latestGameResult = parsedMessage[1]
      const sumResult = parsedMessage[1].d1 + parsedMessage[1].d2 + parsedMessage[1].d3
      const resultType = sumResult > 10 ? "TAI" : "XIU"
      Log(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Kết quả phiên ${chalk.cyan(`#${parsedMessage[1].sid}`)}: ` +
        chalk.green(`${resultType} (${sumResult} điểm)`),
      )

      // Reset zombie failure count khi có kết quả thành công
      if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối ổn định, reset failure count.`))
        this.zombieFailureCount = 0
      }

      // Xử lý logic Martingale sau khi có kết quả
      if (IS_MARTINGALE) {
        if (this.lastBetChoice && this.lastBetAmount > 0) { // Đảm bảo có cược trước đó
          if (this.lastBetChoice === resultType) {
            Log(chalk.green(`[${new Date().toLocaleTimeString()}] Phiên #${parsedMessage[1].sid}: THẮNG! Reset cược gấp thếp.`));
            this.martingaleCurrentBet = this.baseBetAmount; // Reset về cược cơ sở
          } else {
            Log(chalk.red(`[${new Date().toLocaleTimeString()}] Phiên #${parsedMessage[1].sid}: THUA! Tăng cược gấp thếp.`));
            this.martingaleCurrentBet = Math.ceil(this.lastBetAmount * RATE_MARTINGALE); // Tăng cược theo tỷ lệ
            // Đảm bảo cược không vượt quá một giới hạn nào đó nếu cần
            // if (this.martingaleCurrentBet > MAX_MARTINGALE_CAP) {
            //   this.martingaleCurrentBet = this.baseBetAmount;
            //   Log(chalk.yellow("Cược gấp thếp đã đạt giới hạn và được reset."));
            // }
          }
        }
      }
      // Reset lastBetChoice và lastBetAmount cho phiên tiếp theo
      this.lastBetChoice = null;
      this.lastBetAmount = 0;

      // Thêm kết quả mới vào lịch sử và giới hạn độ dài
      this.gameHistory.push(resultType)
      if (this.gameHistory.length > 10) {
        this.gameHistory.shift() // Xóa phần tử cũ nhất
      }
      Log(chalk.gray(`Lịch sử gần đây: [${this.gameHistory.join(", ")}]`))
    }
    // Lệnh 2002: Xác nhận đặt cược thành công
    else if (messageString.includes(`"cmd":2002`)) {
      Log(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Phiên ${chalk.cyan(`#${this.currentSessionId}`)} - ` +
        chalk.green(`Người dùng: ${this.username}`) +
        ` - Đặt cược: ${chalk.red(this.currentBetAmount)} đ. ` + // Sử dụng currentBetAmount
        chalk.magenta(`Cược thành công cửa: `) +
        chalk.yellow(this.bettingChoice),
      )
      this.isBettingAllowed = true
      this.shouldRequestBudget = true
    }
    // Lệnh 2011: Cập nhật hũ
    else if (messageString.includes(`"cmd":2011`)) {
      const newJackpot = parsedMessage[1].J
      if (newJackpot !== this.currentJackpot) {
        Log(
          chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          chalk.magenta(`Hũ hiện tại: `) +
          chalk.green(`${newJackpot} đ`),
        )
        this.currentJackpot = newJackpot
        if (this.currentJackpot < JACKPOT_THRESHOLD) { // Sử dụng JACKPOT_THRESHOLD global
          Log(chalk.red("Giá trị hũ dưới ngưỡng dừng. Bỏ cược"))
          // this.stop()
        }
      }
    }
    // Lệnh 2005: Phiên trò chơi mới bắt đầu
    else if (messageString.includes(`"cmd":2005`)) {
      if (parsedMessage[1].sid !== this.previousSessionId) {
        this.currentSessionId = parsedMessage[1].sid
        Log(
          chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          `Phiên mới bắt đầu: ${chalk.cyan(`#${this.currentSessionId}`)}. Đang chờ đặt cược...`,
        )
        setTimeout(
          () => {
            this.executeBettingLogic(this.currentSessionId)
          },
          Math.floor(Math.random() * 20000) + 10000,
        ) // Đặt cược sau 10-30 giây ngẫu nhiên
      }
    }
  }

  /**
   * Xử lý các tin nhắn nhận được từ kết nối WebSocket Simms (để cập nhật số dư).
   * @param {object} msg - Đối tượng tin nhắn thô từ thư viện websocket.
   */
  handleSimmsMessage(msg) {
    if (msg.type !== "utf8") {
      Log(chalk.yellow(`Nhận tin nhắn không phải UTF8 từ Simms: ${msg.type}. Bỏ qua.`))
      return
    }
    const messageString = msg.utf8Data
    let parsedMessage
    try {
      parsedMessage = JSON.parse(messageString)
    } catch (e) {
      Log(
        chalk.red(
          `Lỗi phân tích tin nhắn Simms (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`,
        ),
      )
      return
    }

    // Lệnh 310: Cập nhật số dư
    if (messageString.includes(`"cmd":310`)) {
      if (parsedMessage[1] && parsedMessage[1].As && typeof parsedMessage[1].As.gold === "number") {
        this.currentBudget = parsedMessage[1].As.gold
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) + `Số dư ví: ${chalk.green(this.currentBudget + " đ")}`)
      }
    }
  }

  /**
   * Xác định lựa chọn đặt cược (TÀI hoặc XỈU) và số tiền cược dựa trên các quy tắc đã định nghĩa và lịch sử trò chơi.
   * Ưu tiên các quy tắc có độ ưu tiên cao hơn (priority thấp hơn).
   * @returns {boolean} True nếu xác định được lựa chọn đặt cược hợp lệ, ngược lại là false.
   */
  determineBettingChoice() {
    this.bettingChoice = null // Reset lựa chọn cược
    // this.currentBetAmount = DEFAULT_BET_AMOUNT // Không reset ở đây nếu dùng Martingale
    let selectedRule = null
    const recentHistory = [...this.gameHistory].reverse()
    const activeRules = config.bettingRules.filter((rule) => rule.active).sort((a, b) => a.priority - b.priority)

    for (const rule of activeRules) {
      if (rule.pattern.length === 0) {
        selectedRule = rule
        break
      }
      if (recentHistory.length >= rule.pattern.length) {
        const historySlice = recentHistory.slice(0, rule.pattern.length)
        const reversedPattern = [...rule.pattern].reverse()
        const patternMatches = reversedPattern.every((val, index) => val === historySlice[index])
        if (patternMatches) {
          selectedRule = rule
          break
        }
      }
    }

    if (selectedRule) {
      this.bettingChoice = selectedRule.betOn
      // Áp dụng logic Martingale nếu IS_MARTINGALE là true
      if (IS_MARTINGALE) {
        this.currentBetAmount = this.martingaleCurrentBet
        Log(
          chalk.magenta(`[${new Date().toLocaleTimeString()}] `) +
          `Đã chọn quy tắc: ${chalk.yellow(selectedRule.name)} - Đặt cược (Martingale): ${chalk.yellow(this.bettingChoice)} với số tiền ${chalk.red(this.currentBetAmount)} đ.`,
        )
      } else {
        // Nếu không phải Martingale, sử dụng betAmount của rule hoặc DEFAULT_BET_AMOUNT
        this.currentBetAmount = selectedRule.betAmount || DEFAULT_BET_AMOUNT
        Log(
          chalk.magenta(`[${new Date().toLocaleTimeString()}] `) +
          `Đã chọn quy tắc: ${chalk.yellow(selectedRule.name)} - Đặt cược: ${chalk.yellow(this.bettingChoice)} với số tiền ${chalk.red(this.currentBetAmount)} đ.`,
        )
      }
      return true
    } else {
      Log(
        chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
        "Không tìm thấy quy tắc đặt cược phù hợp trong lịch sử gần đây.",
      )
      return false
    }
  }

  /**
   * Thực thi logic đặt cược cho một phiên trò chơi mới.
   * @param {number} sessionId - ID phiên trò chơi hiện tại.
   */
  executeBettingLogic(sessionId) {
    if (this.currentJackpot > JACKPOT_THRESHOLD && this.determineBettingChoice()) { // Sử dụng JACKPOT_THRESHOLD global
      if (!this.isBettingAllowed) {
        Log(chalk.yellow("Chưa được phép đặt cược, đang chờ xác nhận cược trước đó."))
        return
      }

      // Kiểm tra số dư trước khi đặt cược
      if (this.currentBudget !== null) {
        const notEnoughToPlay = this.currentBudget <= BET_STOP // Sử dụng BET_STOP global
        const notEnoughToBet = this.currentBetAmount > this.currentBudget
        if (notEnoughToPlay || notEnoughToBet) {
          const reason = notEnoughToPlay ?
            "Cảnh báo ví tiền không đủ để cược (dưới ngưỡng dừng cược)" :
            "Cảnh báo ví tiền không đủ để đặt cược (không đủ tiền cho ván này)"
          sendTelegramAlert({
            type: "warning",
            title: reason,
            content: "Xin hãy vào để kiểm tra lại ví tiền hoặc điều chỉnh mức cược.",
            metadata: {
              wallet: `Số tiền hiện tại: ${convertVnd(this.currentBudget)}`,
              betAmount: `Số tiền muốn cược: ${convertVnd(this.currentBetAmount)}`,
              betStop: `Ngưỡng dừng cược: ${convertVnd(BET_STOP)}`, // Sử dụng BET_STOP global
              rateMartingale: `${this.lastBetAmount / RATE_MARTINGALE} số thếp đang gấp`,
            },
          })
          const logTime = new Date().toLocaleTimeString()
          Log(
            chalk.red(`[${logTime}] `) +
            `${reason}` +
            `Số dư hiện tại: ${convertVnd(this.currentBudget)}. Đang dừng trò chơi.`,
          )
          this.stop()
          return
        }
      }

      let betCommand
      const betId = this.bettingChoice === "TAI" ? 1 : 2
      betCommand = `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${this.currentBetAmount},"aid":1,"sid":${sessionId},"eid":${betId}}]`

      if (betCommand && this.mainGameConnection && this.mainGameConnection.connected) {
        this.mainGameConnection.sendUTF(betCommand)
        this.isBettingAllowed = false
        // Lưu lại thông tin cược cho logic Martingale ở phiên sau
        this.lastBetAmount = this.currentBetAmount;
        this.lastBetChoice = this.bettingChoice;
        Log(
          chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          `Đang cố gắng đặt ${this.currentBetAmount} đ vào cửa ${chalk.yellow(this.bettingChoice)} cho phiên ${chalk.cyan(`#${sessionId}`)}.`,
        )
      } else {
        Log(chalk.red("Không thể gửi lệnh đặt cược: Kết nối chưa sẵn sàng hoặc lệnh không hợp lệ."))
      }
      this.previousSessionId = sessionId
    } else {
      Log(
        chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
        `Bỏ qua đặt cược cho phiên ${chalk.cyan(`#${sessionId}`)}: Hũ quá thấp hoặc không có mẫu rõ ràng.`,
      )
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
    ]
    this.mainGameConnection.sendUTF(JSON.stringify(initialData))
    this.mainGameConnection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`)
    setTimeout(() => {
      this.mainGameConnection.sendUTF(`[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2000}]`)
    }, 200)
    this.addManagedInterval(() => {
      if (this.isStopped) return
      if (this.mainGameConnection && this.mainGameConnection.connected) {
        this.mainGameConnection.sendUTF(`[7,"Simms",${++this.pingCounter},0]`)
      }
    }, 5000)
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
    ]
    this.simmsConnection.sendUTF(JSON.stringify(initialData))
    this.addManagedInterval(() => {
      if (this.isStopped) return
      if (this.simmsConnection && this.simmsConnection.connected) {
        if (this.shouldRequestBudget) {
          this.simmsConnection.sendUTF(`[6,"Simms","channelPlugin",{"cmd":310}]`)
          this.shouldRequestBudget = false
        }
        this.simmsConnection.sendUTF(`[7,"Simms",${++this.pingCounter},0]`)
      }
    }, 5000)
  }

  /**
   * Bắt đầu quản lý trò chơi bằng cách thiết lập các kết nối WebSocket.
   * @returns {Promise<void>} Một promise sẽ được giải quyết khi các kết nối được thiết lập hoặc bị từ chối khi thất bại.
   */
  async start() {
    // Reset isStopped to false when start is explicitly called, allowing connection attempts
    this.isStopped = false

    let mainGameConnected = false
    let simmsConnected = false

    const checkBothConnected = (resolve, reject) => {
      if (mainGameConnected && simmsConnected) {
        resolve()
      }
    }

    return new Promise((resolve, reject) => {
      this.mainGameClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "MainGame")
        reject(new Error(`Kết nối MainGame thất bại: ${error.message}`))
      })
      this.mainGameClient.on("connect", (connection) => {
        this.mainGameConnection = connection
        Log(chalk.cyan("Kết nối MainGame thành công."))
        this.reconnectAttempts = 0 // Reset attempts on successful connect
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout)
          this.reconnectTimeout = null
        }
        // Reset zombie failure count trên kết nối thành công
        if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
          Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối MainGame thành công, reset failure count.`))
          this.zombieFailureCount = 0
        }
        this.initializeMainGameConnection()
        this.mainGameConnection.on("message", this.handleMainGameMessage)
        this.mainGameConnection.on("error", (error) => this.handleConnectionError(error, "MainGame"))
        this.mainGameConnection.on("close", (reasonCode, description) =>
          this.handleConnectionClose(reasonCode, description, "MainGame"),
        )
        mainGameConnected = true
        checkBothConnected(resolve, reject)
      })

      this.simmsClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "Simms")
        reject(new Error(`Kết nối Simms thất bại: ${error.message}`)) // Reject if Simms fails
      })
      this.simmsClient.on("connect", (connection) => {
        this.simmsConnection = connection
        Log(chalk.cyan("Kết nối Simms thành công."))
        this.reconnectAttempts = 0 // Reset attempts on successful connect
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout)
          this.reconnectTimeout = null
        }
        // Reset zombie failure count trên kết nối thành công
        if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
          Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối Simms thành công, reset failure count.`))
          this.zombieFailureCount = 0
        }
        this.initializeSimmsConnection()
        this.simmsConnection.on("message", this.handleSimmsMessage)
        this.simmsConnection.on("error", (error) => this.handleConnectionError(error, "Simms"))
        this.simmsClient.on("close", (reasonCode, description) =>
          this.handleConnectionClose(reasonCode, description, "Simms"),
        )
        simmsConnected = true
        checkBothConnected(resolve, reject)
      })

      this.mainGameClient.connect("wss://websocket.mangee.io/websocket")
      this.simmsClient.connect("wss://websocket.mangee.io/websocket2")
    })
  }

  /**
   * Dừng quản lý trò chơi bằng cách đóng các kết nối WebSocket và xóa tất cả các interval.
   * @param {boolean} isAutoStop - True if stopping automatically due to max reconnect attempts, false if user-initiated.
   */
  stop(isAutoStop = false) {
    if (this.isStopped && !isAutoStop) { // If already stopped by user, and not an auto-stop call
      Log(chalk.yellow("Quản lý trò chơi đã dừng."))
      return
    }
    if (this.isStopped && isAutoStop) { // If already stopped by auto-stop, and another auto-stop call
      Log(chalk.yellow("Quản lý trò chơi đã dừng (tự động)."))
      return
    }

    Log(chalk.red("Đang dừng quản lý trò chơi..."))
    this.isStopped = true // Set to true immediately to prevent new reconnects

    // Clear any pending reconnect timeouts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    // Clear zombie reconnect timeout
    if (this.zombieReconnectTimeout) {
      clearTimeout(this.zombieReconnectTimeout)
      this.zombieReconnectTimeout = null
    }
    this.reconnectAttempts = 0 // Reset attempts on explicit stop
    this.zombieReconnectAttempts = 0 // Reset zombie attempts
    this.zombieFailureCount = 0 // Reset zombie failure count

    this.activeIntervals.forEach(clearInterval)
    this.activeIntervals = []

    if (this.mainGameConnection && this.mainGameConnection.connected) {
      this.mainGameConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.")
    }
    if (this.simmsConnection && this.simmsConnection.connected) {
      this.simmsConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.")
    }

    if (!isAutoStop) { // Only send alert if it's a user-initiated stop
      sendTelegramAlert({
        type: "warning",
        title: "Trò chơi đã tạm dừng",
        content: "Xin hãy vào kiểm tra lại",
        metadata: {
          rateMartingale: `${this.lastBetAmount / RATE_MARTINGALE} số thếp đang gấp`,
          zombieMode: ZOMBIE_MODE ? "Đã tắt zombie mode" : "Zombie mode không hoạt động",
        },
      })
    }
    Log(chalk.green("Quản lý trò chơi đã dừng thành công."))
  }
}

/*------- CÁC HÀM ĐIỀU KHIỂN TRÒ CHƠI TOÀN CỤC --------*/
let activeGameWorker = null
/**
 * Bắt đầu trò chơi bằng cách khởi tạo một thể hiện GameWorker mới.
 * Nếu trò chơi đang chạy, nó sẽ ghi lỗi.
 * @returns {Promise<void>} Một promise sẽ được giải quyết khi trò chơi bắt đầu hoặc bị từ chối khi có lỗi.
 */
export const startGame = async () => {
  if (activeGameWorker) {
    logError("Trò chơi đang chạy. Vui lòng dừng nó trước.")
    return
  }
  const users = await readUsers()
  const selectedUser = users.find((u) => u.selected)
  if (!selectedUser) {
    return logError("Không tìm thấy người dùng được chọn. Vui lòng chọn một người dùng trong trình quản lý dữ liệu của bạn.",
    )
  }
  const { name: username, password, infoData, signature } = selectedUser
  const userInfo = infoData && infoData[4] ? infoData[4].info : null
  if (!username || !signature || !userInfo) {
    return logError("Thiếu thông tin tài khoản bắt buộc (tên người dùng, chữ ký hoặc dữ liệu thông tin). Vui lòng kiểm tra cấu hình người dùng của bạn.",
    )
  }
  try {
    activeGameWorker = new GameWorker({
      username,
      password,
      info: userInfo,
      signature,
    })
    await activeGameWorker.start()
    Log(chalk.green("Trò chơi đã bắt đầu thành công!"))
    // Log các quy tắc trò chơi và đặt cược từ config.json
    Log(chalk.yellow("\n--- Quy tắc trò chơi ---"))
    config.gameRules.forEach((rule, index) => Log(chalk.yellow(`${index + 1}. ${rule}`)))
    Log(chalk.yellow("\n--- Quy tắc đặt cược đang hoạt động ---"))
    config.bettingRules
      .filter((rule) => rule.active)
      .sort((a, b) => a.priority - b.priority)
      .forEach((rule, index) =>
        Log(
          chalk.yellow(
            `${index + 1}. [Ưu tiên: ${rule.priority}] ${rule.name}: ${rule.description} (Cược: ${rule.betAmount || DEFAULT_BET_AMOUNT} đ)`,
          ),
        ),
      )
    Log(chalk.yellow(`Số tiền đặt cược mặc định: ${chalk.green(DEFAULT_BET_AMOUNT + " đ")}`))
    Log(chalk.yellow(`Ngưỡng hũ để tiếp tục chơi: ${chalk.green(JACKPOT_THRESHOLD + " đ")}`))
    Log(chalk.yellow(`Ngưỡng dừng cược: ${chalk.green(BET_STOP + " đ")}`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    if (IS_MARTINGALE) {
      Log(chalk.yellow(`Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
    Log(chalk.yellow(`Chế độ Zombie: ${ZOMBIE_MODE ? "BẬT" : "TẮT"}`))
  } catch (error) {
    logError(`Không thể bắt đầu trò chơi: ${error.message}`)
    console.error(error)
    activeGameWorker = null
  }
}

/**
 * Dừng trò chơi đang chạy.
 * Nếu không có trò chơi nào đang hoạt động, nó sẽ ghi thông báo.
 */
export const stopGame = () => {
  if (activeGameWorker) {
    activeGameWorker.stop() // Call stop without isAutoStop=true, indicating user-initiated stop
    activeGameWorker = null
    Log(chalk.green("Trò chơi đã dừng bởi người dùng."))
  } else {
    logError("Không có trò chơi nào đang hoạt động để dừng.")
  }
}