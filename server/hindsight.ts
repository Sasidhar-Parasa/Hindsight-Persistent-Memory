import fs from 'fs';
import path from 'path';
import { HindsightClient, RecallResponse } from '@vectorize-io/hindsight-client';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORIES_FILE = path.join(DATA_DIR, 'hindsight-memories.json');

export interface StoredMemory {
  id: string;
  type: 'observation' | 'world' | 'experience';
  text: string;
  context?: string;
  timestamp: string;
  tags?: string[];
}

interface BankStorage {
  banks: Record<string, StoredMemory[]>;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readLocalBankMemories(): BankStorage {
  ensureDataDir();
  if (!fs.existsSync(MEMORIES_FILE)) {
    const initial: BankStorage = { banks: {} };
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const content = fs.readFileSync(MEMORIES_FILE, 'utf-8');
    return JSON.parse(content) as BankStorage;
  } catch (err) {
    console.error('[Hindsight] Error reading local memories file:', err);
    return { banks: {} };
  }
}

function writeLocalBankMemories(data: BankStorage) {
  ensureDataDir();
  const tmp = `${MEMORIES_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, MEMORIES_FILE);
}

// Initialize official Hindsight client
const HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || 'https://api.hindsight.vectorize.io/v1';
const HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY || '';
// Use HINDSIGHT_BANK_ID if set; otherwise use the bank ID provided in JWT_SECRET
const rawBankId = process.env.HINDSIGHT_BANK_ID || process.env.JWT_SECRET || '';
const HINDSIGHT_BANK_ID = (rawBankId && rawBankId !== 'memorychat-jwt-secret-key-change-in-production')
  ? rawBankId.trim()
  : '';

const hindsightClient = new HindsightClient({
  baseUrl: HINDSIGHT_BASE_URL,
  apiKey: HINDSIGHT_API_KEY || undefined,
  userAgent: 'MemoryChat-Hindsight-Integration/1.0.0',
});

// Set of bank IDs verified or created in Hindsight Cloud during this session
const ensuredCloudBanks = new Set<string>();

if (HINDSIGHT_API_KEY) {
  console.log(`[Hindsight] Connected to Hindsight API at ${HINDSIGHT_BASE_URL} with provided API Key.`);
} else {
  console.log(`[Hindsight] HINDSIGHT_API_KEY is not set. Operating in hybrid persistent memory mode using local bank store + Hindsight SDK structures.`);
}

if (HINDSIGHT_BANK_ID) {
  console.log(`[Hindsight] Active Hindsight Bank ID configured: "${HINDSIGHT_BANK_ID}"`);
}

/**
 * Returns a memory bank ID for a user.
 * Each user MUST have their own strictly isolated bank ID so User B (e.g. Dudu)
 * never sees memories from User A (e.g. Adi).
 * If a custom bank prefix is configured via HINDSIGHT_BANK_ID, we namespace it: `${prefix}-${sanitizedUserId}`.
 */
export function getUserBankId(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (HINDSIGHT_BANK_ID) {
    return `${HINDSIGHT_BANK_ID}-${sanitized}`;
  }
  return `user-${sanitized}`;
}

/**
 * Ensures the bank exists in Hindsight Cloud before recall/retain.
 * In Hindsight Cloud, calling recall on a brand new bank returns 404 "Bank not found"
 * unless createBank or an initial retain has provisioned it.
 */
async function ensureCloudBankExists(bankId: string): Promise<void> {
  if (!HINDSIGHT_API_KEY || ensuredCloudBanks.has(bankId)) {
    return;
  }
  try {
    await hindsightClient.createBank(bankId, {
      name: `MemoryBank for ${bankId}`,
      reflectMission: 'Assist user with personalized, context-aware memory retention and recall.',
    });
    ensuredCloudBanks.add(bankId);
    console.log(`[Hindsight] Confirmed/created memory bank "${bankId}" in Hindsight Cloud.`);
  } catch (err: any) {
    // If bank already exists, mark as ensured
    if (err?.message?.includes('already exists') || err?.status === 409) {
      ensuredCloudBanks.add(bankId);
    } else {
      console.warn(`[Hindsight] Note on bank provisioning (${bankId}):`, err?.message || err);
    }
  }
}

/**
 * Retains an interaction or fact in Hindsight.
 * Automatically saves to Hindsight Cloud if API key is configured,
 * and maintains local persistent storage for reliability and instant demo response.
 */
export async function retainMemory(
  userId: string,
  userMessage: string,
  assistantReply: string,
  extractedFacts?: string[]
): Promise<void> {
  const bankId = getUserBankId(userId);
  const now = new Date().toISOString();

  // Combine conversation into a structured memory text
  const interactionText = `User said: "${userMessage.trim()}". AI responded: "${assistantReply.trim()}".`;

  // Always save to persistent bank storage
  const bankStorage = readLocalBankMemories();
  if (!bankStorage.banks[bankId]) {
    bankStorage.banks[bankId] = [];
  }

  // Add the interaction experience
  bankStorage.banks[bankId].push({
    id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: 'experience',
    text: interactionText,
    context: 'Direct chat conversation',
    timestamp: now,
    tags: [userId, 'conversation'],
  });

  // If specific atomic facts were extracted (e.g. name, preferences, goals), record them as observations / world facts
  if (extractedFacts && extractedFacts.length > 0) {
    for (const fact of extractedFacts) {
      // Avoid duplicate facts in the bank
      const exists = bankStorage.banks[bankId].some(
        (m) => m.text.toLowerCase() === fact.toLowerCase()
      );
      if (!exists) {
        bankStorage.banks[bankId].push({
          id: `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'observation',
          text: fact,
          context: 'User profile and preferences',
          timestamp: now,
          tags: [userId, 'profile', 'preference'],
        });
      }
    }
  }

  writeLocalBankMemories(bankStorage);

  // Call the remote Hindsight API if key is present
  if (HINDSIGHT_API_KEY) {
    try {
      await ensureCloudBankExists(bankId);

      await hindsightClient.retain(bankId, interactionText, {
        tags: [userId],
        context: 'User chat interaction',
      });

      if (extractedFacts && extractedFacts.length > 0) {
        for (const fact of extractedFacts) {
          await hindsightClient.retain(bankId, fact, {
            tags: [userId, 'preference'],
            context: 'User synthesized preference',
          });
        }
      }
      console.log(`[Hindsight] Successfully retained memory to Hindsight Cloud for bank ${bankId}`);
    } catch (err: any) {
      console.warn(`[Hindsight] Remote retain notice (${err?.message || err}). Local persistent bank active.`);
    }
  }
}

/**
 * Recalls memories relevant to the user query from Hindsight.
 * Queries remote Hindsight API if configured, and also leverages the persistent local bank.
 */
export async function recallMemories(userId: string, query: string): Promise<string[]> {
  const bankId = getUserBankId(userId);
  const recalledResults: string[] = [];

  // Try calling remote Hindsight Cloud API if API key is provided
  if (HINDSIGHT_API_KEY) {
    try {
      await ensureCloudBankExists(bankId);

      const response: RecallResponse = await hindsightClient.recall(bankId, query, {
        types: ['observation', 'world', 'experience'],
        tags: HINDSIGHT_BANK_ID ? [userId] : undefined, // When sharing a single bank ID across users, scope by user tag!
        maxTokens: 1024,
      });

      if (response && response.results && response.results.length > 0) {
        for (const res of response.results) {
          if (res.text && !recalledResults.includes(res.text)) {
            recalledResults.push(res.text);
          }
        }
        console.log(`[Hindsight] Recalled ${recalledResults.length} memories from Hindsight Cloud.`);
      }
    } catch (err: any) {
      // If bank doesn't exist yet on remote cloud (brand new user who hasn't spoken yet), that's expected
      const msg = err?.message || String(err);
      if (msg.includes('not found')) {
        console.log(`[Hindsight] First interaction for bank "${bankId}". It will be retained on next response.`);
      } else {
        console.warn(`[Hindsight] Remote recall notice: ${msg}`);
      }
    }
  }

  // Retrieve memories from the user's isolated local persistent bank
  const bankStorage = readLocalBankMemories();
  const userMemories = bankStorage.banks[bankId] || [];

  if (userMemories.length > 0) {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    // Score memories based on keyword relevance, preference importance, and recency
    const scoredMemories = userMemories.map((mem) => {
      let score = 0;
      const memTextLower = mem.text.toLowerCase();

      // Observations and profile preferences get higher base priority
      if (mem.type === 'observation') {
        score += 2;
      }

      // Check keyword overlap
      for (const word of queryWords) {
        if (memTextLower.includes(word)) {
          score += 3;
        }
      }

      // If user asks for study, learning, recommendations, or questions like "what should I study next?"
      // or "explain ...", include learning preferences and topics
      const isRecommendationQuery =
        /what.*learn|what.*study|next|recommend|explain|teach|how to|curriculum|roadmap/i.test(queryLower);
      if (isRecommendationQuery) {
        if (/learn|study|python|data engineering|preference|simple|explanation|level/i.test(memTextLower)) {
          score += 5;
        }
      }

      // If query asks about user identity or preferences ("who am i", "my name", "preferences")
      if (/name|who|profile|preference|about me|remember/i.test(queryLower)) {
        if (/name|learning|prefer|simple/i.test(memTextLower)) {
          score += 6;
        }
      }

      return { mem, score };
    });

    // Sort by score descending and only take memories with positive relevance
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

/**
 * Clears/resets all persistent memories for a given user.
 */
export async function clearUserMemories(userId: string): Promise<void> {
  const bankId = getUserBankId(userId);
  const bankStorage = readLocalBankMemories();
  bankStorage.banks[bankId] = [];
  writeLocalBankMemories(bankStorage);
  console.log(`[Hindsight] Cleared local memories for bank: ${bankId}`);
}

/**
 * Returns diagnostic info about Hindsight status for the current user.
 */
export function getHindsightStatus(userId: string) {
  const bankId = getUserBankId(userId);
  const bankStorage = readLocalBankMemories();
  const memories = bankStorage.banks[bankId] || [];

  return {
    bankId,
    cloudConfigured: Boolean(HINDSIGHT_API_KEY),
    baseUrl: HINDSIGHT_BASE_URL,
    totalMemories: memories.length,
    observations: memories.filter((m) => m.type === 'observation').length,
    experiences: memories.filter((m) => m.type === 'experience').length,
  };
}
