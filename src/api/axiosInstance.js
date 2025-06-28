import axios from 'axios';
import chalk from 'chalk';

export function createAxiosInstance({ baseURL, token, timeout = 10000 }) {
  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

  // Interceptor log lỗi với màu sắc
  instance.interceptors.response.use(
    response => response,
    error => {
      const status = error?.response?.status;
      const data = error?.response?.data;
      const url = error?.config?.url;

      console.error(chalk.red.bold('❌ Lỗi khi gọi API:'));
      if (status) console.error(chalk.red(`🔢 Status: ${status}`));
      if (url) console.error(chalk.red(`🌐 URL: ${url}`));
      if (data) console.error(chalk.red(`📦 Response: ${JSON.stringify(data, null, 2)}`));
      else console.error(chalk.red(`📄 Message: ${error.message}`));

      return Promise.reject(error);
    }
  );

  return instance;
}
