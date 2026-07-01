// src/config/googleDriveConfig.ts
import { google } from "googleapis";

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set your access token here (you may need to manage tokens based on your authentication flow)
oAuth2Client.setCredentials({
  access_token: process.env.GOOGLE_ACCESS_TOKEN, // Make sure to set this in your .env file or manage dynamically
});

const drive = google.drive({ version: "v3", auth: oAuth2Client });

export default drive;
