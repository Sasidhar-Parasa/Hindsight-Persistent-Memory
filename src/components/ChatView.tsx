import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessage } from '../types';
import { getChatHistory, sendMessage, clearChat, getHindsightStatus, clearHindsightMemories } from '../api';
import { Send, LogOut, Plus, Brain, Sparkles, User as UserIcon, Trash2 } from 'lucide-react';

interface ChatViewProps {
  user: User;
  onLogout: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({ user, onLogout }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [showClearMemoryConfirm, setShowClearMemoryConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    loadChat();
    refreshHindsightStatus();
  }, [user.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const loadChat = async () => {
    try {
      setInitialLoading(true);
      const history = await getChatHistory();
      setMessages(history);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setInitialLoading(false);
    }
  };

  const refreshHindsightStatus = async () => {
    try {
      const status = await getHindsightStatus();
      setMemoryCount(status.totalMemories);
    } catch (err) {
      console.error('Failed to get Hindsight status:', err);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setInput('');

    // Optimistically add user message
    const tempUserMsg: ChatMessage = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setLoading(true);

    try {
      const res = await sendMessage(text);
      // Replace with actual server responses
      setMessages((prev) => {
        // filter out tempUserMsg and append the real user message and assistant reply
        return [...prev.filter((m) => m.id !== tempUserMsg.id), tempUserMsg, res.message];
      });
      refreshHindsightStatus();
    } catch (err: any) {
      console.error('Error sending message:', err);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response. Please try again.'}`,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);

  const executeNewChat = async () => {
    setShowNewChatConfirm(false);
    try {
      setLoading(true);
      const welcome = await clearChat();
      setMessages([welcome]);
      refreshHindsightStatus();
    } catch (err) {
      console.error('Failed to clear chat:', err);
    } finally {
      setLoading(false);
    }
  };

  const executeClearMemory = async () => {
    setShowClearMemoryConfirm(false);
    try {
      setLoading(true);
      await clearHindsightMemories();
      await executeNewChat();
      const resetNotice: ChatMessage = {
        id: `msg_reset_${Date.now()}`,
        role: 'assistant',
        content: `Your persistent Hindsight memories have been completely wiped. You have a fresh clean slate!`,
        createdAt: new Date().toISOString(),
      };
      setMessages([resetNotice]);
      refreshHindsightStatus();
    } catch (err: any) {
      console.error('Failed to clear memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    if (messages.length <= 1) {
      // Chat is already empty/just welcome message, no confirmation needed
      executeNewChat();
      return;
    }
    setShowNewChatConfirm(true);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900">
      {/* 1. Header: Clean and minimal */}
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between shadow-xs z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-base">MemoryChat</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Hindsight Memory
              </span>
            </div>
            {memoryCount !== null && (
              <p className="text-[11px] text-slate-400">
                Bank: <span className="font-mono text-slate-500">user_{user.name.toLowerCase()}</span> • {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'} retained
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
            <UserIcon className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium">{user.name}</span>
          </div>

          <button
            type="button"
            onClick={handleNewChat}
            title="Start new conversation (retains long-term memory)"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setShowClearMemoryConfirm(true)}
            title="Wipe your persistent Hindsight memory bank"
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition"
          >
            <Trash2 className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Clear Memory</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            title="Logout"
            className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* 2. Chat Messages Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl w-full mx-auto flex flex-col space-y-4">
        {initialLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">
                No messages yet. Send a message to start chatting!
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-full`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {isUser ? 'You' : 'AI (Gemini)'}
                    </span>
                  </div>

                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-xs'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {/* Recalled Memory Pill */}
                  {!isUser && msg.recalledMemories && msg.recalledMemories.length > 0 && (
                    <div className="mt-1.5 ml-1 max-w-[85%] bg-amber-50/80 border border-amber-200/80 rounded-lg p-2 text-xs text-amber-900">
                      <div className="flex items-center gap-1 font-semibold text-amber-800 text-[11px] mb-1">
                        <Sparkles className="w-3 h-3 text-amber-600" />
                        <span>Recalled from Hindsight ({msg.recalledMemories.length})</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900/90 pl-1">
                        {msg.recalledMemories.map((rec, i) => (
                          <li key={i} className="line-clamp-2">{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex flex-col items-start">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 px-1">
                  AI (Gemini)
                </span>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-xs flex items-center gap-2 text-slate-500 text-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"></span>
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                  <span className="text-xs text-slate-400">Recalling Hindsight memories & generating...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      {/* 3. Demo Flow Helper (Minimal pill buttons for quick 1-min demonstration) */}
      <div className="max-w-3xl w-full mx-auto px-4 pb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 text-xs no-scrollbar">
          <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">Demo prompts:</span>
          <button
            type="button"
            onClick={() => handleSend("My name is Adi. I am learning data engineering and I prefer simple explanations.")}
            disabled={loading}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition border border-slate-200 disabled:opacity-50"
          >
            1. "My name is Adi. I am learning data engineering..."
          </button>
          <button
            type="button"
            onClick={() => handleSend("Explain something I should learn next.")}
            disabled={loading}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition border border-slate-200 disabled:opacity-50"
          >
            2. "Explain something I should learn next."
          </button>
          <button
            type="button"
            onClick={() => handleSend("Explain decorators to me.")}
            disabled={loading}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition border border-slate-200 disabled:opacity-50"
          >
            3. "Explain decorators to me."
          </button>
        </div>
      </div>

      {/* 4. Bottom Input Bar */}
      <footer className="bg-white border-t border-slate-200 p-4 shrink-0 shadow-xs">
        <div className="max-w-3xl w-full mx-auto flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Type your message..."
            className="flex-1 bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-xl px-4 py-2.5 text-sm text-slate-900 transition disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-indigo-600 shadow-xs"
          >
            <span>Send</span>
            <Send className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* Confirmation Modal for New Chat (replaces window.confirm) */}
      {showNewChatConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl border border-slate-200">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Start a New Chat?</h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              This clears your current screen, but your persistent long-term memories in Hindsight will remain saved.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewChatConfirm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeNewChat}
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition"
              >
                Start New Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Clear Memory */}
      {showClearMemoryConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl border border-amber-200">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Clear Hindsight Memory?</h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              This will completely wipe your long-term persistent memories and preferences from your Hindsight bank. The AI will treat you with a clean slate.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearMemoryConfirm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeClearMemory}
                className="px-4 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs transition"
              >
                Wipe Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
