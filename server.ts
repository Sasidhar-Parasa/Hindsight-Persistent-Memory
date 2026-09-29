import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { db } from './server/db.js';
import { requireAuth, generateToken, hashPassword, comparePassword, AuthRequest } from './server/auth.js';
import { retainMemory, recallMemories, getHindsightStatus, clearUserMemories } from './server/hindsight.js';
import { generateChatResponse, extractKeyFacts } from './server/gemini.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// --- Authentication Routes ---

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.findUserByEmail(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const newUser = db.createUser({
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
    });

    const token = generateToken(newUser);

    // Initial greeting in chat history
    db.addChatMessage(newUser.id, {
      id: `msg_welcome_${Date.now()}`,
      role: 'assistant',
      content: `Hello ${newUser.name}! I am your AI assistant with persistent memory powered by Hindsight. What would you like to explore or talk about today?`,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
      token,
    });
  } catch (err: any) {
    console.error('Sign up error:', err);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

// Login (POST)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
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
      res.status(401).json({ error: 'Incorrect password. Please try again.' });
      return;
    }

    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      token,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Friendly informative response if someone visits /api/auth/login or /api/auth/signup with GET in a browser
app.get(['/api/auth/login', '/api/auth/signup'], (req, res) => {
  res.status(405).json({
    error: 'Authentication endpoints require POST requests with credentials. Visit / in your browser to sign in or sign up.',
  });
});

// Get Current User Profile
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
});

// --- Chat & Hindsight Memory Routes ---

// Load Chat History
app.get('/api/chat/history', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const messages = db.getUserChat(user.id);
  res.json({ messages });
});

// Send Message
app.post('/api/chat/message', requireAuth, async (req: AuthRequest, res) => {
  const user = req.user!;
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Message text is required' });
    return;
  }

  const trimmedMessage = message.trim();
  const now = new Date().toISOString();

  // 1. Record user message in user's chat history
  const userMessageId = `msg_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  db.addChatMessage(user.id, {
    id: userMessageId,
    role: 'user',
    content: trimmedMessage,
    createdAt: now,
  });

  try {
    // Check if the user specifically asked to delete or clear their memory
    const isMemoryDeletionRequest = /^(?:delete|clear|reset|forget)\s+(?:all\s+)?(?:my\s+)?(?:hindsight\s+)?(?:memories|memory)$/i.test(trimmedMessage);
    if (isMemoryDeletionRequest) {
      await clearUserMemories(user.id);
      const assistantMessageId = `msg_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const assistantMsg = {
        id: assistantMessageId,
        role: 'assistant' as const,
        content: `I have cleared all your persistent Hindsight memories. You now have a clean slate!`,
        createdAt: new Date().toISOString(),
      };
      db.addChatMessage(user.id, assistantMsg);
      res.json({
        message: assistantMsg,
        recalledMemories: [],
      });
      return;
    }

    // 2. Retrieve relevant memories from Hindsight using the user's namespace
    console.log(`[Hindsight] Recalling memories for user ${user.id} query: "${trimmedMessage}"`);
    const recalledMemories = await recallMemories(user.id, trimmedMessage);
    console.log(`[Hindsight] Recalled ${recalledMemories.length} relevant memories`);

    // 3. Send current message + relevant memories to Google Gemini
    const assistantReply = await generateChatResponse(trimmedMessage, recalledMemories, user.name);

    // 4. Save the assistant response in the user's chat history
    const assistantMessageId = `msg_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const assistantMsg = {
      id: assistantMessageId,
      role: 'assistant' as const,
      content: assistantReply,
      recalledMemories: recalledMemories.length > 0 ? recalledMemories : undefined,
      createdAt: new Date().toISOString(),
    };
    db.addChatMessage(user.id, assistantMsg);

    // 5. Store meaningful interaction and facts in Hindsight in background
    (async () => {
      try {
        const extractedFacts = await extractKeyFacts(trimmedMessage, assistantReply);
        await retainMemory(user.id, trimmedMessage, assistantReply, extractedFacts);
      } catch (storeErr) {
        console.error('[Hindsight] Background retain error:', storeErr);
      }
    })();

    // 6. Return response to frontend
    res.json({
      message: assistantMsg,
      recalledMemories,
    });
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Failed to process chat message' });
  }
});

// Clear Chat Screen (New Chat session, while keeping Hindsight long-term memories intact)
app.post('/api/chat/clear', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  db.clearUserChat(user.id);

  // Add initial clean greeting
  const welcome = {
    id: `msg_welcome_${Date.now()}`,
    role: 'assistant' as const,
    content: `New chat started! I still remember your preferences and previous background from Hindsight. How can I help you?`,
    createdAt: new Date().toISOString(),
  };
  db.addChatMessage(user.id, welcome);

  res.json({ success: true, message: welcome });
});

// Hindsight Memory Status / Diagnostic
app.get('/api/hindsight/status', requireAuth, (req: AuthRequest, res) => {
  const user = req.user!;
  const status = getHindsightStatus(user.id);
  res.json(status);
});

// Clear/Reset Hindsight Memories for user
app.post('/api/hindsight/clear', requireAuth, async (req: AuthRequest, res) => {
  const user = req.user!;
  await clearUserMemories(user.id);
  res.json({ success: true, message: 'All persistent memories cleared.' });
});

// Explicit 404 for unhandled API endpoints so they never return HTML index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// --- Vite Integration & Production Server ---

async function startServer() {
  const distPath = path.resolve(process.cwd(), 'dist');
  const indexHtmlPath = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(indexHtmlPath);

  // In production or when built dist files exist, serve static assets
  if (process.env.NODE_ENV === 'production' || hasDist) {
    console.log(`[Server] Serving production build from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(indexHtmlPath);
    });
  } else {
    console.log('[Server] Starting in development mode with Vite middleware');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`MemoryChat application running at http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('[Server] Server error:', err);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
