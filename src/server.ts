/**
 * Setup express server.
 */

import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import express, { Request, Response, NextFunction } from 'express';
import logger from 'jet-logger';
const bodyParser = require('body-parser')

import 'express-async-errors';

import HttpStatusCodes from './constants/HttpStatusCodes';

import EnvVars from './constants/EnvVars';
import { NodeEnvs } from './constants/misc';
import { RouteError } from './other/errorHandler';
import apiRouter from './router';
// import { serverAdapter as queueDashboard } from './queues/dashboard';

// **** Variables **** //

const app = express();

// **** Setup **** //

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookieParser(EnvVars.CookieProps.Secret));
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())
app.use(cors());

// Show routes called in console during development
if (EnvVars.NodeEnv === NodeEnvs.Dev.valueOf()) {
  app.use(morgan('dev'));
}

// Security
if (EnvVars.NodeEnv === NodeEnvs.Production.valueOf()) {
  app.use(helmet());
}

app.get('/', (req, res) => {
  res.send('Hello World')
})

// Bull Board Dashboard - Monitoreo de queues
// app.use('/admin/queues', queueDashboard.getRouter());

app.use('/api', apiRouter);

// Add error handler
app.use((
  err: Error,
 req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  if (EnvVars.NodeEnv !== NodeEnvs.Test.valueOf()) {
    logger.err(err, true);
  }
  let status = HttpStatusCodes.BAD_REQUEST;
  if (err instanceof RouteError) {
    status = err.status;
  }
  let errorMessage = err.message

   res.status(status).json({ error: errorMessage });
});
// **** Export default **** //

export default app;
