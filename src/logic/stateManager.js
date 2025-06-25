import fs from 'fs/promises';
import path from 'path';

const SELECTED_FILE = path.resolve('data', 'selected.json');

export async function saveSelectedUserId(id) {
  const data = { selectedUserId: id };
  await fs.mkdir(path.dirname(SELECTED_FILE), { recursive: true });
  await fs.writeFile(SELECTED_FILE, JSON.stringify(data, null, 2));
}

export async function getSelectedUserId() {
  try {
    const raw = await fs.readFile(SELECTED_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data.selectedUserId;
  } catch (err) {
    return null;
  }
}
