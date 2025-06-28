import { createAxiosInstance } from './axiosInstance.js';
import chalk from 'chalk';
import { domain } from '../configs/baseUrl.js';

/**
 * Gọi API https://api.atpman.net/id với token và body truyền vào
 * @param {string} token - Token cần truyền vào header Authorization
 * @param {object} body - Dữ liệu body gửi lên (ví dụ: { command: ..., token: ..., agency: ... })
 */
export async function callAgencyLogin(token, body) {
  const instance = createAxiosInstance({
    baseURL: domain,
    timeout: 10000,
  });

  try {
    const response = await instance.post('/id', body, {
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.8',
        'cache-control': 'no-cache',
        'content-type': 'application/json; charset=UTF-8',
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
        'authorization': token,
      },
    });

    const status = response?.data?.status
    if(status === 1){
        console.log(chalk.red('❗ Lỗi:'), response.data?.data?.message);
        return null
    }
        return response.data;
  } catch (error) {
    console.error(chalk.red('❗ Gọi API thất bại.'));
    throw error;
  }
}