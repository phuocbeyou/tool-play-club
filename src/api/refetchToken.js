import { domain_2 } from '../configs/baseUrl.js';
import { createAxiosInstance } from './axiosInstance.js';
import chalk from 'chalk';

/**
 * Gọi API https://api.mangee.io/id?command=refreshToken&refreshToken=... để refresh token
 * @param {string} token - Token để truyền vào header `authorization`
 * @param {string} refreshToken - Token dùng để làm mới (truyền lên query string)
 */
export async function callRefreshToken(refreshToken) {
  const instance = createAxiosInstance({
    baseURL: domain_2,
    timeout: 10000,
  });

  try {
    const response = await instance.get('/id', {
      params: {
        command: 'refreshToken',
        refreshToken: refreshToken,
      },
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.8',
        'cache-control': 'no-cache',
        'origin': 'https://play.man.club',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://play.man.club/',
        'sec-ch-ua': '"Brave";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'sec-gpc': '1',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      },
    });

    const data = response.data;

    if (data?.status === 1) {
      console.log(chalk.red('❗ Lỗi refresh token:'), data?.data?.message);
      return null;
    }

    console.log(chalk.green('✅ Refresh thành công:'), data);
    return data;
  } catch (error) {
    console.error(chalk.red('❗ Lỗi khi gọi refresh token API.'));
    throw error;
  }
}
