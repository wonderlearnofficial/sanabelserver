import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { connectToDb, sequelize } from "./config/db_connection";
import { Request, Response, NextFunction } from "express";
// Import routes
import { router as user_route } from "./routes/user_routes";
import { router as student_route } from "./routes/student_routes";
import { router as organization_routes } from "./routes/organization_routes";
import { router as class_routes } from "./routes/class_routes";
import { router as teacher_routes } from "./routes/teacher_routes";
import { router as parent_route } from "./routes/parent_routes";
import { router as admin_routes } from "./routes/admin_routes";
import { router as mission_routes } from "./routes/mission_routes";
import { router as app_routes } from "./routes/app_routes";
import { router as dev_routes } from "./routes/dev_routes";
import { isDevEnvironment, getTestAccounts } from "./controllers/devController";
import { initPrayerTimeScheduler } from "./services/prayerTimeService";
import logger from "./config/logger";
import requestLogger from "./middleware/requestLogger";
import { createCorsOptions } from "./config/cors";
import { describeUploadError } from "./middleware/uploadExcel";
import type { Server } from "http";

const app = express();
// Railway terminates TLS at exactly one reverse proxy in front of this process.
// Trusting one hop makes req.ip the real client address (from X-Forwarded-For),
// so the per-IP rate limiters key on each client instead of the proxy's IP.
// Do not use `true`: that would trust a client-supplied X-Forwarded-For chain.
app.set("trust proxy", 1);
let databaseReady = false;
// Railway (and most PaaS hosts) assign their own port via process.env.PORT and
// expect the app to bind to it; SERVER_PORT remains the local-dev override.
const PORT = process.env.PORT || process.env.SERVER_PORT || 5000;

// Security headers. CSP is disabled because this process also serves Swagger UI
// (which needs inline assets); CORP is set cross-origin so email clients can load
// inline logo images from /assets.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Middleware
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
app.use(requestLogger);

// Strip internal error details from any response in production, without having
// to touch every controller. The user-facing `message` is preserved; raw
// `error`/`stack` fields (which can leak SQL/schema) are removed.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (
      process.env.NODE_ENV === "production" &&
      body &&
      typeof body === "object"
    ) {
      delete body.error;
      delete body.stack;
    }
    return originalJson(body);
  };
  next();
});

// Throttle unauthenticated auth endpoints to blunt brute-force / OTP abuse.
// Kept per-IP and moderate so shared school networks aren't locked out; the
// real OTP protection is the per-account lockout in the auth controllers.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts, try again later." },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.REFRESH_RATE_LIMIT) || 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many session refresh requests, try again later." },
});

// Serve static assets (used in email templates to avoid base64 bloat)
app.use(
  "/assets",
  express.static(require("path").resolve(__dirname, "../assets")),
);

// Rate-limit the brute-forceable, unauthenticated auth endpoints.
app.use("/users/login", authLimiter);
app.use("/users/registration", authLimiter);
app.use("/users/send-otp", authLimiter);
app.use("/users/verify-otp", authLimiter);
app.use("/users/reset-password", authLimiter);
app.use("/users/send-auth", authLimiter);
app.use("/users/verfication-auth", authLimiter);
// Refresh needs a valid refresh token, so it is not brute-forceable the way
// login/OTP are. It gets its own, much higher per-IP budget: a whole school
// behind one NAT renews sessions here, and a 429 would log every pupil out.
app.use("/users/refresh", refreshLimiter);
app.use("/users/impersonation/exchange", authLimiter);
app.use("/users/impersonate/exchange", authLimiter);

// Define routes
app.use("/users", user_route);
app.use("/students", student_route);
app.use("/organization", organization_routes);
app.use("/parents", parent_route);

app.use("/class", class_routes);
app.use("/teachers", teacher_routes);
app.use("/admin", admin_routes);
app.use("/mission", mission_routes);
app.use("/app", app_routes);

// /dev issues tokens without a password, so it is mounted only when NODE_ENV
// is explicitly "development" or "test". Fail closed: an unset or unexpected
// NODE_ENV (e.g. a deployment that forgot it) leaves /dev unmounted (404).
// devController re-checks the same condition per handler.
//
// Exception, testing phase: the client /test page reads GET /dev/test-accounts
// in production too. It is read-only and returns no password or token, so it
// is mounted unconditionally; login-as and /dev/users stay behind the gate.
app.get("/dev/test-accounts", getTestAccounts);
if (isDevEnvironment()) {
  app.use("/dev", dev_routes);
}


app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", (_req, res) => {
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ready" : "not_ready",
    database: databaseReady ? "connected" : "disconnected",
  });
});

app.get("/", (req, res) => {
  res.send("Sanabel Server is running.");
});

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Sanabel Elahssan API",
      version: "1.0.0",
      description: "API documentation for Sanabel Elahssan project",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Development Server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"], // Adjust the path based on your folder structure
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
// 404 for unmatched routes — standardized shape.
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Resource not found" });
});

// Central error handler. Full detail is logged server-side only; the client
// receives a generic message with no stack trace or internal error text.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled Error:", {
    error: err?.message || err,
    stack: err?.stack,
    path: req.originalUrl,
  });
  const uploadError = describeUploadError(err);
  if (uploadError) {
    return res.status(uploadError.status).json({
      success: false,
      code: uploadError.code,
      message: uploadError.message,
    });
  }
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    success: false,
    message:
      status === 500
        ? "Internal server error"
        : err?.message || "Request failed",
  });
});

const startServer = async (): Promise<Server> => {
  await connectToDb();

  // Initialize the optional Prayer Time Scheduler only after models and the
  // database are ready. Invalid enabled-push configuration fails startup.
  initPrayerTimeScheduler();
  databaseReady = true;

  // Listen with explicit socket backlog of 4096 to prevent connection drops during spikes
  const server = app.listen(Number(PORT), "0.0.0.0", 4096, () => {
    logger.info(`Server is running on http://localhost:${PORT}`);
    logger.info(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  });

  // High-concurrency socket and timeout tuning
  server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS) || 65000;
  server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS) || 66000;
  server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 30000;

  // Graceful shutdown handling (SIGTERM & SIGINT)
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    databaseReady = false;

    server.close(async () => {
      logger.info("HTTP server closed. Draining database connection pool...");
      try {
        await sequelize.close();
        logger.info("Database pool closed cleanly.");
        process.exit(0);
      } catch (err) {
        logger.error("Error closing database pool:", { error: err });
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error("Forceful shutdown: connections failed to close in time.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return server;
};

if (require.main === module) {
  startServer().catch((error) => {
    databaseReady = false;
    logger.error("Server startup failed", { error });
    process.exitCode = 1;
  });
}

export { app, startServer };

