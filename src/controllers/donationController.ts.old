// src/controllers/donationController.ts
import { Request, Response } from "express";
import Donation from "../models/donation.model";
import drive from "../config/cloudaryconfig";
import fs from "fs";
import multer from "multer";

// Set up multer for file uploads
const upload = multer({ dest: "uploads/" }); // Temporary storage

// Function to create a donation
export const createDonation = async (req: Request, res: Response) => {
  try {
    if (req.file?.path) {
      const filePath = req.file.path; // Path to the uploaded file
      const fileMetadata = {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
      };

      const media = {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(filePath),
      };

      // Upload file to Google Drive
      const fileResponse = await drive.files.create({
        media: media,
        fields: "id",
      });

      const fileId = fileResponse.data.id;

      // Create a donation entry in the database
      const donation = await Donation.create({
        amount: req.body.amount,
        studentId: req.body.studentId,
        receiptImage: `https://drive.google.com/uc?id=${fileId}`, // Generate a public URL
      });

      // Clean up temporary file
      fs.unlinkSync(filePath);

      res.status(201).json(donation);
    }
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
};

// Export multer middleware
export const uploadReceipt = upload.single("receiptImage");
