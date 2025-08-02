import inquirer from 'inquirer';

// Custom renderer để ẩn dòng chọn sau khi hoàn thành prompt
const suppressFinalAnswerRenderer = {
  render() {},
  close() {},
};

export async function promptMainMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'mainCmd',
      message: '📋 Chọn mục chính:',
      choices : [
        { name: '[🔑] Quản lý tài khoản', value: 'account' },
        { name: '[🎲] Thiết lập tài xỉu', value: 'even_odd' },
        { name: '[⭕] Thiết lập sóc đĩa', value: 'xoc_dia' },
        new inquirer.Separator(),
        { name: '[▶]  Bắt đầu cược xóc đĩa', value: 'start_bet_shake' },
        { name: '[■]  Dừng cược xóc đĩa', value: 'stop_bet_shake' },
        { name: '[▶]  Bắt đầu cược tài xỉu', value: 'start_bet' },
        { name: '[■]  Dừng cược tài xỉu', value: 'stop_bet' },
        new inquirer.Separator(),
        { name: '[X]  Thoát', value: 'exit' },
      ],      
      pageSize: 30,
    },
  ], { renderer: suppressFinalAnswerRenderer });

  return answers.mainCmd;
}
