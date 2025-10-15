import { NextFunction, Request, Response } from "express";
import * as jwt from 'jsonwebtoken';
import { RouteError } from "../other/errorHandler";
import HttpStatusCodes from "../constants/HttpStatusCodes";

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  if(process.env.NODE_ENV === 'development') {
    next();
    return;
  }
  const header = req.headers["authorization"] || "";
  const token = Array.isArray(header) ? "" : header.split(" ")[1];
  if (!token) {
    throw new RouteError(HttpStatusCodes.UNAUTHORIZED, "Token not provied");
  }
  try {
    const secret = process.env.JWT_SECRET
    jwt.verify(token, secret);
    next();
  } catch (error) {
    throw new RouteError(HttpStatusCodes.UNAUTHORIZED, "Token not valid");
  }
}