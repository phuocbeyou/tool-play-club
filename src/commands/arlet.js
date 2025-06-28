import { getSettings, saveSettings } from '../logic/dataManager.js';

export async function setWalletAlertConfig({ threshold, interval }) {
  if (threshold == null || threshold < 0) {
    throw new Error('Threshold phải là số không âm');
  }
  if (interval == null || interval <= 0) {
    throw new Error('Interval phải là số dương');
  }

  const settings = await getSettings();

  settings.walletAlert = {
    threshold,
    interval,  // đơn vị: phút hoặc giây tùy bạn (đề xuất phút)
    lastSent: 0, // timestamp lần gửi cảnh báo gần nhất (khởi tạo 0)
  };

  await saveSettings(settings);

  console.log(`✅ Đã thiết lập cảnh báo ví tiền: dưới ${threshold}, gửi mỗi ${interval} phút.`);
}
