import chalk from "chalk"
import fs from "fs"
import path, { dirname } from "path"
import { fileURLToPath } from "url"
import websocket from "websocket"
import { readUsers } from "../logic/dataManager.js"
import { logError } from "../ui/display.js"
import { convertVnd } from "../utils/bet.js"
import { sendTelegramAlert } from "../utils/bot.js"
import { SocketClient } from "./socketClient.js"

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
let ZOMBIE_MODE
let GIFT_MODE // Thêm biến gift mode
let AMOUNT_GIFT // Thêm biến số tiền gift
// Các biến này sẽ được cập nhật khi config thay đổi
let IS_MARTINGALE
let RATE_MARTINGALE
let configReloadTimeout // Biến để quản lý debounce
let JACKPOT_RANGE // Thêm biến jackpot range

// socket
let SOCKET_ENABLED = false // Bật/tắt socket
let SOCKET_ROOM_ID = "game_room_01" // Room ID mặc định

/**
 * Tải cấu hình từ file rule.json và cập nhật các hằng số liên quan.
 */
const loadConfigAndConstants = () => {
  try {
    const newConfig = JSON.parse(fs.readFileSync(configPath, "utf8"))
    config = newConfig
    DEFAULT_BET_AMOUNT = config.gameSettings.BET_AMOUNT
    JACKPOT_THRESHOLD = config.gameSettings.JACKPOT_THRESHOLD
    BET_STOP = config.gameSettings.BET_STOP
    IS_MARTINGALE = config.gameSettings.IS_MARTINGALE
    RATE_MARTINGALE = config.gameSettings.RATE_MARTINGALE
    ZOMBIE_MODE = config.gameSettings.ZOMBIE || false
    GIFT_MODE = config.gameSettings.GIFT_MODE || false
    AMOUNT_GIFT = config.gameSettings.AMOUNT_GIFT || DEFAULT_BET_AMOUNT
    JACKPOT_RANGE = config.gameSettings.JACKPOT_RANGE || []
    SOCKET_ENABLED = config.gameSettings.SOCKET_ENABLED || false
    SOCKET_ROOM_ID = config.gameSettings.SOCKET_ROOM_ID || "game_room_01"
    
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Cấu hình rule.json đã được tải lại.`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Chế độ Zombie: ${ZOMBIE_MODE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Chế độ Gift: ${GIFT_MODE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Socket.IO: ${SOCKET_ENABLED ? "BẬT" : "TẮT"}`))
    
    if (IS_MARTINGALE) {
      Log(chalk.yellow(`Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
    if (GIFT_MODE) {
      Log(chalk.yellow(`Số tiền Gift: ${AMOUNT_GIFT} đ`))
    }
    if (JACKPOT_RANGE.length > 0) {
      Log(chalk.yellow(`Khoảng Jackpot cho phép cược:`))
      JACKPOT_RANGE.forEach((range, index) => {
        Log(chalk.yellow(`  ${index + 1}. Từ ${range.MIN} đến ${range.MAX} đ`))
      })
    }
  } catch (error) {
    console.error(chalk.red(`Lỗi khi đọc hoặc phân tích cú pháp rule.json: ${error.message}`))
  }
}

// Thêm hàm helper để kiểm tra jackpot có nằm trong range không
/**
 * Kiểm tra xem jackpot có nằm trong khoảng cho phép không
 * @param {number} jackpot - Giá trị jackpot hiện tại
 * @returns {boolean} True nếu jackpot nằm trong một trong các khoảng cho phép
 */
const isJackpotInRange = (jackpot) => {
  if (!JACKPOT_RANGE || JACKPOT_RANGE.length === 0) {
    return true // Nếu không có range nào được định nghĩa, cho phép tất cả
  }
  
  return JACKPOT_RANGE.some(range => 
    jackpot >= range.MIN && jackpot <= range.MAX
  )
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
        // Cập nhật socket config
        if (SOCKET_ENABLED && !activeGameWorker.socketClient) {
          activeGameWorker.initializeSocket()
        } else if (!SOCKET_ENABLED && activeGameWorker.socketClient) {
          activeGameWorker.disconnectSocket()
        }
      }
    }, 300) // Thời gian debounce 300ms
  }
})

/*------- LỚP QUẢN LÝ TRÒ CHƠI --------------------*/
class GameWorker {
  constructor({ username, password, info, signature }) {
    this.username = username
    this.password = password
    this.info = info
    this.signature = signature
    this.mainGameClient = new WebSocketClient()
    this.simmsClient = new WebSocketClient()
    this.mainGameConnection = null
    this.simmsConnection = null
    this.isStopped = false
    this.isBettingAllowed = true
    this.shouldRequestBudget = true
    this.latestGameResult = null
    this.secondLatestGameResult = null
    this.currentSessionId = null
    this.previousSessionId = null
    this.bettingChoice = null
    this.currentBetAmount = DEFAULT_BET_AMOUNT
    this.currentBudget = null
    this.currentJackpot = 0
    this.gameHistory = []
    this.activeIntervals = []
    this.pingCounter = 0

    // Martingale
    this.baseBetAmount = DEFAULT_BET_AMOUNT
    this.martingaleCurrentBet = this.baseBetAmount
    this.lastBetAmount = 0
    this.lastBetChoice = null

    // Gift mode
    this.isGiftBettingProcessed = false

    // Reconnection
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 5000
    this.reconnectTimeout = null

    // Zombie mode
    this.zombieReconnectAttempts = 0
    this.zombieReconnectDelay = 5 * 60 * 1000
    this.zombieReconnectTimeout = null
    this.zombieFailureCount = 0

    // Socket.IO client
    this.socketClient = null
    this.lastSocketBudgetUpdate = 0
    this.socketUpdateInterval = 5000 // Cập nhật budget mỗi 5s

    // Bind handlers
    this.handleConnectFailed = this.handleConnectFailed.bind(this)
    this.handleConnectionClose = this.handleConnectionClose.bind(this)
    this.handleConnectionError = this.handleConnectionError.bind(this)
    this.handleMainGameMessage = this.handleMainGameMessage.bind(this)
    this.handleSimmsMessage = this.handleSimmsMessage.bind(this)
  }

  /*------- SOCKET.IO METHODS -------*/
  
  /**
   * Khởi tạo kết nối Socket.IO
   */
  initializeSocket() {
    if (!SOCKET_ENABLED) {
      Log(chalk.yellow("Socket.IO bị tắt trong config."))
      return
    }

    try {
      this.socketClient = new SocketClient({
        userId: this.username,
        roomId: SOCKET_ROOM_ID,
      })
      
      this.socketClient.connect()
      
      // Override respondUserInfo để tự động gửi budget
      const originalRespond = this.socketClient.respondUserInfo.bind(this.socketClient)
      this.socketClient.respondUserInfo = (coin) => {
        const currentCoin = coin !== undefined ? coin : this.currentBudget || 0
        originalRespond(currentCoin)
      }

      Log(chalk.cyan(`[${new Date().toLocaleTimeString()}] Socket.IO đã được khởi tạo (Room: ${SOCKET_ROOM_ID})`))
      
      // Gửi thông báo game started
      this.notifySocketGameEvent("game-started", {
        timestamp: new Date().toISOString(),
        settings: {
          martingale: IS_MARTINGALE,
          zombie: ZOMBIE_MODE,
          gift: GIFT_MODE,
          jackpotThreshold: JACKPOT_THRESHOLD,
        }
      })
    } catch (error) {
      Log(chalk.red(`Lỗi khởi tạo Socket.IO: ${error.message}`))
    }
  }

  /**
   * Ngắt kết nối Socket.IO
   */
  disconnectSocket() {
    if (this.socketClient) {
      try {
        this.notifySocketGameEvent("game-stopped", {
          timestamp: new Date().toISOString()
        })
        this.socketClient.leaveRoom()
        this.socketClient = null
        Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Socket.IO đã ngắt kết nối`))
      } catch (error) {
        Log(chalk.red(`Lỗi khi ngắt Socket.IO: ${error.message}`))
      }
    }
  }

  /**
   * Gửi thông báo sự kiện game qua socket
   */
  notifySocketGameEvent(event, payload = {}) {
    if (!this.socketClient) return
    
    try {
      this.socketClient.sendRoomNotify(event, {
        userId: this.username,
        timestamp: new Date().toISOString(),
        ...payload
      })
    } catch (error) {
      Log(chalk.red(`Lỗi gửi socket event '${event}': ${error.message}`))
    }
  }

  /**
   * Cập nhật budget lên socket server
   */
  updateSocketBudget() {
    if (!this.socketClient || this.currentBudget === null) return
    
    const now = Date.now()
    if (now - this.lastSocketBudgetUpdate < this.socketUpdateInterval) return
    
    this.lastSocketBudgetUpdate = now
    this.socketClient.respondUserInfo(this.currentBudget)
  }

  /**
   * Báo lỗi qua socket
   */
  reportSocketError(reason) {
    if (!this.socketClient) return
    this.socketClient.reportUserError(reason)
  }

  /*------- ORIGINAL METHODS -------*/

  resetMartingaleState() {
    this.baseBetAmount = DEFAULT_BET_AMOUNT
    this.martingaleCurrentBet = this.baseBetAmount
    this.lastBetAmount = 0
    this.lastBetChoice = null
    if (IS_MARTINGALE) {
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Trạng thái Martingale đã được reset.`))
    }
  }

  addManagedInterval(callback, delay) {
    const id = setInterval(callback, delay)
    this.activeIntervals.push(id)
    return id
  }

  forceKillConnections() {
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Force killing all connections...`))
    
    this.activeIntervals.forEach(clearInterval)
    this.activeIntervals = []

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.zombieReconnectTimeout) {
      clearTimeout(this.zombieReconnectTimeout)
      this.zombieReconnectTimeout = null
    }

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

    this.mainGameClient = new WebSocketClient()
    this.simmsClient = new WebSocketClient()
  }

  handleConnectFailed(error, clientName) {
    Log(chalk.red(`Kết nối thất bại (${clientName}): ${error.toString()}`))
    this.reportSocketError(`connection-failed-${clientName}`)
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, error)
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.yellow(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  handleConnectionClose(reasonCode, description, clientName) {
    Log(chalk.yellow(`Kết nối đã đóng (${clientName}): ${description.toString()}`))
    this.notifySocketGameEvent("connection-closed", {
      client: clientName,
      reason: description.toString()
    })
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, new Error(`Connection closed: ${description}`))
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.yellow(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  handleConnectionError(error, clientName) {
    Log(chalk.red(`Lỗi (${clientName}): ${error.toString()}`))
    this.reportSocketError(`error-${clientName}`)
    
    if (ZOMBIE_MODE && !this.isStopped) {
      this.handleZombieReconnect(clientName, error)
    } else if (!this.isStopped) {
      this.tryReconnect(clientName)
    } else {
      Log(chalk.red(`Không tự động kết nối lại ${clientName} vì trò chơi đã dừng.`))
    }
  }

  handleZombieReconnect(clientName, error) {
    this.zombieFailureCount++
    Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Lần thất bại thứ ${this.zombieFailureCount} cho ${clientName}`))

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
      
      this.notifySocketGameEvent("zombie-reconnect", {
        failureCount: this.zombieFailureCount,
        client: clientName
      })
    }

    this.forceKillConnections()

    Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Sẽ thử kết nối lại sau 5 phút...`))
    this.zombieReconnectTimeout = setTimeout(() => {
      this.zombieReconnectAttempts++
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Zombie Mode: Đang thử kết nối lại lần ${this.zombieReconnectAttempts}...`))
      this.start().catch((startError) => {
        Log(chalk.red(`Zombie reconnect failed: ${startError.message}`))
      })
    }, this.zombieReconnectDelay)
  }

  tryReconnect(clientName) {
    if (this.isStopped) {
      Log(chalk.yellow(`Không thể tự động kết nối lại ${clientName}: Trò chơi đã dừng.`))
      return
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Đang cố gắng kết nối lại ${clientName} (Lần ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`))
      this.reconnectTimeout = setTimeout(() => {
        this.start()
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
        this.stop(true)
      }
    }
  }

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
      Log(chalk.red(`Lỗi phân tích tin nhắn MainGame (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`))
      return
    }

    // Lệnh 2000: Trạng thái trò chơi ban đầu
    if (messageString.includes(`"cmd":2000`)) {
      if (parsedMessage[1] && parsedMessage[1].htr && parsedMessage[1].htr.length >= 2) {
        this.latestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 1]
        this.secondLatestGameResult = parsedMessage[1].htr[parsedMessage[1].htr.length - 2]
        this.gameHistory = parsedMessage[1].htr.map((r) => (r.d1 + r.d2 + r.d3 > 10 ? "TAI" : "XIU"))
        if (this.gameHistory.length > 10) {
          this.gameHistory = this.gameHistory.slice(-10)
        }
        
        this.notifySocketGameEvent("game-history-loaded", {
          historyLength: this.gameHistory.length
        })
      }
    }
    // Lệnh 2006: Cập nhật kết quả trò chơi
    else if (messageString.includes(`"cmd":2006`)) {
      this.secondLatestGameResult = this.latestGameResult
      this.latestGameResult = parsedMessage[1]
      const sumResult = parsedMessage[1].d1 + parsedMessage[1].d2 + parsedMessage[1].d3
      const resultType = sumResult > 10 ? "TAI" : "XIU"
      Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Kết quả phiên ${chalk.cyan(`#${parsedMessage[1].sid}`)}: ` +
        chalk.green(`${resultType} (${sumResult} điểm)`))

      // Thông báo kết quả qua socket
      this.notifySocketGameEvent("game-result", {
        sessionId: parsedMessage[1].sid,
        result: resultType,
        sum: sumResult,
        dice: [parsedMessage[1].d1, parsedMessage[1].d2, parsedMessage[1].d3],
        wasCorrect: this.lastBetChoice === resultType,
        betAmount: this.lastBetAmount
      })

      if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối ổn định, reset failure count.`))
        this.zombieFailureCount = 0
      }

      // Xử lý Martingale
      if (IS_MARTINGALE && !GIFT_MODE) {
        if (this.lastBetChoice && this.lastBetAmount > 0) {
          if (this.lastBetChoice === resultType) {
            Log(chalk.green(`[${new Date().toLocaleTimeString()}] Phiên #${parsedMessage[1].sid}: THẮNG! Reset cược gấp thếp.`))
            this.martingaleCurrentBet = this.baseBetAmount
          } else {
            Log(chalk.red(`[${new Date().toLocaleTimeString()}] Phiên #${parsedMessage[1].sid}: THUA! Tăng cược gấp thếp.`))
            this.martingaleCurrentBet = Math.ceil(this.lastBetAmount * RATE_MARTINGALE)
          }
        }
      }

      if (GIFT_MODE) {
        this.isGiftBettingProcessed = false
      }
      
      this.lastBetChoice = null
      this.lastBetAmount = 0

      this.gameHistory.push(resultType)
      if (this.gameHistory.length > 10) {
        this.gameHistory.shift()
      }
      Log(chalk.gray(`Lịch sử gần đây: [${this.gameHistory.join(", ")}]`))
    }
    // Lệnh 2002: Xác nhận đặt cược thành công
    else if (messageString.includes(`"cmd":2002`)) {
      Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Phiên ${chalk.cyan(`#${this.currentSessionId}`)} - ` +
        chalk.green(`Người dùng: ${this.username}`) +
        ` - Đặt cược: ${chalk.red(this.currentBetAmount)} đ. ` +
        chalk.magenta(`Cược thành công cửa: `) +
        chalk.yellow(this.bettingChoice))
      
      this.notifySocketGameEvent("bet-placed", {
        sessionId: this.currentSessionId,
        choice: this.bettingChoice,
        amount: this.currentBetAmount,
        budget: this.currentBudget
      })
      
      this.isBettingAllowed = true
      this.shouldRequestBudget = true
    }
    // Lệnh 2011: Cập nhật hũ
    else if (messageString.includes(`"cmd":2011`)) {
      const newJackpot = parsedMessage[1].J
      if (newJackpot !== this.currentJackpot) {
        const isInRange = isJackpotInRange(newJackpot)
        const rangeStatus = isInRange ? chalk.green("✓ Trong khoảng") : chalk.red("✗ Ngoài khoảng")
        
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          chalk.magenta(`Hũ hiện tại: `) +
          chalk.green(`${newJackpot} đ `) +
          rangeStatus)
        
        this.notifySocketGameEvent("jackpot-update", {
          jackpot: newJackpot,
          inRange: isInRange
        })
        
        this.currentJackpot = newJackpot
        
        if (this.currentJackpot < JACKPOT_THRESHOLD) {
          Log(chalk.red("Giá trị hũ dưới ngưỡng tối thiểu. Bỏ cược"))
          return
        }
        
        if (!isInRange) {
          Log(chalk.red("Giá trị hũ ngoài khoảng cho phép. Bỏ cược"))
          return
        }
      }
    }
    // Lệnh 2005: Phiên trò chơi mới bắt đầu
    else if (messageString.includes(`"cmd":2005`)) {
      if (parsedMessage[1].sid !== this.previousSessionId) {
        this.currentSessionId = parsedMessage[1].sid
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          `Phiên mới bắt đầu: ${chalk.cyan(`#${this.currentSessionId}`)}. Đang chờ đặt cược...`)
        
        this.notifySocketGameEvent("new-session", {
          sessionId: this.currentSessionId
        })
        
        setTimeout(() => {
          this.executeBettingLogic(this.currentSessionId)
        }, Math.floor(Math.random() * 20000) + 10000)
      }
    }
  }

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
      Log(chalk.red(`Lỗi phân tích tin nhắn Simms (JSON không hợp lệ): ${messageString.substring(0, 100)}... Lỗi: ${e.message}`))
      return
    }

    // Lệnh 310: Cập nhật số dư
    if (messageString.includes(`"cmd":310`)) {
      if (parsedMessage[1] && parsedMessage[1].As && typeof parsedMessage[1].As.gold === "number") {
        this.currentBudget = parsedMessage[1].As.gold
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) + `Số dư ví: ${chalk.green(this.currentBudget + " đ")}`)
        
        // Cập nhật budget lên socket
        this.updateSocketBudget()
      }
    }
  }

  executeGiftBetting(sessionId) {
    if (this.isGiftBettingProcessed) {
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Gift betting đã được thực hiện cho phiên này.`))
      return
    }

    const totalBetAmount = AMOUNT_GIFT * 2
    if (this.currentBudget !== null) {
      const notEnoughToPlay = this.currentBudget <= BET_STOP
      const notEnoughToBet = totalBetAmount > this.currentBudget
      if (notEnoughToPlay || notEnoughToBet) {
        const reason = notEnoughToPlay ?
          "Cảnh báo ví tiền không đủ để cược (dưới ngưỡng dừng cược)" :
          "Cảnh báo ví tiền không đủ để đặt cược Gift (không đủ tiền cho cả 2 cửa)"
        sendTelegramAlert({
          type: "warning",
          title: reason,
          content: "Xin hãy vào để kiểm tra lại ví tiền hoặc điều chỉnh mức cược Gift.",
          metadata: {
            wallet: `Số tiền hiện tại: ${convertVnd(this.currentBudget)}`,
            giftAmount: `Số tiền Gift mỗi cửa: ${convertVnd(AMOUNT_GIFT)}`,
            totalNeeded: `Tổng tiền cần: ${convertVnd(totalBetAmount)}`,
            betStop: `Ngưỡng dừng cược: ${convertVnd(BET_STOP)}`,
          },
        })
        
        this.reportSocketError("insufficient-budget-gift")
        
        const logTime = new Date().toLocaleTimeString()
        Log(chalk.red(`[${logTime}] `) +
          `${reason}` +
          `Số dư hiện tại: ${convertVnd(this.currentBudget)}. Đang dừng trò chơi.`)
        this.stop()
        return
      }
    }

    const betCommands = [
      `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${AMOUNT_GIFT},"aid":1,"sid":${sessionId},"eid":1}]`, // TÀI
      `[6,"MiniGame","taixiuUnbalancedPlugin",{"cmd":2002,"b":${AMOUNT_GIFT},"aid":1,"sid":${sessionId},"eid":2}]`  // XỈU
    ]

    if (this.mainGameConnection && this.mainGameConnection.connected) {
      // Đặt cược TÀI
      this.mainGameConnection.sendUTF(betCommands[0])
      Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
        `Gift Mode - Đặt cược TÀI: ${AMOUNT_GIFT} đ cho phiên ${chalk.cyan(`#${sessionId}`)}.`)
      
      // Delay nhỏ trước khi đặt cược XỈU
      setTimeout(() => {
        this.mainGameConnection.sendUTF(betCommands[1])
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          `Gift Mode - Đặt cược XỈU: ${AMOUNT_GIFT} đ cho phiên ${chalk.cyan(`#${sessionId}`)}.`)
      }, 1000)

      this.isGiftBettingProcessed = true
      this.isBettingAllowed = false
      this.lastBetAmount = totalBetAmount
      this.currentBetAmount = totalBetAmount
      
      // Thông báo qua socket
      this.notifySocketGameEvent("gift-bet-placed", {
        sessionId: sessionId,
        amountPerSide: AMOUNT_GIFT,
        totalAmount: totalBetAmount,
        budget: this.currentBudget
      })
      
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] `) +
        `Gift Mode - Đã đặt cược cả 2 cửa với tổng số tiền: ${chalk.red(totalBetAmount)} đ.`)
    } else {
      Log(chalk.red("Không thể gửi lệnh đặt cược Gift: Kết nối chưa sẵn sàng."))
      this.reportSocketError("gift-bet-connection-failed")
    }
  }

  determineBettingChoice() {
    if (GIFT_MODE) {
      return true
    }

    this.bettingChoice = null
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
      if (IS_MARTINGALE) {
        this.currentBetAmount = this.martingaleCurrentBet
        Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] `) +
          `Đã chọn quy tắc: ${chalk.yellow(selectedRule.name)} - Đặt cược (Martingale): ${chalk.yellow(this.bettingChoice)} với số tiền ${chalk.red(this.currentBetAmount)} đ.`)
      } else {
        this.currentBetAmount = selectedRule.betAmount || DEFAULT_BET_AMOUNT
        Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] `) +
          `Đã chọn quy tắc: ${chalk.yellow(selectedRule.name)} - Đặt cược: ${chalk.yellow(this.bettingChoice)} với số tiền ${chalk.red(this.currentBetAmount)} đ.`)
      }
      return true
    } else {
      Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
        "Không tìm thấy quy tắc đặt cược phù hợp trong lịch sử gần đây.")
      return false
    }
  }

  executeBettingLogic(sessionId) {
    if (GIFT_MODE) {
      if (this.currentJackpot < JACKPOT_THRESHOLD) {
        Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
          `Bỏ qua Gift betting cho phiên ${chalk.cyan(`#${sessionId}`)}: Hũ dưới ngưỡng tối thiểu (${this.currentJackpot} < ${JACKPOT_THRESHOLD}).`)
        return
      }
      
      if (!isJackpotInRange(this.currentJackpot)) {
        Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
          `Bỏ qua Gift betting cho phiên ${chalk.cyan(`#${sessionId}`)}: Hũ ngoài khoảng cho phép (${this.currentJackpot}).`)
        return
      }
      
      this.executeGiftBetting(sessionId)
      this.previousSessionId = sessionId
      return
    }

    const isJackpotValid = this.currentJackpot > JACKPOT_THRESHOLD && isJackpotInRange(this.currentJackpot)
    
    if (isJackpotValid && this.determineBettingChoice()) {
      if (!this.isBettingAllowed) {
        Log(chalk.yellow("Chưa được phép đặt cược, đang chờ xác nhận cược trước đó."))
        return
      }

      if (this.currentBudget !== null) {
        const notEnoughToPlay = this.currentBudget <= BET_STOP
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
              betStop: `Ngưỡng dừng cược: ${convertVnd(BET_STOP)}`,
              rateMartingale: `${this.lastBetAmount / RATE_MARTINGALE} số thếp đang gấp`,
            },
          })
          
          this.reportSocketError("insufficient-budget")
          
          const logTime = new Date().toLocaleTimeString()
          Log(chalk.red(`[${logTime}] `) +
            `${reason}` +
            `Số dư hiện tại: ${convertVnd(this.currentBudget)}. Đang dừng trò chơi.`)
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
        this.lastBetAmount = this.currentBetAmount
        this.lastBetChoice = this.bettingChoice
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] `) +
          `Đang cố gắng đặt ${this.currentBetAmount} đ vào cửa ${chalk.yellow(this.bettingChoice)} cho phiên ${chalk.cyan(`#${sessionId}`)}.`)
      } else {
        Log(chalk.red("Không thể gửi lệnh đặt cược: Kết nối chưa sẵn sàng hoặc lệnh không hợp lệ."))
        this.reportSocketError("bet-connection-failed")
      }
      this.previousSessionId = sessionId
    } else {
      let skipReason = ""
      if (this.currentJackpot <= JACKPOT_THRESHOLD) {
        skipReason = "Hũ dưới ngưỡng tối thiểu"
      } else if (!isJackpotInRange(this.currentJackpot)) {
        skipReason = "Hũ ngoài khoảng cho phép"
      } else {
        skipReason = "Không có mẫu rõ ràng"
      }
      
      Log(chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
        `Bỏ qua đặt cược cho phiên ${chalk.cyan(`#${sessionId}`)}: ${skipReason}.`)
    }
  }

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

  async start() {
    this.isStopped = false

    let mainGameConnected = false
    let simmsConnected = false

    const checkBothConnected = (resolve) => {
      if (mainGameConnected && simmsConnected) {
        // Khởi tạo socket sau khi cả 2 game connections đã sẵn sàng
        if (SOCKET_ENABLED) {
          this.initializeSocket()
        }
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
        this.reconnectAttempts = 0
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout)
          this.reconnectTimeout = null
        }
        if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
          Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối MainGame thành công, reset failure count.`))
          this.zombieFailureCount = 0
        }
        this.initializeMainGameConnection()
        this.mainGameConnection.on("message", this.handleMainGameMessage)
        this.mainGameConnection.on("error", (error) => this.handleConnectionError(error, "MainGame"))
        this.mainGameConnection.on("close", (reasonCode, description) =>
          this.handleConnectionClose(reasonCode, description, "MainGame"))
        mainGameConnected = true
        checkBothConnected(resolve)
      })

      this.simmsClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "Simms")
        reject(new Error(`Kết nối Simms thất bại: ${error.message}`))
      })
      this.simmsClient.on("connect", (connection) => {
        this.simmsConnection = connection
        Log(chalk.cyan("Kết nối Simms thành công."))
        this.reconnectAttempts = 0
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout)
          this.reconnectTimeout = null
        }
        if (ZOMBIE_MODE && this.zombieFailureCount > 0) {
          Log(chalk.green(`[${new Date().toLocaleTimeString()}] Zombie Mode: Kết nối Simms thành công, reset failure count.`))
          this.zombieFailureCount = 0
        }
        this.initializeSimmsConnection()
        this.simmsConnection.on("message", this.handleSimmsMessage)
        this.simmsConnection.on("error", (error) => this.handleConnectionError(error, "Simms"))
        this.simmsConnection.on("close", (reasonCode, description) =>
          this.handleConnectionClose(reasonCode, description, "Simms"))
        simmsConnected = true
        checkBothConnected(resolve)
      })

      this.mainGameClient.connect("wss://websocket.mangee.io/websocket")
      this.simmsClient.connect("wss://websocket.mangee.io/websocket2")
    })
  }

  stop(isAutoStop = false) {
    if (this.isStopped && !isAutoStop) {
      Log(chalk.yellow("Quản lý trò chơi đã dừng."))
      return
    }
    if (this.isStopped && isAutoStop) {
      Log(chalk.yellow("Quản lý trò chơi đã dừng (tự động)."))
      return
    }

    Log(chalk.red("Đang dừng quản lý trò chơi..."))
    this.isStopped = true

    // Ngắt kết nối socket trước
    this.disconnectSocket()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.zombieReconnectTimeout) {
      clearTimeout(this.zombieReconnectTimeout)
      this.zombieReconnectTimeout = null
    }
    this.reconnectAttempts = 0
    this.zombieReconnectAttempts = 0
    this.zombieFailureCount = 0

    this.activeIntervals.forEach(clearInterval)
    this.activeIntervals = []

    if (this.mainGameConnection && this.mainGameConnection.connected) {
      this.mainGameConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.")
    }
    if (this.simmsConnection && this.simmsConnection.connected) {
      this.simmsConnection.close(1000, "Trò chơi dừng theo yêu cầu người dùng.")
    }

    if (!isAutoStop) {
      sendTelegramAlert({
        type: "warning",
        title: "Trò chơi đã tạm dừng",
        content: "Xin hãy vào kiểm tra lại",
        metadata: {
          rateMartingale: `${this.lastBetAmount / RATE_MARTINGALE} số thếp đang gấp`,
          zombieMode: ZOMBIE_MODE ? "Đã tắt zombie mode" : "Zombie mode không hoạt động",
          giftMode: GIFT_MODE ? "Đã tắt gift mode" : "Gift mode không hoạt động",
        },
      })
    }
    Log(chalk.green("Quản lý trò chơi đã dừng thành công."))
  }
}

/*------- CÁC HÀM ĐIỀU KHIỂN TRÒ CHƠI TOÀN CỤC --------*/
let activeGameWorker = null

export const startGame = async () => {
  if (activeGameWorker) {
    logError("Trò chơi đang chạy. Vui lòng dừng nó trước.")
    return
  }
  const users = await readUsers()
  const selectedUser = users.find((u) => u.selected)
  if (!selectedUser) {
    return logError("Không tìm thấy người dùng được chọn. Vui lòng chọn một người dùng trong trình quản lý dữ liệu của bạn.")
  }
  const { name: username, password, infoData, signature } = selectedUser
  const userInfo = infoData && infoData[4] ? infoData[4].info : null
  if (!username || !signature || !userInfo) {
    return logError("Thiếu thông tin tài khoản bắt buộc (tên người dùng, chữ ký hoặc dữ liệu thông tin). Vui lòng kiểm tra cấu hình người dùng của bạn.")
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
    
    Log(chalk.yellow("\n--- Quy tắc trò chơi ---"))
    config.gameRules.forEach((rule, index) => Log(chalk.yellow(`${index + 1}. ${rule}`)))
    
    if (!GIFT_MODE) {
      Log(chalk.yellow("\n--- Quy tắc đặt cược đang hoạt động ---"))
      config.bettingRules
        .filter((rule) => rule.active)
        .sort((a, b) => a.priority - b.priority)
        .forEach((rule, index) =>
          Log(chalk.yellow(
            `${index + 1}. [Ưu tiên: ${rule.priority}] ${rule.name}: ${rule.description} (Cược: ${rule.betAmount || DEFAULT_BET_AMOUNT} đ)`)))
    }
    
    Log(chalk.yellow(`Số tiền đặt cược mặc định: ${chalk.green(DEFAULT_BET_AMOUNT + " đ")}`))
    Log(chalk.yellow(`Ngưỡng hũ để tiếp tục chơi: ${chalk.green(JACKPOT_THRESHOLD + " đ")}`))
    Log(chalk.yellow(`Ngưỡng dừng cược: ${chalk.green(BET_STOP + " đ")}`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    if (IS_MARTINGALE && !GIFT_MODE) {
      Log(chalk.yellow(`Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
    Log(chalk.yellow(`Chế độ Zombie: ${ZOMBIE_MODE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Chế độ Gift: ${GIFT_MODE ? "BẬT" : "TẮT"}`))
    Log(chalk.yellow(`Socket.IO: ${SOCKET_ENABLED ? "BẬT" : "TẮT"}`))
    
    if (GIFT_MODE) {
      Log(chalk.yellow(`Số tiền Gift mỗi cửa: ${chalk.green(AMOUNT_GIFT + " đ")}`))
      Log(chalk.yellow(`Tổng tiền cần cho mỗi phiên: ${chalk.green((AMOUNT_GIFT * 2) + " đ")}`))
      Log(chalk.cyan("Lưu ý: Chế độ Gift sẽ đặt cược cả TÀI và XỈU với cùng số tiền, bỏ qua tất cả quy tắc cược khác."))
    }
    if (JACKPOT_RANGE.length > 0) {
      Log(chalk.yellow(`Khoảng Jackpot cho phép cược:`))
      JACKPOT_RANGE.forEach((range, index) => {
        Log(chalk.yellow(`  ${index + 1}. Từ ${chalk.green(range.MIN)} đến ${chalk.green(range.MAX)} đ`))
      })
    } else {
      Log(chalk.yellow(`Khoảng Jackpot: ${chalk.green("Tất cả giá trị")}`))
    }
  } catch (error) {
    logError(`Không thể bắt đầu trò chơi: ${error.message}`)
    console.error(error)
    activeGameWorker = null
  }
}

export const stopGame = () => {
  if (activeGameWorker) {
    console.log("stop game 1095")
    activeGameWorker.stop()
    activeGameWorker = null
    Log(chalk.green("Trò chơi đã dừng bởi người dùng."))
  } else {
    logError("Không có trò chơi nào đang hoạt động để dừng.")
  }
}