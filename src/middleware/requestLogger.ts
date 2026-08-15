import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";
import { randomUUID } from "crypto";
import { runWithRequestContext } from "../config/requestContext";

const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const suppliedRequestId = req.header("x-request-id");
  const requestId =
    suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  res.setHeader("x-request-id", requestId);

  runWithRequestContext(requestId, () => {
    const start = Date.now();
    const { method, originalUrl, ip } = req;

    // Log incoming request
    logger.info(`--> ${method} ${originalUrl}`, { ip });

    // On finish, log response details
    res.on("finish", () => {
      const duration = Date.now() - start;
      const { statusCode } = res;

      // Use warn for 4xx and error for 5xx
      const logLevel =
        statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

      logger.log(
        logLevel,
        `<-- ${method} ${originalUrl} ${statusCode} ${duration}ms`,
        {
          method,
          url: originalUrl,
          status: statusCode,
          duration,
        },
      );
    });

    next();
  });
};

export default requestLogger;
