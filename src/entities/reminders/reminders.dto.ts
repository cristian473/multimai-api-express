
export interface ProcessTodayRemindersRequest {
  // No body parameters required, but UID is expected in headers
}

export interface ReminderData {
  id: string;
  userId: string;
  toRemember: string;
  status?: string;
  eventDateTime: any; // Firestore Timestamp
  customer?: {
    name: string;
    phone: string;
  };
  [key: string]: any;
}

export interface QueuedJob {
  reminderId: string;
  jobId: string;
  customerPhone?: string;
  customerName?: string;
  toRemember?: string;
}

export interface ProcessTodayRemindersResponse {
  success: boolean;
  message: string;
  remindersProcessed: number;
  totalReminders?: number;
  queuedJobs?: QueuedJob[];
  errors?: any[];
}
