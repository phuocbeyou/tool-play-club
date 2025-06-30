import fs from 'fs/promises';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.resolve(__dirname, '../../users.json');
const settingsFile = path.resolve(__dirname, '../../settings.json');
const ruleFile = path.resolve(__dirname, '../../rule.json');

export async function readUsers() {
  try {
    const content = await fs.readFile(dataFile, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      await fs.writeFile(dataFile, '[]', 'utf-8');
      return [];
    }
    throw e;
  }
}

export async function writeUsers(users) {
  await fs.writeFile(dataFile, JSON.stringify(users, null, 2), 'utf-8');
}

// ✅ Đọc file settings (tạo mới nếu chưa tồn tại)
export async function getSettings() {
  try {
    const content = await fs.readFile(settingsFile, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Tạo file mới nếu chưa có
      await fs.writeFile(settingsFile, '{}', 'utf-8');
      return {};
    }
    throw e;
  }
}

// ✅ Ghi đè file settings
export async function saveSettings(settings) {
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

// đọc file rule (tạo mới nếu chưa tồn tại)
export async function readRule() {
  try {
    const content = await fs.readFile(ruleFile, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      await fs.writeFile(ruleFile, '[]', 'utf-8');
      return [];
    }
    throw e;
  }
}

// ghi đè rule
export async function writeRule(users) {
  await fs.writeFile(ruleFile, JSON.stringify(users, null, 2), 'utf-8');
}
