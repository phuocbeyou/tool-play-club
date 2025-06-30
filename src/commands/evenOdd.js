import { readRule,writeRule } from '../logic/dataManager.js';

// Cập nhật giá trị trong gameSettings (VD: BET_AMOUNT, BET_STOP)
export async function updateGameSetting(key, value) {
  const config = await readRule();
  if (!config.gameSettings) config.gameSettings = {};
  config.gameSettings[key] = value;
  await writeRule(config);
}

// Cập nhật betAmount của rule theo ID
export async function updateBetAmountByRuleId(ruleId, newAmount) {
  const config = await readRule();
  const rule = config.bettingRules.find(r => r.id === ruleId);
  if (!rule) {
    throw new Error(`❌ Không tìm thấy rule với id: ${ruleId}`);
  }
  rule.betAmount = newAmount;
  await writeRule(config);
}