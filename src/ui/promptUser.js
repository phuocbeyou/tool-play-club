import inquirer from 'inquirer';
import chalk from 'chalk';
import { readUsers } from '../logic/dataManager.js';

// Menu quản lý tài khoản
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
  
  // Prompt thêm user
  export async function promptUserAdd() {
    return await inquirer.prompt([
      {
        name: 'metaData',
        message: chalk.yellow('👤 Nhập meta data: '),
        type: 'input',
        validate: v => !!v || '⚠️ Không được để trống',
        filter: v => v.trim(),
      },
    ]);
  }
  
  // Prompt cập nhật user
  export async function promptUserUpdate() {
    return await inquirer.prompt([
      {
        name: 'metaData',
        message: chalk.yellow('📝 Nhập chuỗi JSON metaData để cập nhật user:'),
        type: 'input',
        validate: v => !!v || '⚠️ Không được để trống',
        filter: v => v.trim(),
      }
    ]);
  }
  
  // Prompt xoá user
  export async function promptUserDelete() {
    const users = await readUsers();

  if (!users.length) {
    console.log(chalk.red('⚠️ Không có user nào để xoá.'));
    return { id: null };
  }

  const { id } = await inquirer.prompt([
    {
      name: 'id',
      message: chalk.yellow('🗑️ Chọn user cần xoá:'),
      type: 'list',
      choices: users.map((u) => ({
        name: `${u.name} (${u.id})${u.selected ? ' ✅ đang chọn' : ''}`,
        value: u.id,
      })),
    },
  ]);

  return id ;
  }
  
  // Prompt chọn user
  export async function promptUserSelect() {
    const users = await readUsers();
  
    if (users.length === 0) {
      console.log(chalk.red('⚠️ Hiện không có user nào để chọn.'));
      return null;
    }
  
    const choices = users.map(u => ({
      name: `${u.id}. ${u.name} (Token: ${u.token})${u.selected ? ' 🟢 [Đang chọn]' : ''}`,
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
  