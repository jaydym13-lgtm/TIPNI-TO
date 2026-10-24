// =========================================================================
// ⚙️ TIPNI TO! - CENTRÁLNÍ BACKEND INICIALIZACE A SDK INSTANCE (init.js)
// =========================================================================

const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { CloudTasksClient } = require("@google-cloud/tasks");

// 🇪🇺 CENTRÁLNÍ EVROPSKÝ REGION PRO VŠECHNY CLOUD FUNKCE
const { getDatabase } = require("firebase-admin/database");

setGlobalOptions({ region: "europe-west1" });

initializeApp({
    databaseURL: "https://tipni-to-default-rtdb.europe-west1.firebasedatabase.app"
});
const db = getFirestore();
const auth = getAuth();
const rtdb = getDatabase();
const tasksClient = new CloudTasksClient();

// Kompatibilita pro stávající FieldValue, Timestamp a Realtime Database volání
const admin = {
    firestore: {
        FieldValue,
        Timestamp
    },
    database: () => rtdb
};

// ⚙️ CENTRÁLNÍ KONSTANTY BACKENDU
const DEFAULT_SEASON_ID = "2026_2027";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "tipni-to-data";
const RENDER_BOT_URL = process.env.RENDER_BOT_URL || "https://tipni-to-bot.onrender.com";
const BOT_SECRET = process.env.BOT_SECRET || "";

module.exports = {
    db,
    auth,
    rtdb,
    admin,
    FieldValue,
    Timestamp,
    tasksClient,
    DEFAULT_SEASON_ID,
    R2_BUCKET_NAME,
    RENDER_BOT_URL,
    BOT_SECRET
};