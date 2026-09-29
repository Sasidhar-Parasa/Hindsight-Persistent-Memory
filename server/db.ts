import fs from 'fs';
import path from 'path';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recalledMemories?: string[];
  createdAt: string;
}

interface DatabaseSchema {
  users: User[];
  chats: Record<string, ChatMessage[]>; // Keyed by userId
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Pre-computed bcrypt hash for 'demo1234' with 10 salt rounds
const DEMO_PASSWORD_HASH = '$2b$10$peqZCgYh1HnhvQ6e6Kr5t.c8rr2brdfHyb8hS0K7YaQ/ENKYcTWHG';

function seedDefaultUsers(database: DatabaseSchema): boolean {
  let changed = false;

  // Ensure Adi exists with demo1234
  let adi = database.users.find(u => u.email.toLowerCase() === 'adi@example.com' || u.email.toLowerCase() === 'test_adi@example.com');
  if (!adi) {
    adi = {
      id: 'usr_demo_adi',
      name: 'Adi',
      email: 'adi@example.com',
      passwordHash: DEMO_PASSWORD_HASH,
      createdAt: '2026-09-29T10:00:00.000Z',
    };
    database.users.push(adi);
    if (!database.chats[adi.id]) {
      database.chats[adi.id] = [{
        id: 'msg_welcome_adi',
        role: 'assistant',
        content: 'Hello Adi! I am your AI assistant with persistent memory powered by Hindsight. What would you like to explore or talk about today?',
        createdAt: '2026-09-29T10:00:00.000Z',
      }];
    }
    changed = true;
  } else {
    // Ensure email is adi@example.com and password hash is valid
    if (adi.email !== 'adi@example.com' || adi.passwordHash !== DEMO_PASSWORD_HASH) {
      adi.email = 'adi@example.com';
      adi.passwordHash = DEMO_PASSWORD_HASH;
      changed = true;
    }
  }

  return changed;
}

function readDb(): DatabaseSchema {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const initial: DatabaseSchema = { users: [], chats: {} };
    seedDefaultUsers(initial);
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    const database = JSON.parse(data) as DatabaseSchema;
    if (seedDefaultUsers(database)) {
      writeDb(database);
    }
    return database;
  } catch (err) {
    console.error('Error reading db.json, returning empty structure:', err);
    const fallback: DatabaseSchema = { users: [], chats: {} };
    seedDefaultUsers(fallback);
    return fallback;
  }
}

function writeDb(data: DatabaseSchema): void {
  ensureDataDir();
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

export const db = {
  findUserByEmail(email: string): User | undefined {
    const database = readDb();
    return database.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  },

  findUserById(id: string): User | undefined {
    const database = readDb();
    return database.users.find((u) => u.id === id);
  },

  createUser(user: User): User {
    const database = readDb();
    database.users.push(user);
    if (!database.chats[user.id]) {
      database.chats[user.id] = [];
    }
    writeDb(database);
    return user;
  },

  getUserChat(userId: string): ChatMessage[] {
    const database = readDb();
    return database.chats[userId] || [];
  },

  addChatMessage(userId: string, message: ChatMessage): void {
    const database = readDb();
    if (!database.chats[userId]) {
      database.chats[userId] = [];
    }
    database.chats[userId].push(message);
    writeDb(database);
  },

  clearUserChat(userId: string): void {
    const database = readDb();
    database.chats[userId] = [];
    writeDb(database);
  },
};
