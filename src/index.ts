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
import { connectToDb } from "./config/db_connection";
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
import { router as dev_routes } from "./routes/dev_routes";
import { initPrayerTimeScheduler } from "./services/prayerTimeService";
import logger from "./config/logger";
import requestLogger from "./middleware/requestLogger";
// CORS allowlist. Trusted web origins come from CORS_ORIGINS (comma-separated).
// Requests with no Origin header (native mobile apps, server-to-server, health
// checks) are always allowed, as are the Capacitor/localhost origins the mobile
// build uses. In non-production, any origin is reflected for developer convenience.
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const alwaysAllowed = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:8100",
  "http://localhost:5173",
];

const allowedOrigins = Array.from(
  new Set([...configuredOrigins, ...alwaysAllowed]),
);

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
};

const app = express();
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
app.use(cors(corsOptions));
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
app.use("/users/refresh", authLimiter);

// Define routes
app.use("/users", user_route);
app.use("/students", student_route);
app.use("/organization", organization_routes);
app.use("/parents", parent_route);

app.use("/class", class_routes);
app.use("/teachers", teacher_routes);
app.use("/admin", admin_routes);
app.use("/mission", mission_routes);

// Dev-only "log in as any user" tool — never mounted in production, so the
// route doesn't exist at all outside local development (the controller also
// double-checks NODE_ENV itself as a second layer of protection).
if (process.env.NODE_ENV !== "production") {
  app.use("/dev", dev_routes);
}

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
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    success: false,
    message:
      status === 500
        ? "Internal server error"
        : err?.message || "Request failed",
  });
});

// Start server
app.listen(PORT, async () => {
  logger.info(`Server is running on http://localhost:${PORT}`);
  logger.info(`Swagger docs available at http://localhost:${PORT}/api-docs`);
  await connectToDb();
  
  // Initialize Prayer Time Scheduler
  initPrayerTimeScheduler();
});
