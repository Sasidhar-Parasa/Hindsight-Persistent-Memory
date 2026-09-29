import React, { useState, useEffect } from 'react';
import { User } from './types';
import { authStorage, getCurrentUser } from './api';
import { AuthForm } from './components/AuthForm';
import { ChatView } from './components/ChatView';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const token = authStorage.getToken();
    if (token) {
      getCurrentUser()
        .then((fetchedUser) => {
          setUser(fetchedUser);
        })
        .catch((err) => {
          console.warn('Session expired or invalid token:', err);
          authStorage.removeToken();
          setUser(null);
        })
        .finally(() => {
          setCheckingAuth(false);
        });
    } else {
      setCheckingAuth(false);
    }
  }, []);

  const handleLogout = () => {
    authStorage.removeToken();
    setUser(null);
  };

  const handleAuthSuccess = (authenticatedUser: User) => {
    setUser(authenticatedUser);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-500 font-medium">Loading MemoryChat...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm onAuthSuccess={handleAuthSuccess} />;
  }

  return <ChatView user={user} onLogout={handleLogout} />;
}
