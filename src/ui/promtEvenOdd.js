import inquirer from 'inquirer';
import chalk from 'chalk';

export async function promptEvenOddMenu() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: chalk.cyan('🎲 Chọn thiết lập cược even/odd:'),
      choices: [
        { name: '🎯 Thiết lập jackpot target', value: 'set_jackpot' },
        { name: '💰 Thiết lập combo tiền cược', value: 'set_combos' },
        { name: '🧩 Thiết lập rule cược', value: 'set_rule' },
        new inquirer.Separator(),
        { name: '🔙 Quay lại menu chính', value: 'back' },
      ],
      pageSize: 10,
    }
  ]);
  return answers.action;
}


// Prompt nhập số jackpot target
export async function promptSetJackpot() {
  const { jackpot } = await inquirer.prompt([
    {
      name: 'jackpot',
      type: 'input',
      message: chalk.yellow('🎯 Nhập giá trị jackpot (số dương):'),
      validate: v => {
        if (v.trim() === '') return '⚠️ Vui lòng nhập giá trị';
        const n = Number(v);
        if (isNaN(n) || n <= 0) return '⚠️ Vui lòng nhập số dương lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    }
  ]);
  return jackpot;
}

// Prompt nhập một combo cược (threshold và amount)
async function promptOneCombo() {
  const combo = await inquirer.prompt([
    {
      name: 'threshold',
      type: 'input',
      message: chalk.yellow('⏳ Nhập ngưỡng jackpot (threshold):'),
      validate: v => {
        const n = Number(v);
        if (isNaN(n) || n < 0) return '⚠️ Phải là số không âm';
        return true;
      },
      filter: v => Number(v),
    },
    {
      name: 'amount',
      type: 'input',
      message: chalk.yellow('💰 Nhập số tiền cược tương ứng:'),
      validate: v => {
        const n = Number(v);
        if (isNaN(n) || n <= 0) return '⚠️ Phải là số lớn hơn 0';
        return true;
      },
      filter: v => Number(v),
    }
  ]);
  return combo;
}

// Prompt nhập danh sách combo cược (lặp cho đến khi user chọn kết thúc)
export async function promptSetBetCombos() {
  const combos = [];

  console.log(chalk.green('💰 Nhập combo tiền cược theo ngưỡng jackpot. Nhập xong chọn "Hoàn thành".'));

  while (true) {
    const combo = await promptOneCombo();
    combos.push(combo);

    const { next } = await inquirer.prompt([
      {
        type: 'list',
        name: 'next',
        message: chalk.blue('Bạn có muốn nhập thêm combo nữa không?'),
        choices: [
          { name: '➕ Tiếp tục nhập', value: 'continue' },
          { name: '✅ Hoàn thành', value: 'done' },
        ],
      }
    ]);

    if (next === 'done') break;
  }

  return combos;
}

// Prompt nhập rule cược
export async function promptSetBetRule() {
  const answers = await inquirer.prompt([
    {
      name: 'pattern',
      type: 'input',
      message: chalk.yellow('🧩 Nhập pattern (ví dụ: "xiu,xiu" hoặc "tai,tai"):'),
      validate: v => {
        if (!v || !v.includes(',')) return '⚠️ Vui lòng nhập ít nhất 2 giá trị, phân cách dấu phẩy';
        return true;
      },
      filter: v => v.split(',').map(s => s.trim()).filter(Boolean),
    },
    {
      name: 'result',
      type: 'input',
      message: chalk.yellow('🧩 Nhập kết quả cược tiếp theo (ví dụ: "tai" hoặc "xiu"):'),
      validate: v => !!v || '⚠️ Không được để trống',
      filter: v => v.trim(),
    },
  ]);

  return answers;
}
