
import { Request, Response } from 'express';
import HttpStatusCodes from '../../constants/HttpStatusCodes';
import remindersService from './reminders.service';
import { RouteError } from '@/other/errorHandler';

export async function processTodayReminders(req: Request, res: Response) {
  try {
    const uid = req.headers['uid'] as string;
    
    if (!uid) {
      throw new RouteError(HttpStatusCodes.BAD_REQUEST, 'UID header is required');
    }

    const result = await remindersService.processTodayReminders(uid);

    res.status(HttpStatusCodes.OK).json(result);
  } catch (error: any) {
    console.error('Error processing reminders:', error);
    if (error instanceof RouteError) {
      throw error;
    }
    throw new RouteError(HttpStatusCodes.INTERNAL_SERVER_ERROR, error.message || 'Internal server error while processing reminders');
  }
}
