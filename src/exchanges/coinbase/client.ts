import type { AxiosInstance } from 'axios';
import { createHttpClient } from '../../core/http.js';
import { COINBASE_BASE_URL } from './endpoints.js';

export const createCoinbaseClient = (): AxiosInstance => {
  return createHttpClient(COINBASE_BASE_URL, 10000);
};
