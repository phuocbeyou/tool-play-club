import inquirer from 'inquirer';
import chalk from 'chalk';

export async function promptEvenOddMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('🎲 Thiết lập & Thống kê Tài Xỉu:'),
      choices: [
        { name: '⚙️  Mở cấu hình (Web UI)', value: 'open_settings' },
        { name: '📊  Xem thống kê & báo cáo (Web UI)', value: 'open_stats' },
        new inquirer.Separator(),
        { name: '🔙  Quay lại menu chính', value: 'back' },
      ],
      pageSize: 10,
    }
  ]);
  return answers.action;
}
