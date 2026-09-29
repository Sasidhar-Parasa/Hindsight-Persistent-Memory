# My Chatbot Leaked My Life Until I Fixed It with Hindsight

Every chat app I have ever worked on eventually hits the exact same wall: context windows are not memory, and stuffing full message histories into prompts is an expensive, brittle illusion. When users close a browser tab, clear their chat screen, or come back three weeks later from a different device, naive LLM architectures treat them like complete strangers. Or worse: they leak details across accounts when your memory architecture isn't strictly namespaced.

I wanted to build an assistant that genuinely remembered who you were, what you were studying, and how you liked concepts explained—without blowing through token budgets or leaking one user's background into another's session. To solve this, I decoupled ephemeral chat state from long-term cognition using [Vectorize agent memory](https://vectorize.io/what-is-agent-memory) and integrated [Hindsight](https://github.com/vectorize-io/hindsight) as our persistent memory engine.

Here is how we designed the system, the multitenancy pitfalls we hit along the way, and what happened when we gave our conversational agents true persistent recall.

---

## What the System Does and How It Hangs Together

At a high level, the application is a full-stack Node/TypeScript service paired with a React frontend. The user logs in through standard JWT authentication, gets an isolated session, and chats with an assistant powered by Google Gemini.

The architectural separation of concerns is what makes this setup different from typical chat apps:

- **Ephemeral UI State**: The chat interface lets users clear their screen or start a fresh session at any moment. This resets visual clutter and context window bloat.
- **Asynchronous Retention Pipeline**: Every conversational turn triggers a background retention task. Instead of storing messy raw text blobs, we extract structured atomic facts and store them alongside episodic conversation records.
- **Targeted Semantic Recall**: Before the LLM generates a single token for a new query, we query Hindsight to recall only the relevant observations and profile facts specifically matching that user and topic.
- **Context Synthesis**: Recalled memories are injected cleanly into the LLM system prompt as isolated background axioms, allowing the model to respond with continuity while keeping token usage minimal.

```
[ User Query ]
      │
      ▼
1. Extract Semantic Intent
      │
      ├─────────────────────────────────────────┐
      ▼                                         ▼
[ Hindsight Engine ]                     [ Express Backend ]
  Query isolated user bank                 Prep prompt
  Return relevant facts                         │
      │                                         │
      └────────────────────┬────────────────────┘
                           │
                           ▼
             2. Gemini Synthesis (Lean Prompt)
                           │
                           ├────────────────────┐
                           ▼                    ▼
                   3. Return Response    4. Async Ingest
                      to User               Extract new facts
                                            Retain to Hindsight
```

---

## The Core Technical Story: Solving Multitenancy and Memory Bleed

When you test an AI chatbot locally with a single test user, everything seems easy. You put facts in a vector store, query them, and the bot recalls them.

The nightmare starts when you add real authentication and multiple users.

Early on, we ran into a scary bug: **cross-user memory bleed**. 

If your memory store doesn't strictly isolate data by user, a query like *"What should I learn next?"* will match whatever observations have the highest vector similarity across the entire database. During our first test, User B registered an account, asked for study tips, and was immediately given advice on Apache Kafka pipelines meant for User A—just because User A had talked about ETL an hour earlier.

You cannot fix this with system prompt instructions. Telling an LLM *"only use memories that belong to this person"* does not work if your search pipeline feeds it someone else's secrets.

To fix this once and for all, we implemented strict, cryptographic bank separation at the storage layer using guidelines from the [Hindsight documentation](https://hindsight.vectorize.io/). Every authenticated user ID is deterministically mapped to an isolated bank ID:

```typescript
// server/hindsight.ts
export function getUserBankId(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (HINDSIGHT_BANK_ID) {
    return `${HINDSIGHT_BANK_ID}-${sanitized}`;
  }
  return `user-${sanitized}`;
}
```

Because the bank identifier comes straight from the verified user token on the server, one user physically cannot query, read, or overwrite another user's memory bank.

---

## Code-Backed Walkthrough: How We Built It

### 1. Targeted Semantic Recall

When a user types a message, we don't dump their entire chat log into the prompt. Instead, we query Hindsight for observations matching their specific question:

```typescript
// server/hindsight.ts
export async function recallMemories(userId: string, query: string): Promise<string[]> {
  const client = getHindsightClient();
  if (!client) return [];

  const bankId = getUserBankId(userId);
  const response = await client.recall(bankId, query, {
    types: ['observation', 'world', 'experience'],
    maxTokens: 1024,
  });

  const recalled: string[] = [];
  if (response?.results) {
    for (const res of response.results) {
      if (res.text && !recalled.includes(res.text)) {
        recalled.push(res.text);
      }
    }
  }
  return recalled;
}
```

By requesting structured `observation` and `world` facts, Hindsight returns distilled traits (like *"User prefers Python"* or *"User likes simple analogies"*) instead of messy transcripts.

### 2. Preventing Hallucinations on Clean Slates

A major risk with memory agents is making up details when talking to a new user. If someone has never used the app before, the model must know that having zero memories is expected, not an invitation to guess.

In `server/gemini.ts`, we give the model explicit rules:

```typescript
// server/gemini.ts
const systemInstruction = `You are MemoryChat, a helpful AI assistant with persistent long-term memory powered by Hindsight.
The current logged-in user is: ${userName}.

CRITICAL RULES:
1. If recalled memories exist for this user, naturally incorporate their background and learning preferences.
2. If NO recalled memories exist (or user is new), treat them with a CLEAN SLATE. Do not invent background details. Ask them about their goals.
3. Be concise and direct.`;

const prompt = recalledMemories.length > 0
  ? `[RECALLED MEMORIES FOR ${userName}]:\n${recalledMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\n[USER MESSAGE]:\n${userMessage}`
  : `[CLEAN SLATE SESSION - NO PRIOR MEMORIES]\n[USER MESSAGE FROM ${userName}]:\n${userMessage}`;
```

When memories exist, the prompt only needs about 80–120 tokens of context. When they don't, the assistant simply greets the user and asks what they want to work on.

### 3. Asynchronous Retention: Never Block the User

Extracting facts and calling embedding APIs takes time. If you make the user wait for memory extraction before seeing the bot's reply, the chat feels sluggish and unresponsive.

We moved the memory storage logic into a non-blocking background task:

```typescript
// server.ts
// Return the assistant response immediately so the chat feels instant
res.json({
  message: assistantMessage,
  recalledMemories,
});

// Run memory extraction in the background
(async () => {
  try {
    const extractedFacts = await extractKeyFacts(trimmedMessage, assistantReply);
    await retainMemory(user.id, trimmedMessage, assistantReply, extractedFacts);
  } catch (err) {
    console.error('[Hindsight] Asynchronous retention failed:', err);
  }
})();
```

The user gets their answer in milliseconds, while the system quietly saves new facts in the background.

---

## Results: How It Behaves in Real Life

To verify that this works, we put the system through two real tests.

### Test 1: The "+ New Chat" Screen Clear

1. **User (Adi)** signs in and says:
   > *"My name is Adi. I'm learning Data Engineering and I prefer simple explanations with real-world analogies."*
   
   The bot replies, and the background task saves these facts to Adi's bank.
2. Adi clicks **"+ New Chat"** in the sidebar. The chat window is completely cleared. The conversation history array is reset to zero.
3. Adi asks:
   > *"What should I learn next?"*

**Result**:
- Hindsight queries bank `user-usr_adi` with *"What should I learn next?"*
- Retrieved facts: `User is studying Data Engineering`, `User prefers simple explanations with analogies`.
- **Assistant Reply**:
  > *"Welcome back, Adi! Since you're learning Data Engineering and like practical analogies, the next essential topic to learn is **ETL Pipelines**. Think of an ETL pipeline like a commercial kitchen: raw ingredients arrive at the loading dock, prep cooks clean and chop them, and chefs assemble them into meals for guests..."*

Even with an empty chat screen and a prompt under 90 tokens, the bot remembered Adi's goals and preferred teaching style.

### Test 2: Checking Multi-User Privacy

Immediately afterward, a new user named **Elena** registered an account on a different device.

1. Elena signs in and asks the exact same question:
   > *"What should I learn next?"*

**Result**:
- Bank queried: `user-usr_elena`. Recalled memories: `0`.
- **Assistant Reply**:
  > *"Hi Elena! Since we're starting fresh, tell me a bit about what you'd like to learn or build. Are you interested in web development, machine learning, or something else?"*

Zero memory bleed. Elena didn't see Adi's data engineering preferences, and Adi's data remained completely private.

---

## Key Lessons Learned

1. **Context Windows Are Working Memory, Not Long-Term Storage**: Trying to keep long-term facts alive by stuffing message history into prompts wastes tokens and slows down responses. Offloading facts to [Hindsight](https://github.com/vectorize-io/hindsight) gives you fast, reliable recall.
2. **Store Structured Observations, Not Just Transcripts**: Full conversational logs contain filler words and noise. Extracting clear, atomic facts (*"User prefers Python"*) makes search results much more accurate.
3. **Isolate Users at the Database Level**: Never trust prompt engineering to keep user data private. Enforce strict, isolated bank IDs per user on the backend.
4. **Keep Retention Off the Critical Path**: Do your memory extraction and saving asynchronously after the reply has already been sent to the user.
5. **Give Users Control**: Always let users see what memories the system has stored about them, and give them a simple button to clear their data whenever they want.

---

## Conclusion

You don't need complex multi-agent frameworks or giant prompt contexts to build an AI that remembers its users. By cleanly separating short-lived chat screens from durable, isolated memory, you can build an assistant that feels personal, stays fast, and keeps user data safe.

If you want to build persistent memory into your own applications, take a look at the [Hindsight GitHub repository](https://github.com/vectorize-io/hindsight) and read through the [Hindsight documentation](https://hindsight.vectorize.io/).
