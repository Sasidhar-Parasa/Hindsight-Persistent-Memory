# MemoryChat with Hindsight 🧠

A full-stack, production-grade conversational AI assistant featuring **isolated, persistent long-term memory** powered by [Hindsight](https://github.com/vectorize-io/hindsight), Google Gemini, and Node.js / Express.

Unlike typical chatbots that stuff raw message transcripts into expensive LLM context windows, MemoryChat decouples ephemeral UI chat sessions from durable semantic memory. It extracts atomic profile facts and episodic experiences in the background, recalling only relevant context when the user asks questions—even after clearing the chat screen or switching devices.

---

## 🚀 Key Features

- **Isolated Per-User Memory Banks**: Uses strict namespacing (`${HINDSIGHT_BANK_ID}-${userId}`) so User A never has their learning goals, personal details, or preferences leaked to User B.
- **Durable Recall Across Clean Slates**: Clicking **"+ New Chat"** clears the visual screen, but the assistant still remembers your name, study topics, and explanation preferences on the very next prompt.
- **Asynchronous Fact & Experience Extraction**: Conversation turns are ingested in background tasks without blocking user-facing HTTP responses or streaming.
- **Semantic Memory Inspector**: A dedicated live sidebar showing all observations, facts, and conversation experiences stored in Hindsight for the authenticated user, complete with one-click deletion and search.
- **Recalled Memory Transparency**: Assistant replies highlight exactly which long-term memories were recalled and used to formulate the answer.
- **Production-Ready Google Gemini Integration**: Backed by `gemini-3.8-flash` with graceful fallback to `gemini-3.1-flash-lite` and `gemini-flash-latest`.
- **Hybrid Storage Architecture**: Integrates with Hindsight Cloud while supporting a resilient local file-backed fallback if an API key is omitted during development.

---

## 🏗️ Architecture

```
┌─────────────────────────┐          1. Message          ┌──────────────────────────┐
│  React 19 + Tailwind    │ ───────────────────────────> │  Express Backend         │
│  (Modern Clean UI)      │                              │  (Auth, Routes, Gemini)  │
└─────────────────────────┘                              └─────────────┬────────────┘
             ▲                                                         │
             │                                           2. Recall     │ 4. Asynchronous Retain
             │ 5. Response + Recalled Pills                 Memories   │    (Observations & Turns)
             │                                                         ▼
┌────────────┴────────────┐                              ┌──────────────────────────┐
│ Google Gemini           │ <───── 3. Prompt + Context ─ │ Hindsight Memory Engine  │
│ (System Prompt Hook)    │                              │ (Isolated Bank per User) │
└─────────────────────────┘                              └──────────────────────────┘
```

---

## 🛠️ Technology Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons
- **Backend**: Express.js, TypeScript, TSX runtime
- **LLM**: Google Gemini (`@google/genai` SDK)
- **Memory Engine**: [Hindsight](https://github.com/vectorize-io/hindsight) by [Vectorize](https://vectorize.io/what-is-agent-memory)
- **Authentication**: JWT token-based auth with bcrypt password hashing
- **Persistence**: File-backed database & memory caches in `/data`

---

## 📦 Getting Started

### 1. Prerequisites
- Node.js 18+ installed
- A Google Gemini API key (`GEMINI_API_KEY`)
- *(Optional)* A Hindsight API key (`HINDSIGHT_API_KEY`) and Bank ID

### 2. Setup Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3000
JWT_SECRET=your_super_secret_jwt_key
GEMINI_API_KEY=your_gemini_api_key

# Optional: Connect to live Hindsight Cloud
HINDSIGHT_API_KEY=your_hindsight_api_key
HINDSIGHT_API_URL=https://api.hindsight.vectorize.io
HINDSIGHT_BANK_ID=my-app-bank
```

### 3. Installation
```bash
npm install
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Production Build
```bash
npm run build
npm start
```

---

## 🧪 Testing the Memory System

1. **Sign Up / Log In**: Create an account (e.g. `adi@example.com`).
2. **Teach the Assistant**:
   > *"My name is Adi. I am learning Data Engineering and I prefer simple explanations."*
3. **Inspect Memories**: Notice the right-hand **Hindsight Memory Inspector** populate with your name and preferences.
4. **Wipe the Screen**: Click **"+ New Chat"** in the top navigation bar. Your message history disappears.
5. **Verify Persistent Recall**:
   > *"What should I learn next?"*
   Notice that the assistant addresses you as Adi, recognizes your Data Engineering journey, suggests an appropriate concept (like Docker or Airflow), and uses everyday beginner-friendly analogies.
6. **Verify Cross-User Isolation**:
   Log out and sign up as a different user (e.g. `alex@example.com`). Ask *"What should I learn next?"*. The assistant starts with a true clean slate and asks Alex about their own interests—with zero memory leakage from Adi.

---

## 📖 Deep Dive & Technical Article

For an in-depth, code-backed engineering breakdown of how this was built and the lessons learned around multitenancy and memory leakage, read [`article.md`](./article.md):
- **Article Title**: *My Chatbot Leaked My Life Until I Fixed It with Hindsight*
- Explores context window failure modes, per-user namespace derivation, clean-slate prompt conditioning, and non-blocking background retention.

---

## 🔗 Resources

- [Hindsight GitHub Repository](https://github.com/vectorize-io/hindsight)
- [Hindsight Official Documentation](https://hindsight.vectorize.io/)
- [Vectorize: What is Agent Memory?](https://vectorize.io/what-is-agent-memory)
