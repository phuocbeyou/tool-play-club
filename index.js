import {
  promptMainMenu,
} from './src/ui/prompt.js';
import { showBanner } from './src/ui/banner.js';
import { promptEvenOddMenu } from './src/ui/promtEvenOdd.js';
import { startGame, stopGame } from './src/socket/index.js';
import { startServer } from './server.js';
import { openHtml } from './src/utils/htmlHelper.js';

async function main() {
  showBanner()

  // Khởi động API Server (cổng 3001 cho tool-play-club; xem server.js)
  await startServer();

  // Handle command-line arguments for non-interactive mode (PM2)
  const args = process.argv.slice(2);
  
  if (args.includes('--api-only')) {
    console.log('🚀 Chế độ API Server Only.');
    return;
  }

  const gameArg = args.find(arg => arg.startsWith('--game='));
  const gameType = gameArg ? gameArg.split('=')[1] : args[0];

  if (gameType) {
    console.log(`🚀 Khởi động bot ở chế độ tự động cho game: ${gameType}`);

    if (gameType === 'even_odd' || gameType === 'even-odd') {
      await startGame();
    } else {
      console.log(`⚠️ Không tìm thấy game: ${gameType}`);
      process.exit(1);
    }
    
    console.log("🟢 Bot đang chạy... (Nhấn Ctrl+C để dừng)");
    return;
  }

  while (true) {
    const mainCmd = await promptMainMenu();

    if (mainCmd === 'exit') {
      console.log('👋 Thoát chương trình. Hẹn gặp lại!');
      process.exit(0);
    }

    if (mainCmd === 'account') {
      openHtml('account-manager.html');
    }

    else if (mainCmd === 'even_odd') {
      while (true) {
        const action = await promptEvenOddMenu();
    
        if (action === 'back') break;
    
        if (action === 'open_settings') {
          openHtml('even-odd-settings.html');
        }
    
        else if (action === 'open_stats') {
          openHtml('even-odd-stats.html');
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
  if (err.name === 'ExitPromptError') {
    console.log('\n👋 Thoát chương trình. Hẹn gặp lại!');
    process.exit(0);
  }
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
