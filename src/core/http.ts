import axios, { type AxiosInstance } from 'axios';
import { withRetry } from './retry.js';

export const createHttpClient = (baseURL: string, timeoutMs = 10000): AxiosInstance => {
  return axios.create({
    baseURL,
    timeout: timeoutMs
  });
};

export const getJson = async <T>(client: AxiosInstance, path: string, headers?: Record<string, string>): Promise<T> => {
  const res = await withRetry(() => client.get<T>(path, { headers }));
  return res.data;
};

export const postJson = async <TReq, TRes>(
  client: AxiosInstance,
  path: string,
  body: TReq,
  headers?: Record<string, string>
): Promise<TRes> => {
  const res = await withRetry(() => client.post<TRes>(path, body, { headers }));
  return res.data;
};
