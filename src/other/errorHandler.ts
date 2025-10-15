

/**
 * Miscellaneous shared classes go here.
 */

import HttpStatusCodes from '../constants/HttpStatusCodes';


/**
 * Error with status code and message
 */
export class RouteError extends Error {

  public status: HttpStatusCodes;
  // public message: string;


  public constructor(status: HttpStatusCodes, message: string) {
    super(message);
    this.status = status;
    // this.message = message;
  }
}