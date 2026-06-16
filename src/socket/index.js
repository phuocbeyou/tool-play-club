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
const configPath = path.resolve(__dirname, "../config/even-odd.json")
const statsPath = path.resolve(__dirname, "../config/stast-even-odd.json")

let latestSessionStats = null
export function getLatestSessionStats() {
  return latestSessionStats
}

/*------- HÀM TIỆN ÍCH --------------------*/
/**
 * Ghi thông báo ra console và thêm vào file 'game.log'.
 * Xóa các mã màu ANSI khỏi thông báo trước khi ghi vào file để log sạch hơn.
 * @param {string} message - Thông báo cần ghi.
 */
const Log = (message) => {
  console.log(message)
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
let COUNTDOWN_TIME
let WIN_STOP
let LOSS_STOP
let JACKPOT_HUNT
let JACKPOT_HUNT_BET
let JACKPOT_HUNT_MARTINGALE
let JACKPOT_HUNT_RATE
let JACKPOT_HUNT_CONSECUTIVE
let JACKPOT_HUNT_MIN
let JACKPOT_HUNT_MAX
let JACKPOT_HUNT_BET_TIERS // Bậc cược theo giá trị hũ: [{ jackpot, bet }]
let configReloadTimeout // Biến để quản lý debounce

/**
 * Tính mức cược săn hũ theo giá trị hũ dựa trên bảng khoảng JACKPOT_HUNT_BET_TIERS.
 * Mỗi bậc là 1 khoảng { min, max, bet }; chọn bậc có min cao nhất mà min <= jackpot <= max.
 * - Không định nghĩa bậc nào → dùng JACKPOT_HUNT_BET phẳng (tương thích chế độ cũ).
 * - Có bậc nhưng hũ NẰM NGOÀI mọi khoảng → trả về null (báo hiệu "ngoài range" để dừng).
 * @param {number} jackpot - Giá trị hũ hiện tại.
 * @returns {number|null} Mức cược, hoặc null nếu hũ ngoài range các bậc.
 */
const computeJackpotHuntBet = (jackpot) => {
  const tiers = Array.isArray(JACKPOT_HUNT_BET_TIERS) ? JACKPOT_HUNT_BET_TIERS : []
  if (!tiers.length) return JACKPOT_HUNT_BET // không có bậc → mức phẳng
  let matched = null
  for (const t of tiers) {
    if (
      typeof t.min === "number" && typeof t.max === "number" && typeof t.bet === "number" &&
      jackpot >= t.min && jackpot <= t.max
    ) {
      if (!matched || t.min > matched.min) matched = t // ưu tiên bậc cao hơn ở ranh giới
    }
  }
  return matched ? matched.bet : null // null = ngoài range tiers
}

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
    COUNTDOWN_TIME = config.gameSettings.COUNTDOWN_TIME || 37 // Thời gian đếm ngược
    WIN_STOP = config.gameSettings.WIN_STOP || 200000
    LOSS_STOP = config.gameSettings.LOSS_STOP || 100000
    JACKPOT_HUNT = config.gameSettings.JACKPOT_HUNT || false
    JACKPOT_HUNT_BET = config.gameSettings.JACKPOT_HUNT_BET || 20000
    JACKPOT_HUNT_MARTINGALE = config.gameSettings.JACKPOT_HUNT_MARTINGALE !== false
    JACKPOT_HUNT_RATE = config.gameSettings.JACKPOT_HUNT_RATE || 2
    JACKPOT_HUNT_CONSECUTIVE = config.gameSettings.JACKPOT_HUNT_CONSECUTIVE || 2
    JACKPOT_HUNT_MIN = config.gameSettings.JACKPOT_HUNT_MIN || 0
    JACKPOT_HUNT_MAX = config.gameSettings.JACKPOT_HUNT_MAX || Number.MAX_SAFE_INTEGER
    JACKPOT_HUNT_BET_TIERS = Array.isArray(config.gameSettings.JACKPOT_HUNT_BET_TIERS)
      ? config.gameSettings.JACKPOT_HUNT_BET_TIERS
          .filter((t) => t && typeof t.min === "number" && typeof t.max === "number" && typeof t.bet === "number")
          .sort((a, b) => a.min - b.min)
      : []
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Cấu hình rule.json đã được tải lại.`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Chế độ Zombie: ${ZOMBIE_MODE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Thời gian đếm ngược: ${COUNTDOWN_TIME} giây`))
    Log(chalk.yellow(`Mục tiêu thắng (Win Stop): ${WIN_STOP} đ`))
    Log(chalk.yellow(`Giới hạn thua (Loss Stop): ${LOSS_STOP} đ`))
    Log(chalk.yellow(`Chế độ Săn Hũ (Jackpot Hunt): ${JACKPOT_HUNT ? "BẬT" : "TẮT"}`))
    if (JACKPOT_HUNT) {
      Log(chalk.yellow(`  Mức cược săn hũ (mặc định): ${JACKPOT_HUNT_BET} đ | Chuỗi cần: ${JACKPOT_HUNT_CONSECUTIVE} | Range hũ: ${JACKPOT_HUNT_MIN} → ${JACKPOT_HUNT_MAX} đ`))
      if (JACKPOT_HUNT_BET_TIERS.length) {
        Log(chalk.yellow(`  Bậc cược theo hũ: ${JACKPOT_HUNT_BET_TIERS.map((t) => `${t.min}-${t.max}→${t.bet}đ`).join(" | ")} (ngoài range → DỪNG cả 2 acc)`))
      }
    }
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
    // fs.watch có thể bắn nhiều sự kiện cho 1 lần lưu (macOS/editor ghi nhiều bước).
    // Gộp bằng debounce: chỉ log + tải lại 1 lần khi đã ổn định.
    clearTimeout(configReloadTimeout)
    configReloadTimeout = setTimeout(() => {
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Phát hiện thay đổi rule.json, đang tải lại...`))
      loadConfigAndConstants()
      // Khi cấu hình được tải lại, các GameWorker đang chạy sẽ tự động sử dụng các giá trị mới
      // vì chúng truy cập các biến global như IS_MARTINGALE, RATE_MARTINGALE, DEFAULT_BET_AMOUNT.
      // Tuy nhiên, martingaleCurrentBet của các instance hiện tại cần được reset nếu IS_MARTINGALE bị tắt
      // hoặc nếu baseBetAmount thay đổi. Để đơn giản, chúng ta sẽ reset martingaleCurrentBet về baseBetAmount
      // khi config được tải lại, đảm bảo trạng thái sạch.
      if (activeJackpotManager) {
        activeJackpotManager.resetMartingaleState()
      } else if (activeGameWorker) {
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
    // Chế độ điều phối bởi JackpotHuntManager (bet song song 2 acc)
    this.managedMode = false
    this.manager = null
    this.role = null // "A" (cửa săn hũ) hoặc "B" (cửa backup)
    this.mainGameClient = new WebSocketClient()
    this.simmsClient = new WebSocketClient()
    this.mainGameConnection = null
    this.simmsConnection = null
    this.isStopped = false // Indicates if the game is explicitly stopped by user or max reconnects
    this.isBettingAllowed = true
    this.shouldRequestBudget = true
    this.budgetFresh = true // số dư hiện tại đã phản ánh kết quả ván gần nhất (đã settle) chưa
    this.latestGameResult = null
    this.secondLatestGameResult = null
    this.currentSessionId = null
    this.previousSessionId = null
    this.bettingChoice = null // Lựa chọn cược cho phiên hiện tại (TAI/XIU)
    this.currentBetAmount = DEFAULT_BET_AMOUNT // Số tiền cược cho phiên hiện tại
    this.currentBudget = null
    this.initialBudget = null
    this.currentJackpot = 0
    this.gameHistory = [] // Lưu trữ lịch sử kết quả TAI/XIU (ví dụ: ["TAI", "XIU", "TAI"])
    this.activeIntervals = []
    this.pingCounter = 0

    // Biến lưu trữ pool và quản lý đếm ngược đặt cược
    this.latestTaiPool = 0
    this.latestXiuPool = 0
    this.betTimeout = null
    this.countdownInterval = null

    // Thống kê phiên chạy cho báo cáo Telegram
    this.sessionCounter = 0
    this.runTotalBets = 0
    this.runWins = 0
    this.runLosses = 0

    // Biến cho chế độ Martingale
    this.baseBetAmount = DEFAULT_BET_AMOUNT // Số tiền cược cơ sở, không đổi trong một chuỗi Martingale
    this.martingaleCurrentBet = this.baseBetAmount // Số tiền cược hiện tại theo Martingale
    this.lastBetAmount = 0 // Số tiền đã cược ở phiên trước
    this.lastBetChoice = null // Cửa đã cược ở phiên trước (TAI/XIU)

    // Jackpot hunt state
    this.jackpotHuntCurrentBet = JACKPOT_HUNT_BET
    this.jackpotHuntLastChoice = null
    this.jackpotHuntLastAmount = 0

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

    // Managed-mode reconnect (săn hũ 2 acc): kết nối lại nhanh 15s/lần, tối đa 3 lần rồi mới dừng
    this.maxManagedReconnect = 3
    this.managedReconnectDelay = 15 * 1000 // 15 giây
    this.managedReconnectAttempts = 0
    this.managedReconnectTimeout = null
    this.isManagedReconnecting = false

    // Watchdog: phát hiện kết nối "chết treo" (không bắn close/error)
    this.lastMainMessageAt = Date.now()
    this.watchdogTimeoutMs = 90 * 1000 // không nhận message > 90s ⇒ coi như mất kết nối

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
    this.jackpotHuntCurrentBet = JACKPOT_HUNT_BET
    this.jackpotHuntLastChoice = null
    this.jackpotHuntLastAmount = 0
    if (IS_MARTINGALE) {
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Trạng thái Martingale đã được reset.`))
    }
  }

  /**
   * Kiểm tra điều kiện săn hũ: N ván liên tiếp cùng loại → cược theo chiều đó.
   * Rule nổ hũ: 2 ván trước cùng Tài → ván tiếp theo 6-6-6 nổ hũ; cùng Xỉu → 1-1-1 nổ hũ.
   * @returns {{ choice: string, betAmount: number } | null}
   */
  detectJackpotCondition() {
    if (!JACKPOT_HUNT || this.gameHistory.length < JACKPOT_HUNT_CONSECUTIVE) return null

    const recent = this.gameHistory.slice(-JACKPOT_HUNT_CONSECUTIVE)
    const allSame = recent.every(r => r === recent[0])
    if (!allSame) return null

    const choice = recent[0] // TAI hoặc XIU — cược tiếp theo chiều này để hưởng jackpot

    let betAmount
    if (JACKPOT_HUNT_MARTINGALE && this.jackpotHuntLastChoice === choice && this.jackpotHuntLastAmount > 0) {
      // Thua ván trước cùng chiều → gấp thếp
      betAmount = Math.ceil(this.jackpotHuntLastAmount * JACKPOT_HUNT_RATE)
    } else {
      betAmount = JACKPOT_HUNT_BET
    }

    return { choice, betAmount }
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
    if (this.managedReconnectTimeout) {
      clearTimeout(this.managedReconnectTimeout)
      this.managedReconnectTimeout = null
    }
    if (this.betTimeout) {
      clearTimeout(this.betTimeout)
      this.betTimeout = null
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval)
      this.countdownInterval = null
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

    if (this.managedMode && this.manager && !this.isStopped) {
      this.handleManagedReconnect(clientName, error)
      return
    }

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

    if (this.managedMode && this.manager && !this.isStopped) {
      this.handleManagedReconnect(clientName, new Error(`Connection closed: ${description}`))
      return
    }

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

    if (this.managedMode && this.manager && !this.isStopped) {
      this.handleManagedReconnect(clientName, error)
      return
    }

    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, error)
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.red(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  /**
   * Kết nối lại cho chế độ săn hũ 2 acc: kiểu zombie (force kill + reconnect) nhưng nhanh —
   * 15s/lần, tối đa 3 lần. Hết 3 lần thất bại → dừng cả 2 acc + Telegram (qua manager).
   * @param {string} clientName - Tên client
   * @param {Error} error - Lỗi gây ra việc kết nối lại
   */
  handleManagedReconnect(clientName, error) {
    if (this.isStopped) return
    if (this.isManagedReconnecting) return // đang trong 1 chu kỳ reconnect, bỏ qua event trùng

    this.managedReconnectAttempts++
    if (this.managedReconnectAttempts > this.maxManagedReconnect) {
      Log(chalk.red(`[${new Date().toLocaleTimeString()}] [Hunt ${this.role}] Kết nối lại thất bại sau ${this.maxManagedReconnect} lần.`))
      this.manager.onWorkerConnectionFailure(
        this,
        `Kết nối lại thất bại sau ${this.maxManagedReconnect} lần (15s/lần) cho ${clientName}: ${error.message}`,
      )
      return
    }

    this.isManagedReconnecting = true
    Log(
      chalk.magenta(`[${new Date().toLocaleTimeString()}] [Hunt ${this.role}] `) +
      `Mất kết nối ${clientName}. Thử kết nối lại sau 15s (lần ${this.managedReconnectAttempts}/${this.maxManagedReconnect})...`,
    )
    this.forceKillConnections()
    this.managedReconnectTimeout = setTimeout(() => {
      this.isManagedReconnecting = false // cho phép lần thử kế nếu lần này lại fail
      this.start().catch((startError) => {
        Log(chalk.red(`[Hunt ${this.role}] Kết nối lại lỗi: ${startError.message}`))
        // start() fail sẽ tự trigger handleConnectFailed → handleManagedReconnect lần kế
      })
    }, this.managedReconnectDelay)
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
   * Nhãn ngắn nhận diện worker trong log (vd "[A] MA_playman1").
   * @returns {string}
   */
  get logLabel() {
    return this.managedMode ? `[${this.role}] ${this.username}` : this.username
  }

  /**
   * Ghi log trạng thái DÙNG CHUNG của ván (kết quả, hũ, lịch sử, đếm ngược...).
   * Ở chế độ săn hũ 2 acc, chỉ acc A in để tránh log trùng lặp 2 lần.
   * @param {string} message
   */
  logOnce(message) {
    if (!this.managedMode || this.role === "A") Log(message)
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
    this.lastMainMessageAt = Date.now() // watchdog: đánh dấu kết nối còn sống
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

    if (parsedMessage && parsedMessage[1] && Array.isArray(parsedMessage[1].bs)) {
      const taiEntry = parsedMessage[1].bs.find(item => item.eid === 1);
      const xiuEntry = parsedMessage[1].bs.find(item => item.eid === 2);
      if (taiEntry && typeof taiEntry.v === "number") {
        this.latestTaiPool = taiEntry.v;
      }
      if (xiuEntry && typeof xiuEntry.v === "number") {
        this.latestXiuPool = xiuEntry.v;
      }
    }

    // Lệnh 2000: Trạng thái trò chơi ban đầu hoặc lịch sử
    if (messageString.includes(`"cmd":2000`)) {
      if (parsedMessage[1] && typeof parsedMessage[1].J === "number") {
        this.currentJackpot = parsedMessage[1].J
      }
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
      this.logOnce(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Kết quả phiên ${chalk.cyan(`#${parsedMessage[1].sid}`)}: ` +
        chalk.green(`${resultType} (${sumResult} điểm)`) +
        chalk.gray(` [${parsedMessage[1].d1}-${parsedMessage[1].d2}-${parsedMessage[1].d3}]`),
      )

      // Reset zombie failure count khi có kết quả thành công
      if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối ổn định, reset failure count.`))
        this.zombieFailureCount = 0
      }

      // Save stats to stast-even-odd.json (managed mode: chỉ acc A ghi để tránh race ghi file)
      if (!this.managedMode || this.role === "A") try {
        let won = null;
        if (this.lastBetChoice) {
          won = (this.lastBetChoice === resultType);
        }
        
        const sessionEntry = {
          gid: parsedMessage[1].sid,
          endedAt: new Date().toISOString(),
          result: `${resultType} (${sumResult}đ)`,
          dices: [parsedMessage[1].d1, parsedMessage[1].d2, parsedMessage[1].d3],
          botBet: this.lastBetChoice ? {
            choice: this.lastBetChoice,
            amount: this.lastBetAmount,
            won: won
          } : null,
          budget: this.currentBudget,
          jackpot: this.currentJackpot
        };

        latestSessionStats = sessionEntry;

        let history = [];
        if (fs.existsSync(statsPath)) {
          const raw = fs.readFileSync(statsPath, "utf8").trim();
          if (raw && raw !== "[]") {
            history = JSON.parse(raw);
          }
        }
        history.push(sessionEntry);
        fs.writeFileSync(statsPath, JSON.stringify(history, null, 2), "utf8");
        Log(chalk.cyan(`[${new Date().toLocaleTimeString()}] 📝 Đã lưu phiên GID:${sessionEntry.gid} vào stast-even-odd.json (${history.length} phiên)`))
      } catch (err) {
        Log(chalk.red(`❌ Lỗi lưu stats: ${err.message}`));
      }

      // Cập nhật thống kê và gửi báo cáo Telegram mỗi 50 ván
      this.sessionCounter++
      if (this.lastBetChoice) {
        this.runTotalBets++
        if (this.lastBetChoice === resultType) {
          this.runWins++
        } else {
          this.runLosses++
        }
      }

      if (this.sessionCounter > 0 && this.sessionCounter % 50 === 0) {
        const profit = this.currentBudget !== null && this.initialBudget !== null ? this.currentBudget - this.initialBudget : 0
        const winRate = this.runTotalBets > 0 ? ((this.runWins / this.runTotalBets) * 100).toFixed(1) + "%" : "0%"
        
        sendTelegramAlert({
          type: "info",
          title: `📊 Báo Cáo Thống Kê Tài Xỉu - ${this.username}`,
          content: `Hệ thống vừa hoàn thành thêm 50 phiên đấu liên tiếp.`,
          metadata: {
            "Tổng số phiên": `${this.sessionCounter} phiên`,
            "Số dư hiện tại": this.currentBudget !== null ? convertVnd(this.currentBudget) : "Chưa cập nhật",
            "Lợi nhuận ròng": profit >= 0 ? `+${convertVnd(profit)}` : convertVnd(profit),
            "Số ván đã cược": `${this.runTotalBets} ván`,
            "Thắng / Thua": `${this.runWins} Thắng / ${this.runLosses} Thua`,
            "Tỉ lệ thắng": winRate
          }
        }).catch(err => Log(chalk.red(`❌ Lỗi gửi báo cáo Telegram: ${err.message}`)))
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
      // Cập nhật jackpot hunt martingale state
      if (JACKPOT_HUNT && this.jackpotHuntLastChoice) {
        if (this.jackpotHuntLastChoice === resultType) {
          Log(chalk.green(`[${new Date().toLocaleTimeString()}] 🎯 Jackpot Hunt: THẮNG! Reset mức cược săn hũ.`))
          this.jackpotHuntCurrentBet = JACKPOT_HUNT_BET
        } else {
          this.jackpotHuntCurrentBet = Math.ceil(this.jackpotHuntLastAmount * JACKPOT_HUNT_RATE)
          Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] 🎯 Jackpot Hunt: THUA, gấp thếp lần sau: ${this.jackpotHuntCurrentBet} đ`))
        }
      }
      this.jackpotHuntLastChoice = null
      this.jackpotHuntLastAmount = 0

      // Reset lastBetChoice và lastBetAmount cho phiên tiếp theo
      this.lastBetChoice = null;
      this.lastBetAmount = 0;

      // Thêm kết quả mới vào lịch sử và giới hạn độ dài
      this.gameHistory.push(resultType)
      if (this.gameHistory.length > 10) {
        this.gameHistory.shift() // Xóa phần tử cũ nhất
      }
      this.logOnce(chalk.gray(`Lịch sử gần đây: [${this.gameHistory.join(", ")}]`))

      // Sau MỖI ván: lấy lại số dư đã settle để luôn hiển thị lãi/lỗ (kể cả ván không cược).
      this.budgetFresh = false
      this.shouldRequestBudget = true

      // Báo cho manager (chế độ săn hũ 2 acc) để in tổng kết khi cả 2 số dư đã settle
      if (this.managedMode && this.manager) {
        this.manager.onWorkerResult(this, resultType, parsedMessage[1])
      }
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
      // KHÔNG lấy số dư ở đây: lúc này nhà cái mới trừ tiền cược (pending), chưa cộng tiền thắng
      // → sẽ lấy số dư sau khi có kết quả (cmd:2006) để hiển thị lãi/lỗ đã settle.
    }
    // Lệnh 2011: Cập nhật hũ
    else if (messageString.includes(`"cmd":2011`)) {
      const newJackpot = parsedMessage[1].J
      if (newJackpot !== this.currentJackpot) {
        this.logOnce(
          chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          chalk.magenta(`Hũ hiện tại: `) +
          chalk.green(convertVnd(newJackpot)),
        )
        this.currentJackpot = newJackpot
        if (this.currentJackpot < JACKPOT_THRESHOLD) { // Sử dụng JACKPOT_THRESHOLD global
          this.logOnce(chalk.red("Giá trị hũ dưới ngưỡng dừng. Bỏ cược"))
          // this.stop()
        }
      }
    }
    // Lệnh 2005: Phiên trò chơi mới bắt đầu
    else if (messageString.includes(`"cmd":2005`)) {
      if (parsedMessage[1].sid !== this.previousSessionId) {
        this.currentSessionId = parsedMessage[1].sid
        this.latestTaiPool = 0
        this.latestXiuPool = 0
        this.isBettingAllowed = true
        
        // Dọn timeout/interval còn sót từ phiên trước
        if (this.betTimeout) {
          clearTimeout(this.betTimeout)
          this.betTimeout = null
        }
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval)
          this.countdownInterval = null
        }

        if (this.managedMode) {
          // Săn hũ: quyết định dựa vào LỊCH SỬ (không phụ thuộc pool) → đặt cược NGAY khi phiên mở,
          // không chờ hết đếm ngược theo COUNTDOWN_TIME.
          this.logOnce(
            chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
            `Phiên mới: ${chalk.cyan(`#${this.currentSessionId}`)} — săn hũ, đặt cược ngay (bỏ qua đếm ngược).`,
          )
          this.executeManagedBet(this.currentSessionId)
        } else {
          let countdownSeconds = COUNTDOWN_TIME
          this.logOnce(
            chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
            `Phiên mới bắt đầu: ${chalk.cyan(`#${this.currentSessionId}`)}. Bắt đầu đếm ngược ${chalk.yellow(countdownSeconds + " giây")} đặt cược...`,
          )

          this.countdownInterval = setInterval(() => {
            countdownSeconds--
            if (countdownSeconds <= 0) {
              clearInterval(this.countdownInterval)
              this.countdownInterval = null
            } else if (countdownSeconds % 5 === 0 || countdownSeconds <= 5) {
              this.logOnce(
                chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
                `Phiên ${chalk.cyan(`#${this.currentSessionId}`)} - Còn ${chalk.yellow(countdownSeconds + "s")} | Pool Tài: ${chalk.green(convertVnd(this.latestTaiPool))} | Pool Xỉu: ${chalk.green(convertVnd(this.latestXiuPool))}`,
              )
            }
          }, 1000)

          this.betTimeout = setTimeout(() => {
            this.executePoolBettingLogic(this.currentSessionId)
          }, COUNTDOWN_TIME * 1000)
        }
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
        const time = new Date().toLocaleTimeString()
        const label = chalk.bold(this.logLabel)

        if (this.initialBudget === null) {
          this.initialBudget = this.currentBudget
          Log(
            chalk.cyan(`[${time}] 💰 `) + label +
            ` │ Số dư: ${chalk.green(convertVnd(this.currentBudget))} (số dư ban đầu)`,
          )
        } else {
          const profit = this.currentBudget - this.initialBudget
          const profitStr = profit >= 0 ? chalk.green("+" + convertVnd(profit)) : chalk.red(convertVnd(profit))
          Log(
            chalk.blue(`[${time}] 💰 `) + label +
            ` │ Số dư: ${chalk.green(convertVnd(this.currentBudget))}` +
            ` │ Lãi/Lỗ: ${profitStr}`,
          )

          // Trong managed mode, manager kiểm tra win/loss tổng hợp 2 acc — bỏ qua stop riêng lẻ
          if (!this.managedMode && WIN_STOP && profit >= WIN_STOP) {
            Log(chalk.green(`[${new Date().toLocaleTimeString()}] 🎉 Đã đạt mục tiêu thắng dừng cược (Win Stop +${convertVnd(WIN_STOP)}). Dừng trò chơi!`))
            this.stop()
            return
          }
          if (!this.managedMode && LOSS_STOP && profit <= -LOSS_STOP) {
            Log(chalk.red(`[${new Date().toLocaleTimeString()}] 🛑 Đã chạm giới hạn thua dừng cược (Loss Stop -${convertVnd(LOSS_STOP)}). Dừng trò chơi!`))
            this.stop()
            return
          }
        }

        // Số dư vừa cập nhật đã phản ánh kết quả ván gần nhất (đã settle)
        this.budgetFresh = true
        if (this.managedMode && this.manager) {
          this.manager.onBudgetSettled()
        }
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
   * Thực thi logic đặt cược dựa trên tổng số tiền cược của hai bên sau 38 giây.
   * @param {number} sessionId - ID phiên trò chơi hiện tại.
   */
  executePoolBettingLogic(sessionId) {
    if (this.isStopped) return;

    if (this.initialBudget !== null) {
      const profit = this.currentBudget - this.initialBudget
      if (WIN_STOP && profit >= WIN_STOP) {
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] 🎉 Đã đạt mục tiêu thắng dừng cược (Win Stop +${convertVnd(WIN_STOP)}). Hủy đặt cược và dừng!`))
        this.stop()
        return
      }
      if (LOSS_STOP && profit <= -LOSS_STOP) {
        Log(chalk.red(`[${new Date().toLocaleTimeString()}] 🛑 Đã chạm giới hạn thua dừng cược (Loss Stop -${convertVnd(LOSS_STOP)}). Hủy đặt cược và dừng!`))
        this.stop()
        return
      }
    }

    if (this.currentJackpot > JACKPOT_THRESHOLD) { // Sử dụng JACKPOT_THRESHOLD global
      if (!this.isBettingAllowed) {
        Log(chalk.yellow("Chưa được phép đặt cược, đang chờ xác nhận cược trước đó."))
        return
      }

      // --- CHẾ ĐỘ SĂN HŨ ---
      const jackpotSignal = this.detectJackpotCondition()
      if (jackpotSignal) {
        const { choice, betAmount } = jackpotSignal
        this.bettingChoice = choice
        this.currentBetAmount = betAmount

        Log(
          chalk.magenta(`[${new Date().toLocaleTimeString()}] 🎯 Jackpot Hunt kích hoạt! `) +
          `Chuỗi ${JACKPOT_HUNT_CONSECUTIVE} ván ${choice} liên tiếp → Cược ${chalk.yellow(choice)} ${chalk.red(betAmount)} đ`,
        )

        if (this.currentBudget !== null && (this.currentBudget <= BET_STOP || betAmount > this.currentBudget)) {
          Log(chalk.red(`[${new Date().toLocaleTimeString()}] Jackpot Hunt: Số dư không đủ. Dừng.`))
          this.stop()
          return
        }

        const betId = choice === "TAI" ? 1 : 2
        const betCommand = `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${betAmount},"aid":1,"sid":${sessionId},"eid":${betId}}]`
        if (this.mainGameConnection && this.mainGameConnection.connected) {
          this.mainGameConnection.sendUTF(betCommand)
          this.isBettingAllowed = false
          this.lastBetAmount = betAmount
          this.lastBetChoice = choice
          this.jackpotHuntLastChoice = choice
          this.jackpotHuntLastAmount = betAmount
        }
        this.previousSessionId = sessionId
        return
      }
      // --- KẾT THÚC CHẾ ĐỘ SĂN HŨ ---

      // So sánh pool
      const taiPool = this.latestTaiPool;
      const xiuPool = this.latestXiuPool;
      
      Log(
        chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `So sánh Pool phiên #${sessionId} sau ${COUNTDOWN_TIME} giây: ` +
        `Tài: ${chalk.yellow(convertVnd(taiPool))} | Xỉu: ${chalk.yellow(convertVnd(xiuPool))}`
      );

      if (taiPool < xiuPool) {
        this.bettingChoice = "TAI";
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] Chọn cửa TÀI vì pool Tài nhỏ hơn.`));
      } else if (xiuPool < taiPool) {
        this.bettingChoice = "XIU";
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] Chọn cửa XỈU vì pool Xỉu nhỏ hơn.`));
      } else {
        this.bettingChoice = "TAI"; // Cửa mặc định khi hai bên bằng nhau
        Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Pool bằng nhau hoặc chưa có dữ liệu. Mặc định chọn TÀI.`));
      }

      // Xác định số tiền cược
      if (IS_MARTINGALE) {
        this.currentBetAmount = this.martingaleCurrentBet;
      } else {
        this.currentBetAmount = DEFAULT_BET_AMOUNT;
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

      const betId = this.bettingChoice === "TAI" ? 1 : 2
      const betCommand = `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${this.currentBetAmount},"aid":1,"sid":${sessionId},"eid":${betId}}]`

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
        `Bỏ qua đặt cược cho phiên ${chalk.cyan(`#${sessionId}`)}: Hũ quá thấp.`,
      )
    }
  }

  /**
   * Đặt cược theo quyết định của JackpotHuntManager (chế độ săn hũ 2 acc song song).
   * Manager quyết định cửa (A = cửa săn hũ, B = cửa backup ngược lại) và mức cược,
   * đồng thời gác điều kiện range hũ và số dư của cả 2 acc.
   * @param {number} sessionId - ID phiên trò chơi hiện tại.
   */
  executeManagedBet(sessionId) {
    if (this.isStopped || !this.manager) return

    const decision = this.manager.requestBet(this, sessionId)
    if (!decision) {
      // Không có tín hiệu săn hũ, hoặc đã bị dừng — không cược ván này
      this.previousSessionId = sessionId
      return
    }

    const { choice, amount } = decision
    this.bettingChoice = choice
    this.currentBetAmount = amount

    const betId = choice === "TAI" ? 1 : 2
    const betCommand = `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${amount},"aid":1,"sid":${sessionId},"eid":${betId}}]`

    if (this.mainGameConnection && this.mainGameConnection.connected) {
      this.mainGameConnection.sendUTF(betCommand)
      this.isBettingAllowed = false
      this.lastBetAmount = amount
      this.lastBetChoice = choice
      Log(
        chalk.magenta(`[${new Date().toLocaleTimeString()}] 🎯 [Hunt ${this.role}] `) +
        `${this.username} đặt ${chalk.yellow(choice)} ${chalk.red(amount)} đ cho phiên ${chalk.cyan(`#${sessionId}`)}.`,
      )
    } else {
      Log(chalk.red(`[Hunt ${this.role}] Không thể gửi lệnh đặt cược: Kết nối chưa sẵn sàng.`))
    }
    this.previousSessionId = sessionId
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
    this.lastMainMessageAt = Date.now()
    this.addManagedInterval(() => {
      if (this.isStopped) return
      if (this.mainGameConnection && this.mainGameConnection.connected) {
        this.mainGameConnection.sendUTF(`[7,"Simms",${++this.pingCounter},0]`)
      }
    }, 5000)

    // Watchdog: nếu quá lâu không nhận được message nào từ MainGame ⇒ kết nối "chết treo"
    // (không bắn close/error) ⇒ xử lý như mất kết nối để kích hoạt reconnect/dừng.
    this.addManagedInterval(() => {
      if (this.isStopped || this.isManagedReconnecting) return
      if (!this.mainGameConnection || !this.mainGameConnection.connected) return
      const silentMs = Date.now() - this.lastMainMessageAt
      if (silentMs > this.watchdogTimeoutMs) {
        Log(
          chalk.red(`[${new Date().toLocaleTimeString()}] ⚠️ Watchdog: `) +
          `${this.managedMode ? `[Hunt ${this.role}] ` : ""}Không nhận dữ liệu MainGame ${Math.round(silentMs / 1000)}s — coi như mất kết nối.`,
        )
        this.handleConnectionError(new Error(`Watchdog: im lặng ${Math.round(silentMs / 1000)}s`), "MainGame")
      }
    }, 15000)
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
        this.managedReconnectAttempts = 0 // Reset managed-mode reconnect
        this.isManagedReconnecting = false
        this.lastMainMessageAt = Date.now()
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
        this.managedReconnectAttempts = 0 // Reset managed-mode reconnect
        this.isManagedReconnecting = false
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
    // Clear managed-mode reconnect timeout
    if (this.managedReconnectTimeout) {
      clearTimeout(this.managedReconnectTimeout)
      this.managedReconnectTimeout = null
    }
    this.isManagedReconnecting = false
    if (this.betTimeout) {
      clearTimeout(this.betTimeout)
      this.betTimeout = null
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval)
      this.countdownInterval = null
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

/*------- QUẢN LÝ SĂN HŨ 2 TÀI KHOẢN SONG SONG --------*/
/**
 * Điều phối 2 GameWorker chạy song song để săn hũ có phòng hộ (hedge):
 * - Acc A đặt theo chiều có thể nổ hũ (chuỗi N ván cùng loại).
 * - Acc B đặt cửa ngược lại để "backup" gỡ lại khi A thua.
 * - Chỉ cược khi giá trị hũ nằm trong range cho phép (JACKPOT_HUNT_MIN..MAX).
 * - Nếu 1 acc thiếu tiền hoặc lỗi kết nối → dừng cả 2 và báo Telegram.
 */
class JackpotHuntManager {
  constructor(workerA, workerB) {
    this.workerA = workerA
    this.workerB = workerB
    this.stopped = false
    this.sessionDecisions = new Map() // sid -> { active, jackpotSide }
    this.processedResultSids = new Set()
    this.combinedLoggedThisRound = false // đã in tổng kết (theo số dư đã settle) cho ván hiện tại chưa

    for (const [w, role] of [[workerA, "A"], [workerB, "B"]]) {
      w.managedMode = true
      w.manager = this
      w.role = role
    }
  }

  /**
   * Khởi động cả 2 worker. Nếu 1 trong 2 thất bại, dừng tất cả.
   */
  async start() {
    await Promise.all([this.workerA.start(), this.workerB.start()])
  }

  /** Worker có lịch sử dài hơn được dùng làm tham chiếu trạng thái game. */
  refWorker() {
    return this.workerB.gameHistory.length > this.workerA.gameHistory.length ? this.workerB : this.workerA
  }

  /** Cả 2 acc đều đang kết nối ổn định (để giữ hedge, không đặt lệch khi 1 acc đang reconnect). */
  bothConnected() {
    const ok = (w) => !!(w.mainGameConnection && w.mainGameConnection.connected) && !w.isManagedReconnecting
    return ok(this.workerA) && ok(this.workerB)
  }

  /**
   * Tính (và cache) quyết định săn hũ cho 1 phiên: có kích hoạt không và cửa săn hũ là gì.
   * Cache theo sid để cả A và B nhận cùng 1 quyết định nhất quán.
   */
  getDecisionForSession(sessionId) {
    if (this.sessionDecisions.has(sessionId)) return this.sessionDecisions.get(sessionId)

    const ref = this.refWorker()
    let decision = { active: false, jackpotSide: null, betAmount: 0, outOfRange: false }
    const jackpot = ref.currentJackpot
    const inRange = jackpot >= JACKPOT_HUNT_MIN && jackpot <= JACKPOT_HUNT_MAX

    if (inRange && ref.gameHistory.length >= JACKPOT_HUNT_CONSECUTIVE) {
      const recent = ref.gameHistory.slice(-JACKPOT_HUNT_CONSECUTIVE)
      if (recent.every((r) => r === recent[0])) {
        // Mức cược tăng theo giá trị hũ (bảng khoảng); null = hũ ngoài range các bậc
        const bet = computeJackpotHuntBet(jackpot)
        decision = { active: true, jackpotSide: recent[0], betAmount: bet, outOfRange: bet === null }
      }
    }

    this.sessionDecisions.set(sessionId, decision)
    if (this.sessionDecisions.size > 50) {
      this.sessionDecisions.delete(this.sessionDecisions.keys().next().value)
    }
    return decision
  }

  /**
   * Kiểm tra số dư cả 2 acc đủ để cược tiếp hay không.
   * @returns {{ok: boolean, offender?: GameWorker, reason?: string}}
   */
  checkBudgets(requiredAmount) {
    for (const w of [this.workerA, this.workerB]) {
      if (w.currentBudget === null) continue // chưa có số dư, tạm cho qua
      if (w.currentBudget <= BET_STOP) {
        return { ok: false, offender: w, reason: `Số dư dưới ngưỡng dừng (${convertVnd(w.currentBudget)} <= ${convertVnd(BET_STOP)})` }
      }
      if (requiredAmount && w.currentBudget < requiredAmount) {
        return { ok: false, offender: w, reason: `Không đủ tiền cho ván này (${convertVnd(w.currentBudget)} < ${convertVnd(requiredAmount)})` }
      }
    }
    return { ok: true }
  }

  /**
   * Worker gọi khi đến giờ cược. Trả về { choice, amount } hoặc null (bỏ qua/đã dừng).
   */
  requestBet(worker, sessionId) {
    if (this.stopped) return null

    // Giữ hedge: chỉ đặt khi CẢ 2 acc online. Nếu 1 acc đang reconnect → bỏ qua ván này (không đặt lệch).
    if (!this.bothConnected()) {
      Log(chalk.yellow(`[Hunt ${worker.role}] Một acc đang mất kết nối/kết nối lại — bỏ qua ván #${sessionId} để giữ hedge.`))
      return null
    }

    if (!worker.isBettingAllowed) {
      Log(chalk.yellow(`[Hunt ${worker.role}] Chưa được phép đặt cược, chờ xác nhận cược trước đó.`))
      return null
    }

    const decision = this.getDecisionForSession(sessionId)
    if (!decision.active) {
      Log(
        chalk.gray(`[${new Date().toLocaleTimeString()}] [Hunt ${worker.role}] `) +
        `Phiên #${sessionId}: không có tín hiệu săn hũ (chưa đủ chuỗi ${JACKPOT_HUNT_CONSECUTIVE} ván hoặc hũ ngoài MIN/MAX). Bỏ qua.`,
      )
      return null
    }

    // Hũ ngoài mọi khoảng bậc cược → dừng cả 2 acc theo cấu hình
    if (decision.outOfRange) {
      const jp = this.refWorker().currentJackpot
      this.stopAll(`Hũ ${convertVnd(jp)} ngoài range bậc cược (JACKPOT_HUNT_BET_TIERS). Dừng cả 2 acc.`)
      return null
    }

    const betAmount = decision.betAmount || JACKPOT_HUNT_BET

    // Gác số dư cả 2 acc trước khi đặt
    const budget = this.checkBudgets(betAmount)
    if (!budget.ok) {
      this.stopAll(`Tài khoản ${budget.offender.username} không đủ tiền cược: ${budget.reason}`, budget.offender)
      return null
    }

    const opposite = decision.jackpotSide === "TAI" ? "XIU" : "TAI"
    const choice = worker.role === "A" ? decision.jackpotSide : opposite
    return { choice, amount: betAmount }
  }

  /**
   * Worker gọi khi VỪA có kết quả (cmd:2006). Chỉ đánh dấu "chờ settle" cho ván mới;
   * phần kiểm tra số dư / tổng kết để dành cho onBudgetSettled (khi số dư đã cập nhật xong).
   */
  onWorkerResult(worker, resultType, data) {
    if (this.stopped) return
    const sid = data.sid
    if (this.processedResultSids.has(sid)) return // chỉ reset 1 lần / phiên
    this.processedResultSids.add(sid)
    if (this.processedResultSids.size > 100) {
      this.processedResultSids.delete(this.processedResultSids.values().next().value)
    }
    this.lastSid = sid
    this.combinedLoggedThisRound = false // mở khoá để in tổng kết khi cả 2 số dư đã settle
  }

  /**
   * Worker gọi khi số dư của nó vừa cập nhật (đã settle). Khi CẢ 2 acc đã settle,
   * in tổng kết + kiểm tra số dư & win/loss tổng hợp — tất cả dựa trên số dư đã settle.
   */
  onBudgetSettled() {
    if (this.stopped) return
    if (!this.workerA.budgetFresh || !this.workerB.budgetFresh) return // chờ acc còn lại settle
    if (this.combinedLoggedThisRound) return
    this.combinedLoggedThisRound = true

    const profitOf = (w) =>
      w.currentBudget !== null && w.initialBudget !== null ? w.currentBudget - w.initialBudget : 0
    const pA = profitOf(this.workerA)
    const pB = profitOf(this.workerB)
    const combined = pA + pB
    const fmt = (p) => (p >= 0 ? chalk.green("+" + convertVnd(p)) : chalk.red(convertVnd(p)))
    Log(
      chalk.magenta(`[${new Date().toLocaleTimeString()}] 📊 Tổng kết${this.lastSid ? ` #${this.lastSid}` : ""} `) +
      `│ ${this.workerA.username}: ${fmt(pA)} │ ${this.workerB.username}: ${fmt(pB)} │ ` +
      chalk.bold(`Tổng 2 acc: ${fmt(combined)}`),
    )

    // Kiểm tra số dư (đã settle) đủ cho ván tới chưa
    const nextBet = computeJackpotHuntBet(this.refWorker().currentJackpot) || JACKPOT_HUNT_BET
    const budget = this.checkBudgets(nextBet)
    if (!budget.ok) {
      this.stopAll(`Tài khoản ${budget.offender.username} không đủ tiền: ${budget.reason}`, budget.offender)
      return
    }

    // Win/Loss tổng hợp 2 acc
    if (WIN_STOP && combined >= WIN_STOP) {
      this.stopAll(`🎉 Đạt mục tiêu thắng tổng hợp 2 acc (+${convertVnd(combined)} >= +${convertVnd(WIN_STOP)})`)
      return
    }
    if (LOSS_STOP && combined <= -LOSS_STOP) {
      this.stopAll(`🛑 Chạm giới hạn thua tổng hợp 2 acc (${convertVnd(combined)} <= -${convertVnd(LOSS_STOP)})`)
    }
  }

  /** Worker báo lỗi kết nối → dừng cả 2 ngay lập tức. */
  onWorkerConnectionFailure(worker, reason) {
    if (this.stopped) return
    this.stopAll(`Tài khoản ${worker.username} (acc ${worker.role}) lỗi kết nối: ${reason}`, worker)
  }

  /** Dừng cả 2 worker và gửi 1 báo cáo Telegram tổng hợp (idempotent). */
  stopAll(reason, offender) {
    if (this.stopped) return
    this.stopped = true

    Log(chalk.red(`[${new Date().toLocaleTimeString()}] 🛑 Jackpot Hunt Manager dừng cả 2 acc: ${reason}`))
    try { this.workerA.stop(true) } catch (e) { /* noop */ }
    try { this.workerB.stop(true) } catch (e) { /* noop */ }

    const profitStr = (w) => {
      if (w.currentBudget === null || w.initialBudget === null) return "?"
      const p = w.currentBudget - w.initialBudget
      return (p >= 0 ? "+" : "") + convertVnd(p)
    }

    sendTelegramAlert({
      type: "warning",
      title: "🎯 Jackpot Hunt: Đã dừng cả 2 tài khoản",
      content: reason,
      metadata: {
        "Tài khoản A": this.workerA.username,
        "Số dư A": this.workerA.currentBudget !== null ? convertVnd(this.workerA.currentBudget) : "?",
        "Lợi nhuận A": profitStr(this.workerA),
        "Tài khoản B": this.workerB.username,
        "Số dư B": this.workerB.currentBudget !== null ? convertVnd(this.workerB.currentBudget) : "?",
        "Lợi nhuận B": profitStr(this.workerB),
        ...(offender ? { "Acc gây dừng": offender.username } : {}),
      },
    }).catch((err) => Log(chalk.red(`❌ Lỗi gửi Telegram khi dừng: ${err.message}`)))

    activeJackpotManager = null
  }

  resetMartingaleState() {
    this.workerA.resetMartingaleState()
    this.workerB.resetMartingaleState()
  }
}

/*------- CÁC HÀM ĐIỀU KHIỂN TRÒ CHƠI TOÀN CỤC --------*/
let activeGameWorker = null
let activeJackpotManager = null
/**
 * Bắt đầu trò chơi bằng cách khởi tạo một thể hiện GameWorker mới.
 * Nếu trò chơi đang chạy, nó sẽ ghi lỗi.
 * @returns {Promise<void>} Một promise sẽ được giải quyết khi trò chơi bắt đầu hoặc bị từ chối khi có lỗi.
 */
export const startGame = async () => {
  if (activeGameWorker || activeJackpotManager) {
    logError("Trò chơi đang chạy. Vui lòng dừng nó trước.")
    return
  }
  const users = await readUsers()

  // ===== CHẾ ĐỘ SĂN HŨ: yêu cầu đúng 2 tài khoản chạy song song =====
  if (JACKPOT_HUNT) {
    const selected = users.filter((u) => u.selected)
    if (selected.length !== 2) {
      return logError(
        `Chế độ Săn Hũ (Jackpot Hunt) yêu cầu chọn ĐÚNG 2 tài khoản (hiện đang chọn ${selected.length}). Vui lòng chọn 2 acc rồi thử lại.`,
      )
    }

    const buildWorker = (u) => {
      const { name: username, password, infoData, signature } = u
      const userInfo = infoData && infoData[4] ? infoData[4].info : null
      if (!username || !signature || !userInfo) {
        throw new Error(`Tài khoản "${u.name}" thiếu thông tin bắt buộc (tên, chữ ký hoặc info).`)
      }
      return new GameWorker({ username, password, info: userInfo, signature })
    }

    try {
      const workerA = buildWorker(selected[0]) // cửa săn hũ
      const workerB = buildWorker(selected[1]) // cửa backup
      activeJackpotManager = new JackpotHuntManager(workerA, workerB)
      await activeJackpotManager.start()
      Log(chalk.green(`🎯 Chế độ Săn Hũ đã bắt đầu với 2 acc: ${workerA.username} (A/săn hũ) + ${workerB.username} (B/backup)`))
      Log(chalk.yellow(`Mức cược mỗi ván: ${JACKPOT_HUNT_BET} đ | Chuỗi kích hoạt: ${JACKPOT_HUNT_CONSECUTIVE} ván | Range hũ: ${JACKPOT_HUNT_MIN} → ${JACKPOT_HUNT_MAX} đ`))
    } catch (error) {
      logError(`Không thể bắt đầu chế độ Săn Hũ: ${error.message}`)
      if (activeJackpotManager) activeJackpotManager.stopAll(`Khởi động thất bại: ${error.message}`)
      activeJackpotManager = null
    }
    return
  }

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
    Log(chalk.yellow(`Thời gian đếm ngược đặt cược: ${chalk.green(COUNTDOWN_TIME + " giây")}`))
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
  if (activeJackpotManager) {
    activeJackpotManager.stopAll("Người dùng dừng trò chơi.")
    activeJackpotManager = null
    Log(chalk.green("Chế độ Săn Hũ đã dừng bởi người dùng."))
    return
  }
  if (activeGameWorker) {
    activeGameWorker.stop() // Call stop without isAutoStop=true, indicating user-initiated stop
    activeGameWorker = null
    Log(chalk.green("Trò chơi đã dừng bởi người dùng."))
  } else {
    logError("Không có trò chơi nào đang hoạt động để dừng.")
  }
}