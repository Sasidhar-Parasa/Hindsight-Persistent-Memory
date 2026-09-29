// server.ts
import express from "express";
import path3 from "path";
import fs3 from "fs";
import dotenv2 from "dotenv";

// server/db.ts
import fs from "fs";
import path from "path";
var DATA_DIR = path.resolve(process.cwd(), "data");
var DB_FILE = path.join(DATA_DIR, "db.json");
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
var DEMO_PASSWORD_HASH = "$2b$10$peqZCgYh1HnhvQ6e6Kr5t.c8rr2brdfHyb8hS0K7YaQ/ENKYcTWHG";
function seedDefaultUsers(database) {
  let changed = false;
  let adi = database.users.find((u) => u.email.toLowerCase() === "adi@example.com" || u.email.toLowerCase() === "test_adi@example.com");
  if (!adi) {
    adi = {
      id: "usr_demo_adi",
      name: "Adi",
      email: "adi@example.com",
      passwordHash: DEMO_PASSWORD_HASH,
      createdAt: "2026-09-29T10:00:00.000Z"
    };
    database.users.push(adi);
    if (!database.chats[adi.id]) {
      database.chats[adi.id] = [{
        id: "msg_welcome_adi",
        role: "assistant",
        content: "Hello Adi! I am your AI assistant with persistent memory powered by Hindsight. What would you like to explore or talk about today?",
        createdAt: "2026-09-29T10:00:00.000Z"
      }];
    }
    changed = true;
  } else {
    if (adi.email !== "adi@example.com" || adi.passwordHash !== DEMO_PASSWORD_HASH) {
      adi.email = "adi@example.com";
      adi.passwordHash = DEMO_PASSWORD_HASH;
      changed = true;
    }
  }
  return changed;
}
function readDb() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], chats: {} };
    seedDefaultUsers(initial);
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    const database = JSON.parse(data);
    if (seedDefaultUsers(database)) {
      writeDb(database);
    }
    return database;
  } catch (err) {
    console.error("Error reading db.json, returning empty structure:", err);
    const fallback = { users: [], chats: {} };
    seedDefaultUsers(fallback);
    return fallback;
  }
}
function writeDb(data) {
  ensureDataDir();
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpFile, DB_FILE);
}
var db = {
  findUserByEmail(email) {
    const database = readDb();
    return database.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },
  findUserById(id) {
    const database = readDb();
    return database.users.find((u) => u.id === id);
  },
  createUser(user) {
    const database = readDb();
    database.users.push(user);
    if (!database.chats[user.id]) {
      database.chats[user.id] = [];
    }
    writeDb(database);
    return user;
  },
  getUserChat(userId) {
    const database = readDb();
    return database.chats[userId] || [];
  },
  addChatMessage(userId, message) {
    const database = readDb();
    if (!database.chats[userId]) {
      database.chats[userId] = [];
    }
    database.chats[userId].push(message);
    writeDb(database);
  },
  clearUserChat(userId) {
    const database = readDb();
    database.chats[userId] = [];
    writeDb(database);
  }
};

// server/auth.ts
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
var JWT_SECRET = process.env.JWT_SECRET || "memorychat-default-secret-key-production";
function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}
function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    return;
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(decoded.userId);
    if (!user) {
      res.status(401).json({ error: "Unauthorized: User not found" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
    return;
  }
}

// server/hindsight.ts
import fs2 from "fs";
import path2 from "path";
import { HindsightClient } from "@vectorize-io/hindsight-client";
var DATA_DIR2 = path2.resolve(process.cwd(), "data");
var MEMORIES_FILE = path2.join(DATA_DIR2, "hindsight-memories.json");
function ensureDataDir2() {
  if (!fs2.existsSync(DATA_DIR2)) {
    fs2.mkdirSync(DATA_DIR2, { recursive: true });
  }
}
function readLocalBankMemories() {
  ensureDataDir2();
  if (!fs2.existsSync(MEMORIES_FILE)) {
    const initial = { banks: {} };
    fs2.writeFileSync(MEMORIES_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  try {
    const content = fs2.readFileSync(MEMORIES_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("[Hindsight] Error reading local memories file:", err);
    return { banks: {} };
  }
}
function writeLocalBankMemories(data) {
  ensureDataDir2();
  const tmp = `${MEMORIES_FILE}.tmp`;
  fs2.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs2.renameSync(tmp, MEMORIES_FILE);
}
var HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || "https://api.hindsight.vectorize.io/v1";
var HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY || "";
var rawBankId = process.env.HINDSIGHT_BANK_ID || process.env.JWT_SECRET || "";
var HINDSIGHT_BANK_ID = rawBankId && rawBankId !== "memorychat-jwt-secret-key-change-in-production" ? rawBankId.trim() : "";
var hindsightClient = new HindsightClient({
  baseUrl: HINDSIGHT_BASE_URL,
  apiKey: HINDSIGHT_API_KEY || void 0,
  userAgent: "MemoryChat-Hindsight-Integration/1.0.0"
});
var ensuredCloudBanks = /* @__PURE__ */ new Set();
if (HINDSIGHT_API_KEY) {
  console.log(`[Hindsight] Connected to Hindsight API at ${HINDSIGHT_BASE_URL} with provided API Key.`);
} else {
  console.log(`[Hindsight] HINDSIGHT_API_KEY is not set. Operating in hybrid persistent memory mode using local bank store + Hindsight SDK structures.`);
}
if (HINDSIGHT_BANK_ID) {
  console.log(`[Hindsight] Active Hindsight Bank ID configured: "${HINDSIGHT_BANK_ID}"`);
}
function getUserBankId(userId) {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (HINDSIGHT_BANK_ID) {
    return `${HINDSIGHT_BANK_ID}-${sanitized}`;
  }
  return `user-${sanitized}`;
}
async function ensureCloudBankExists(bankId) {
  if (!HINDSIGHT_API_KEY || ensuredCloudBanks.has(bankId)) {
    return;
  }
  try {
    await hindsightClient.createBank(bankId, {
      name: `MemoryBank for ${bankId}`,
      reflectMission: "Assist user with personalized, context-aware memory retention and recall."
    });
    ensuredCloudBanks.add(bankId);
    console.log(`[Hindsight] Confirmed/created memory bank "${bankId}" in Hindsight Cloud.`);
  } catch (err) {
    if (err?.message?.includes("already exists") || err?.status === 409) {
      ensuredCloudBanks.add(bankId);
    } else {
      console.warn(`[Hindsight] Note on bank provisioning (${bankId}):`, err?.message || err);
    }
  }
}
async function retainMemory(userId, userMessage, assistantReply, extractedFacts) {
  const bankId = getUserBankId(userId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const interactionText = `User said: "${userMessage.trim()}". AI responded: "${assistantReply.trim()}".`;
  const bankStorage = readLocalBankMemories();
  if (!bankStorage.banks[bankId]) {
    bankStorage.banks[bankId] = [];
  }
  bankStorage.banks[bankId].push({
    id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: "experience",
    text: interactionText,
    context: "Direct chat conversation",
    timestamp: now,
    tags: [userId, "conversation"]
  });
  if (extractedFacts && extractedFacts.length > 0) {
    for (const fact of extractedFacts) {
      const exists = bankStorage.banks[bankId].some(
        (m) => m.text.toLowerCase() === fact.toLowerCase()
      );
      if (!exists) {
        bankStorage.banks[bankId].push({
          id: `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: "observation",
          text: fact,
          context: "User profile and preferences",
          timestamp: now,
          tags: [userId, "profile", "preference"]
        });
      }
    }
  }
  writeLocalBankMemories(bankStorage);
  if (HINDSIGHT_API_KEY) {
    try {
      await ensureCloudBankExists(bankId);
      await hindsightClient.retain(bankId, interactionText, {
        tags: [userId],
        context: "User chat interaction"
      });
      if (extractedFacts && extractedFacts.length > 0) {
        for (const fact of extractedFacts) {
          await hindsightClient.retain(bankId, fact, {
            tags: [userId, "preference"],
            context: "User synthesized preference"
          });
        }
      }
      console.log(`[Hindsight] Successfully retained memory to Hindsight Cloud for bank ${bankId}`);
    } catch (err) {
      console.warn(`[Hindsight] Remote retain notice (${err?.message || err}). Local persistent bank active.`);
    }
  }
}
async function recallMemories(userId, query) {
  const bankId = getUserBankId(userId);
  const recalledResults = [];
  if (HINDSIGHT_API_KEY) {
    try {
      await ensureCloudBankExists(bankId);
      const response = await hindsightClient.recall(bankId, query, {
        types: ["observation", "world", "experience"],
        tags: HINDSIGHT_BANK_ID ? [userId] : void 0,
        // When sharing a single bank ID across users, scope by user tag!
        maxTokens: 1024
      });
      if (response && response.results && response.results.length > 0) {
        for (const res of response.results) {
          if (res.text && !recalledResults.includes(res.text)) {
            recalledResults.push(res.text);
          }
        }
        console.log(`[Hindsight] Recalled ${recalledResults.length} memories from Hindsight Cloud.`);
      }
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes("not found")) {
        console.log(`[Hindsight] First interaction for bank "${bankId}". It will be retained on next response.`);
      } else {
        console.warn(`[Hindsight] Remote recall notice: ${msg}`);
      }
    }
  }
  const bankStorage = readLocalBankMemories();
  const userMemories = bankStorage.banks[bankId] || [];
  if (userMemories.length > 0) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const scoredMemories = userMemories.map((mem) => {
      let score = 0;
      const memTextLower = mem.text.toLowerCase();
      if (mem.type === "observation") {
        score += 2;
      }
      for (const word of queryWords) {
        if (memTextLower.includes(word)) {
          score += 3;
        }
      }
      const isRecommendationQuery = /what.*learn|what.*study|next|recommend|explain|teach|how to|curriculum|roadmap/i.test(queryLower);
      if (isRecommendationQuery) {
        if (/learn|study|python|data engineering|preference|simple|explanation|level/i.test(memTextLower)) {
          score += 5;
        }
      }
      if (/name|who|profile|preference|about me|remember/i.test(queryLower)) {
        if (/name|learning|prefer|simple/i.test(memTextLower)) {
          score += 6;
        }
      }
      return { mem, score };
    });
    const relevantMemories = scoredMemories.filter((item) => item.score > 0);
    for (const item of relevantMemories) {
      if (!recalledResults.includes(item.mem.text)) {
        recalledResults.push(item.mem.text);
      }
      if (recalledResults.length >= 5) break;
    }
  }
  return recalledResults;
}
async function clearUserMemories(userId) {
  const bankId = getUserBankId(userId);
  const bankStorage = readLocalBankMemories();
  bankStorage.banks[bankId] = [];
  writeLocalBankMemories(bankStorage);
  console.log(`[Hindsight] Cleared local memories for bank: ${bankId}`);
}
function getHindsightStatus(userId) {
  const bankId = getUserBankId(userId);
  const bankStorage = readLocalBankMemories();
  const memories = bankStorage.banks[bankId] || [];
  return {
    bankId,
    cloudConfigured: Boolean(HINDSIGHT_API_KEY),
    baseUrl: HINDSIGHT_BASE_URL,
    totalMemories: memories.length,
    observations: memories.filter((m) => m.type === "observation").length,
    experiences: memories.filter((m) => m.type === "experience").length
  };
}

// server/gemini.ts
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();
function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
var CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest"
];
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function generateChatResponse(userMessage, recalledMemories, userName) {
  const ai = getAiClient();
  const systemInstruction = `You are MemoryChat, a helpful, intelligent, and personable AI assistant with persistent long-term memory powered by Hindsight.

${userName ? `The current logged-in user is: ${userName}.` : ""}

Your memory system recalls pertinent long-term memories about the user from past conversations when available.
CRITICAL INSTRUCTIONS:
1. If recalled memories exist for this user, incorporate their background, study topics (e.g. Data Engineering, Python), and learning preferences (e.g. simple explanations) naturally.
2. If NO recalled memories exist for this user (or if the user is new), treat them with a CLEAN SLATE. Do NOT assume they are studying data engineering or anything else unless they explicitly stated it in this conversation or in recalled memories. Ask them what topics or goals they would like to focus on!
3. Address the user by their name (${userName || "the user"}) when appropriate.
4. Speak naturally and conversationally. Do NOT sound robotic.`;
  let prompt = "";
  if (recalledMemories.length > 0) {
    prompt = `[RECALLED HINDSIGHT MEMORIES ABOUT THIS USER (${userName || "User"})]:
${recalledMemories.map((m, idx) => `${idx + 1}. ${m}`).join("\n")}

[CURRENT USER MESSAGE]:
${userMessage}

Please answer the user's message, applying relevant context and preferences from the recalled memories:`;
  } else {
    prompt = `[NOTE: This is a fresh user or new conversation with NO prior recalled memories. Do not assume any prior study field or preferences.]
[CURRENT USER MESSAGE FROM ${userName || "User"}]:
${userMessage}`;
  }
  let lastError = null;
  for (const modelName of CANDIDATE_MODELS) {
    try {
      console.log(`[Gemini API] Requesting generation with model ${modelName}...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7
        }
      });
      if (response && response.text) {
        return response.text;
      }
    } catch (err) {
      lastError = err;
      const isQuotaExhausted = err?.status === "RESOURCE_EXHAUSTED" || err?.message?.includes("429") || err?.message?.includes("quota") || err?.message?.includes("Quota exceeded");
      console.warn(
        `[Gemini API] Model ${modelName} failed (${err?.message?.slice(0, 120)}...). ${isQuotaExhausted ? "Trying alternative Gemini model..." : ""}`
      );
      await sleep(500);
    }
  }
  console.error("[Gemini API] All candidate models encountered errors/quotas. Generating graceful contextual fallback.");
  if (recalledMemories.length > 0) {
    const memorySummary = recalledMemories.join("; ");
    return `Hello! I noticed you previously shared: "${memorySummary}". Based on your background, I'm ready to continue exploring that with you. (Note: The Gemini free-tier quota is currently busy; please try again in a few moments!)`;
  }
  throw new Error(`Gemini API rate limit reached across models. Please retry shortly.`);
}
async function extractKeyFacts(userMessage, assistantReply) {
  const facts = [];
  const text = userMessage.trim();
  const nameMatch = text.match(/(?:my name is|i am|i'm)\s+([A-Z][a-zA-Z]+)/i);
  if (nameMatch && !["learning", "studying", "preparing", "looking", "glad", "ready", "interested"].includes(nameMatch[1].toLowerCase())) {
    facts.push(`User's name is ${nameMatch[1]}`);
  }
  if (/learning data engineering|studying data engineering|into data engineering/i.test(text)) {
    facts.push("User is learning Data Engineering");
  } else if (/learning python|studying python|into python/i.test(text)) {
    facts.push("User is learning Python");
  }
  if (/simple explanation|prefer simple|explain.*simply|beginner/i.test(text)) {
    facts.push("User prefers simple, beginner-friendly explanations with analogies");
  }
  if (/interview prep|preparing for (?:an |technical )?interview/i.test(text)) {
    facts.push("User is preparing for technical interviews");
  }
  return facts;
}

// server.ts
dotenv2.config();
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
app.use(express.json());
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters long" });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const existing = db.findUserByEmail(cleanEmail);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const passwordHash = await hashPassword(password);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newUser = db.createUser({
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const token = generateToken(newUser);
    db.addChatMessage(newUser.id, {
      id: `msg_welcome_${Date.now()}`,
      role: "assistant",
      content: `Hello ${newUser.name}! I am your AI assistant with persistent memory powered by Hindsight. What would you like to explore or talk about today?`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.status(201).json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email
      },
      token
    });
  } catch (err) {
    console.error("Sign up error:", err);
    res.status(500).json({ error: "Failed to create account. Please try again." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = db.findUserByEmail(cleanEmail);
    if (!user) {
      res.status(401).json({ error: `No account found with this email. Please switch to "Sign Up" above to register.` });
      return;
    }
    const match = await comparePassword(password, user.passwordHash);
    if (!match) {
      res.status(401).json({ error: "Incorrect password. Please try again." });
      return;
    }
    const token = generateToken(user);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      token
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});
app.get(["/api/auth/login", "/api/auth/signup"], (req, res) => {
  res.status(405).json({
    error: "Authentication endpoints require POST requests with credentials. Visit / in your browser to sign in or sign up."
  });
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
  });
});
app.get("/api/chat/history", requireAuth, (req, res) => {
  const user = req.user;
  const messages = db.getUserChat(user.id);
  res.json({ messages });
});
app.post("/api/chat/message", requireAuth, async (req, res) => {
  const user = req.user;
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Message text is required" });
    return;
  }
  const trimmedMessage = message.trim();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const userMessageId = `msg_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  db.addChatMessage(user.id, {
    id: userMessageId,
    role: "user",
    content: trimmedMessage,
    createdAt: now
  });
  try {
    const isMemoryDeletionRequest = /^(?:delete|clear|reset|forget)\s+(?:all\s+)?(?:my\s+)?(?:hindsight\s+)?(?:memories|memory)$/i.test(trimmedMessage);
    if (isMemoryDeletionRequest) {
      await clearUserMemories(user.id);
      const assistantMessageId2 = `msg_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const assistantMsg2 = {
        id: assistantMessageId2,
        role: "assistant",
        content: `I have cleared all your persistent Hindsight memories. You now have a clean slate!`,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      db.addChatMessage(user.id, assistantMsg2);
      res.json({
        message: assistantMsg2,
        recalledMemories: []
      });
      return;
    }
    console.log(`[Hindsight] Recalling memories for user ${user.id} query: "${trimmedMessage}"`);
    const recalledMemories = await recallMemories(user.id, trimmedMessage);
    console.log(`[Hindsight] Recalled ${recalledMemories.length} relevant memories`);
    const assistantReply = await generateChatResponse(trimmedMessage, recalledMemories, user.name);
    const assistantMessageId = `msg_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const assistantMsg = {
      id: assistantMessageId,
      role: "assistant",
      content: assistantReply,
      recalledMemories: recalledMemories.length > 0 ? recalledMemories : void 0,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.addChatMessage(user.id, assistantMsg);
    (async () => {
      try {
        const extractedFacts = await extractKeyFacts(trimmedMessage, assistantReply);
        await retainMemory(user.id, trimmedMessage, assistantReply, extractedFacts);
      } catch (storeErr) {
        console.error("[Hindsight] Background retain error:", storeErr);
      }
    })();
    res.json({
      message: assistantMsg,
      recalledMemories
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Failed to process chat message" });
  }
});
app.post("/api/chat/clear", requireAuth, (req, res) => {
  const user = req.user;
  db.clearUserChat(user.id);
  const welcome = {
    id: `msg_welcome_${Date.now()}`,
    role: "assistant",
    content: `New chat started! I still remember your preferences and previous background from Hindsight. How can I help you?`,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  db.addChatMessage(user.id, welcome);
  res.json({ success: true, message: welcome });
});
app.get("/api/hindsight/status", requireAuth, (req, res) => {
  const user = req.user;
  const status = getHindsightStatus(user.id);
  res.json(status);
});
app.post("/api/hindsight/clear", requireAuth, async (req, res) => {
  const user = req.user;
  await clearUserMemories(user.id);
  res.json({ success: true, message: "All persistent memories cleared." });
});
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});
async function startServer() {
  const distPath = path3.resolve(process.cwd(), "dist");
  const indexHtmlPath = path3.join(distPath, "index.html");
  const hasDist = fs3.existsSync(indexHtmlPath);
  if (process.env.NODE_ENV === "production" || hasDist) {
    console.log(`[Server] Serving production build from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(indexHtmlPath);
    });
  } else {
    console.log("[Server] Starting in development mode with Vite middleware");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`MemoryChat application running at http://0.0.0.0:${PORT}`);
  });
  server.on("error", (err) => {
    console.error("[Server] Server error:", err);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
