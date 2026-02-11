
export type Role = 'admin' | 'user';

export interface User {
  username: string;
  role: Role;
}

export interface SubCategory {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  iconName: string; // We will use a string to map to Lucide icons
  description: string;
  subCategories: SubCategory[];
}

export interface Question {
  id?: string;
  imageUrl?: string; // Optional image link
  contextText?: string; // Optional intro/context text above items
  contentItems?: string[]; // Optional list items (I., II., III. etc.)
  sourceTag?: string; // Optional source label (e.g. "2025 Deneme 3")
  questionText: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
}

export interface QuestionReport {
  id?: string;
  questionId: string;
  topicId?: string | null;
  categoryId?: string | null;
  reporterUsername?: string | null;
  reporterRole?: Role | null;
  note?: string | null;
  questionTextSnapshot?: string | null;
  createdAt?: unknown;
}

export interface QuizState {
  currentQuestionIndex: number;
  userAnswers: (number | null)[]; // Stores the selected option index for each question
  showResults: boolean;
  questions: Question[];
  loading: boolean;
  error: string | null;
  // Timer related
  timeLeft: number; // in seconds
  totalTime: number; // in seconds (for progress calculation)
  isTimerActive: boolean;
}
