import { Router, Request, Response } from "express";
import { wsRoutes, remindersRoutes, cacheRoutes } from "./entities";
import { verifyToken } from "./middlewares/tokenVerification";
import cronRouter from "./routes/cron";

const apiRouter = Router();
apiRouter.get("/test", (req: Request, res: Response) => {
    res.send("Hello World!");
})

// Rutas de WhatsApp
apiRouter.use('/ws', wsRoutes);

// Rutas de Reminders
apiRouter.use('/reminders', remindersRoutes);

// Rutas de Cache
apiRouter.use('/cache', cacheRoutes);

// Rutas de Cron (para ejecución manual)
apiRouter.use('/cron', cronRouter);

export default apiRouter