import { readUsers, writeUsers } from '../logic/dataManager.js';
import { logSuccess, logError, logInfo } from '../ui/display.js';

// Thêm user
export async function userAdd({ name, email }) {
  if (!name || !email) {
    logError('Name và email là bắt buộc!');
    return;
  }

  const users = await readUsers();

  if (users.find(u => u.email === email)) {
    logError('Email đã tồn tại, không thể thêm!');
    return;
  }

  const newUser = {
    id: users.length > 0 ? users[users.length - 1].id + 1 : 1,
    name,
    email,
    selected: false,
  };

  users.push(newUser);
  await writeUsers(users);
  logSuccess(`✅ Thêm user thành công: ${name} (${email})`);
}

// Xoá user theo ID
export async function userDelete(id) {
  const users = await readUsers();
  const index = users.findIndex(u => u.id === id);

  if (index === -1) {
    logError(`Không tìm thấy user với ID ${id}`);
    return;
  }

  const removed = users.splice(index, 1)[0];
  await writeUsers(users);

  logSuccess(`🗑️ Đã xoá user: ${removed.name} (${removed.email})`);
}

// Chọn user để sử dụng
export async function userSelect(id) {
  const users = await readUsers();
  const target = users.find(u => u.id === id);

  if (!target) {
    logError(`Không tìm thấy user với ID ${id}`);
    return;
  }

  // Bỏ selected ở các user khác
  users.forEach(u => { u.selected = false });
  target.selected = true;

  await writeUsers(users);
  logSuccess(`👉 Đã chọn user: ${target.name} (${target.email})`);
}

// Hiển thị user đang được chọn
export async function userGetSelected() {
  const users = await readUsers();
  const selected = users.find(u => u.selected);

  if (!selected) {
    logInfo('⚠️ Chưa có user nào được chọn.');
  } else {
    logInfo(`🟢 User đang được chọn: ${selected.name} (${selected.email})`);
  }
}

// Cập nhật thông tin user theo ID
export async function userUpdate({ id, name, email }) {
  if (!id) {
    logError('ID user là bắt buộc để cập nhật!');
    return;
  }

  const users = await readUsers();
  const user = users.find(u => u.id === id);

  if (!user) {
    logError(`Không tìm thấy user với ID ${id}`);
    return;
  }

  // Kiểm tra email mới có trùng với email của user khác không (nếu có cập nhật)
  if (email && users.some(u => u.email === email && u.id !== id)) {
    logError('Email mới đã tồn tại, không thể cập nhật!');
    return;
  }

  if (name) user.name = name;
  if (email) user.email = email;

  await writeUsers(users);
  logSuccess(`✏️ Cập nhật user thành công: ${user.name} (${user.email})`);
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
      console.log(`  - ID: ${u.id}, Tên: ${u.name}, Email: ${u.email}${selectedMark}`);
    });
  }

  return users;
}

