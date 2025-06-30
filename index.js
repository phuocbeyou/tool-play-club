import {
  promptMainMenu,
} from './src/ui/prompt.js';

import {
  userUpdate,
  userDelete,
  userSelect,
  userGetSelected,
  tokenAdd,
} from './src/commands/user.js';
import { showBanner } from './src/ui/banner.js';
import { promptAccountMenu,promptUserAdd,
  promptUserUpdate,
  promptUserDelete,
  promptUserSelect, } from './src/ui/promptUser.js';
import { promptEvenOddMenu, promptSetBetStop, promptSetJackpot, promptUpdateBetAmount } from './src/ui/promtEvenOdd.js';
import { startGame, stopGame } from './src/socket/index.js';

async function main() {
  showBanner()
  while (true) {
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
          const userData = user.metaData
          await tokenAdd(userData);
        } else if (accountCmd === 'update') {
          const user = await promptUserUpdate();
          await userUpdate(user.metaData);
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

    else if (mainCmd === 'even_odd') {
      while (true) {
        const action = await promptEvenOddMenu();
    
        if (action === 'back') break;
    
        if (action === 'set_jackpot') {
          await promptSetJackpot();
        }
    
        else if (action === 'set_bet_stop') {
          await promptSetBetStop()
        }

        else if (action === 'update_bet_amount') {
          await promptUpdateBetAmount()
        }
      }
    }
    else if (mainCmd === 'start_bet') {
      startGame()
    }
    else if (mainCmd === 'stop_bet') {
      stopGame()
    }
  }
}

main().catch(err => {
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
