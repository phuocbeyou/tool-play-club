import { readUsers, writeUsers } from '../logic/dataManager.js';
import { logSuccess, logError, logInfo } from '../ui/display.js';
import { parseAndValidate } from '../utils/validateJson.js';
import inquirer from 'inquirer';

// add token
export async function tokenAdd(metaData) {

  if(!metaData){
    return  logError('Không được để trống');
  }
  try {
   
  const dataUser = parseAndValidate(metaData)

  const name = dataUser[2]
  const password = dataUser[3]
  const token = dataUser[4]?.info?.refreshToken
  const signature = dataUser[4]?.signature

  const users = await readUsers();

  if (users.find(u => u.name === name)) {
    logError('Tên đã tồn tại, không thể thêm!');
    return;
  }

  const newUser = {
    id: users.length > 0 ? users[users.length - 1].id + 1 : 1,
    name,
    password,
    token,
    signature,
    selected: false,
    infoData:dataUser
  };

  users.push(newUser);
  await writeUsers(users);
  logSuccess(`✅ Thêm user thành công: ${name}`); 
  } catch (error) {
    logError(`xin kiểm tra lại: ${error}`); 
  }
}

// Xoá user theo ID
export async function userDelete() {
  const users = await readUsers();

  if (users.length === 0) {
    logError("⚠️ Không có user nào để xoá.");
    return;
  }

  const { userId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'userId',
      message: '🗑️ Chọn user muốn xoá:',
      choices: users.map(u => ({
        name: `${u.name} (${u.id})${u.selected ? " ✅ đang chọn" : ""}`,
        value: u.id
      }))
    }
  ]);

  const index = users.findIndex(u => u.id === userId);

  if (index === -1) {
    logError(`Không tìm thấy user với ID ${userId}`);
    return;
  }

  const removed = users.splice(index, 1)[0];
  await writeUsers(users);

  logSuccess(`🗑️ Đã xoá user: ${removed.name}`);
}

// Chọn user để sử dụng
export async function userSelect(id) {
  const users = await readUsers();
  const target = users.find(u => u.id === id);

  if (!target) {
    logError(`Không tìm thấy user với ID ${id}`);
    return;
  }

  users.forEach(u => { u.selected = false });
  target.selected = true;

  await writeUsers(users);
  logSuccess(`👉 Đã chọn user: ${target.name}`);
}

// Hiển thị user đang được chọn
export async function userGetSelected() {
  const users = await readUsers();
  const selected = users.find(u => u.selected);

  if (!selected) {
    logInfo('⚠️ Chưa có user nào được chọn.');
  } else {
    logInfo(`🟢 User đang được chọn: ${selected.name}`);
  }
}

// Cập nhật thông tin user theo ID
export async function userUpdate(metaData) {
  if (!metaData) {
    return logError('⚠️ Không được để trống');
  }

  try {
    const dataUser = parseAndValidate(metaData);

    const name = dataUser[2]; // dùng cho cập nhật nếu cần đổi tên
    const password = dataUser[3];
    const token = dataUser[4]?.info?.refreshToken;
    const signature = dataUser[4]?.signature;
    const username = dataUser[4]?.info?.username;

    if (!username) {
      return logError('❌ Không tìm thấy username trong dữ liệu!');
    }

    const users = await readUsers();
    const user = users.find(u => u.name === username);

    if (!user) {
      return logError(`❌ Không tìm thấy user với username: ${username}`);
    }

    // Kiểm tra nếu muốn đổi tên
    if (name && name !== user.name && users.some(u => u.name === name && u.id !== user.id)) {
      return logError('⚠️ Tên mới đã tồn tại, không thể cập nhật!');
    }

    // Cập nhật user
    if (name) user.name = name;
    if (password) user.password = password;
    if (token) user.token = token;
    if (signature) user.signature = signature;
    user.infoData = dataUser;

    await writeUsers(users);
    logSuccess(`✏️ Đã cập nhật user thành công: ${user.name}`);
  } catch (error) {
    logError(`❌ Lỗi khi cập nhật: ${error.message}`);
  }
}

// Lấy danh sách user (trả về mảng user)
export async function userGetList() {
  const users = await readUsers();

  if (users.length === 0) {
    logInfo('📭 Danh sách user hiện đang trống.');
  } else {
    logInfo('📋 Danh sách user:');
    users.forEach(u => {
      const selectedMark = u.selected ? ' (Đang chọn)' : '';
      console.log(`  - ID: ${u.id}, Tên: ${u.name}, Token: ${u.token}${selectedMark}`);
    });
  }

  return users;
}
