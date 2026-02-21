import { createHttpClient } from '../../core/http.js';
import { BINANCE_BASE_URL } from './endpoints.js';

export const createBinanceClient = () => createHttpClient(BINANCE_BASE_URL, 10000);
