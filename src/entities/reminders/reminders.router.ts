
import { Router } from 'express';
import * as controller from './reminders.controller';

const router = Router();

router.post('/process-today', controller.processTodayReminders);

export default router;
