import { Router, Request, Response } from "express";
import { wsRoutes } from "./entities";
import { verifyToken } from "./middlewares/tokenVerification";

const apiRouter = Router();
apiRouter.get("/test", (req: Request, res: Response) => {
    res.send("Hello World!");
})

// Rutas de WhatsApp
apiRouter.use('/ws', wsRoutes);

export default apiRouter