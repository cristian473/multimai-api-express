import axios, { AxiosInstance } from "axios";

// WS PROXY API client configuration
export const wsProxyClient: AxiosInstance = axios.create({
  baseURL: process.env.WS_PROXY_BASE_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.WS_PROXY_AUTH_TOKEN}`,
  },
});