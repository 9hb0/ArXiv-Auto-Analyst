
export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
  categories: string[];
  comment?: string;
}

export interface AnalyzedPaper extends ArxivPaper {
  relevanceScore: number;
  tags: string[];
  hasCode: boolean;
  isAccepted: boolean;
  reasoning: string;
  innovations?: string; // For deep analysis
  methodology?: string;
  value?: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  FETCHING = 'FETCHING',
  FILTERING = 'FILTERING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface FilterCriteria {
  keywords: string[];
  topics: string[];
}

export const TARGET_CATEGORIES = ['cs.AI', 'cs.CV'];
export const SEARCH_KEYWORDS = [
  "Visual Language Model", "VLM", 
  "Pre-deployment", 
  "Efficient Fine-tuning", "PEFT",
  "Runtime Optimization", 
  "Lightweight", "Mobile", "Edge",
  "Quantization", "Pruning"
];

// SiliconFlow / LLM Configuration
export interface AIModel {
  id: string;
  name: string;
}

export const SILICONFLOW_MODELS: AIModel[] = [
  { id: 'moonshotai/Kimi-K2-Thinking-Turbo', name: 'Kimi K2 Thinking Turbo' },
  { id: 'deepseek-ai/DeepSeek-V3.1-Terminus', name: 'DeepSeek V3.1 Terminus' },
  { id: 'moonshotai/Kimi-K2-Thinking', name: 'Kimi K2 Thinking' },
  { id: 'MiniMaxAI/MiniMax-M2', name: 'MiniMax M2' },
  { id: 'Qwen/QwQ-32B', name: 'Qwen/QwQ-32B' },
  { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' }
];

export interface LLMConfig {
  apiKey: string;
  modelId: string;
}

export interface CloudConfig {
  webhookUrl?: string; // Optional URL to POST data to (for cloud storage)
  enabled: boolean;
}

// Persistence Interfaces
export interface DailyReport {
  date: string;
  timestamp: number;
  papers: AnalyzedPaper[];
}

export interface RawDataStorage {
  date: string;
  papers: ArxivPaper[];
}

export interface FilteredDataStorage {
  date: string;
  papers: AnalyzedPaper[];
}
