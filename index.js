import {
  promptMainMenu,
  promptAccountMenu,
  promptUserAdd,
  promptUserUpdate,
  promptUserDelete,
  promptUserSelect,
} from './src/ui/prompt.js';

import {
  userAdd,
  userUpdate,
  userDelete,
  userSelect,
  userGetSelected,
} from './src/commands/user.js';
import { showBanner } from './src/ui/banner.js';

async function main() {
  while (true) {
    showBanner()
    const mainCmd = await promptMainMenu();

    if (mainCmd === 'exit') {
      console.log('👋 Thoát chương trình. Hẹn gặp lại!');
      process.exit(0);
    }

    if (mainCmd === 'account') {
      while (true) {
        const accountCmd = await promptAccountMenu();

        if (accountCmd === 'back') break;

        if (accountCmd === 'add') {
          const user = await promptUserAdd();
          await userAdd(user);
        } else if (accountCmd === 'update') {
          const user = await promptUserUpdate();
          await userUpdate(user);
        } else if (accountCmd === 'delete') {
          const { id } = await promptUserDelete();
          await userDelete(id);
        } else if (accountCmd === 'select') {
          const id = await promptUserSelect();
          await userSelect(id);
        } else if (accountCmd === 'current') {
          await userGetSelected();
        }
      }
    }

    // Các case cho các menu khác
    else if (mainCmd === 'check_wallet') {
      // gọi function kiểm tra tiền ví ở đây
      console.log('Kiểm tra tiền trong ví (demo)');
    } else if (mainCmd === 'get_token') {
      // gọi function lấy token
      console.log('Lấy token account (demo)');
    } else if (mainCmd === 'start_bet') {
      // gọi function bắt đầu cược
      console.log('Bắt đầu cược (demo)');
    }
    // ... thêm cho taixiu, baocua, alerts sau
  }
}

main().catch(err => {
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
