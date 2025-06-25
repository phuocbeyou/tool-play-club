import chalk from 'chalk';

export function logSuccess(text) {
  console.log(chalk.green(text));
}

export function logError(text) {
  console.log(chalk.red(text));
}

export function logInfo(text) {
  console.log(chalk.blue(text));
}
