import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import * as accountDeletionController from "../controllers/accountDeletionController";

export const router = Router();

/**
 * @swagger
 * /account-deletion/requests:
 *   post:
 *     summary: Public request to delete an account (no sign-in; answers the same whether or not the account exists)
 *     tags: [Account deletion]
 * /account-deletion/mine:
 *   post:
 *     summary: Signed-in user asks for their own account to be deleted
 *     tags: [Account deletion]
 *     security:
 *       - bearerAuth: []
 */
router.post("/requests", accountDeletionController.createPublicRequest);
router.post("/mine", authenticateToken, accountDeletionController.createOwnRequest);
