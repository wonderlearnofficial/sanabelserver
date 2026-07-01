// express.d.ts
import { JwtPayload } from "jsonwebtoken";
import express from "express";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload | string; // Extend Request to include user
    }
  }
}
