import fs from 'fs/promises';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.resolve(__dirname, '../config/account.json');
const settingsFile = path.resolve(__dirname, '../../settings.json');
const ruleFile = path.resolve(__dirname, '../config/even-odd.json');

export async function readUsers() {
  try {
    const content = await fs.readFile(dataFile, 'utf-8');
    const raw = JSON.parse(content);
    if (!Array.isArray(raw)) return [];
    return raw.map(arr => {
      if (!Array.isArray(arr) || arr.length < 5) return null;
      const infoObject = arr[4] || {};
      let infoDataPayload = null;
      try {
        const infoParsed = typeof infoObject.info === 'string' ? JSON.parse(infoObject.info) : infoObject.info;
        infoDataPayload = {
          info: infoParsed,
          signature: infoObject.signature
        };
      } catch (e) {
        infoDataPayload = {
          info: infoObject.info,
          signature: infoObject.signature
        };
      }
      return {
        id: arr[0],
        name: arr[2],
        password: arr[3],
        token: infoDataPayload.info?.refreshToken || '',
        signature: infoObject.signature,
        selected: infoObject.isActive || false,
        categoryGame: infoObject.categoryGame || 'even_odd',
        infoData: [
          arr[0],
          arr[1],
          arr[2],
          arr[3],
          infoDataPayload
        ]
      };
    }).filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') {
      await fs.writeFile(dataFile, '[]', 'utf-8');
      return [];
    }
    throw e;
  }
}

export async function writeUsers(users) {
  const raw = users.map(u => {
    const gameType = u.infoData && u.infoData[1] ? u.infoData[1] : "MiniGame";
    const infoStr = typeof u.infoData[4]?.info === 'object' ? JSON.stringify(u.infoData[4].info) : u.infoData[4]?.info;
    return [
      u.id,
      gameType,
      u.name,
      u.password,
      {
        info: infoStr,
        signature: u.signature,
        isActive: u.selected,
        categoryGame: u.categoryGame || (gameType === "MiniGame" ? "even_odd" : "shake_disk"),
        pid: 4,
        subi: true
      }
    ];
  });
  await fs.writeFile(dataFile, JSON.stringify(raw, null, 2), 'utf-8');
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
      await fs.writeFile(ruleFile, '{}', 'utf-8');
      return {};
    }
    throw e;
  }
}

// ghi đè rule
export async function writeRule(users) {
  await fs.writeFile(ruleFile, JSON.stringify(users, null, 2), 'utf-8');
}
