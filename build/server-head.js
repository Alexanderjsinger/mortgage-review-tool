// ============================================================================
//  Mortgage Review  —  self-hosted server.
//
//  One file, no dependencies, no accounts. Needs Node 22 or newer.
//
//      node mortgage-review-server.js
//
//  Then open http://localhost:8080
//
//  Your data lives in reviews.db, a single file next to this one. Back it up by
//  copying that file. Nothing leaves the machine you run this on.
// ============================================================================

import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- SETTINGS --------------------------------------------------------------
// Each can also be set as an environment variable, which wins over the value here.
const SIGN_IN_PASSWORD = process.env.ADVISOR_PASSWORD || "change-me-before-you-start";
const PORT             = Number(process.env.PORT || 8080);
// Public address clients will see, e.g. "https://reviews.yourdomain.com".
// Leave blank and links are built from whatever host the browser used.
const PUBLIC_URL       = process.env.PUBLIC_URL || "";
const DB_FILE          = process.env.DB_FILE ||
  join(dirname(fileURLToPath(import.meta.url)), "reviews.db");
// ----------------------------------------------------------------------------

// Signs your sign-in cookie. Keep it secret; changing it signs everyone out.
const SESSION_SECRET = process.env.SESSION_SECRET || "b96643fa4d0c5aa5cd6256ab467a1e3c616bbc93019b363c7c97d7939e51fb18";

const ADVISOR = { name: "Alex Singer", phone: "248-942-4743" };
