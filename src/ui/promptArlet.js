import inquirer from 'inquirer';
import chalk from 'chalk';

export async function promptArletMenu() {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'arletCmd',
        message: chalk.cyan('⚠️ Chọn loại cảnh báo muốn thiết lập:'),
        choices: [
            { name: '💰 Cảnh báo tiền trong ví', value: 'wallet' },
            new inquirer.Separator(),
          { name: '🔙 Quay lại menu chính', value: 'back' },
          ],
        pageSize: 10,
      },
    ]);
    return answers.arletCmd;
  }

  export async function promptSetWalletAlert() {
    const answers = await inquirer.prompt([
      {
        name: 'threshold',
        type: 'input',
        message: chalk.yellow('⚠️ Nhập ngưỡng tiền trong ví (khi thấp hơn hoặc bằng sẽ cảnh báo):'),
        validate: v => {
          if (v.trim() === '') return '⚠️ Không được để trống';
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) return '⚠️ Vui lòng nhập số không âm hợp lệ';
          return true;
        },
        filter: v => Number(v),
      },
      {
        name: 'interval',
        type: 'input',
        message: chalk.yellow('⏰ Nhập khoảng thời gian gửi cảnh báo (phút, tối thiểu 1 phút):'),
        validate: v => {
          if (v.trim() === '') return '⚠️ Không được để trống';
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1) return '⚠️ Vui lòng nhập số nguyên ≥ 1';
          return true;
        },
        filter: v => Number(v),
      }
    ]);
  
    return answers;
  }