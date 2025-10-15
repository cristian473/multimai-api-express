import { NextFunction, Response, Request } from "express";
import { RouteError } from "../other/errorHandler";
import HttpStatusCodes from "../constants/HttpStatusCodes";

// export const verifyPermission = (permissionAlias:string) => async (req:Request, res:Response, next: NextFunction) => {
//   const hasPermission = req.userPermissions.includes(permissionAlias) || [];
//   if(!hasPermission) throw new RouteError(HttpStatusCodes.UNAUTHORIZED, 'Permisos insuficientes');
//   next();
// }