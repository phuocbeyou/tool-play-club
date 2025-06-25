import inquirer from 'inquirer';
import chalk from 'chalk';
import { readUsers } from '../logic/dataManager.js';

// Custom renderer to suppress final answer output
const suppressFinalAnswerRenderer = {
  render() {
    // do nothing, không hiển thị gì khi chọn xong
  },
  close() {},
  // các method còn lại có thể là no-op
};

export async function promptMainMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'mainCmd',
      message: '📋 Chọn mục chính:',
      choices: [
        { name: '👤 Quản lý tài khoản', value: 'account' },
        { name: '🎰 Thiết lập tài xỉu', value: 'taixiu' },
        { name: '🦀 Thiết lập bầu cua', value: 'baocua' },
        { name: '💰 Kiểm tra tiền trong ví', value: 'check_wallet' },
        { name: '⚠️ Thiết lập cảnh báo', value: 'alerts' },
        { name: '🔑 Lấy token account', value: 'get_token' },
        { name: '🚀 Bắt đầu cược', value: 'start_bet' },
        new inquirer.Separator(),
        { name: '❌ Thoát', value: 'exit' },
      ],
      pageSize: 12,
    },
  ], { 
    renderer: suppressFinalAnswerRenderer // ẩn line chọn sau khi hoàn thành prompt
  });
  return answers.mainCmd;
}

export async function promptAccountMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'accountCmd',
      message: chalk.yellowBright('👤 Quản lý tài khoản - chọn lệnh:'),
      choices: [
        { name: '➕ Thêm user', value: 'add' },
        { name: '📝 Cập nhật user', value: 'update' },
        { name: '🗑️ Xoá user', value: 'delete' },
        { name: '🎯 Chọn user sử dụng', value: 'select' },
        { name: '👁️ Xem user đang sử dụng', value: 'current' },
        new inquirer.Separator(),
        { name: '🔙 Quay lại menu chính', value: 'back' },
      ],
      pageSize: 10,
    },
  ]);
  return answers.accountCmd;
}

// Các prompt nhập liệu cho user (bạn giữ nguyên như trước)
export async function promptUserAdd() {
  return await inquirer.prompt([
    {
      name: 'name',
      message: chalk.yellow('👤 Tên user: '),
      type: 'input',
      validate: v => !!v || '⚠️ Không được để trống',
      filter: v => v.trim(),
    },
    {
      name: 'email',
      message: chalk.yellow('📧 Email: '),
      type: 'input',
      validate: v => !!v || '⚠️ Không được để trống',
      filter: v => v.trim(),
    },
  ]);
}

export async function promptUserUpdate() {
  return await inquirer.prompt([
    {
      name: 'id',
      message: chalk.yellow('🆔 ID user cần cập nhật: '),
      type: 'input',
      validate: v => {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) return '⚠️ Phải nhập số nguyên lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    },
    {
      name: 'name',
      message: chalk.yellow('👤 Tên mới (nhấn Enter để giữ nguyên): '),
      type: 'input',
      filter: v => v.trim(),
    },
    {
      name: 'email',
      message: chalk.yellow('📧 Email mới (nhấn Enter để giữ nguyên): '),
      type: 'input',
      filter: v => v.trim(),
    },
  ]);
}

export async function promptUserDelete() {
  return await inquirer.prompt([
    {
      name: 'id',
      message: chalk.yellow('🗑️ Nhập ID user cần xoá: '),
      type: 'input',
      validate: v => {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) return '⚠️ Phải là số nguyên lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    },
  ]);
}

export async function promptUserSelect() {
  const users = await readUsers();

  if (users.length === 0) {
    console.log(chalk.red('⚠️ Hiện không có user nào để chọn.'));
    return null;
  }

  const choices = users.map(u => ({
    name: `${u.id}. ${u.name} (${u.email})${u.selected ? ' 🟢 [Đang chọn]' : ''}`,
    value: u.id,
  }));

  const { id } = await inquirer.prompt([
    {
      type: 'list',
      name: 'id',
      message: chalk.yellow('🎯 Chọn user muốn sử dụng:'),
      choices,
      pageSize: 10,
    },
  ]);

  return id;
}