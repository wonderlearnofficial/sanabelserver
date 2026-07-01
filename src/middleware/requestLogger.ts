import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Log incoming request
  logger.info(`--> ${method} ${originalUrl}`, { ip });

  // On finish, log response details
  res.on("finish", () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    
    // Use warn for 4xx and error for 5xx
    const logLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    
    logger.log(logLevel, `<-- ${method} ${originalUrl} ${statusCode} ${duration}ms`, {
      method,
      url: originalUrl,
      status: statusCode,
      duration,
    });
  });

  next();
};

export default requestLogger;
