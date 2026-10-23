import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";
import { randomUUID } from "crypto";
import { runWithRequestContext } from "../config/requestContext";
import { recordRequestMetric } from "../services/operationalMetrics";

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

    // In high-concurrency environments, avoid verbose per-request console spam
    // for routine 2xx/3xx requests while always capturing metrics and errors.
    const isVerbose = process.env.VERBOSE_REQUEST_LOGS === "true" || process.env.LOG_LEVEL === "debug";
    if (isVerbose) {
      logger.info(`--> ${method} ${originalUrl}`, { ip });
    }

    // On finish, record metrics and log response details
    res.on("finish", () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      recordRequestMetric({ status: statusCode, durationMs: duration, path: req.path });

      // Always log 4xx as warn and 5xx as error; log 2xx/3xx only when verbose
      if (statusCode >= 400 || isVerbose) {
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
      }
    });

    next();
  });
};

export default requestLogger;
