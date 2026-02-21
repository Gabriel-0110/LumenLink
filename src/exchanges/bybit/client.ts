import { createHttpClient } from '../../core/http.js';
import { BYBIT_BASE_URL } from './endpoints.js';

export const createBybitClient = () => createHttpClient(BYBIT_BASE_URL, 10000);
