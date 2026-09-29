import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Supported models per SDK guidelines: 'gemini-3.8-flash' (standard text task default), 'gemini-3.1-flash-lite', and 'gemini-flash-latest'
const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates an AI response using Google Gemini, augmenting the prompt
 * with memories recalled from Hindsight.
 * Iterates through candidate models to bypass any single-model free-tier quota exhaustion.
 */
export async function generateChatResponse(
  userMessage: string,
  recalledMemories: string[],
  userName?: string
): Promise<string> {
  const ai = getAiClient();

  const systemInstruction = `You are MemoryChat, a helpful, intelligent, and personable AI assistant with persistent long-term memory powered by Hindsight.

${userName ? `The current logged-in user is: ${userName}.` : ''}

Your memory system recalls pertinent long-term memories about the user from past conversations when available.
CRITICAL INSTRUCTIONS:
1. If recalled memories exist for this user, incorporate their background, study topics (e.g. Data Engineering, Python), and learning preferences (e.g. simple explanations) naturally.
2. If NO recalled memories exist for this user (or if the user is new), treat them with a CLEAN SLATE. Do NOT assume they are studying data engineering or anything else unless they explicitly stated it in this conversation or in recalled memories. Ask them what topics or goals they would like to focus on!
3. Address the user by their name (${userName || 'the user'}) when appropriate.
4. Speak naturally and conversationally. Do NOT sound robotic.`;

  let prompt = '';

  if (recalledMemories.length > 0) {
    prompt = `[RECALLED HINDSIGHT MEMORIES ABOUT THIS USER (${userName || 'User'})]:
${recalledMemories.map((m, idx) => `${idx + 1}. ${m}`).join('\n')}

[CURRENT USER MESSAGE]:
${userMessage}

Please answer the user's message, applying relevant context and preferences from the recalled memories:`;
  } else {
    prompt = `[NOTE: This is a fresh user or new conversation with NO prior recalled memories. Do not assume any prior study field or preferences.]
[CURRENT USER MESSAGE FROM ${userName || 'User'}]:
${userMessage}`;
  }

  let lastError: any = null;

  for (const modelName of CANDIDATE_MODELS) {
    try {
      console.log(`[Gemini API] Requesting generation with model ${modelName}...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      lastError = err;
      const isQuotaExhausted =
        err?.status === 'RESOURCE_EXHAUSTED' ||
        err?.message?.includes('429') ||
        err?.message?.includes('quota') ||
        err?.message?.includes('Quota exceeded');

      console.warn(
        `[Gemini API] Model ${modelName} failed (${err?.message?.slice(0, 120)}...). ${
          isQuotaExhausted ? 'Trying alternative Gemini model...' : ''
        }`
      );
      // Wait a short moment before next model attempt
      await sleep(500);
    }
  }

  // If every model returned 429 quota exhaustion, formulate a helpful memory-aware response
  // so the user experience doesn't hard-crash.
  console.error('[Gemini API] All candidate models encountered errors/quotas. Generating graceful contextual fallback.');
  if (recalledMemories.length > 0) {
    const memorySummary = recalledMemories.join('; ');
    return `Hello! I noticed you previously shared: "${memorySummary}". Based on your background, I'm ready to continue exploring that with you. (Note: The Gemini free-tier quota is currently busy; please try again in a few moments!)`;
  }

  throw new Error(`Gemini API rate limit reached across models. Please retry shortly.`);
}

/**
 * Fast local heuristic extraction of user facts without burning Gemini API quota,
 * extracting ONLY facts that the user explicitly stated about themselves.
 */
export async function extractKeyFacts(userMessage: string, assistantReply: string): Promise<string[]> {
  const facts: string[] = [];
  const text = userMessage.trim();

  // 1. Fast regex extraction of user's explicitly stated name
  const nameMatch = text.match(/(?:my name is|i am|i'm)\s+([A-Z][a-zA-Z]+)/i);
  if (nameMatch && !['learning', 'studying', 'preparing', 'looking', 'glad', 'ready', 'interested'].includes(nameMatch[1].toLowerCase())) {
    facts.push(`User's name is ${nameMatch[1]}`);
  }

  // 2. Explicit learning topics stated by the user
  if (/learning data engineering|studying data engineering|into data engineering/i.test(text)) {
    facts.push('User is learning Data Engineering');
  } else if (/learning python|studying python|into python/i.test(text)) {
    facts.push('User is learning Python');
  }

  // 3. User's explicitly stated explanation preferences
  if (/simple explanation|prefer simple|explain.*simply|beginner/i.test(text)) {
    facts.push('User prefers simple, beginner-friendly explanations with analogies');
  }

  if (/interview prep|preparing for (?:an |technical )?interview/i.test(text)) {
    facts.push('User is preparing for technical interviews');
  }

  return facts;
}
