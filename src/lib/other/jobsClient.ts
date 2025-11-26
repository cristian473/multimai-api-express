import axios, { AxiosInstance } from "axios";

// Jobs microservice client configuration
export const jobsClient: AxiosInstance = axios.create({
  baseURL: process.env.JOBS_SERVICE_BASE_URL || 'http://localhost:4000',
  headers: {
    'Content-Type': 'application/json',
  },
});
