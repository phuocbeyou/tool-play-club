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
import { promptEvenOddMenu, promptSetBetCombos, promptSetBetRule, promptSetJackpot } from './src/ui/promtEvenOdd.js';
import { setBetCombos, setBetRule, setJackpotTargetValue } from './src/commands/evenOdd.js';
import { promptArletMenu, promptSetWalletAlert } from './src/ui/promptArlet.js';
import { setWalletAlertConfig } from './src/commands/arlet.js';
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
          const jackpot = await promptSetJackpot();
          await setJackpotTargetValue(jackpot);
        }
        else if (action === 'set_combos') {
          const combos = await promptSetBetCombos();
          await setBetCombos(combos);
        }
        else if (action === 'set_rule') {
          const rule = await promptSetBetRule();
          await setBetRule(rule);
        }
      }
    } else if (mainCmd === 'alerts') {
      while (true) {
        const action = await promptArletMenu();
    
        if (action === 'back') break;
    
        if (action === 'wallet') {
          console.log('ping 82')
          const config = await promptSetWalletAlert();
          await setWalletAlertConfig(config);
        }
      }
    } else if (mainCmd === 'start_bet') {
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
