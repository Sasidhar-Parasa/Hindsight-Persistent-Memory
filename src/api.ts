import { User, ChatMessage, HindsightStatus } from './types';

const TOKEN_KEY = 'memorychat_token';

export const authStorage = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  removeToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

function getAuthHeaders(): HeadersInit {
  const token = authStorage.getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handleResponse<T = any>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  let data: any = null;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    // If the server returned HTML (e.g. unexpected redirect or routing), don't dump the HTML page title into the error message
    if (res.status === 401) {
      authStorage.removeToken();
      throw new Error('Your session has expired or credentials were not recognized. Please sign in.');
    }
    if (contentType.includes('text/html') || rawText.includes('<!doctype') || rawText.includes('<html')) {
      throw new Error('Unable to connect to the authentication service. Please refresh the page and try again.');
    }
    const cleanSnippet = rawText.replace(/<[^>]*>/g, '').trim().slice(0, 100);
    throw new Error(
      cleanSnippet
        ? `Server error (${res.status}): ${cleanSnippet}`
        : `Server error (${res.status}). Please try again.`
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      authStorage.removeToken();
    }
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data as T;
}

export async function signup(name: string, email: string, password: string): Promise<{ user: User; token: string }> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  return handleResponse(res);
}

export async function login(email: string, password: string): Promise<{ user: User; token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res);
}

export async function getCurrentUser(): Promise<User> {
  const res = await fetch('/api/auth/me', {
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ user: User }>(res);
  return data.user;
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const res = await fetch('/api/chat/history', {
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ messages: ChatMessage[] }>(res);
  return data.messages;
}

export async function sendMessage(message: string): Promise<{ message: ChatMessage; recalledMemories: string[] }> {
  const res = await fetch('/api/chat/message', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ message }),
  });
  return handleResponse<{ message: ChatMessage; recalledMemories: string[] }>(res);
}

export async function clearChat(): Promise<ChatMessage> {
  const res = await fetch('/api/chat/clear', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ message: ChatMessage }>(res);
  return data.message;
}

export async function clearHindsightMemories(): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/hindsight/clear', {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  return handleResponse<{ success: boolean; message: string }>(res);
}

export async function getHindsightStatus(): Promise<HindsightStatus> {
  const res = await fetch('/api/hindsight/status', {
    headers: getAuthHeaders(),
  });
  return handleResponse<HindsightStatus>(res);
}
