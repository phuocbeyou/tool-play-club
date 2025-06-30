import inquirer from 'inquirer';
import chalk from 'chalk';
import { updateGameSetting, updateBetAmountByRuleId } from '../commands/evenOdd.js';
import { readRule } from '../logic/dataManager.js';

export async function promptEvenOddMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('🎲 Chọn thiết lập cược even/odd:'),
      choices: [
        { name: '🎯 Thiết lập jackpot target', value: 'set_jackpot' },
        { name: '⛔ Thiết lập bet stop', value: 'set_bet_stop' },
        { name: '🔧 Cập nhật số tiền cược theo rule', value: 'update_bet_amount' },
        new inquirer.Separator(),
        { name: '🔙 Quay lại menu chính', value: 'back' },
      ],
      pageSize: 10,
    }
  ]);
  return answers.action;
}

export async function promptSetJackpot() {
  const { jackpot } = await inquirer.prompt([
    {
      name: 'jackpot',
      type: 'input',
      message: chalk.yellow('🎯 Nhập giá trị jackpot (số dương):'),
      validate: v => {
        if (v.trim() === '') return '⚠️ Vui lòng nhập giá trị';
        const n = Number(v);
        if (isNaN(n) || n <= 0) return '⚠️ Vui lòng nhập số dương lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    }
  ]);
  await updateGameSetting('JACKPOT_THRESHOLD', jackpot);
  console.log(chalk.green(`✅ Đã cập nhật JACKPOT_THRESHOLD thành ${jackpot.toLocaleString('vi-VN')} VND.`));
}

export async function promptSetBetStop() {
  const { betStop } = await inquirer.prompt([
    {
      name: 'betStop',
      type: 'input',
      message: chalk.yellow('🎯 Nhập giá trị bet stop (số dương):'),
      validate: v => {
        if (v.trim() === '') return '⚠️ Vui lòng nhập giá trị';
        const n = Number(v);
        if (isNaN(n) || n <= 0) return '⚠️ Vui lòng nhập số dương lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    }
  ]);
  await updateGameSetting('BET_STOP', betStop);
  console.log(chalk.green(`✅ Đã cập nhật BET_STOP thành ${betStop.toLocaleString('vi-VN')} VND.`));
}

export async function promptUpdateBetAmount() {
  const config = await readRule();
  const choices = config.bettingRules.map(rule => ({
    name: `${rule.name} - hiện tại: ${rule.betAmount.toLocaleString('vi-VN')} VND`,
    value: rule.id
  }));

  const { selectedRuleId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedRuleId',
      message: chalk.magenta('📋 Chọn rule để cập nhật số tiền cược:'),
      choices,
    }
  ]);

  const { newAmount } = await inquirer.prompt([
    {
      type: 'input',
      name: 'newAmount',
      message: chalk.yellow('💰 Nhập số tiền cược mới:'),
      validate: v => {
        const n = Number(v);
        if (isNaN(n) || n <= 0) return '⚠️ Nhập số dương hợp lệ';
        return true;
      },
      filter: v => Number(v),
    }
  ]);

  await updateBetAmountByRuleId(selectedRuleId, newAmount);
  console.log(chalk.green(`✅ Đã cập nhật thành công số tiền cược cho rule.`));
}
