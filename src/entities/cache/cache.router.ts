
import { Router } from 'express';
import * as controller from './cache.controller';

const router = Router();

router.post('/revalidate', controller.revalidateCache);
router.get('/revalidate', controller.getAllTags);
router.get('/stats', controller.getCacheStats);

export default router;
