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
      choices: [
        { name: '🔐 Quản lý tài khoản', value: 'account' },
        { name: '🎲 Thiết lập tài xỉu', value: 'even_odd' },
        { name: '🀄 Thiết lập bầu cua', value: 'baocua' },
        { name: '▶️ Bắt đầu cược', value: 'start_bet' },
        { name: '⏹ Dừng cược', value: 'stop_bet' },
        new inquirer.Separator(),
        { name: '✖️ Thoát', value: 'exit' },
      ],
      pageSize: 30,
    },
  ], { renderer: suppressFinalAnswerRenderer });

  return answers.mainCmd;
}
