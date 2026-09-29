export interface User {
  id: string;
  name: string;
  email: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recalledMemories?: string[];
  createdAt: string;
}

export interface HindsightStatus {
  bankId: string;
  cloudConfigured: boolean;
  baseUrl: string;
  totalMemories: number;
  observations: number;
  experiences: number;
}
