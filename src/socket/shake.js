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
const configPath = path.resolve(__dirname, "../../rule_shake.json")

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
let IS_MARTINGALE
let RATE_MARTINGALE
let configReloadTimeout

/**
 * Tải cấu hình từ file rule.json và cập nhật các hằng số liên quan.
 */
const loadConfigAndConstants = () => {
  Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Đang tải cấu hình từ ${configPath}`))
  try {
    const newConfig = JSON.parse(fs.readFileSync(configPath, "utf8"))
    config = newConfig
    DEFAULT_BET_AMOUNT = config.gameSettings.BET_AMOUNT
    JACKPOT_THRESHOLD = config.gameSettings.JACKPOT_THRESHOLD
    BET_STOP = config.gameSettings.BET_STOP
    IS_MARTINGALE = config.gameSettings.IS_MARTINGALE
    RATE_MARTINGALE = config.gameSettings.RATE_MARTINGALE

    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Cấu hình đã được tải thành công`))
    Log(chalk.yellow(`  - Số tiền cược mặc định: ${DEFAULT_BET_AMOUNT} đ`))
    Log(chalk.yellow(`  - Ngưỡng hũ: ${JACKPOT_THRESHOLD} đ`))
    Log(chalk.yellow(`  - Ngưỡng dừng cược: ${BET_STOP} đ`))
    Log(chalk.yellow(`  - Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    if (IS_MARTINGALE) {
      Log(chalk.yellow(`  - Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
  } catch (error) {
    console.error(chalk.red(`[${new Date().toLocaleTimeString()}] LỖI: Không thể đọc rule.json: ${error.message}`))
  }
}

// Tải cấu hình lần đầu
loadConfigAndConstants()

// Theo dõi sự thay đổi của file rule.json
fs.watch(configPath, (eventType, filename) => {
  if (filename) {
    Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Phát hiện thay đổi trong rule.json. Đang tải lại...`))
    clearTimeout(configReloadTimeout)
    configReloadTimeout = setTimeout(() => {
      loadConfigAndConstants()
      if (activeGameWorker) {
        activeGameWorker.resetMartingaleState()
      }
    }, 300)
  }
})

/*------- MAPPING EID CHO GAME SÓC ĐĨA --------------------*/
const EID_NAMES = {
  0: "4 nút đỏ (1:16)",    // 4 đỏ
  1: "3 đỏ 1 vàng (1:4)",  // 3 đỏ 1 vàng
  2: "Chẵn",               // Tổng chẵn
  3: "Lẻ",                 // Tổng lẻ
  4: "4 nút vàng (1:16)",  // 4 vàng
  5: "3 vàng 1 đỏ (1:4)"   // 3 vàng 1 đỏ
}

// Hàm phân tích kết quả dựa trên 4 xúc xắc
function analyzeResult(d1, d2, d3, d4) {
  const dices = [d1, d2, d3, d4];

  // Quy đổi màu: 1-3 = Đỏ, 4-6 = Vàng
  const isRed = dice => dice >= 1 && dice <= 3;
  const redCount = dices.filter(isRed).length;
  const yellowCount = 4 - redCount;

  // Xác định kết quả màu
  let colorResult = "";
  if (redCount === 4) colorResult = "RED_4";
  else if (yellowCount === 4) colorResult = "YELLOW_4";
  else if (redCount === 3) colorResult = "RED_3_YELLOW_1";
  else if (yellowCount === 3) colorResult = "YELLOW_3_RED_1";
  else colorResult = "MIXED"; // 2 đỏ 2 vàng

  // Tổng điểm để xác định chẵn/lẻ
  const sum = dices.reduce((a, b) => a + b, 0);
  const evenOddResult = sum % 2 === 0 ? "CHAN" : "LE";

  return {
    dices,
    sum,
    redCount,
    yellowCount,
    colorResult,
    evenOddResult,
    isSpecial: redCount === 4 || yellowCount === 4
  };
}


/*------- LỚP QUẢN LÝ TRÒ CHƠI --------------------*/
class GameWorker {
  constructor({ username, password, info, signature }) {
    Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Khởi tạo GameWorker cho user: ${username}`))
    this.username = username
    this.password = password
    this.info = info
    this.signature = signature
    this.simmsClient = new WebSocketClient()
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
    // Biến cho chế độ Martingale
    this.baseBetAmount = DEFAULT_BET_AMOUNT
    this.martingaleCurrentBet = this.baseBetAmount
    this.lastBetAmount = 0
    this.lastBetChoice = null
    // Reconnection properties
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 5000
    this.reconnectTimeout = null
    // Bind event handlers
    this.handleConnectFailed = this.handleConnectFailed.bind(this)
    this.handleConnectionClose = this.handleConnectionClose.bind(this)
    this.handleConnectionError = this.handleConnectionError.bind(this)
    this.handleSimmsMessage = this.handleSimmsMessage.bind(this)
  }

  resetMartingaleState() {
    this.baseBetAmount = DEFAULT_BET_AMOUNT
    this.martingaleCurrentBet = this.baseBetAmount
    this.lastBetAmount = 0
    this.lastBetChoice = null
    if (IS_MARTINGALE) {
      Log(chalk.magenta(`[${new Date().toLocaleTimeString()}] Trạng thái Martingale đã được reset`))
    }
  }

  addManagedInterval(callback, delay) {
    const id = setInterval(callback, delay)
    this.activeIntervals.push(id)
    return id
  }

  handleConnectFailed(error, clientName) {
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Kết nối ${clientName} thất bại: ${error.toString()}`))
    if (!this.isStopped) {
      this.tryReconnect(clientName)
    }
  }

  handleConnectionClose(reasonCode, description, clientName) {
    Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Kết nối ${clientName} đã đóng: ${description.toString()}`))
    if (!this.isStopped) {
      this.tryReconnect(clientName)
    }
  }

  handleConnectionError(error, clientName) {
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Lỗi kết nối ${clientName}: ${error.toString()}`))
    if (!this.isStopped) {
      this.tryReconnect(clientName)
    }
  }

  tryReconnect(clientName) {
    if (this.isStopped) return
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Đang kết nối lại ${clientName} (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`))
      this.reconnectTimeout = setTimeout(() => {
        this.start()
      }, this.reconnectDelay)
    } else {
      Log(chalk.red(`[${new Date().toLocaleTimeString()}] Đã đạt số lần kết nối lại tối đa cho ${clientName}. Dừng trò chơi`))
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

  handleSimmsMessage(msg) {
    if (msg.type !== "utf8") return

    const messageString = msg.utf8Data
    let parsedMessage
    try {
      parsedMessage = JSON.parse(messageString)
    } catch (e) {
      Log(chalk.red(`[${new Date().toLocaleTimeString()}] Lỗi phân tích JSON: ${e.message}`))
      return
    }

    // Lệnh 907: Kết quả game Sóc Đĩa
    if (messageString.includes(`"cmd":907`)) {
      if (parsedMessage[1] && parsedMessage[1].dice) {
        const dice = parsedMessage[1].dice
        const { d1, d2, d3, d4 } = dice
        const analysis = analyzeResult(d1, d2, d3, d4)

        this.latestGameResult = {
          d1, d2, d3, d4,
          sum: analysis.sum,
          redCount: analysis.redCount,
          yellowCount: analysis.yellowCount,
          colorResult: analysis.colorResult,
          evenOddResult: analysis.evenOddResult,
          isSpecial: analysis.isSpecial,
          gid: parsedMessage[1].gid || 'unknown'
        }

        Log(
          chalk.blue(`[${new Date().toLocaleTimeString()}] Kết quả phiên #${parsedMessage[1].gid}: `) +
          chalk.green(`${analysis.colorResult} | ${analysis.evenOddResult}`) +
          chalk.gray(` - Xúc xắc: [${d1}, ${d2}, ${d3}, ${d4}] (${analysis.redCount}đỏ-${analysis.yellowCount}vàng, tổng: ${analysis.sum})`)
        )
        // Xử lý logic Martingale
        if (IS_MARTINGALE && this.lastBetChoice !== null && this.lastBetAmount > 0) {
          let isWin = false

          // Kiểm tra thắng thua dựa trên eid
          switch (this.lastBetChoice) {
            case 0: // 4 nút đỏ
              isWin = (analysis.redCount === 4)
              break
            case 1: // 3 đỏ 1 vàng
              isWin = (analysis.redCount === 3 && analysis.yellowCount === 1)
              break
            case 2: // Chẵn
              isWin = (analysis.sum % 2 === 0)
              break
            case 3: // Lẻ
              isWin = (analysis.sum % 2 === 1)
              break
            case 4: // 4 nút vàng
              isWin = (analysis.yellowCount === 4)
              break
            case 5: // 3 vàng 1 đỏ
              isWin = (analysis.yellowCount === 3 && analysis.redCount === 1)
              break
          }

          if (isWin) {
            Log(chalk.green(`[${new Date().toLocaleTimeString()}] Martingale: THẮNG! Reset cược gấp thếp`))
            this.martingaleCurrentBet = this.baseBetAmount
          } else {
            Log(chalk.red(`[${new Date().toLocaleTimeString()}] Martingale: THUA! Tăng cược gấp thếp`))
            this.martingaleCurrentBet = Math.ceil(this.lastBetAmount * RATE_MARTINGALE)
          }
        }

        this.lastBetChoice = null
        this.lastBetAmount = 0
        // Thêm kết quả vào lịch sử (cả màu và chẵn/lẻ)
        this.gameHistory.push({
          color: analysis.colorResult,
          evenOdd: analysis.evenOddResult,
          combined: `${analysis.colorResult}_${analysis.evenOddResult}`
        })

        if (this.gameHistory.length > 10) {
          this.gameHistory.shift()
        }
      }
    }
    // Lệnh 207: Cập nhật jackpot
    else if (messageString.includes(`"cmd":207`)) {
      if (parsedMessage[1] && typeof parsedMessage[1].ba === "number") {
        this.currentJackpot = parsedMessage[1].ba
        Log(chalk.cyan(`[${new Date().toLocaleTimeString()}] Jackpot cập nhật: ${convertVnd(this.currentJackpot)}`))
        // Kiểm tra jackpot threshold
        if (this.currentJackpot < JACKPOT_THRESHOLD) {
          Log(chalk.red(`[${new Date().toLocaleTimeString()}] CẢNH BÁO: Jackpot thấp hơn ngưỡng ${convertVnd(JACKPOT_THRESHOLD)}!`))
          return
        }
      }
    }
    // Lệnh 900: Xác nhận đặt cược thành công
    else if (messageString.includes(`"cmd":900`)) {
      Log(
        chalk.green(`[${new Date().toLocaleTimeString()}] Đặt cược thành công: ${this.currentBetAmount} đ vào cửa ${EID_NAMES[this.bettingChoice]} (eid:${this.bettingChoice})`)
      )
      this.isBettingAllowed = true
      this.shouldRequestBudget = true
    }
    // Lệnh 904: Bắt đầu phiên mới
    else if (messageString.includes(`"cmd":904`)) {
      Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Phiên mới bắt đầu, chờ đặt cược...`))
      const delay = Math.floor(Math.random() * 15000) + 5000
      setTimeout(() => {
        this.executeTaiXiuBettingLogic()
      }, delay)
    }
    // Lệnh 310: Cập nhật số dư
    else if (messageString.includes(`"cmd":310`)) {
      if (parsedMessage[1] && parsedMessage[1].As && typeof parsedMessage[1].As.gold === "number") {
        this.currentBudget = parsedMessage[1].As.gold
        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Số dư cập nhật: ${this.currentBudget} đ`))
      }
    }
  }

  determineBettingChoice() {
    this.bettingChoice = null
    let selectedRule = null

    // Tạo lịch sử để so sánh với pattern
    const colorHistory = this.gameHistory.map(h => h.color).reverse()
    const evenOddHistory = this.gameHistory.map(h => h.evenOdd).reverse()
    const combinedHistory = this.gameHistory.map(h => h.combined).reverse()

    const activeRules = config.bettingRules.filter((rule) => rule.active).sort((a, b) => a.priority - b.priority)
    Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Lịch sử màu: [${colorHistory.join(", ")}]`))
    Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Lịch sử chẵn/lẻ: [${evenOddHistory.join(", ")}] - Kiểm tra ${activeRules.length} quy tắc`))
    for (const rule of activeRules) {
      if (rule.pattern.length === 0) {
        selectedRule = rule
        break
      }

      // Chọn lịch sử phù hợp để so sánh
      let historyToCheck = []
      const firstPatternElement = rule.pattern[0]

      if (firstPatternElement.includes("RED_") || firstPatternElement.includes("YELLOW_") || firstPatternElement === "MIXED") {
        historyToCheck = colorHistory
      } else if (firstPatternElement === "CHAN" || firstPatternElement === "LE") {
        historyToCheck = evenOddHistory
      } else {
        historyToCheck = combinedHistory
      }

      if (historyToCheck.length >= rule.pattern.length) {
        const historySlice = historyToCheck.slice(0, rule.pattern.length)
        const reversedPattern = [...rule.pattern].reverse()
        const patternMatches = reversedPattern.every((val, index) => val === historySlice[index])

        if (patternMatches) {
          Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Tìm thấy quy tắc phù hợp: "${rule.name}"`))
          selectedRule = rule
          break
        }
      }
    }
    if (selectedRule) {
      this.bettingChoice = selectedRule.betOn // betOn sẽ là eid (0-5)
      if (IS_MARTINGALE) {
        this.currentBetAmount = this.martingaleCurrentBet
      } else {
        this.currentBetAmount = selectedRule.betAmount || DEFAULT_BET_AMOUNT
      }

      Log(
        chalk.magenta(`[${new Date().toLocaleTimeString()}] Chọn quy tắc: ${selectedRule.name} - Cược: ${EID_NAMES[this.bettingChoice]} với ${this.currentBetAmount} đ`)
      )
      return true
    } else {
      Log(chalk.gray(`[${new Date().toLocaleTimeString()}] Không tìm thấy quy tắc phù hợp`))
      return false
    }
  }

  executeTaiXiuBettingLogic() {
    if (this.determineBettingChoice()) {
      if (!this.isBettingAllowed) {
        Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Chưa được phép đặt cược, đang chờ...`))
        return
      }
      // Kiểm tra số dư (giữ nguyên logic cũ)
      if (this.currentBudget !== null) {
        const notEnoughToPlay = this.currentBudget <= BET_STOP
        const notEnoughToBet = this.currentBetAmount > this.currentBudget

        if (notEnoughToPlay || notEnoughToBet) {
          const reason = notEnoughToPlay ?
            "Số dư dưới ngưỡng dừng cược" :
            "Số dư không đủ để đặt cược"

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

          Log(chalk.red(`[${new Date().toLocaleTimeString()}] ${reason}. Số dư: ${convertVnd(this.currentBudget)}. Dừng trò chơi`))
          this.stop()
          return
        }
      }
      // Sử dụng trực tiếp eid từ bettingChoice
      const eid = this.bettingChoice // bettingChoice giờ sẽ là eid (0-5)

      if (eid < 0 || eid > 5) {
        Log(chalk.red(`[${new Date().toLocaleTimeString()}] EID không hợp lệ: ${eid}`))
        return
      }
      const betCommand = `[6,"ShakeDisk","SD_ConMucPlugin",{"cmd":900,"eid":${eid},"v":${this.currentBetAmount}}]`
      if (this.simmsConnection && this.simmsConnection.connected) {
        this.simmsConnection.sendUTF(betCommand)
        this.isBettingAllowed = false
        this.lastBetAmount = this.currentBetAmount
        this.lastBetChoice = this.bettingChoice // Lưu eid

        Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Đã gửi lệnh cược ${this.currentBetAmount} đ vào cửa ${EID_NAMES[eid]} (eid:${eid})`))
      } else {
        Log(chalk.red(`[${new Date().toLocaleTimeString()}] Không thể gửi lệnh cược: Kết nối chưa sẵn sàng`))
      }
    }
  }

  initializeSimmsConnection() {
    const initialData = [
      1,
      "ShakeDisk",
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
    // Khởi tạo game Sóc Đĩa
    setTimeout(() => {
      this.simmsConnection.sendUTF(`[6,"ShakeDisk","SD_ConMucPlugin",{"cmd":1950}]`)
    }, 1000)

    // Thiết lập ping và budget request interval
    this.addManagedInterval(() => {
      if (this.isStopped) return
      if (this.simmsConnection && this.simmsConnection.connected) {
        if (this.shouldRequestBudget) {
          this.simmsConnection.sendUTF(`[6,"ShakeDisk","channelPlugin",{"cmd":310}]`)
          this.shouldRequestBudget = false
        }
        this.simmsConnection.sendUTF(`[7,"ShakeDisk",${++this.pingCounter},0]`)
      }
    }, 5000)
  }

  async start() {
    this.isStopped = false
    return new Promise((resolve, reject) => {
      this.simmsClient.on("connectFailed", (error) => {
        this.handleConnectFailed(error, "ShakeDisk")
        reject(new Error(`Kết nối ShakeDisk thất bại: ${error.message}`))
      })

      this.simmsClient.on("connect", (connection) => {
        Log(chalk.green(`[${new Date().toLocaleTimeString()}] ShakeDisk kết nối thành công!`))
        this.simmsConnection = connection
        this.reconnectAttempts = 0
        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout)
          this.reconnectTimeout = null
        }
        this.initializeSimmsConnection()
        this.simmsConnection.on("message", this.handleSimmsMessage)
        this.simmsConnection.on("error", (error) => this.handleConnectionError(error, "ShakeDisk"))
        this.simmsConnection.on("close", (reasonCode, description) =>
          this.handleConnectionClose(reasonCode, description, "ShakeDisk"),
        )
        resolve()
      })

      this.simmsClient.connect("wss://ws-xdcm.atpman.net/websocket")
    })
  }

  stop(isAutoStop = false) {
    if (this.isStopped && !isAutoStop) {
      Log(chalk.yellow(`[${new Date().toLocaleTimeString()}] Trò chơi đã dừng`))
      return
    }
    if (this.isStopped && isAutoStop) {
      return
    }
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Đang dừng trò chơi...`))
    this.isStopped = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.reconnectAttempts = 0
    this.activeIntervals.forEach(clearInterval)
    this.activeIntervals = []
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
        },
      })
    }
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Trò chơi đã dừng thành công`))
  }
}

/*------- CÁC HÀM ĐIỀU KHIỂN TRÒ CHƠI TOÀN CỤC --------*/
let activeGameWorker = null
export const startGameShake = async () => {
  if (activeGameWorker) {
    logError("Trò chơi đang chạy. Vui lòng dừng nó trước.")
    return
  }
  Log(chalk.blue(`[${new Date().toLocaleTimeString()}] Bắt đầu khởi động game Sóc Đĩa`))
  const users = await readUsers()
  const selectedUser = users.find((u) => u.selected)
  if (!selectedUser) {
    return logError("Không tìm thấy người dùng được chọn")
  }
  const { name: username, password, infoData, signature } = selectedUser
  const userInfo = infoData && infoData[4] ? infoData[4].info : null
  if (!username || !signature || !userInfo) {
    return logError("Thiếu thông tin tài khoản bắt buộc")
  }
  try {
    activeGameWorker = new GameWorker({
      username,
      password,
      info: userInfo,
      signature,
    })
    await activeGameWorker.start()
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Trò chơi Sóc Đĩa đã bắt đầu thành công!`))
    // Log thông tin cấu hình
    Log(chalk.yellow("\n--- Thông tin cấu hình ---"))
    Log(chalk.yellow(`Số tiền đặt cược mặc định: ${chalk.green(DEFAULT_BET_AMOUNT + " đ")}`))
    Log(chalk.yellow(`Ngưỡng hũ: ${chalk.green(JACKPOT_THRESHOLD + " đ")}`))
    Log(chalk.yellow(`Ngưỡng dừng cược: ${chalk.green(BET_STOP + " đ")}`))
    Log(chalk.yellow(`Chế độ Martingale: ${IS_MARTINGALE ? "BẬT" : "TẮT"}`))
    if (IS_MARTINGALE) {
      Log(chalk.yellow(`Tỷ lệ gấp thếp: ${RATE_MARTINGALE}`))
    }
    Log(chalk.yellow("\n--- Quy tắc đặt cược đang hoạt động ---"))
    if (config.bettingRules) {
      config.bettingRules
        .filter((rule) => rule.active)
        .sort((a, b) => a.priority - b.priority)
        .forEach((rule, index) =>
          Log(chalk.yellow(`${index + 1}. [Ưu tiên: ${rule.priority}] ${rule.name}: ${rule.description} (Cược: ${rule.betAmount || DEFAULT_BET_AMOUNT} đ)`),
          ),
        )
    }
  } catch (error) {
    Log(chalk.red(`[${new Date().toLocaleTimeString()}] Không thể bắt đầu trò chơi: ${error.message}`))
    logError(`Không thể bắt đầu trò chơi: ${error.message}`)
    console.error(error)
    activeGameWorker = null
  }
}

export const stopGameShake = () => {
  if (activeGameWorker) {
    activeGameWorker.stop()
    activeGameWorker = null
    Log(chalk.green(`[${new Date().toLocaleTimeString()}] Trò chơi đã dừng bởi người dùng`))
  } else {
    logError("Không có trò chơi nào đang hoạt động để dừng.")
  }
}