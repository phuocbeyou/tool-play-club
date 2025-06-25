import fs from 'fs/promises';
import path from 'path';

const dataFile = path.resolve(process.cwd(), 'users.json');

export async function readUsers() {
  try {
    const content = await fs.readFile(dataFile, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // file chưa tồn tại, tạo mới file với mảng rỗng
      await fs.writeFile(dataFile, '[]', 'utf-8');
      return [];
    }
    throw e;
  }
}

export async function writeUsers(users) {
  await fs.writeFile(dataFile, JSON.stringify(users, null, 2), 'utf-8');
}
