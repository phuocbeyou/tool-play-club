import { io } from "socket.io-client";
import { stopGame } from "./index.js";

const SERVER_URL = "http://localhost:4000"; // đổi sang URL thực tế
const PING_INTERVAL = 10_000; // 30s ping 1 lần

export class SocketClient {
  constructor({ userId, roomId }) {
    this.userId = userId;
    this.roomId = roomId;
    this.socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    this.registerCoreHandlers();
  }

  /** 🔌 Kết nối và join room */
  connect() {
    this.socket.on("connect", () => {
      console.log(`✅ Connected: ${this.socket.id}`);
      this.joinRoom();
      this.startPing();
    });
  }

  /** 🚪 Join room */
  joinRoom() {
    this.socket.emit("join-room", {
      roomId: this.roomId,
      userId: this.userId,
    });
  }

  /** 🚪 Rời room */
  leaveRoom() {
    this.socket.emit("leave-room", {
      roomId: this.roomId,
      userId: this.userId,
    });
    this.stopPing();
    this.socket.disconnect();
  }

  /** 💓 Gửi ping định kỳ */
  startPing() {
    this.pingTimer = setInterval(() => {
      this.socket.emit("ping-check", {
        userId: this.userId,
        roomId: this.roomId,
      });
    }, PING_INTERVAL);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  /** 🧩 Đăng ký các event listener chính */
  registerCoreHandlers() {
    const s = this.socket;

    // ======= ROOM EVENTS =======
    s.on("room-joined", (data) => {
      console.log(`🎉 Joined Room: ${data.message} (${data.userCount} users)`);
    });

    s.on("user-joined", (data) => {
      console.log(`👋 ${data.message}`);
    });

    s.on("user-left", (data) => {
      stopGame()
      console.log(`👋 ${data.message}`);
    });

    s.on("user-disconnected", (data) => {
      console.log("stop game line 81")
      stopGame()
      console.log(`⚠️ User ${data.userId} disconnected: ${data.reason}`);
    });

    // ======= PING EVENTS =======
    s.on("pong-check", (data) => {
      console.log(`💓 Pong from server at ${new Date(data.timestamp).toLocaleTimeString()}`);
    });

    // ======= ERROR / STOP EVENTS =======
    s.on("room-stop", (data) => {
      stopGame()
      this.stopPing()
      this.leaveRoom()
      console.log(`⛔ Room stopped: ${data.message}`);
    });

    // ======= NOTIFY EVENTS =======
    s.on("room-event", (data) => {
      console.log(`📢 [${data.event}]`, data.payload);
    });

    // ======= USER INFO EVENTS =======
    s.on("request-user-info", (data) => {
      console.log(`📤 Server yêu cầu gửi thông tin user (${data.reason})`);
      this.respondUserInfo();
    });

    s.on("user-info-updated", (data) => {
      console.log(`💰 ${data.userId} cập nhật coin: ${data.coin}`);
    });

    // ======= CONNECTION HANDLERS =======
    s.on("disconnect", (reason) => {
      console.log(`❌ Disconnected: ${reason}`);
      this.stopPing();
    });

    s.on("connect_error", (err) => {
      this.stopPing();
      stopGame()
      console.error("❌ Connection error:", err.message);
    });
  }

  /** 💬 Gửi thông báo trong phòng */
  sendRoomNotify(event, payload = {}) {
    console.log(`📤 Gửi room-notify: [${event}]`, payload);
    this.socket.emit("room-notify", {
      roomId: this.roomId,
      event,
      payload,
    });
  }

  /** ⚠️ Báo lỗi người dùng */
  reportUserError(reason = "unknown") {
    this.socket.emit("user-error", {
      roomId: this.roomId,
      userId: this.userId,
      reason,
    });
  }

  /** 📤 Gửi thông tin user (coin, name, ...) */
  respondUserInfo(coin = 0) {
    this.socket.emit("response-user-info", {
      roomId: this.roomId,
      userId: this.userId,
      coin: coin,
    });
  }

  /** 🧠 Server yêu cầu fetch user info toàn phòng */
  requestFetchUserInfo(reason = "manual check") {
    this.socket.emit("fetch-user-info", {
      roomId: this.roomId,
      reason,
    });
  }
}
