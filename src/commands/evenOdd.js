import { getSettings, saveSettings } from '../logic/dataManager.js';
import { logSuccess, logError } from '../ui/display.js';

// ✅ Lưu jackpot target value (number)
export async function setJackpotTargetValue(value) {
  if (typeof value !== 'number' || value < 0) {
    logError('⚠️ Giá trị jackpot phải là số dương!');
    return;
  }

  const settings = await getSettings();
  settings.jackpotTarget = value;
  await saveSettings(settings);

  logSuccess(`🎯 Đã lưu jackpot target: ${value}`);
}

// ✅ Lưu combo tiền cược theo ngưỡng jackpot
export async function setBetCombos(combos) {
  const isValid = Array.isArray(combos) && combos.every(c =>
    typeof c.threshold === 'number' &&
    typeof c.amount === 'number' &&
    c.threshold >= 0 &&
    c.amount > 0
  );

  if (!isValid) {
    logError('⚠️ Danh sách combo không hợp lệ!');
    return;
  }

  const settings = await getSettings();
  settings.betCombos = combos;
  await saveSettings(settings);

  logSuccess('💰 Đã lưu combo tiền cược!');
}

// ✅ Lưu rule đặt cược theo lịch sử
export async function setBetRule(rule) {
  if (
    !rule ||
    !Array.isArray(rule.pattern) ||
    typeof rule.result !== 'string'
  ) {
    logError('⚠️ Rule không hợp lệ!');
    return;
  }

  const settings = await getSettings();
  settings.betRule = rule;
  await saveSettings(settings);

  logSuccess('🧠 Đã lưu rule đặt cược!');
}
