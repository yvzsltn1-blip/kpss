import React, { useState, useEffect, useMemo, useRef } from 'react';
import { INITIAL_CATEGORIES } from './constants';
import { Category, User, SubCategory, Question, QuizState, QuestionReport } from './types';
import { Icon } from './components/Icon';
import { parseBulkQuestionsWithReport } from './services/questionParser';

// --- Firebase Importları ---
import { auth, db } from './firebase';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { 
  addDoc,
  collection, 
  deleteDoc, 
  type DocumentReference,
  setDoc,
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  where, 
  writeBatch, 
  getDocs
} from 'firebase/firestore';

type ViewState = 'dashboard' | 'quiz-setup' | 'quiz' | 'admin';
type QuizConfirmAction = 'exit' | 'finish';
type TopicProgressStats = {
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  totalWrongAnswers: number;
  totalBlankAnswers: number;
  completedQuizCount: number;
  lastPlayedAt: number;
};
type LegacyTopicProgressStats = {
  seenQuestionIds: string[];
  correctQuestionIds: string[];
  wrongQuestionIds: string[];
  blankQuestionIds: string[];
  wrongRecoveryStreakByQuestionId: Record<string, number>;
  correctCount: number;
  wrongCount: number;
  blankCount: number;
  completedQuizCount: number;
  lastPlayedAt: number;
};
type WrongQuestionStatus = 'active_wrong' | 'active_blank' | 'resolved';
type WrongQuestionStats = {
  questionTrackingId: string;
  topicId: string;
  status: WrongQuestionStatus;
  recoveryStreak: number;
  wrongCount: number;
  blankCount: number;
  lastWrongAt: number;
  resolvedAt: number;
};

// Kategori Renk Tanımları
const CATEGORY_COLORS: Record<string, { bg: string; bgLight: string; bgDark: string; text: string; textDark: string; gradient: string; shadow: string; border: string; borderDark: string }> = {
  '1': { // Tarih - Amber
    bg: 'bg-amber-500', bgLight: 'bg-amber-50', bgDark: 'dark:bg-amber-900/20',
    text: 'text-amber-600', textDark: 'dark:text-amber-400',
    gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/20',
    border: 'border-amber-200', borderDark: 'dark:border-amber-800/30',
  },
  '2': { // Cografya - Emerald
    bg: 'bg-emerald-500', bgLight: 'bg-emerald-50', bgDark: 'dark:bg-emerald-900/20',
    text: 'text-emerald-600', textDark: 'dark:text-emerald-400',
    gradient: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/20',
    border: 'border-emerald-200', borderDark: 'dark:border-emerald-800/30',
  },
  '3': { // Vatandaslik - Violet
    bg: 'bg-violet-500', bgLight: 'bg-violet-50', bgDark: 'dark:bg-violet-900/20',
    text: 'text-violet-600', textDark: 'dark:text-violet-400',
    gradient: 'from-violet-500 to-purple-500', shadow: 'shadow-violet-500/20',
    border: 'border-violet-200', borderDark: 'dark:border-violet-800/30',
  },
  '4': { // Genel Kultur - Rose
    bg: 'bg-rose-500', bgLight: 'bg-rose-50', bgDark: 'dark:bg-rose-900/20',
    text: 'text-rose-600', textDark: 'dark:text-rose-400',
    gradient: 'from-rose-500 to-pink-500', shadow: 'shadow-rose-500/20',
    border: 'border-rose-200', borderDark: 'dark:border-rose-800/30',
  },
};

const DEFAULT_COLOR = {
  bg: 'bg-blue-500', bgLight: 'bg-blue-50', bgDark: 'dark:bg-blue-900/20',
  text: 'text-blue-600', textDark: 'dark:text-blue-400',
  gradient: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/20',
  border: 'border-blue-200', borderDark: 'dark:border-blue-800/30',
};

const getCatColor = (id: string) => CATEGORY_COLORS[id] || DEFAULT_COLOR;
const ADMIN_QUESTIONS_PER_PAGE = 5;
const WRONG_RECOVERY_STREAK_TARGET = 3;
const RESOLVED_RETENTION_DAYS = 45;
const RESOLVED_RETENTION_MS = RESOLVED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TOPIC_STATS_MIGRATION_KEY_PREFIX = 'kpsspro_topic_stats_migrated_v2_';

const STORAGE_KEYS = {
  theme: 'kpsspro_theme',
  quizSize: 'kpsspro_quiz_size',
  categories: 'kpsspro_categories',
  topicProgressStats: 'kpsspro_topic_progress_stats',
} as const;
const UNTAGGED_SOURCE_KEY = '__untagged__';

const EMPTY_TOPIC_PROGRESS: TopicProgressStats = {
  seenCount: 0,
  correctCount: 0,
  wrongCount: 0,
  blankCount: 0,
  totalWrongAnswers: 0,
  totalBlankAnswers: 0,
  completedQuizCount: 0,
  lastPlayedAt: 0,
};

const getWrongQuestionDocId = (questionTrackingId: string): string => encodeURIComponent(questionTrackingId);
const getQuestionTrackingIdFromWrongDocId = (docId: string): string => {
  try {
    return decodeURIComponent(docId);
  } catch {
    return docId;
  }
};

const getStoredCategories = (): Category[] => {
  if (typeof window === 'undefined') return INITIAL_CATEGORIES;
  try {
    const rawCategories = window.localStorage.getItem(STORAGE_KEYS.categories);
    if (!rawCategories) return INITIAL_CATEGORIES;
    const parsed = JSON.parse(rawCategories);
    if (!Array.isArray(parsed)) return INITIAL_CATEGORIES;

    const isValid = parsed.every((cat: unknown) => {
      const typedCat = cat as Partial<Category>;
      return (
        typedCat &&
        typeof typedCat.id === 'string' &&
        typeof typedCat.name === 'string' &&
        typeof typedCat.iconName === 'string' &&
        typeof typedCat.description === 'string' &&
        Array.isArray(typedCat.subCategories) &&
        typedCat.subCategories.every((sub: unknown) => {
          const typedSub = sub as Partial<SubCategory>;
          return typedSub && typeof typedSub.id === 'string' && typeof typedSub.name === 'string';
        })
      );
    });

    return isValid ? (parsed as Category[]) : INITIAL_CATEGORIES;
  } catch {
    return INITIAL_CATEGORIES;
  }
};

const getStoredTheme = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEYS.theme);
    if (storedTheme === 'dark') return true;
    if (storedTheme === 'light') return false;
  } catch {
    // Ignore storage errors and continue with default
  }
  return true;
};

const getStoredQuizSize = (): 0 | 1 | 2 => {
  if (typeof window === 'undefined') return 0;
  try {
    const storedSize = window.localStorage.getItem(STORAGE_KEYS.quizSize);
    if (storedSize === '1') return 1;
    if (storedSize === '2') return 2;
  } catch {
    // Ignore storage errors and use default
  }
  return 0;
};

const getStoredLegacyTopicProgressStats = (): Record<string, LegacyTopicProgressStats> => {
  if (typeof window === 'undefined') return {};
  try {
    const rawStats = window.localStorage.getItem(STORAGE_KEYS.topicProgressStats);
    if (!rawStats) return {};
    const parsed = JSON.parse(rawStats);
    if (!parsed || typeof parsed !== 'object') return {};

    const statsRecord: Record<string, LegacyTopicProgressStats> = {};
    Object.entries(parsed).forEach(([topicId, value]) => {
      const typedValue = value as Partial<LegacyTopicProgressStats>;
      if (!typedValue || typeof topicId !== 'string') return;
      const seenQuestionIds = Array.isArray(typedValue.seenQuestionIds)
        ? Array.from(new Set(typedValue.seenQuestionIds.filter((id): id is string => typeof id === 'string')))
        : [];
      const correctQuestionIds = Array.isArray(typedValue.correctQuestionIds)
        ? Array.from(new Set(typedValue.correctQuestionIds.filter((id): id is string => typeof id === 'string')))
        : [];
      const wrongQuestionIds = Array.isArray(typedValue.wrongQuestionIds)
        ? Array.from(new Set(typedValue.wrongQuestionIds.filter((id): id is string => typeof id === 'string')))
        : [];
      const blankQuestionIds = Array.isArray(typedValue.blankQuestionIds)
        ? Array.from(new Set(typedValue.blankQuestionIds.filter((id): id is string => typeof id === 'string')))
        : [];
      const rawWrongRecoveryStreak = typedValue.wrongRecoveryStreakByQuestionId;
      const wrongRecoveryStreakByQuestionId: Record<string, number> = {};
      if (rawWrongRecoveryStreak && typeof rawWrongRecoveryStreak === 'object' && !Array.isArray(rawWrongRecoveryStreak)) {
        Object.entries(rawWrongRecoveryStreak as Record<string, unknown>).forEach(([questionId, value]) => {
          if (typeof questionId !== 'string') return;
          const numericValue = Math.floor(Number(value));
          if (Number.isFinite(numericValue) && numericValue > 0) {
            wrongRecoveryStreakByQuestionId[questionId] = numericValue;
          }
        });
      }
      Object.keys(wrongRecoveryStreakByQuestionId).forEach((questionId) => {
        if (!wrongQuestionIds.includes(questionId)) {
          delete wrongRecoveryStreakByQuestionId[questionId];
        }
      });

      statsRecord[topicId] = {
        seenQuestionIds,
        correctQuestionIds,
        wrongQuestionIds,
        blankQuestionIds,
        wrongRecoveryStreakByQuestionId,
        correctCount: correctQuestionIds.length > 0
          ? correctQuestionIds.length
          : (Number.isFinite(typedValue.correctCount) ? Number(typedValue.correctCount) : 0),
        wrongCount: wrongQuestionIds.length > 0
          ? wrongQuestionIds.length
          : (Number.isFinite(typedValue.wrongCount) ? Number(typedValue.wrongCount) : 0),
        blankCount: blankQuestionIds.length > 0
          ? blankQuestionIds.length
          : (Number.isFinite(typedValue.blankCount) ? Number(typedValue.blankCount) : 0),
        completedQuizCount: Number.isFinite(typedValue.completedQuizCount) ? Number(typedValue.completedQuizCount) : 0,
        lastPlayedAt: Number.isFinite(typedValue.lastPlayedAt) ? Number(typedValue.lastPlayedAt) : 0,
      };
    });

    return statsRecord;
  } catch {
    return {};
  }
};

const normalizeTopicProgressStats = (value: Partial<TopicProgressStats>): TopicProgressStats => {
  const seenCount = Number.isFinite(value.seenCount) ? Math.max(0, Number(value.seenCount)) : 0;
  const correctCount = Number.isFinite(value.correctCount) ? Math.max(0, Number(value.correctCount)) : 0;
  const wrongCount = Number.isFinite(value.wrongCount) ? Math.max(0, Number(value.wrongCount)) : 0;
  const blankCount = Number.isFinite(value.blankCount) ? Math.max(0, Number(value.blankCount)) : 0;
  const totalWrongAnswers = Number.isFinite(value.totalWrongAnswers) ? Math.max(0, Number(value.totalWrongAnswers)) : wrongCount;
  const totalBlankAnswers = Number.isFinite(value.totalBlankAnswers) ? Math.max(0, Number(value.totalBlankAnswers)) : blankCount;

  return {
    seenCount,
    correctCount,
    wrongCount,
    blankCount,
    totalWrongAnswers,
    totalBlankAnswers,
    completedQuizCount: Number.isFinite(value.completedQuizCount) ? Math.max(0, Number(value.completedQuizCount)) : 0,
    lastPlayedAt: Number.isFinite(value.lastPlayedAt) ? Number(value.lastPlayedAt) : 0,
  };
};

const normalizeWrongQuestionStatus = (value: unknown): WrongQuestionStatus => {
  if (value === 'active_wrong' || value === 'active_blank' || value === 'resolved') return value;
  return 'active_wrong';
};

const getTimestampMillis = (value: unknown): number => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const maybeTimestamp = value as { toDate: () => Date };
    try {
      return maybeTimestamp.toDate().getTime();
    } catch {
      return 0;
    }
  }
  return 0;
};

const formatDateTime = (value: unknown): string => {
  const ms = getTimestampMillis(value);
  if (!ms) return '-';
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getQuestionSourceKey = (question: Question): string => {
  const rawSourceTag = typeof question.sourceTag === 'string' ? question.sourceTag.trim() : '';
  return rawSourceTag.length > 0 ? rawSourceTag : UNTAGGED_SOURCE_KEY;
};

const getSourceTagLabel = (sourceKey: string): string => {
  return sourceKey === UNTAGGED_SOURCE_KEY ? 'Etiketsiz' : sourceKey;
};

type QuestionFormState = {
  imageUrl: string;
  contextText: string;
  itemsText: string;
  sourceTag: string;
  questionRoot: string;
  optionsText: string;
  correctOption: number;
  explanation: string;
};

type PendingQuestionDraft = {
  imageUrl: string | null;
  contextText: string | null;
  contentItems: string[] | null;
  sourceTag: string | null;
  questionText: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  topicId: string;
  createdAt: Date;
};

const EMPTY_QUESTION_FORM: QuestionFormState = {
  imageUrl: '',
  contextText: '',
  itemsText: '',
  sourceTag: '',
  questionRoot: '',
  optionsText: '',
  correctOption: 0,
  explanation: '',
};

export default function App() {
  const getAutoDurationForQuestionCount = (questionCount: number): number => {
    return Math.max(0, questionCount) * 30;
  };

  // -- State --
  const [user, setUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginPasswordConfirm, setLoginPasswordConfirm] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const [categories, setCategories] = useState<Category[]>(() => getStoredCategories());
  const [topicProgressStats, setTopicProgressStats] = useState<Record<string, TopicProgressStats>>({});
  const [wrongQuestionStatsById, setWrongQuestionStatsById] = useState<Record<string, WrongQuestionStats>>({});
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeTopic, setActiveTopic] = useState<{ cat: Category, sub: SubCategory } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => getStoredTheme());

  // Quiz Configuration State
  const [quizConfig, setQuizConfig] = useState({
    questionCount: 10,
    durationSeconds: 300,
  });
  const [quizTagQuestionCounts, setQuizTagQuestionCounts] = useState<Record<string, number>>({});

  // --- SORULAR STATE (ARTIK BOŞ BAŞLIYOR) ---
  const [allQuestions, setAllQuestions] = useState<Record<string, Question[]>>({});

  // Quiz State
  const [quizState, setQuizState] = useState<QuizState>({
    currentQuestionIndex: 0,
    userAnswers: [],
    showResults: false,
    questions: [],
    loading: false,
    error: null,
    timeLeft: 0,
    totalTime: 0,
    isTimerActive: false,
  });

  // Admin Panel State
  const [adminSelectedCatId, setAdminSelectedCatId] = useState<string>('');
  const [adminSelectedTopicId, setAdminSelectedTopicId] = useState<string>('');
  const [adminQuestionSearch, setAdminQuestionSearch] = useState('');
  const [adminQuestionPage, setAdminQuestionPage] = useState(1);
  const [isAdminActionsOpen, setIsAdminActionsOpen] = useState(false);
  const [adminPreviewQuestion, setAdminPreviewQuestion] = useState<Question | null>(null);
  const [adminPreviewSelectedOption, setAdminPreviewSelectedOption] = useState<number | null>(null);
  const [adminPreviewChecked, setAdminPreviewChecked] = useState(false);
  const [questionReports, setQuestionReports] = useState<QuestionReport[]>([]);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportingQuestion, setReportingQuestion] = useState<Question | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [quizConfirmAction, setQuizConfirmAction] = useState<QuizConfirmAction | null>(null);
  const [isResetStatsModalOpen, setIsResetStatsModalOpen] = useState(false);
  const [resetStatsTargetTopic, setResetStatsTargetTopic] = useState<{ id: string; name: string } | null>(null);
  const [quizStatusFilter, setQuizStatusFilter] = useState<{ wrong: boolean; blank: boolean }>({ wrong: false, blank: false });

  // Admin Modals
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTopicModalOpen, setIsTopicModalOpen] = useState(false);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newTopicName, setNewTopicName] = useState('');

  // Edit Question State
  const [editingQuestion, setEditingQuestion] = useState<{ index: number; question: Question } | null>(null);
  const [editForm, setEditForm] = useState({
    imageUrl: '',
    contextText: '',
    itemsText: '',
    sourceTag: '',
    questionRoot: '',
    optionsText: '',
    correctOption: 0,
    explanation: ''
  });

  // Bulk Import State
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState<Question[]>([]);
  const [bulkParseErrors, setBulkParseErrors] = useState<string[]>([]);
  const [bulkStep, setBulkStep] = useState<'paste' | 'preview'>('paste');

  // Add Question Form State
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(EMPTY_QUESTION_FORM);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionDraft[]>([]);

  // Quiz Font Size: 0=compact, 1=normal, 2=large
  const [quizSize, setQuizSize] = useState<0 | 1 | 2>(() => getStoredQuizSize());

  // Mobile Menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Timer Ref
  const timerRef = useRef<number | null>(null);
  // Auto-advance ref
  const autoAdvanceRef = useRef<number | null>(null);
  const wrongQuestionIdsByTopic = useMemo<Record<string, string[]>>(() => {
    const next: Record<string, string[]> = {};
    (Object.values(wrongQuestionStatsById) as WrongQuestionStats[]).forEach((stats) => {
      if (stats.status !== 'active_wrong') return;
      if (!next[stats.topicId]) next[stats.topicId] = [];
      next[stats.topicId].push(stats.questionTrackingId);
    });
    return next;
  }, [wrongQuestionStatsById]);
  const blankQuestionIdsByTopic = useMemo<Record<string, string[]>>(() => {
    const next: Record<string, string[]> = {};
    (Object.values(wrongQuestionStatsById) as WrongQuestionStats[]).forEach((stats) => {
      if (stats.status !== 'active_blank') return;
      if (!next[stats.topicId]) next[stats.topicId] = [];
      next[stats.topicId].push(stats.questionTrackingId);
    });
    return next;
  }, [wrongQuestionStatsById]);

  // -- Effects --
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.theme, isDarkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(categories));
    } catch {
      // Ignore storage errors
    }
  }, [categories]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.quizSize, String(quizSize));
    } catch {
      // Ignore storage errors
    }
  }, [quizSize]);

  // --- FIREBASE VERİ ÇEKME EFFECT'İ ---
  useEffect(() => {
    // Firestore'daki "questions" koleksiyonunu dinle
    const q = query(collection(db, "questions"));
    
    // Canlı dinleyici (Real-time listener)
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupedQuestions: Record<string, Question[]> = {};
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        // Firestore verisini Question tipine çeviriyoruz
        const question = { 
          ...data, 
          id: doc.id, // Firestore ID'sini kullan
          options: data.options || [], // Güvenlik önlemi
          contentItems: data.contentItems || undefined
        } as Question & { topicId: string }; 

        // Soruları konu ID'lerine (topicId) göre grupla
        const tId = question.topicId;
        if (!tId) return; // topicId yoksa atla

        if (!groupedQuestions[tId]) {
          groupedQuestions[tId] = [];
        }
        groupedQuestions[tId].push(question);
      });
      
      // Tarihe göre (oluşturulma sırası) veya başka bir şeye göre sıralama yapılabilir
      // Şimdilik olduğu gibi kaydediyoruz
      setAllQuestions(groupedQuestions);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') {
      setQuestionReports([]);
      return;
    }

    const q = query(collection(db, "questionReports"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const reports = snapshot.docs
          .map((reportDoc) => ({ id: reportDoc.id, ...reportDoc.data() } as QuestionReport))
          .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
        setQuestionReports(reports);
      },
      (error) => {
        console.error("Raporlari dinlerken hata:", error);
        setQuestionReports([]);
      }
    );

    return () => unsubscribe();
  }, [user?.role]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setIsAuthBootstrapping(false);
        return;
      }

      try {
        const token = await firebaseUser.getIdTokenResult();
        const role: User['role'] = token.claims.admin === true ? 'admin' : 'user';
        const fallbackName = firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Kullanici';
        const username = firebaseUser.displayName?.trim() || fallbackName;

        setUser({ uid: firebaseUser.uid, username, role });
        if (role !== 'admin') {
          setCurrentView(prev => (prev === 'admin' ? 'dashboard' : prev));
        }
      } catch (error) {
        console.error("Auth kullanici bilgisi okunamadi:", error);
        setUser(null);
      } finally {
        setIsAuthBootstrapping(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const cleanupExpiredResolvedWrongQuestions = async (uid: string, wrongDocIds: string[]) => {
    if (wrongDocIds.length === 0) return;
    for (let i = 0; i < wrongDocIds.length; i += 400) {
      const batch = writeBatch(db);
      wrongDocIds.slice(i, i + 400).forEach((docId) => {
        batch.delete(doc(db, 'users', uid, 'wrongQuestions', docId));
      });
      await batch.commit();
    }
  };

  useEffect(() => {
    if (!user?.uid || typeof window === 'undefined') return;

    const migrationKey = `${TOPIC_STATS_MIGRATION_KEY_PREFIX}${user.uid}`;
    try {
      if (window.localStorage.getItem(migrationKey) === '1') return;
    } catch {
      return;
    }

    const legacyStats = getStoredLegacyTopicProgressStats();
    const entries = Object.entries(legacyStats);
    if (entries.length === 0) {
      try {
        window.localStorage.setItem(migrationKey, '1');
      } catch {
        // ignore
      }
      return;
    }

    const migrate = async () => {
      try {
        let batch = writeBatch(db);
        let opCount = 0;
        const commitCurrentBatch = async () => {
          if (opCount === 0) return;
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        };

        for (const [topicId, legacyValue] of entries) {
          const migratedTopicStats = normalizeTopicProgressStats({
            seenCount: legacyValue.seenQuestionIds.length,
            correctCount: legacyValue.correctCount,
            wrongCount: legacyValue.wrongQuestionIds.length,
            blankCount: legacyValue.blankQuestionIds.length,
            totalWrongAnswers: legacyValue.wrongCount,
            totalBlankAnswers: legacyValue.blankCount,
            completedQuizCount: legacyValue.completedQuizCount,
            lastPlayedAt: legacyValue.lastPlayedAt,
          });
          batch.set(doc(db, 'users', user.uid, 'topicStats', topicId), migratedTopicStats, { merge: true });
          opCount += 1;
          if (opCount >= 450) await commitCurrentBatch();

          const wrongSet = new Set(legacyValue.wrongQuestionIds);
          const blankSet = new Set(legacyValue.blankQuestionIds.filter((questionTrackingId) => !wrongSet.has(questionTrackingId)));
          const baseTimestamp = legacyValue.lastPlayedAt || Date.now();

          for (const questionTrackingId of wrongSet) {
            batch.set(
              doc(db, 'users', user.uid, 'wrongQuestions', getWrongQuestionDocId(questionTrackingId)),
              {
                questionTrackingId,
                topicId,
                status: 'active_wrong',
                recoveryStreak: legacyValue.wrongRecoveryStreakByQuestionId[questionTrackingId] || 0,
                wrongCount: 1,
                blankCount: 0,
                lastWrongAt: baseTimestamp,
                resolvedAt: 0,
              } satisfies WrongQuestionStats,
              { merge: true }
            );
            opCount += 1;
            if (opCount >= 450) await commitCurrentBatch();
          }

          for (const questionTrackingId of blankSet) {
            batch.set(
              doc(db, 'users', user.uid, 'wrongQuestions', getWrongQuestionDocId(questionTrackingId)),
              {
                questionTrackingId,
                topicId,
                status: 'active_blank',
                recoveryStreak: 0,
                wrongCount: 0,
                blankCount: 1,
                lastWrongAt: baseTimestamp,
                resolvedAt: 0,
              } satisfies WrongQuestionStats,
              { merge: true }
            );
            opCount += 1;
            if (opCount >= 450) await commitCurrentBatch();
          }
        }

        await commitCurrentBatch();
        try {
          window.localStorage.setItem(migrationKey, '1');
        } catch {
          // ignore
        }
      } catch (error) {
        console.error('Yerel istatistik migration hatasi:', error);
      }
    };

    void migrate();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setTopicProgressStats({});
      setWrongQuestionStatsById({});
      return;
    }

    const topicStatsQuery = query(collection(db, 'users', user.uid, 'topicStats'));
    const wrongQuestionsQuery = query(collection(db, 'users', user.uid, 'wrongQuestions'));

    const unsubscribeTopicStats = onSnapshot(
      topicStatsQuery,
      (snapshot) => {
        const nextStats: Record<string, TopicProgressStats> = {};
        snapshot.forEach((topicDoc) => {
          const data = topicDoc.data() as Partial<TopicProgressStats> & { lastPlayedAt?: unknown };
          nextStats[topicDoc.id] = normalizeTopicProgressStats({
            seenCount: data.seenCount,
            correctCount: data.correctCount,
            wrongCount: data.wrongCount,
            blankCount: data.blankCount,
            totalWrongAnswers: data.totalWrongAnswers,
            totalBlankAnswers: data.totalBlankAnswers,
            completedQuizCount: data.completedQuizCount,
            lastPlayedAt: getTimestampMillis(data.lastPlayedAt),
          });
        });
        setTopicProgressStats(nextStats);
      },
      (error) => {
        console.error('Topic istatistikleri okunamadi:', error);
        setTopicProgressStats({});
      }
    );

    const unsubscribeWrongQuestions = onSnapshot(
      wrongQuestionsQuery,
      (snapshot) => {
        const now = Date.now();
        const nextWrongStats: Record<string, WrongQuestionStats> = {};
        const expiredResolvedDocIds: string[] = [];

        snapshot.forEach((wrongDoc) => {
          const data = wrongDoc.data() as Record<string, unknown>;
          const questionTrackingId =
            (typeof data.questionTrackingId === 'string' && data.questionTrackingId.length > 0)
              ? data.questionTrackingId
              : getQuestionTrackingIdFromWrongDocId(wrongDoc.id);
          const topicId = typeof data.topicId === 'string' ? data.topicId : '';
          if (!questionTrackingId || !topicId) return;

          const status = normalizeWrongQuestionStatus(data.status);
          const resolvedAt = getTimestampMillis(data.resolvedAt);
          if (status === 'resolved' && resolvedAt > 0 && now - resolvedAt >= RESOLVED_RETENTION_MS) {
            expiredResolvedDocIds.push(wrongDoc.id);
            return;
          }

          nextWrongStats[questionTrackingId] = {
            questionTrackingId,
            topicId,
            status,
            recoveryStreak: Number.isFinite(data.recoveryStreak) ? Math.max(0, Math.floor(Number(data.recoveryStreak))) : 0,
            wrongCount: Number.isFinite(data.wrongCount) ? Math.max(0, Math.floor(Number(data.wrongCount))) : 0,
            blankCount: Number.isFinite(data.blankCount) ? Math.max(0, Math.floor(Number(data.blankCount))) : 0,
            lastWrongAt: getTimestampMillis(data.lastWrongAt),
            resolvedAt,
          };
        });

        setWrongQuestionStatsById(nextWrongStats);

        if (expiredResolvedDocIds.length > 0) {
          void cleanupExpiredResolvedWrongQuestions(user.uid, expiredResolvedDocIds);
        }
      },
      (error) => {
        console.error('Yanlis soru havuzu okunamadi:', error);
        setWrongQuestionStatsById({});
      }
    );

    return () => {
      unsubscribeTopicStats();
      unsubscribeWrongQuestions();
    };
  }, [user?.uid]);

  // Timer Logic
  useEffect(() => {
    if (currentView === 'quiz' && quizState.isTimerActive && !quizState.showResults && quizState.timeLeft > 0) {
      timerRef.current = window.setInterval(() => {
        setQuizState(prev => {
          if (prev.timeLeft <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return { ...prev, timeLeft: 0, showResults: true, isTimerActive: false };
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentView, quizState.isTimerActive, quizState.showResults]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  // -- Handlers --

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const normalizedEmail = loginEmail.trim().toLowerCase();
    const normalizedPassword = loginPassword.trim();
    const normalizedPasswordConfirm = loginPasswordConfirm.trim();

    if (!normalizedEmail || !normalizedPassword) {
      setLoginError('E-posta ve sifre giriniz.');
      return;
    }

    if (authMode === 'register') {
      if (normalizedPassword.length < 6) {
        setLoginError('Sifre en az 6 karakter olmali.');
        return;
      }
      if (normalizedPassword !== normalizedPasswordConfirm) {
        setLoginError('Sifreler eslesmiyor.');
        return;
      }
    }

    setIsAuthLoading(true);
    try {
      if (authMode === 'register') {
        await createUserWithEmailAndPassword(auth, normalizedEmail, normalizedPassword);
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, normalizedPassword);
      }

      setLoginPassword('');
      setLoginPasswordConfirm('');
      if (authMode === 'register') {
        setAuthMode('login');
      }
    } catch (error) {
      console.error("Giris hatasi:", error);
      const rawCode = (error as { code?: string })?.code || '';
      if (rawCode.includes('auth/email-already-in-use')) {
        setLoginError('Bu e-posta zaten kayitli.');
      } else if (rawCode.includes('auth/invalid-email')) {
        setLoginError('Gecerli bir e-posta giriniz.');
      } else if (rawCode.includes('auth/operation-not-allowed')) {
        setLoginError('Email/Sifre girisi Firebase tarafinda kapali. Authentication > Sign-in method ekranindan Email/Password secenegini aktif edin.');
      } else if (rawCode.includes('auth/invalid-credential') || rawCode.includes('auth/wrong-password') || rawCode.includes('auth/user-not-found')) {
        setLoginError('E-posta veya sifre hatali.');
      } else if (rawCode.includes('auth/unauthorized-domain')) {
        setLoginError('Bu domain Firebase Auth icin yetkili degil. Authentication > Settings > Authorized domains alanina domaini ekleyin.');
      } else if (rawCode.includes('auth/too-many-requests')) {
        setLoginError('Cok fazla deneme yapildi. Lutfen daha sonra tekrar deneyin.');
      } else {
        setLoginError(
          authMode === 'register'
            ? 'Kayit olusturulamadi. Lutfen tekrar deneyin.'
            : 'Giris sirasinda bir hata olustu. Tekrar deneyin.'
        );
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Cikis hatasi:", error);
    }
    setUser(null);
    setCurrentView('dashboard');
    setActiveCategory(null);
    setActiveTopic(null);
    setLoginEmail('');
    setLoginPassword('');
    setLoginPasswordConfirm('');
    setLoginError('');
    setAuthMode('login');
    setIsMobileMenuOpen(false);
    resetQuiz();
  };

  const resetQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    setReportingQuestion(null);
    setReportNote('');
    setQuizConfirmAction(null);
    setQuizState({
      currentQuestionIndex: 0,
      userAnswers: [],
      showResults: false,
      questions: [],
      loading: false,
      error: null,
      timeLeft: 0,
      totalTime: 0,
      isTimerActive: false,
    });
  };

  const openQuizSetup = (category: Category, sub: SubCategory, preset: 'all' | 'wrong' | 'blank' | 'both' = 'all') => {
    const topicQuestions = allQuestions[sub.id] || [];
    const wrongSet = new Set(wrongQuestionIdsByTopic[sub.id] || []);
    const blankSet = new Set(blankQuestionIdsByTopic[sub.id] || []);
    const nextStatusFilter =
      preset === 'wrong'
        ? { wrong: true, blank: false }
        : preset === 'blank'
          ? { wrong: false, blank: true }
          : preset === 'both'
            ? { wrong: true, blank: true }
            : { wrong: false, blank: false };
    const statusActive = nextStatusFilter.wrong || nextStatusFilter.blank;
    const filteredCount = statusActive
      ? topicQuestions.filter((question, index) => {
          const questionTrackingId = getQuestionTrackingId(question, sub.id, index);
          const includeWrong = nextStatusFilter.wrong && wrongSet.has(questionTrackingId);
          const includeBlank = nextStatusFilter.blank && blankSet.has(questionTrackingId);
          return includeWrong || includeBlank;
        }).length
      : topicQuestions.length;

    setActiveTopic({ cat: category, sub: sub });
    const initialQuestionCount = filteredCount > 0 ? Math.min(10, filteredCount) : 0;
    setQuizStatusFilter(nextStatusFilter);
    setQuizTagQuestionCounts({});
    setQuizConfig({
      questionCount: initialQuestionCount,
      durationSeconds: getAutoDurationForQuestionCount(initialQuestionCount),
    });
    setCurrentView('quiz-setup');
  };

  const handleStartQuiz = () => {
    if (!activeTopic) return;

    const topicId = activeTopic.sub.id;
    const wrongSet = new Set(wrongQuestionIdsByTopic[topicId] || []);
    const blankSet = new Set(blankQuestionIdsByTopic[topicId] || []);
    const isStatusFilterActive = quizStatusFilter.wrong || quizStatusFilter.blank;
    const topicQuestionsPool = (allQuestions[topicId] || []).filter((question, index) => {
      if (!isStatusFilterActive) return true;
      const questionTrackingId = getQuestionTrackingId(question, topicId, index);
      const includeWrong = quizStatusFilter.wrong && wrongSet.has(questionTrackingId);
      const includeBlank = quizStatusFilter.blank && blankSet.has(questionTrackingId);
      return includeWrong || includeBlank;
    });
    const selectedTagEntries = Object.keys(quizTagQuestionCounts)
      .map((sourceKey) => ({
        sourceKey,
        count: Math.max(0, Math.floor(Number(quizTagQuestionCounts[sourceKey] || 0))),
      }))
      .filter((entry) => entry.count > 0);

    let selectedQuestions: Question[] = [];
    if (selectedTagEntries.length > 0) {
      const tagBuckets = topicQuestionsPool.reduce<Record<string, Question[]>>((acc, question) => {
        const sourceKey = getQuestionSourceKey(question);
        if (!acc[sourceKey]) acc[sourceKey] = [];
        acc[sourceKey].push(question);
        return acc;
      }, {});

      selectedTagEntries.forEach(({ sourceKey, count }) => {
        const tagQuestions = [...(tagBuckets[sourceKey] || [])];
        for (let i = tagQuestions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tagQuestions[i], tagQuestions[j]] = [tagQuestions[j], tagQuestions[i]];
        }
        selectedQuestions.push(...tagQuestions.slice(0, Math.min(count, tagQuestions.length)));
      });

      for (let i = selectedQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [selectedQuestions[i], selectedQuestions[j]] = [selectedQuestions[j], selectedQuestions[i]];
      }
    } else {
      for (let i = topicQuestionsPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [topicQuestionsPool[i], topicQuestionsPool[j]] = [topicQuestionsPool[j], topicQuestionsPool[i]];
      }
      selectedQuestions = topicQuestionsPool.slice(0, quizConfig.questionCount);
    }

    setCurrentView('quiz');
    setQuizState(prev => ({
      ...prev,
      loading: true,
      error: null,
      questions: [],
      userAnswers: [],
      showResults: false,
      currentQuestionIndex: 0,
      timeLeft: quizConfig.durationSeconds,
      totalTime: quizConfig.durationSeconds,
      isTimerActive: true
    }));

    // Soruları karıştır ve seç
    
    // Basit karıştırma algoritması (Fisher-Yates)
    

    setTimeout(() => {
      if (selectedQuestions.length > 0) {
        setQuizState(prev => ({
          ...prev,
          questions: selectedQuestions,
          userAnswers: new Array(selectedQuestions.length).fill(null),
          loading: false
        }));
      } else {
        setQuizState(prev => ({
          ...prev,
          loading: false,
          error: "Bu kriterlere uygun soru bulunamadi."
        }));
      }
    }, 600);
  };

  const handleSelectOption = (optionIndex: number) => {
    if (quizState.showResults) return;

    const newAnswers = [...quizState.userAnswers];
    newAnswers[quizState.currentQuestionIndex] = optionIndex;

    setQuizState(prev => ({
      ...prev,
      userAnswers: newAnswers
    }));

    // Auto-advance after 1 second
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = window.setTimeout(() => {
      setQuizState(prev => {
        if (prev.showResults) return prev;
        if (prev.currentQuestionIndex < prev.questions.length - 1) {
          return { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 };
        }
        return prev;
      });
    }, 1000);
  };

  const handleNextQuestion = () => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    if (quizState.currentQuestionIndex < quizState.questions.length - 1) {
      setQuizState(prev => ({
        ...prev,
        currentQuestionIndex: prev.currentQuestionIndex + 1
      }));
    } else {
      handleFinishQuiz();
    }
  };

  const handlePrevQuestion = () => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    if (quizState.currentQuestionIndex > 0) {
      setQuizState(prev => ({
        ...prev,
        currentQuestionIndex: prev.currentQuestionIndex - 1
      }));
    }
  };

  const goToQuestion = (index: number) => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    setQuizState(prev => ({
      ...prev,
      currentQuestionIndex: index
    }));
  };

  const getQuestionTrackingId = (question: Question, topicId: string, index: number): string => {
    if (typeof question.id === 'string' && question.id.length > 0) {
      return question.id;
    }
    return `${topicId}_${index}_${question.questionText.trim().toLocaleLowerCase('tr')}`;
  };

  const handleFinishQuiz = () => {
    if (quizState.showResults) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);

    if (activeTopic && quizState.questions.length > 0 && user?.uid) {
      const topicId = activeTopic.sub.id;
      const currentAnswers = quizState.userAnswers;
      const currentQuestions = quizState.questions;
      const now = Date.now();
      const nextWrongQuestionStatsById = { ...wrongQuestionStatsById };
      const changedQuestionIds = new Set<string>();
      const prevTopicStats = topicProgressStats[topicId] || EMPTY_TOPIC_PROGRESS;
      const nextTopicStats: TopicProgressStats = {
        ...prevTopicStats,
        seenCount: prevTopicStats.seenCount + currentQuestions.length,
        correctCount: prevTopicStats.correctCount,
        wrongCount: prevTopicStats.wrongCount,
        blankCount: prevTopicStats.blankCount,
        totalWrongAnswers: prevTopicStats.totalWrongAnswers,
        totalBlankAnswers: prevTopicStats.totalBlankAnswers,
        completedQuizCount: prevTopicStats.completedQuizCount + 1,
        lastPlayedAt: now,
      };

      currentQuestions.forEach((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, topicId, index);
        const prevWrongStats = nextWrongQuestionStatsById[questionTrackingId];
        const answer = currentAnswers[index];

        if (answer === null || answer === undefined) {
          nextTopicStats.totalBlankAnswers += 1;
          nextWrongQuestionStatsById[questionTrackingId] = {
            questionTrackingId,
            topicId,
            status: 'active_blank',
            recoveryStreak: 0,
            wrongCount: prevWrongStats?.wrongCount || 0,
            blankCount: (prevWrongStats?.blankCount || 0) + 1,
            lastWrongAt: now,
            resolvedAt: 0,
          };
          changedQuestionIds.add(questionTrackingId);
          return;
        }

        if (answer === question.correctOptionIndex) {
          nextTopicStats.correctCount += 1;
          if (prevWrongStats && (prevWrongStats.status === 'active_wrong' || prevWrongStats.status === 'active_blank')) {
            const nextRecoveryStreak = prevWrongStats.recoveryStreak + 1;
            nextWrongQuestionStatsById[questionTrackingId] = {
              ...prevWrongStats,
              recoveryStreak: nextRecoveryStreak,
              status: nextRecoveryStreak >= WRONG_RECOVERY_STREAK_TARGET ? 'resolved' : prevWrongStats.status,
              resolvedAt: nextRecoveryStreak >= WRONG_RECOVERY_STREAK_TARGET ? now : 0,
            };
            changedQuestionIds.add(questionTrackingId);
          }
          return;
        }

        nextTopicStats.totalWrongAnswers += 1;
        nextWrongQuestionStatsById[questionTrackingId] = {
          questionTrackingId,
          topicId,
          status: 'active_wrong',
          recoveryStreak: 0,
          wrongCount: (prevWrongStats?.wrongCount || 0) + 1,
          blankCount: prevWrongStats?.blankCount || 0,
          lastWrongAt: now,
          resolvedAt: 0,
        };
        changedQuestionIds.add(questionTrackingId);
      });

      const activeWrongCount = (Object.values(nextWrongQuestionStatsById) as WrongQuestionStats[]).reduce<number>((sum, stats) => {
        return stats.topicId === topicId && stats.status === 'active_wrong' ? sum + 1 : sum;
      }, 0);
      const activeBlankCount = (Object.values(nextWrongQuestionStatsById) as WrongQuestionStats[]).reduce<number>((sum, stats) => {
        return stats.topicId === topicId && stats.status === 'active_blank' ? sum + 1 : sum;
      }, 0);
      nextTopicStats.wrongCount = activeWrongCount;
      nextTopicStats.blankCount = activeBlankCount;

      setTopicProgressStats((prev) => ({
        ...prev,
        [topicId]: nextTopicStats,
      }));
      setWrongQuestionStatsById(nextWrongQuestionStatsById);

      const persistTopicAndWrongStats = async () => {
        try {
          const batch = writeBatch(db);
          batch.set(doc(db, 'users', user.uid, 'topicStats', topicId), nextTopicStats, { merge: true });

          changedQuestionIds.forEach((questionTrackingId) => {
            const wrongStats = nextWrongQuestionStatsById[questionTrackingId];
            if (!wrongStats) return;
            batch.set(
              doc(db, 'users', user.uid, 'wrongQuestions', getWrongQuestionDocId(questionTrackingId)),
              wrongStats,
              { merge: true }
            );
          });

          await batch.commit();
        } catch (error) {
          console.error('Quiz istatistikleri kaydedilemedi:', error);
        }
      };

      void persistTopicAndWrongStats();
    }

    setQuizState(prev => ({
      ...prev,
      showResults: true,
      isTimerActive: false
    }));
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // --- Admin Handlers (GÜNCELLENDİ) ---

  const handleDeleteQuestion = async (questionId: string) => {
    if (!user || user.role !== 'admin') return;
    if (!window.confirm("Bu soruyu kalici olarak silmek istediginize emin misiniz?")) return;
    
    try {
      await deleteDoc(doc(db, "questions", questionId));
      if (adminPreviewQuestion?.id === questionId) {
        handleCloseAdminPreview();
      }
      // Manuel state güncellemesine gerek yok, onSnapshot halledecek
    } catch (error) {
      console.error("Silme hatası:", error);
      alert("Soru silinirken hata oluştu.");
    }
  };
  const handleReportQuestion = (question: Question) => {
    if (!activeTopic || !question.id || isSubmittingReport) {
      if (!question.id) {
        alert("Bu soru raporlanamadi. Soru kimligi bulunamadi.");
      }
      return;
    }
    setReportingQuestion(question);
    setReportNote('');
  };

  const handleCancelQuestionReport = () => {
    if (isSubmittingReport) return;
    setReportingQuestion(null);
    setReportNote('');
  };

  const handleSubmitQuestionReport = async () => {
    if (!activeTopic || !reportingQuestion?.id || isSubmittingReport) return;
    setIsSubmittingReport(true);
    try {
      await addDoc(collection(db, "questionReports"), {
        questionId: reportingQuestion.id,
        topicId: activeTopic.sub.id,
        categoryId: activeTopic.cat.id,
        reporterUsername: user?.username || "Kullanici",
        reporterRole: user?.role || "user",
        note: reportNote.trim() || null,
        questionTextSnapshot: reportingQuestion.questionText,
        createdAt: new Date(),
      });
      alert("Bildiriminiz alindi.");
      setReportingQuestion(null);
      setReportNote('');
    } catch (error) {
      console.error("Soru raporlama hatasi:", error);
      alert("Bildirim gonderilemedi. Lutfen tekrar deneyin.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!user || user.role !== 'admin') return;
    if (!window.confirm("Bu bildirimi silmek istediginize emin misiniz?")) return;
    try {
      await deleteDoc(doc(db, "questionReports", reportId));
    } catch (error) {
      console.error("Bildirim silme hatasi:", error);
      alert("Bildirim silinemedi.");
    }
  };
  const getCreatedAtMillis = (question: Question): number => {
    const createdAt = (question as Question & { createdAt?: unknown }).createdAt;
    return getTimestampMillis(createdAt);
  };

  const getLatestTopicQuestions = (count: number): Array<Question & { id: string }> => {
    if (!adminSelectedTopicId) return [];
    const topicQuestions = allQuestions[adminSelectedTopicId] || [];
    return [...topicQuestions]
      .filter((q): q is Question & { id: string } => typeof q.id === 'string' && q.id.length > 0)
      .sort((a, b) => getCreatedAtMillis(b) - getCreatedAtMillis(a))
      .slice(0, count);
  };

  const commitInChunks = async (
    questions: Array<Question & { id: string }>,
    action: (batch: ReturnType<typeof writeBatch>, question: Question & { id: string }) => void
  ) => {
    const chunkSize = 450;
    for (let i = 0; i < questions.length; i += chunkSize) {
      const chunk = questions.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((question) => action(batch, question));
      await batch.commit();
    }
  };

  const handleBulkDeleteQuestions = async () => {
    if (!adminSelectedTopicId) return;
    const count = allQuestions[adminSelectedTopicId]?.length || 0;
    if (count === 0) return;
    if (!window.confirm(`Bu konudaki ${count} sorunun tamamini silmek istediginize emin misiniz?`)) return;

    try {
      // Önce bu konuya ait tüm soruları bul
      const q = query(collection(db, "questions"), where("topicId", "==", adminSelectedTopicId));
      const snapshot = await getDocs(q);

      // Hepsini silmek için batch oluştur
      const batch = writeBatch(db);
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      // Manuel state güncellemesine gerek yok
    } catch (error) {
      console.error("Toplu silme hatası:", error);
      alert("Toplu silme sırasında hata oluştu.");
    }
  };

  const handleDeleteLatestQuestions = async () => {
    if (!adminSelectedTopicId) return;
    const totalCount = (allQuestions[adminSelectedTopicId] || []).length;
    if (totalCount === 0) return;

    const rawInput = window.prompt(`Kac adet son eklenen soruyu silmek istiyorsunuz? (1-${totalCount})`, '5');
    if (!rawInput) return;

    const requested = parseInt(rawInput, 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      alert("Lutfen gecerli bir sayi girin.");
      return;
    }

    const deleteCount = Math.min(requested, totalCount);
    const deletable = getLatestTopicQuestions(deleteCount);

    if (deletable.length === 0) {
      alert("Silinebilir soru bulunamadi.");
      return;
    }

    if (!window.confirm(`Bu konudaki son eklenen ${deletable.length} soruyu silmek istediginize emin misiniz?`)) return;

    try {
      await commitInChunks(deletable, (batch, q) => {
        batch.delete(doc(db, "questions", q.id));
      });
      setIsAdminActionsOpen(false);
    } catch (error) {
      console.error("Son sorulari silme hatası:", error);
      alert("Son eklenen sorular silinirken bir hata oluştu.");
    }
  };

  const handleTagLatestQuestions = async () => {
    if (!adminSelectedTopicId) return;
    const totalCount = (allQuestions[adminSelectedTopicId] || []).length;
    if (totalCount === 0) return;

    const rawInput = window.prompt(`Kac adet son eklenen soruya etiket eklensin? (1-${totalCount})`, '5');
    if (!rawInput) return;

    const requested = parseInt(rawInput, 10);
    if (!Number.isFinite(requested) || requested <= 0) {
      alert("Lutfen gecerli bir sayi girin.");
      return;
    }

    const rawTag = window.prompt('Eklenecek etiket nedir?', '');
    if (rawTag === null) return;

    const nextTag = rawTag.trim();
    if (!nextTag) {
      alert("Etiket bos olamaz.");
      return;
    }

    const tagCount = Math.min(requested, totalCount);
    const taggable = getLatestTopicQuestions(tagCount);

    if (taggable.length === 0) {
      alert("Etiketlenecek soru bulunamadi.");
      return;
    }

    if (!window.confirm(`Son eklenen ${taggable.length} soruya "${nextTag}" etiketi eklensin mi?`)) return;

    try {
      await commitInChunks(taggable, (batch, q) => {
        batch.update(doc(db, "questions", q.id), { sourceTag: nextTag });
      });
      setIsAdminActionsOpen(false);
    } catch (error) {
      console.error("Son sorulari etiketleme hatası:", error);
      alert("Son sorular etiketlenirken bir hata oluştu.");
    }
  };

  const handleStartEditQuestion = (q: Question, idx: number) => {
    setEditingQuestion({ index: idx, question: q });
    setEditForm({
      imageUrl: q.imageUrl || '',
      contextText: q.contextText || '',
      itemsText: q.contentItems ? q.contentItems.join('\n') : '',
      sourceTag: q.sourceTag || '',
      questionRoot: q.questionText,
      optionsText: q.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n'),
      correctOption: q.correctOptionIndex,
      explanation: q.explanation,
    });
  };

  const handleSaveEditQuestion = async () => {
    if (!editingQuestion) return;
    const options = parseOptions(editForm.optionsText);
    const contentItems = parseItems(editForm.itemsText);

    const updatedData = {
      imageUrl: editForm.imageUrl.trim() || null,
      contextText: editForm.contextText.trim() || null,
      contentItems: contentItems.length > 0 ? contentItems : null,
      sourceTag: editForm.sourceTag.trim() || null,
      questionText: editForm.questionRoot,
      options,
      correctOptionIndex: editForm.correctOption,
      explanation: editForm.explanation,
      // topicId değişmiyor
    };

    try {
      await updateDoc(doc(db, "questions", editingQuestion.question.id!), updatedData);
      setEditingQuestion(null);
    } catch (error) {
      console.error("Güncelleme hatası:", error);
      alert("Güncelleme sırasında hata oluştu.");
    }
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const newCat: Category = {
      id: Date.now().toString(),
      name: newCategoryName,
      iconName: 'BookOpen',
      description: 'Yeni eklenen kategori',
      subCategories: []
    };
    setCategories([...categories, newCat]);
    setNewCategoryName('');
    setIsCategoryModalOpen(false);
  };

  const handleAddTopic = () => {
    if (!newTopicName.trim()) return;
    let targetCatId = activeCategory?.id;
    if (currentView === 'admin' && adminSelectedCatId) targetCatId = adminSelectedCatId;
    if (!targetCatId) return;

    const newSub: SubCategory = { id: Date.now().toString(), name: newTopicName };
    const updatedCategories = categories.map(c => {
      if (c.id === targetCatId) return { ...c, subCategories: [...c.subCategories, newSub] };
      return c;
    });
    setCategories(updatedCategories);
    if (activeCategory && activeCategory.id === targetCatId) {
        setActiveCategory(prev => prev ? { ...prev, subCategories: [...prev.subCategories, newSub] } : null);
    }
    setNewTopicName('');
    setIsTopicModalOpen(false);
  };

  const parseOptions = (text: string): string[] => {
    const parts = text.split(/(?:^|\s+)[A-E]\)\s*/).filter(p => p.trim() !== '');
    if (parts.length >= 2) return parts.map(p => p.trim());
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length >= 2) return lines;
    return ["Secenek A", "Secenek B", "Secenek C", "Secenek D", "Secenek E"];
  };

  const parseItems = (text: string): string[] => {
    if (!text.trim()) return [];
    const regex = /(?:^|[\n,]\s*)(?=[IVX]+\.)/g;
    const items = text.split(regex).map(s => s.trim().replace(/^,/, '').trim()).filter(s => s !== '');
    if (items.length <= 1 && text.includes('\n')) return text.split('\n').filter(t => t.trim() !== '');
    return items.length > 0 ? items : [text];
  };

  const getCurrentQuestionTopicId = (): string => {
    let topicId = '';
    if (currentView === 'admin' && adminSelectedTopicId) topicId = adminSelectedTopicId;
    return topicId;
  };

  const buildDraftFromQuestionForm = (): PendingQuestionDraft | null => {
    const topicId = getCurrentQuestionTopicId();
    if (!topicId) return null;

    const questionText = questionForm.questionRoot.trim();
    if (!questionText) {
      alert("Soru kökü boş bırakılamaz.");
      return null;
    }

    const options = parseOptions(questionForm.optionsText);
    const contentItems = parseItems(questionForm.itemsText);

    return {
      imageUrl: questionForm.imageUrl.trim() || null,
      contextText: questionForm.contextText.trim() || null,
      contentItems: contentItems.length > 0 ? contentItems : null,
      sourceTag: questionForm.sourceTag.trim() || null,
      questionText,
      options: options,
      correctOptionIndex: questionForm.correctOption,
      explanation: questionForm.explanation.trim(),
      topicId: topicId,
      createdAt: new Date()
    };
  };

  const handleAddQuestionToQueue = () => {
    const draft = buildDraftFromQuestionForm();
    if (!draft) return;
    setPendingQuestions(prev => [...prev, draft]);
    setQuestionForm(EMPTY_QUESTION_FORM);
  };

  const handleSaveQuestion = async () => {
    if (pendingQuestions.length === 0) {
      alert("Kaydetmeden önce en az bir soruyu listeye ekleyin.");
      return;
    }
    try {
      const batch = writeBatch(db);
      pendingQuestions.forEach((draft) => {
        const docRef = doc(collection(db, "questions"));
        batch.set(docRef, draft);
      });

      await batch.commit();
      setPendingQuestions([]);
      setQuestionForm(EMPTY_QUESTION_FORM);
      setIsQuestionModalOpen(false);
    } catch (error) {
      console.error("Soru eklenirken hata:", error);
      alert("Soru eklenirken bir hata oluştu. İnternet bağlantınızı kontrol edin.");
    }
  };

  const handleRemovePendingQuestion = (index: number) => {
    setPendingQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const handleCloseQuestionModal = () => {
    if (pendingQuestions.length > 0) {
      const confirmed = window.confirm(`Listede kaydedilmemiş ${pendingQuestions.length} soru var. Kapatırsanız silinecek. Devam etmek istiyor musunuz?`);
      if (!confirmed) return;
    }
    setPendingQuestions([]);
    setQuestionForm(EMPTY_QUESTION_FORM);
    setIsQuestionModalOpen(false);
  };

  // Bulk import handlers
  const handleBulkParse = () => {
    if (!bulkText.trim()) return;
    const report = parseBulkQuestionsWithReport(bulkText);
    setBulkParsed(report.questions);
    setBulkParseErrors(report.errors);
    setBulkStep('preview');
  };

  const handleBulkSave = async () => {
    if (!adminSelectedTopicId || bulkParsed.length === 0) return;
    
    try {
      const batch = writeBatch(db);
      
      bulkParsed.forEach(q => {
        const docRef = doc(collection(db, "questions")); // Yeni ID al
        batch.set(docRef, {
          imageUrl: q.imageUrl ?? null,
          contextText: q.contextText ?? null,
          contentItems: q.contentItems ?? null,
          sourceTag: q.sourceTag ?? null,
          questionText: q.questionText,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation ?? '',
          topicId: adminSelectedTopicId,
          createdAt: new Date()
        });
      });

      await batch.commit(); // Hepsini tek seferde kaydet
      
      setBulkText('');
      setBulkParsed([]);
      setBulkParseErrors([]);
      setBulkStep('paste');
      setIsBulkImportOpen(false);
    } catch (error) {
      console.error("Toplu kayıt hatası:", error);
      alert("Toplu kayıt sırasında bir hata oluştu.");
    }
  };

  const handleBulkClose = () => {
    setIsBulkImportOpen(false);
    setBulkText('');
    setBulkParsed([]);
    setBulkParseErrors([]);
    setBulkStep('paste');
  };

  const handleRemoveBulkQuestion = (index: number) => {
    setBulkParsed(prev => prev.filter((_, i) => i !== index));
  };

  const handleOpenAdminPreview = (question: Question) => {
    setAdminPreviewQuestion(question);
    setAdminPreviewSelectedOption(null);
    setAdminPreviewChecked(false);
  };

  const handleCloseAdminPreview = () => {
    setAdminPreviewQuestion(null);
    setAdminPreviewSelectedOption(null);
    setAdminPreviewChecked(false);
  };

  const questionLookup = Object.keys(allQuestions).reduce<Record<string, Question & { topicId: string }>>((acc, topicId) => {
    const questions = allQuestions[topicId] || [];
    questions.forEach((q) => {
      if (q.id) {
        acc[q.id] = { ...q, topicId };
      }
    });
    return acc;
  }, {});

  const adminVisibleReports = questionReports.slice(0, 50);

  const adminTopicQuestions = adminSelectedTopicId ? (allQuestions[adminSelectedTopicId] || []) : [];
  const normalizedAdminSearch = adminQuestionSearch.trim().toLocaleLowerCase('tr');
  const adminFilteredQuestions = adminTopicQuestions
    .map((question, originalIndex) => ({ question, originalIndex }))
    .filter(({ question }) => {
      if (!normalizedAdminSearch) return true;
      const haystack = [
        question.questionText,
        question.contextText || '',
        (question.contentItems || []).join(' '),
        question.options.join(' '),
        question.sourceTag || '',
      ]
        .join(' ')
        .toLocaleLowerCase('tr');
      return haystack.includes(normalizedAdminSearch);
    });
  const adminTotalPages = Math.max(1, Math.ceil(adminFilteredQuestions.length / ADMIN_QUESTIONS_PER_PAGE));
  const adminSafePage = Math.min(adminQuestionPage, adminTotalPages);
  const adminPageStart = (adminSafePage - 1) * ADMIN_QUESTIONS_PER_PAGE;
  const adminVisibleQuestions = adminFilteredQuestions.slice(adminPageStart, adminPageStart + ADMIN_QUESTIONS_PER_PAGE);

  useEffect(() => {
    if (adminQuestionPage !== adminSafePage) {
      setAdminQuestionPage(adminSafePage);
    }
  }, [adminQuestionPage, adminSafePage]);

  useEffect(() => {
    if (!adminSelectedTopicId || currentView !== 'admin') {
      setIsAdminActionsOpen(false);
    }
  }, [adminSelectedTopicId, currentView]);

  const calculateScore = () => {
    if (!quizState.questions || quizState.questions.length === 0) return 0;
    let correct = 0;
    quizState.questions.forEach((q, idx) => {
        if (quizState.userAnswers[idx] === q.correctOptionIndex) correct++;
    });
    return correct;
  };

  const getTotalQuestionCount = () => {
    return Object.values(allQuestions).reduce<number>((sum, qs) => {
      return sum + (Array.isArray(qs) ? qs.length : 0);
    }, 0);
  };

  const getTopicProgress = (topicId: string): TopicProgressStats => {
    return topicProgressStats[topicId] || EMPTY_TOPIC_PROGRESS;
  };

  const allTopicProgressStats = Object.values(topicProgressStats) as TopicProgressStats[];
  const overallProgressStats = allTopicProgressStats.reduce<{
    seenCount: number;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    completedQuizCount: number;
  }>(
    (acc, stats) => {
      acc.seenCount += stats.seenCount;
      acc.correctCount += stats.correctCount;
      acc.wrongCount += stats.wrongCount;
      acc.blankCount += stats.blankCount;
      acc.completedQuizCount += stats.completedQuizCount;
      return acc;
    },
    { seenCount: 0, correctCount: 0, wrongCount: 0, blankCount: 0, completedQuizCount: 0 }
  );
  const hasAnyProgressStats = overallProgressStats.seenCount > 0 || overallProgressStats.completedQuizCount > 0 || overallProgressStats.wrongCount > 0 || overallProgressStats.blankCount > 0 || Object.keys(wrongQuestionStatsById).length > 0;
  const hasProgressForTopic = (topicId: string): boolean => {
    const stats = getTopicProgress(topicId);
    const activeWrongCount = (wrongQuestionIdsByTopic[topicId] || []).length;
    const activeBlankCount = (blankQuestionIdsByTopic[topicId] || []).length;
    return stats.seenCount > 0 || stats.completedQuizCount > 0 || stats.wrongCount > 0 || stats.blankCount > 0 || activeWrongCount > 0 || activeBlankCount > 0;
  };
  const resetStatsPreview = resetStatsTargetTopic
    ? (() => {
        const topicStats = getTopicProgress(resetStatsTargetTopic.id);
        return {
          seenCount: topicStats.seenCount,
          correctCount: topicStats.correctCount,
          wrongCount: topicStats.wrongCount,
          blankCount: topicStats.blankCount,
          completedQuizCount: topicStats.completedQuizCount,
        };
      })()
    : overallProgressStats;
  const handleResetTopicProgressStats = () => {
    if (!hasAnyProgressStats) return;
    setResetStatsTargetTopic(null);
    setIsResetStatsModalOpen(true);
  };
  const handleResetSingleTopicProgressStats = (topicId: string, topicName: string) => {
    if (!hasProgressForTopic(topicId)) return;
    setResetStatsTargetTopic({ id: topicId, name: topicName });
    setIsResetStatsModalOpen(true);
  };
  const handleCancelResetTopicProgressStats = () => {
    setIsResetStatsModalOpen(false);
    setResetStatsTargetTopic(null);
  };
  const handleConfirmResetTopicProgressStats = async () => {
    if (!user?.uid) {
      setIsResetStatsModalOpen(false);
      setResetStatsTargetTopic(null);
      return;
    }

    try {
      const commitDeleteRefsInChunks = async (refs: Array<DocumentReference>) => {
        for (let i = 0; i < refs.length; i += 400) {
          const batch = writeBatch(db);
          refs.slice(i, i + 400).forEach((ref) => {
            batch.delete(ref);
          });
          await batch.commit();
        }
      };

      if (resetStatsTargetTopic) {
        const topicId = resetStatsTargetTopic.id;
        const wrongQuestionsForTopic = await getDocs(query(collection(db, 'users', user.uid, 'wrongQuestions'), where('topicId', '==', topicId)));
        const refsToDelete = wrongQuestionsForTopic.docs.map((wrongDoc) => wrongDoc.ref);
        refsToDelete.push(doc(db, 'users', user.uid, 'topicStats', topicId));
        await commitDeleteRefsInChunks(refsToDelete);

        setTopicProgressStats((prev) => {
          if (!prev[topicId]) return prev;
          const next = { ...prev };
          delete next[topicId];
          return next;
        });
        setWrongQuestionStatsById((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((questionTrackingId) => {
            if (next[questionTrackingId].topicId === topicId) {
              delete next[questionTrackingId];
            }
          });
          return next;
        });
      } else {
        const [topicStatsSnapshot, wrongQuestionsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'topicStats'))),
          getDocs(query(collection(db, 'users', user.uid, 'wrongQuestions'))),
        ]);
        const refsToDelete = [
          ...topicStatsSnapshot.docs.map((topicDoc) => topicDoc.ref),
          ...wrongQuestionsSnapshot.docs.map((wrongDoc) => wrongDoc.ref),
        ];
        await commitDeleteRefsInChunks(refsToDelete);
        setTopicProgressStats({});
        setWrongQuestionStatsById({});
      }
    } catch (error) {
      console.error('Istatistik sifirlama hatasi:', error);
      alert('Istatistikler sifirlanamadi. Lutfen tekrar deneyin.');
    } finally {
      setIsResetStatsModalOpen(false);
      setResetStatsTargetTopic(null);
    }
  };

  // Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Gunaydin';
    if (hour < 18) return 'Iyi gunler';
    return 'Iyi aksamlar';
  };


  // ===== RENDER VIEWS =====

  if (isAuthBootstrapping) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 mesh-gradient opacity-30"></div>
        <div className="flex flex-col items-center gap-5 relative z-10 animate-fade-in">
          <div className="relative">
            <div className="w-16 h-16 border-3 border-surface-700/30 border-t-brand-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 w-16 h-16 border-3 border-transparent border-b-violet-500 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1s' }}></div>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-base mb-1">KPSS Pro</p>
            <p className="text-surface-400 text-sm font-medium">Oturum kontrol ediliyor...</p>
          </div>
        </div>
      </div>
    );
  }

  // 1. LOGIN VIEW
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 relative overflow-hidden">
        {/* Mesh Gradient Background */}
        <div className="absolute inset-0 mesh-gradient opacity-40"></div>

        {/* Animated Blobs */}
        <div className="absolute inset-0">
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-gradient-to-br from-brand-600/20 to-violet-600/15 rounded-full blur-[120px] animate-pulse-soft"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-gradient-to-br from-violet-600/20 to-purple-600/15 rounded-full blur-[120px] animate-pulse-soft" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-[40%] left-[50%] w-[350px] h-[350px] bg-gradient-to-br from-emerald-600/15 to-cyan-600/10 rounded-full blur-[100px] animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
        </div>

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '48px 48px' }}></div>

        <div className="w-full max-w-md relative z-10 px-5">
          <div className="animate-fade-in">
            {/* Logo & Title */}
            <div className="text-center mb-12">
              <div className="inline-flex p-5 bg-gradient-to-br from-brand-500 via-violet-600 to-purple-600 rounded-3xl shadow-2xl shadow-brand-500/30 mb-7 animate-float relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-50"></div>
                <Icon name="Brain" className="w-12 h-12 text-white relative z-10" />
              </div>
              <h1 className="text-5xl font-black text-white mb-3 tracking-tight bg-gradient-to-r from-white via-white to-white/80 bg-clip-text">
                KPSS Pro
              </h1>
              <p className="text-surface-400 text-base font-medium">Akıllı hazırlık ile başarıya bir adım daha yakın.</p>
            </div>

            {/* Login Card - Premium Glassmorphic */}
            <div className="glass-card rounded-3xl p-8 shadow-premium-lg relative overflow-hidden">
              <form onSubmit={handleLoginSubmit} className="space-y-5 relative z-10">
                <div>
                  <label className="block text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-2.5 ml-1">
                    E-posta
                  </label>
                  <div className="relative group">
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-surface-50/50 dark:bg-white/[0.04] border-2 border-surface-200/50 dark:border-white/[0.06] rounded-2xl focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/60 text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 outline-none transition-all text-sm font-medium hover:border-surface-300 dark:hover:border-white/[0.12] focus:bg-white dark:focus:bg-white/[0.06]"
                      placeholder="ornek@mail.com"
                      autoComplete="email"
                    />
                    <Icon name="User" className="w-5 h-5 text-surface-400 dark:text-surface-500 absolute left-4 top-1/2 -translate-y-1/2 transition-colors group-focus-within:text-brand-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-2.5 ml-1">
                    Şifre
                  </label>
                  <div className="relative group">
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-surface-50/50 dark:bg-white/[0.04] border-2 border-surface-200/50 dark:border-white/[0.06] rounded-2xl focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/60 text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 outline-none transition-all text-sm font-medium hover:border-surface-300 dark:hover:border-white/[0.12] focus:bg-white dark:focus:bg-white/[0.06]"
                      placeholder="Şifrenizi giriniz"
                      autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400 dark:text-surface-500 transition-colors group-focus-within:text-brand-500">
                       <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                  </div>
                </div>

                {authMode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-2.5 ml-1">
                      Şifre Tekrar
                    </label>
                    <div className="relative group">
                      <input
                        type="password"
                        value={loginPasswordConfirm}
                        onChange={(e) => setLoginPasswordConfirm(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-surface-50/50 dark:bg-white/[0.04] border-2 border-surface-200/50 dark:border-white/[0.06] rounded-2xl focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/60 text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 outline-none transition-all text-sm font-medium hover:border-surface-300 dark:hover:border-white/[0.12] focus:bg-white dark:focus:bg-white/[0.06]"
                        placeholder="Şifrenizi tekrar giriniz"
                        autoComplete="new-password"
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400 dark:text-surface-500 transition-colors group-focus-within:text-brand-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </div>
                    </div>
                  </div>
                )}

                {loginError && (
                  <div className="p-4 bg-red-500/10 dark:bg-red-500/5 border-2 border-red-500/20 dark:border-red-500/10 rounded-2xl text-red-600 dark:text-red-300 text-sm font-medium flex items-center gap-3 backdrop-blur-sm">
                     <Icon name="XCircle" className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0" />
                     {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full py-4 px-6 bg-gradient-to-r from-brand-600 via-violet-600 to-purple-600 text-white font-bold rounded-2xl hover:shadow-2xl hover:shadow-brand-600/30 transition-all duration-300 transform hover:-translate-y-1 hover:scale-[1.02] active:translate-y-0 active:scale-100 flex items-center justify-center gap-2.5 mt-3 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none text-base relative overflow-hidden group/btn"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300"></div>
                  <span className="relative z-10">{isAuthLoading ? 'Bekleyin...' : authMode === 'register' ? 'Kayıt Ol' : 'Giriş Yap'}</span>
                  {!isAuthLoading && <Icon name="ChevronRight" className="w-5 h-5 relative z-10 transition-transform group-hover/btn:translate-x-1" />}
                </button>
              </form>

              <div className="mt-7 pt-6 border-t border-surface-200/50 dark:border-white/[0.06] text-center">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(prev => prev === 'login' ? 'register' : 'login');
                    setLoginError('');
                    setLoginPassword('');
                    setLoginPasswordConfirm('');
                  }}
                  className="text-sm text-surface-600 dark:text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors font-semibold"
                >
                  {authMode === 'login' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. QUIZ SETUP VIEW
  if (currentView === 'quiz-setup' && activeTopic) {
    const allSetupTopicQuestions = allQuestions[activeTopic.sub.id] || [];
    const wrongQuestionIdSet = new Set(wrongQuestionIdsByTopic[activeTopic.sub.id] || []);
    const blankQuestionIdSet = new Set(blankQuestionIdsByTopic[activeTopic.sub.id] || []);
    const statusFilterActive = quizStatusFilter.wrong || quizStatusFilter.blank;
    const getFilteredQuestionsByStatus = (status: { wrong: boolean; blank: boolean }) => {
      const isActive = status.wrong || status.blank;
      if (!isActive) return allSetupTopicQuestions;
      return allSetupTopicQuestions.filter((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, activeTopic.sub.id, index);
        const includeWrong = status.wrong && wrongQuestionIdSet.has(questionTrackingId);
        const includeBlank = status.blank && blankQuestionIdSet.has(questionTrackingId);
        return includeWrong || includeBlank;
      });
    };
    const setupTopicQuestions = getFilteredQuestionsByStatus(quizStatusFilter);
    const wrongOnlyQuestionCount = getFilteredQuestionsByStatus({ wrong: true, blank: false }).length;
    const blankOnlyQuestionCount = getFilteredQuestionsByStatus({ wrong: false, blank: true }).length;
    const maxQuestions = setupTopicQuestions.length;
    const catColor = getCatColor(activeTopic.cat.id);
    const sourceTagCounter = setupTopicQuestions.reduce<Record<string, number>>((acc, question) => {
      const sourceKey = getQuestionSourceKey(question);
      acc[sourceKey] = (acc[sourceKey] || 0) + 1;
      return acc;
    }, {});
    const sourceTagOptions = Object.keys(sourceTagCounter)
      .map((sourceKey) => ({
        sourceKey,
        label: getSourceTagLabel(sourceKey),
        totalCount: sourceTagCounter[sourceKey],
      }))
      .sort((a, b) => {
        if (a.sourceKey === UNTAGGED_SOURCE_KEY) return 1;
        if (b.sourceKey === UNTAGGED_SOURCE_KEY) return -1;
        return a.label.localeCompare(b.label, 'tr');
      });
    const selectedTagTotalQuestionCount = sourceTagOptions.reduce((sum, option) => {
      const selectedCount = quizTagQuestionCounts[option.sourceKey] || 0;
      return sum + Math.min(option.totalCount, Math.max(0, selectedCount));
    }, 0);
    const isTagDistributionActive = selectedTagTotalQuestionCount > 0;
    const effectiveQuestionCount = isTagDistributionActive ? selectedTagTotalQuestionCount : quizConfig.questionCount;
    const updateQuizStatusFilter = (nextStatusFilter: { wrong: boolean; blank: boolean }) => {
      const nextFilteredQuestions = getFilteredQuestionsByStatus(nextStatusFilter);
      const nextQuestionCount = nextFilteredQuestions.length > 0
        ? Math.min(quizConfig.questionCount, nextFilteredQuestions.length)
        : 0;
      setQuizStatusFilter(nextStatusFilter);
      setQuizTagQuestionCounts({});
      setQuizConfig((prev) => ({
        ...prev,
        questionCount: nextQuestionCount,
        durationSeconds: getAutoDurationForQuestionCount(nextQuestionCount),
      }));
    };

    const updateTagQuestionCount = (sourceKey: string, nextCount: number, maxCount: number) => {
      const clampedCount = Math.min(maxCount, Math.max(0, Math.floor(nextCount)));
      setQuizTagQuestionCounts((prev) => {
        if (clampedCount <= 0) {
          const { [sourceKey]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [sourceKey]: clampedCount };
      });
    };

    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 flex items-start justify-center p-3 sm:p-4 md:py-8">
        <div className="w-full max-w-lg animate-fade-in-scale">
          {/* Back Button */}
          <button
            onClick={() => { setActiveTopic(null); setCurrentView('dashboard'); }}
            className="flex items-center gap-2 text-surface-400 hover:text-surface-700 dark:hover:text-white transition-colors mb-4 md:mb-6 font-medium text-xs md:text-sm"
          >
            <Icon name="ArrowLeft" className="w-4 h-4" />
            Geri Don
          </button>

          <div className="bg-white dark:bg-surface-800 rounded-2xl md:rounded-3xl shadow-card dark:shadow-card-dark p-4 sm:p-5 md:p-9 border border-surface-100 dark:border-surface-700">
            {/* Header */}
            <div className="text-center mb-5 md:mb-8">
              <div className={`w-12 h-12 md:w-16 md:h-16 ${catColor.bgLight} ${catColor.bgDark} rounded-xl md:rounded-2xl mx-auto flex items-center justify-center mb-3 md:mb-5 ${catColor.text} ${catColor.textDark}`}>
                <Icon name="Settings" className="w-6 h-6 md:w-8 md:h-8" />
              </div>
              <h2 className="text-xl md:text-2xl font-extrabold text-surface-800 dark:text-white mb-1">Sinavi Ozellestir</h2>
              <p className="text-surface-400 text-xs md:text-sm break-words">{activeTopic.cat.name} &middot; {activeTopic.sub.name}</p>
            </div>

            {/* Settings */}
            <div className="space-y-4 md:space-y-6">
              {/* Status Filter */}
              {(wrongOnlyQuestionCount > 0 || blankOnlyQuestionCount > 0) && (
                <div className="bg-surface-50 dark:bg-surface-900/50 p-3.5 md:p-5 rounded-xl md:rounded-2xl border border-surface-100 dark:border-surface-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <label className="font-bold text-surface-700 dark:text-surface-200 text-sm flex items-center gap-2">
                      <Icon name="Target" className="w-4 h-4 text-surface-400" />
                      Soru Kaynagi
                    </label>
                    <span className="text-[11px] font-bold text-surface-500 dark:text-surface-300 bg-white dark:bg-surface-800 px-2 py-0.5 rounded-full border border-surface-200 dark:border-surface-600">
                      {statusFilterActive ? `${maxQuestions} soru` : 'Tum sorular'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateQuizStatusFilter({ wrong: !quizStatusFilter.wrong, blank: quizStatusFilter.blank })}
                      disabled={wrongOnlyQuestionCount === 0}
                      className={`text-left rounded-xl border px-2.5 md:px-3 py-2 md:py-2.5 transition ${
                        quizStatusFilter.wrong
                          ? 'border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20'
                          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <p className="text-[11px] md:text-xs font-bold text-surface-700 dark:text-surface-200">Yanlislarim</p>
                      <p className="text-[11px] text-red-600 dark:text-red-300 mt-0.5">{wrongOnlyQuestionCount} soru</p>
                    </button>
                    <button
                      onClick={() => updateQuizStatusFilter({ wrong: quizStatusFilter.wrong, blank: !quizStatusFilter.blank })}
                      disabled={blankOnlyQuestionCount === 0}
                      className={`text-left rounded-xl border px-2.5 md:px-3 py-2 md:py-2.5 transition ${
                        quizStatusFilter.blank
                          ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70'
                          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <p className="text-[11px] md:text-xs font-bold text-surface-700 dark:text-surface-200">Boslarim</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{blankOnlyQuestionCount} soru</p>
                    </button>
                  </div>

                  {statusFilterActive && (
                    <div className="mt-2.5 flex items-center justify-between">
                      <p className="text-[11px] text-brand-600 dark:text-brand-300 font-medium">
                        {quizStatusFilter.wrong && quizStatusFilter.blank
                          ? 'Yanlis + bos sorulardan secilecek.'
                          : quizStatusFilter.wrong
                            ? 'Sadece yanlis sorulardan secilecek.'
                            : 'Sadece bos sorulardan secilecek.'}
                      </p>
                      <button
                        onClick={() => updateQuizStatusFilter({ wrong: false, blank: false })}
                        className="text-[11px] font-bold text-surface-500 hover:text-surface-700 dark:text-surface-300 dark:hover:text-white"
                      >
                        Temizle
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Question Count */}
              <div className="bg-surface-50 dark:bg-surface-900/50 p-3.5 md:p-5 rounded-xl md:rounded-2xl border border-surface-100 dark:border-surface-700/50">
                <div className="flex justify-between items-center mb-3">
                  <label className="font-bold text-surface-700 dark:text-surface-200 text-sm flex items-center gap-2">
                    <Icon name="Hash" className="w-4 h-4 text-surface-400" />
                    Soru Sayisi
                  </label>
                  <span className={`${catColor.text} ${catColor.textDark} font-bold ${catColor.bgLight} ${catColor.bgDark} px-2.5 py-0.5 rounded-full text-xs`}>
                    Max: {maxQuestions}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max={maxQuestions}
                    value={quizConfig.questionCount}
                    onChange={(e) => {
                      const nextQuestionCount = parseInt(e.target.value, 10);
                      setQuizConfig({
                        ...quizConfig,
                        questionCount: nextQuestionCount,
                        durationSeconds: getAutoDurationForQuestionCount(nextQuestionCount),
                      });
                    }}
                    disabled={maxQuestions === 0 || isTagDistributionActive}
                    className="w-full h-2 bg-surface-200 dark:bg-surface-700 rounded-lg cursor-pointer"
                  />
                  <div className="w-14 h-10 flex items-center justify-center bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl font-extrabold text-lg text-surface-800 dark:text-white flex-shrink-0">
                    {effectiveQuestionCount}
                  </div>
                </div>
                {maxQuestions === 0 && <p className="text-red-500 text-xs mt-2 font-medium">Bu konuda henuz soru bulunmuyor.</p>}
                {isTagDistributionActive && (
                  <p className="text-[11px] text-brand-600 dark:text-brand-300 mt-2 font-medium">
                    Etiket dagilimi aktif. Toplam soru sayisi etiketlerden hesaplanir.
                  </p>
                )}
              </div>

              {/* Tag Distribution */}
              {sourceTagOptions.length > 0 && (
                <div className="bg-surface-50 dark:bg-surface-900/50 p-3.5 md:p-5 rounded-xl md:rounded-2xl border border-surface-100 dark:border-surface-700/50">
                  <div className="flex items-center justify-between mb-3">
                    <label className="font-bold text-surface-700 dark:text-surface-200 text-sm flex items-center gap-2">
                      <Icon name="BookOpen" className="w-4 h-4 text-surface-400" />
                      Etiket Dagilimi
                    </label>
                    <span className="text-[11px] font-bold text-surface-500 dark:text-surface-300 bg-white dark:bg-surface-800 px-2 py-0.5 rounded-full border border-surface-200 dark:border-surface-600">
                      Secili: {selectedTagTotalQuestionCount}
                    </span>
                  </div>

                  <p className="text-xs text-surface-400 mb-3">
                    Bir veya birden fazla etiket secip her etiketten kac soru gelecegini belirleyin. 0 degeri, o etiketi kapatir.
                  </p>

                  <div className="space-y-2 max-h-[52vh] md:max-h-56 overflow-y-auto custom-scrollbar pr-0.5 md:pr-1">
                    {sourceTagOptions.map((option) => {
                      const selectedCount = Math.min(
                        option.totalCount,
                        Math.max(0, quizTagQuestionCounts[option.sourceKey] || 0)
                      );
                      const isSelected = selectedCount > 0;

                      return (
                        <div
                          key={option.sourceKey}
                          className={`rounded-xl border p-2.5 md:p-3 transition ${
                            isSelected
                              ? 'border-brand-200 dark:border-brand-800/40 bg-brand-50/50 dark:bg-brand-900/10'
                              : 'border-surface-200 dark:border-surface-700 bg-white/80 dark:bg-surface-800/70'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => updateTagQuestionCount(option.sourceKey, e.target.checked ? Math.min(1, option.totalCount) : 0, option.totalCount)}
                                className="w-4 h-4 accent-brand-600 mt-0.5"
                              />
                              <div className="min-w-0">
                                <p className="text-[13px] md:text-sm font-semibold text-surface-700 dark:text-surface-200 break-words leading-snug">{option.label}</p>
                                <p className="text-[11px] text-surface-400 mt-0.5">{option.totalCount} soru mevcut</p>
                              </div>
                            </label>

                            <div className="flex items-center gap-1.5 self-end sm:self-auto">
                              <button
                                onClick={() => updateTagQuestionCount(option.sourceKey, selectedCount - 1, option.totalCount)}
                                disabled={selectedCount === 0}
                                className="w-8 h-8 md:w-7 md:h-7 rounded-md border border-surface-200 dark:border-surface-600 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={option.totalCount}
                                value={selectedCount}
                                onChange={(e) => updateTagQuestionCount(option.sourceKey, parseInt(e.target.value, 10) || 0, option.totalCount)}
                                className="w-14 h-8 md:h-7 rounded-md border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-center text-xs font-bold text-surface-700 dark:text-surface-200 outline-none focus:border-brand-500"
                              />
                              <button
                                onClick={() => updateTagQuestionCount(option.sourceKey, selectedCount + 1, option.totalCount)}
                                disabled={selectedCount >= option.totalCount}
                                className="w-8 h-8 md:w-7 md:h-7 rounded-md border border-surface-200 dark:border-surface-600 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                      {isTagDistributionActive
                        ? `Toplam ${selectedTagTotalQuestionCount} soru etiket seciminden gelecek.`
                        : 'Etiket secmezseniz sorular rastgele secilir.'}
                    </p>
                    {isTagDistributionActive && (
                      <button
                        onClick={() => setQuizTagQuestionCounts({})}
                        className="text-[11px] font-bold text-surface-500 hover:text-surface-700 dark:text-surface-300 dark:hover:text-white"
                      >
                        Temizle
                      </button>
                    )}
                  </div>
                </div>
              )}

              {sourceTagOptions.length === 0 && maxQuestions > 0 && (
                <div className="bg-surface-50 dark:bg-surface-900/50 p-4 rounded-2xl border border-surface-100 dark:border-surface-700/50">
                  <p className="text-xs text-surface-400">Bu konuda etiketli soru bulunamadi. Standart rastgele secim kullanilir.</p>
                </div>
              )}

              {/* Duration */}
              <div className="bg-surface-50 dark:bg-surface-900/50 p-3.5 md:p-5 rounded-xl md:rounded-2xl border border-surface-100 dark:border-surface-700/50">
                <label className="block font-bold text-surface-700 dark:text-surface-200 text-sm mb-3 flex items-center gap-2">
                  <Icon name="Timer" className="w-4 h-4 text-surface-400" />
                  Sure
                </label>
                <div className="flex items-center gap-2 overflow-hidden">
                  <button
                    onClick={() => setQuizConfig(prev => ({...prev, durationSeconds: Math.max(0, prev.durationSeconds - 30)}))}
                    className="w-11 h-11 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 text-surface-500 hover:border-brand-500 hover:text-brand-600 transition flex items-center justify-center font-bold text-sm flex-shrink-0"
                  >
                    -30
                  </button>
                  <input
                    type="number"
                    value={quizConfig.durationSeconds}
                    onChange={(e) => setQuizConfig({...quizConfig, durationSeconds: Math.max(0, parseInt(e.target.value) || 0)})}
                    className="min-w-0 flex-1 h-11 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 text-center font-extrabold text-lg text-surface-800 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none"
                  />
                  <button
                    onClick={() => setQuizConfig(prev => ({...prev, durationSeconds: prev.durationSeconds + 30}))}
                    className="w-11 h-11 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 text-surface-500 hover:border-brand-500 hover:text-brand-600 transition flex items-center justify-center font-bold text-sm flex-shrink-0"
                  >
                    +30
                  </button>
                </div>
                <p className="text-center mt-2 text-surface-400 text-xs">
                  {Math.floor(quizConfig.durationSeconds / 60)} dakika {quizConfig.durationSeconds % 60} saniye
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 md:gap-3 mt-6 md:mt-8">
              <button
                onClick={() => { setActiveTopic(null); setCurrentView('dashboard'); }}
                className="flex-1 py-3.5 rounded-xl font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700/50 transition"
              >
                Vazgec
              </button>
              <button
                onClick={handleStartQuiz}
                disabled={maxQuestions === 0 || effectiveQuestionCount === 0}
                className={`flex-[2] py-3.5 rounded-xl bg-gradient-to-r ${catColor.gradient} text-white font-bold text-sm hover:opacity-90 shadow-lg ${catColor.shadow} transition transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2`}
              >
                <Icon name="Play" className="w-4 h-4" />
                Sinavi Baslat ({effectiveQuestionCount})
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. QUIZ VIEW
  if (currentView === 'quiz' && activeTopic) {
    const currentQuestion = quizState.questions[quizState.currentQuestionIndex];
    const score = calculateScore();
    const catColor = getCatColor(activeTopic.cat.id);
    const progressPercent = quizState.questions.length > 0 ? ((quizState.currentQuestionIndex + 1) / quizState.questions.length) * 100 : 0;
    const timerPercent = quizState.totalTime > 0 ? (quizState.timeLeft / quizState.totalTime) * 100 : 100;
    const scorePercent = quizState.questions.length > 0 ? (score / quizState.questions.length) * 100 : 0;
    const totalQuestions = quizState.questions.length;
    const hasCollapsedQuestionNav = totalQuestions > 7;
    const leadingQuestionIndices = hasCollapsedQuestionNav
      ? [0, 1, 2]
      : Array.from({ length: totalQuestions }, (_, idx) => idx);
    const trailingQuestionIndices = hasCollapsedQuestionNav
      ? [totalQuestions - 3, totalQuestions - 2, totalQuestions - 1]
      : [];
    const questionStemTextSizeClass = quizSize === 0
      ? 'text-[14px] leading-6'
      : quizSize === 1
        ? 'text-base leading-7'
        : 'text-lg leading-8';
    const questionContextTypographyClass = `font-sans font-semibold tracking-[0.008em] ${questionStemTextSizeClass}`;
    const questionItemsTypographyClass = `font-sans font-light tracking-normal ${questionStemTextSizeClass}`;
    const questionRootTypographyClass = `font-sans font-extrabold tracking-[0.012em] ${questionStemTextSizeClass}`;
    const quizConfirmMeta = quizConfirmAction === 'exit'
      ? {
          title: 'Sinavdan cikmak istiyor musunuz?',
          message: 'Mevcut sinav ilerlemeniz sifirlanacak ve ana menüye doneceksiniz.',
          actionLabel: 'Sinavdan Cik',
          actionStyle: 'from-red-500 to-rose-500 hover:shadow-red-500/30',
        }
      : {
          title: 'Sinavi simdi bitirelim mi?',
          message: 'Sorularin kalanini bos birakip sonucu hemen gosteririz.',
          actionLabel: 'Sinavi Bitir',
          actionStyle: 'from-amber-500 to-orange-500 hover:shadow-amber-500/30',
        };

    const handleConfirmQuizAction = () => {
      const action = quizConfirmAction;
      setQuizConfirmAction(null);
      if (action === 'exit') {
        setActiveTopic(null);
        resetQuiz();
        setCurrentView('dashboard');
        return;
      }
      if (action === 'finish') {
        handleFinishQuiz();
      }
    };
    const handleJumpToQuestion = () => {
      const rawInput = window.prompt(
        `Gitmek istediginiz soru numarasini girin (1-${totalQuestions})`,
        String(quizState.currentQuestionIndex + 1)
      );
      if (rawInput === null) return;
      const parsed = Number.parseInt(rawInput.trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > totalQuestions) {
        alert(`Lutfen 1 ile ${totalQuestions} arasinda bir soru numarasi girin.`);
        return;
      }
      goToQuestion(parsed - 1);
    };

    return (
      <div className="h-screen overflow-hidden flex flex-col bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-surface-900 dark:via-surface-900 dark:to-surface-950 transition-colors duration-300">

        {/* Top Progress Bar */}
        <div className="w-full h-1.5 bg-surface-200/80 dark:bg-surface-800/80 flex-shrink-0">
          <div
            className={`h-full bg-gradient-to-r ${catColor.gradient} transition-all duration-500 ease-out`}
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>

        {/* Header */}
        <header className={`flex-shrink-0 bg-white/85 dark:bg-surface-800/85 backdrop-blur-2xl border-b border-surface-200/80 dark:border-surface-700/70 flex items-center justify-between px-3 sm:px-4 md:px-8 z-40 ${
          quizSize === 0 ? 'h-12' : 'h-14'
        }`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setQuizConfirmAction('exit')}
              className={`flex items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors border border-surface-200 dark:border-surface-600 ${
                quizSize === 0 ? 'w-9 h-9' : 'w-10 h-10'
              }`}
            >
              <Icon name="X" className="w-4 h-4" />
            </button>

            <div className="min-w-0">
              <h2 className={`font-bold text-surface-800 dark:text-white leading-tight truncate ${quizSize === 0 ? 'text-[13px]' : 'text-sm sm:text-base'}`}>{activeTopic.sub.name}</h2>
              <span className="text-[11px] sm:text-xs text-surface-500 dark:text-surface-400 truncate block">{activeTopic.cat.name}</span>
            </div>
          </div>

          {/* Question Counter */}
          {!quizState.showResults && quizState.questions.length > 0 && (
            <div className="text-xs font-bold text-surface-500 dark:text-surface-300 px-2.5 py-1 rounded-full border border-surface-200 dark:border-surface-600 bg-white/70 dark:bg-surface-700/60">
              <span className={`${catColor.text} ${catColor.textDark}`}>{quizState.currentQuestionIndex + 1}</span>
              <span className="mx-1">/</span>
              <span>{quizState.questions.length}</span>
            </div>
          )}

          {/* Timer + Size Control */}
          {!quizState.showResults && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Size Toggle */}
              <button
                onClick={() => setQuizSize(prev => ((prev + 1) % 3) as 0 | 1 | 2)}
                className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors border border-surface-200 dark:border-surface-600"
                title="Yazi boyutunu degistir"
              >
                <span className={`font-bold transition-all ${quizSize === 0 ? 'text-[10px]' : quizSize === 1 ? 'text-xs' : 'text-sm'}`}>A</span>
                <span className={`font-bold transition-all ${quizSize === 0 ? 'text-xs' : quizSize === 1 ? 'text-sm' : 'text-base'}`}>A</span>
              </button>

              {/* Timer */}
              <div className={`flex items-center gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-[13px] sm:text-sm font-mono font-bold border
                ${quizState.timeLeft < 30
                  ? 'bg-red-50 dark:bg-red-900/20 text-red-500 border-red-200 dark:border-red-800/50 animate-pulse'
                  : quizState.timeLeft < 60
                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 border-amber-200 dark:border-amber-800/50'
                    : 'bg-surface-50 dark:bg-surface-700 text-surface-700 dark:text-surface-200 border-surface-200 dark:border-surface-600'}
              `}>
                <Icon name="Clock" className="w-3.5 h-3.5 opacity-70" />
                {formatTime(quizState.timeLeft)}
              </div>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden relative flex flex-col">

          {quizState.loading && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-5">
              <div className={`w-14 h-14 border-[3px] border-surface-200 dark:border-surface-700 rounded-full animate-spin`} style={{ borderTopColor: 'rgb(99, 102, 241)' }}></div>
              <p className="text-surface-400 font-medium text-sm animate-pulse-soft">Sorular hazirlaniyor...</p>
            </div>
          )}

          {quizState.error && (
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              <div className="text-center p-8 bg-white dark:bg-surface-800 rounded-3xl shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700 max-w-sm animate-fade-in-scale">
                <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <Icon name="XCircle" className="w-7 h-7 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-surface-800 dark:text-white mb-2">Hata</h3>
                <p className="text-surface-400 text-sm mb-6">{quizState.error}</p>
                <button
                  onClick={() => { setActiveTopic(null); resetQuiz(); setCurrentView('dashboard'); }}
                  className="w-full py-3 bg-surface-900 dark:bg-brand-600 text-white font-bold rounded-xl hover:opacity-90 transition text-sm"
                >
                  Geri Don
                </button>
              </div>
            </div>
          )}

          {!quizState.loading && !quizState.error && !quizState.showResults && quizState.questions.length > 0 && currentQuestion && (
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className={`max-w-2xl mx-auto pb-28 ${
                quizSize === 0 ? 'px-2.5 py-2.5' : quizSize === 1 ? 'px-3 py-3.5 md:px-5' : 'px-3.5 py-4 md:px-6'
              }`}>

                {/* Question Card */}
                <div className={`bg-white/95 dark:bg-surface-800/95 rounded-2xl shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700 animate-fade-in backdrop-blur-sm ${
                  quizSize === 0 ? 'p-3 mb-2.5 rounded-xl' : quizSize === 1 ? 'p-4 md:p-5 mb-3.5' : 'p-5 md:p-6 mb-4'
                }`}>
                  <div className={`flex justify-between items-center gap-2 ${quizSize === 0 ? 'mb-3' : quizSize === 1 ? 'mb-4' : 'mb-5'}`}>
                    <span className={`${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark} font-black rounded-lg uppercase tracking-wider ${
                      quizSize === 0 ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1 text-xs'
                    }`}>
                      Soru {quizState.currentQuestionIndex + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {currentQuestion.sourceTag && (
                        <span className={`rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200 font-semibold border border-slate-200 dark:border-slate-600 ${
                          quizSize === 0 ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
                        }`}>
                          {currentQuestion.sourceTag}
                        </span>
                      )}
                      <button
                        onClick={() => handleReportQuestion(currentQuestion)}
                        disabled={!currentQuestion.id || isSubmittingReport}
                        className={`inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 font-semibold transition hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed ${
                          quizSize === 0 ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]'
                        }`}
                        title="Hatali soruyu bildir"
                      >
                        <Icon name="Flag" className="w-3 h-3" />
                        Bildir
                      </button>
                    </div>
                  </div>

                  {currentQuestion.imageUrl && (
                    <div className={`rounded-lg overflow-hidden border border-surface-100 dark:border-surface-700 ${
                      quizSize === 0 ? 'mb-3 max-h-40' : quizSize === 1 ? 'mb-5 max-h-60' : 'mb-6 max-h-72'
                    }`}>
                      <img src={currentQuestion.imageUrl} alt="Soru" className="w-full h-auto object-contain bg-surface-50 dark:bg-surface-900" style={{ maxHeight: quizSize === 0 ? '160px' : quizSize === 1 ? '240px' : '288px' }} />
                    </div>
                  )}

                  {currentQuestion.contextText && (
                    <p className={`${questionContextTypographyClass} text-surface-700 dark:text-surface-100 mb-3`}>
                      {currentQuestion.contextText}
                    </p>
                  )}

                  {currentQuestion.contentItems && currentQuestion.contentItems.length > 0 && (
                    <div className={`bg-surface-50 dark:bg-surface-900/60 rounded-xl border border-surface-200/70 dark:border-surface-700/60 ${
                      quizSize === 0 ? 'mb-2.5 p-2.5' : quizSize === 1 ? 'mb-3.5 p-3.5' : 'mb-4 p-4'
                    }`}>
                      <div className={quizSize === 0 ? 'space-y-1' : 'space-y-1.5'}>
                        {currentQuestion.contentItems.map((item, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <span className={`mt-2 rounded-full flex-shrink-0 ${catColor.bg} ${
                              quizSize === 0 ? 'w-1.5 h-1.5' : 'w-2 h-2'
                            }`}></span>
                            <p className={`${questionItemsTypographyClass} text-surface-700 dark:text-surface-300`}>
                              {item}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <h3 className={`${questionRootTypographyClass} text-surface-900 dark:text-white`}>
                    {currentQuestion.questionText}
                  </h3>
                </div>

                {/* Options */}
                <div key={quizState.currentQuestionIndex} className={`stagger-children ${quizSize === 0 ? 'space-y-1.5' : quizSize === 1 ? 'space-y-1.5' : 'space-y-2'}`}>
                  {currentQuestion.options.map((option, idx) => {
                    const isSelected = quizState.userAnswers[quizState.currentQuestionIndex] === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => handleSelectOption(idx)}
                        className={`w-full text-left border transition-all duration-200 flex items-center group animate-fade-in active:scale-[0.995] ${
                          quizSize === 0 ? 'p-2.5 rounded-xl gap-2' : quizSize === 1 ? 'p-3 md:p-3.5 rounded-xl gap-2.5' : 'p-3.5 md:p-4 rounded-2xl gap-3'
                        } ${isSelected
                            ? `bg-gradient-to-r ${catColor.gradient} border-transparent shadow-lg ${catColor.shadow}`
                            : 'bg-white/95 dark:bg-surface-800/95 border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-500 shadow-card dark:shadow-card-dark'
                          }
                        `}
                      >
                        <span className={`flex flex-shrink-0 items-center justify-center rounded-xl font-bold transition-colors border ${
                          quizSize === 0 ? 'w-7 h-7 text-[11px]' : quizSize === 1 ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-sm'
                        } ${isSelected
                            ? 'bg-white/20 text-white border-white/30'
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-600 group-hover:bg-surface-200 dark:group-hover:bg-surface-600'
                          }
                        `}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={`font-medium leading-relaxed ${
                          quizSize === 0 ? 'text-[12px]' : quizSize === 1 ? 'text-[13px] md:text-sm' : 'text-sm md:text-base'
                        } ${isSelected ? 'text-white' : 'text-surface-700 dark:text-surface-200'}`}>
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>

              </div>
            </div>
          )}

          {/* Footer Nav */}
          {!quizState.showResults && !quizState.loading && !quizState.error && quizState.questions.length > 0 && (
            <div className={`absolute bottom-0 w-full bg-white/88 dark:bg-surface-800/88 backdrop-blur-2xl border-t border-surface-200/80 dark:border-surface-700/70 z-50 mobile-safe-bottom ${
              quizSize === 0 ? 'p-2' : 'p-3'
            }`}>
              <div className="max-w-2xl mx-auto">
                {/* Question dots navigator */}
                <div className={`flex justify-start sm:justify-center overflow-x-auto no-scrollbar whitespace-nowrap ${quizSize === 0 ? 'gap-1 mb-2' : 'gap-1.5 mb-2.5'}`}>
                  {leadingQuestionIndices.map((idx) => (
                    <button
                      key={`head_${idx}`}
                      onClick={() => goToQuestion(idx)}
                      className={`inline-flex items-center justify-center font-bold transition-all duration-200 border ${
                        quizSize === 0 ? 'w-6 h-6 text-[9px] rounded-md' : 'w-7 h-7 text-[10px] rounded-lg'
                      } ${idx === quizState.currentQuestionIndex
                          ? `bg-gradient-to-r ${catColor.gradient} text-white shadow-sm border-transparent`
                          : quizState.userAnswers[idx] !== null
                            ? `${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark} border-transparent`
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-400 border-surface-200 dark:border-surface-600'
                        }
                      `}
                    >
                      {idx + 1}
                    </button>
                  ))}

                  {hasCollapsedQuestionNav && (
                    <button
                      onClick={handleJumpToQuestion}
                      title="Soru numarasina git"
                      className={`inline-flex items-center justify-center font-black tracking-wider transition-all duration-200 border bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 border-surface-200 dark:border-surface-600 hover:bg-surface-200 dark:hover:bg-surface-600 ${
                        quizSize === 0 ? 'w-6 h-6 text-[9px] rounded-md' : 'w-7 h-7 text-[10px] rounded-lg'
                      }`}
                    >
                      ...
                    </button>
                  )}

                  {trailingQuestionIndices.map((idx) => (
                    <button
                      key={`tail_${idx}`}
                      onClick={() => goToQuestion(idx)}
                      className={`inline-flex items-center justify-center font-bold transition-all duration-200 border ${
                        quizSize === 0 ? 'w-6 h-6 text-[9px] rounded-md' : 'w-7 h-7 text-[10px] rounded-lg'
                      } ${idx === quizState.currentQuestionIndex
                          ? `bg-gradient-to-r ${catColor.gradient} text-white shadow-sm border-transparent`
                          : quizState.userAnswers[idx] !== null
                            ? `${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark} border-transparent`
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-400 border-surface-200 dark:border-surface-600'
                        }
                      `}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>

                {/* Nav Buttons */}
                <div className={`flex ${quizSize === 0 ? 'gap-2' : 'gap-3'}`}>
                  <button
                    onClick={handlePrevQuestion}
                    disabled={quizState.currentQuestionIndex === 0}
                    className={`flex-1 rounded-xl font-bold text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 transition disabled:opacity-40 disabled:cursor-not-allowed border border-surface-200 dark:border-surface-600 ${
                      quizSize === 0 ? 'py-2 text-xs' : 'py-2.5 text-xs sm:text-sm'
                    }`}
                  >
                    Onceki
                  </button>

                  <button
                    onClick={() => setQuizConfirmAction('finish')}
                    className={`flex-1 rounded-xl font-bold text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition border border-red-200 dark:border-red-900/40 ${
                      quizSize === 0 ? 'py-2 text-xs' : 'py-2.5 text-xs sm:text-sm'
                    }`}
                  >
                    Bitir
                  </button>

                  <button
                    onClick={handleNextQuestion}
                    className={`flex-[2] rounded-xl font-bold text-white shadow-lg transition transform active:scale-[0.98] flex items-center justify-center gap-2 ${
                      quizSize === 0 ? 'py-2 text-xs' : 'py-2.5 text-xs sm:text-sm'
                    } ${quizState.currentQuestionIndex === quizState.questions.length - 1
                        ? 'bg-gradient-to-r from-emerald-500 to-green-600 shadow-emerald-500/20'
                        : `bg-gradient-to-r ${catColor.gradient} ${catColor.shadow}`
                      }
                    `}
                  >
                    {quizState.currentQuestionIndex === quizState.questions.length - 1 ? 'Testi Bitir' : 'Sonraki'}
                    <Icon name={quizState.currentQuestionIndex === quizState.questions.length - 1 ? "CheckCircle" : "ChevronRight"} className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Results View */}
          {quizState.showResults && (
            <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center justify-start p-6 pt-10 animate-fade-in">
              <div className="w-full max-w-md">
                {/* Score Card */}
                <div className="bg-white dark:bg-surface-800 rounded-3xl p-8 shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700 text-center mb-5">

                  {/* Circular Score */}
                  <div className="relative w-36 h-36 mx-auto mb-6">
                    <svg className="circular-progress w-full h-full" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className="text-surface-100 dark:text-surface-700" strokeWidth="8" />
                      <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                        className={scorePercent >= 70 ? 'text-emerald-500' : scorePercent >= 40 ? 'text-amber-500' : 'text-red-500'}
                        stroke="currentColor"
                        strokeDasharray={`${2 * Math.PI * 42}`}
                        strokeDashoffset={`${2 * Math.PI * 42 * (1 - scorePercent / 100)}`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-black text-surface-800 dark:text-white animate-count-up">
                        %{Math.round(scorePercent)}
                      </span>
                      <span className="text-xs text-surface-400 font-medium">Basari</span>
                    </div>
                  </div>

                  <h3 className="text-2xl font-extrabold text-surface-800 dark:text-white mb-1">
                    {scorePercent >= 70 ? 'Harika!' : scorePercent >= 40 ? 'Iyi Gidiyorsun' : 'Daha Cok Calismalisin'}
                  </h3>
                  <p className="text-surface-400 text-sm mb-6">
                    {quizState.questions.length} sorudan {score} tanesini dogru yanitladin.
                  </p>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Dogru</span>
                      <span className="text-2xl font-black text-emerald-500">{score}</span>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">Yanlis</span>
                      <span className="text-2xl font-black text-red-400">
                        {quizState.userAnswers.filter((a, i) => a !== null && a !== quizState.questions[i].correctOptionIndex).length}
                      </span>
                    </div>
                    <div className="bg-surface-50 dark:bg-surface-900/50 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-surface-500 uppercase tracking-wider mb-1">Bos</span>
                      <span className="text-2xl font-black text-surface-400">
                        {quizState.userAnswers.filter(a => a === null).length}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setActiveTopic(null); resetQuiz(); setCurrentView('dashboard'); }}
                      className="flex-1 py-3 rounded-xl font-bold text-sm text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 transition"
                    >
                      Ana Menu
                    </button>
                    <button
                      onClick={() => openQuizSetup(activeTopic.cat, activeTopic.sub)}
                      className={`flex-1 py-3 rounded-xl bg-gradient-to-r ${catColor.gradient} text-white font-bold text-sm hover:opacity-90 shadow-lg ${catColor.shadow} transition flex items-center justify-center gap-2`}
                    >
                      <Icon name="RotateCcw" className="w-3.5 h-3.5" />
                      Tekrar Coz
                    </button>
                  </div>
                </div>

                {/* Question Review */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-surface-500 uppercase tracking-wider px-1">Soru Detaylari</h4>
                  {quizState.questions.map((q, idx) => {
                    const userAnswer = quizState.userAnswers[idx];
                    const isCorrect = userAnswer === q.correctOptionIndex;
                    const isUnanswered = userAnswer === null;

                    return (
                      <div key={idx} className="bg-white dark:bg-surface-800 rounded-xl p-4 border border-surface-100 dark:border-surface-700 shadow-card dark:shadow-card-dark">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isCorrect ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500' :
                            isUnanswered ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' :
                            'bg-red-50 dark:bg-red-900/20 text-red-500'
                          }`}>
                            <Icon name={isCorrect ? "CircleCheck" : isUnanswered ? "Minus" : "CircleX"} className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-surface-700 dark:text-surface-200 mb-1.5 leading-relaxed">{q.questionText}</p>
                            {q.sourceTag && (
                              <span className="inline-flex mb-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                {q.sourceTag}
                              </span>
                            )}
                            <div className="text-xs space-y-0.5">
                              {!isUnanswered && !isCorrect && (
                                <p className="text-red-500">Cevabiniz: {String.fromCharCode(65 + userAnswer!)}) {q.options[userAnswer!]}</p>
                              )}
                              <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                                Dogru: {String.fromCharCode(65 + q.correctOptionIndex)}) {q.options[q.correctOptionIndex]}
                              </p>
                              {q.explanation && (
                                <p className="text-surface-400 mt-1 italic">{q.explanation}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Question Report Modal */}
          {reportingQuestion && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 modal-backdrop">
              <div className="relative w-full max-w-lg rounded-3xl border border-red-200/70 dark:border-red-900/50 bg-white/95 dark:bg-surface-800/95 shadow-2xl overflow-hidden modal-content animate-fade-in-scale">
                <div className="absolute -top-16 -right-12 w-40 h-40 rounded-full bg-red-400/20 blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-14 -left-10 w-36 h-36 rounded-full bg-orange-400/20 blur-3xl pointer-events-none"></div>

                <div className="relative p-6 sm:p-7 space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shadow-red-500/20 flex items-center justify-center">
                        <Icon name="Flag" className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-surface-900 dark:text-white">Soruyu Bildir</h3>
                        <p className="text-xs text-surface-500 dark:text-surface-400">Hatali soruyu yoneticiye iletecegiz.</p>
                      </div>
                    </div>
                    <button
                      onClick={handleCancelQuestionReport}
                      disabled={isSubmittingReport}
                      className="w-9 h-9 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100/90 dark:bg-surface-700/90 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-600 transition disabled:opacity-50"
                    >
                      <Icon name="X" className="w-4 h-4 mx-auto" />
                    </button>
                  </div>

                  <div className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50/80 dark:bg-surface-900/60 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-surface-400 mb-1.5">Soru Onizleme</p>
                    <p className="text-sm text-surface-700 dark:text-surface-200 leading-relaxed line-clamp-4">{reportingQuestion.questionText}</p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-surface-400 mb-1.5">Not (Opsiyonel)</label>
                    <textarea
                      value={reportNote}
                      onChange={(e) => setReportNote(e.target.value)}
                      placeholder="Orn: Dogru cevap secenegi yanlis isaretlenmis."
                      className="w-full h-28 resize-none rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-4 py-3 text-sm text-surface-700 dark:text-surface-200 outline-none focus:border-red-400 dark:focus:border-red-500"
                      disabled={isSubmittingReport}
                      autoFocus
                    />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={handleCancelQuestionReport}
                      disabled={isSubmittingReport}
                      className="flex-1 h-11 rounded-xl border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition text-sm font-bold disabled:opacity-50"
                    >
                      Vazgec
                    </button>
                    <button
                      onClick={handleSubmitQuestionReport}
                      disabled={isSubmittingReport}
                      className="flex-[1.6] h-11 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 text-white text-sm font-bold shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmittingReport ? 'Gonderiliyor...' : 'Bildirimi Gonder'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quiz Confirm Modal */}
          {quizConfirmAction && (
            <div className="fixed inset-0 z-[81] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 modal-backdrop">
              <div className="relative w-full max-w-md rounded-3xl border border-surface-200 dark:border-surface-700 bg-white/95 dark:bg-surface-800/95 shadow-2xl overflow-hidden modal-content animate-fade-in-scale">
                <div className="absolute -top-14 -right-10 w-36 h-36 rounded-full bg-brand-500/20 blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-16 -left-8 w-36 h-36 rounded-full bg-rose-500/15 blur-3xl pointer-events-none"></div>

                <div className="relative p-6 sm:p-7">
                  <div className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-200 flex items-center justify-center mb-4">
                    <Icon name="CircleX" className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-extrabold text-surface-900 dark:text-white mb-2">{quizConfirmMeta.title}</h3>
                  <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed mb-6">{quizConfirmMeta.message}</p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setQuizConfirmAction(null)}
                      className="flex-1 h-11 rounded-xl border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition text-sm font-bold"
                    >
                      Iptal
                    </button>
                    <button
                      onClick={handleConfirmQuizAction}
                      className={`flex-[1.4] h-11 rounded-xl bg-gradient-to-r ${quizConfirmMeta.actionStyle} text-white text-sm font-bold shadow-lg transition flex items-center justify-center`}
                    >
                      {quizConfirmMeta.actionLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // 4. DASHBOARD & ADMIN LAYOUT
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-surface-50 via-surface-100 to-surface-50 dark:from-surface-950 dark:via-surface-900 dark:to-surface-950 transition-colors duration-300 relative overflow-hidden">
      {/* Background mesh gradient */}
      <div className="fixed inset-0 mesh-gradient pointer-events-none opacity-50 dark:opacity-30"></div>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 w-full glass-card backdrop-blur-2xl z-50 border-b shadow-premium px-4 h-16 flex justify-between items-center">
        <div className="flex items-center gap-3 font-black text-lg">
          <div className="bg-gradient-to-br from-brand-500 via-violet-600 to-purple-600 p-2 rounded-xl shadow-lg shadow-brand-500/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
            <Icon name="Brain" className="w-5 h-5 text-white relative z-10" />
          </div>
          <span className="bg-gradient-to-r from-surface-800 to-surface-700 dark:from-white dark:to-white/80 bg-clip-text text-transparent">
            KPSS Pro
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 text-surface-500 dark:text-surface-400 hover:text-brand-600 dark:hover:text-brand-400 bg-surface-100 dark:bg-surface-800 rounded-xl transition-all hover:scale-105 active:scale-95"
          >
            <Icon name={isDarkMode ? "Sun" : "Moon"} className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2.5 text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 rounded-xl transition-all hover:scale-105 active:scale-95"
          >
            <Icon name={isMobileMenuOpen ? "X" : "Menu"} className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 glass-card border-r shadow-premium-lg transform transition-all duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static
        flex flex-col
      `}>
        <div className="flex flex-col h-full p-6 relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-10 pl-1">
            <div className="bg-gradient-to-br from-brand-500 via-violet-600 to-purple-600 p-2.5 rounded-2xl shadow-2xl shadow-brand-500/30 relative overflow-hidden hover:scale-105 transition-transform duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
              <Icon name="Brain" className="w-6 h-6 text-white relative z-10" />
            </div>
            <span className="text-xl font-black bg-gradient-to-r from-surface-800 to-surface-700 dark:from-white dark:to-white/80 bg-clip-text text-transparent tracking-tight">
              KPSS Pro
            </span>
          </div>

          {/* User Card */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-brand-600 via-violet-600 to-purple-600 text-white shadow-2xl shadow-brand-500/30 mb-7 relative overflow-hidden group hover:scale-[1.02] transition-all duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-[60px] -mr-10 -mt-10"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/20">
                  <Icon name="User" className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base truncate mb-0.5">{user.username}</div>
                  <div className="text-xs text-white/70 font-medium">{user.role === 'admin' ? 'Yönetici' : 'Premium Üye'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
            <button
              onClick={() => { setCurrentView('dashboard'); setActiveCategory(null); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm
                ${currentView === 'dashboard' && !activeCategory
                  ? 'bg-brand-50 dark:bg-brand-900/15 text-brand-600 dark:text-brand-400'
                  : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 hover:text-surface-900 dark:hover:text-white'}
              `}
            >
              <Icon name="Home" className="w-5 h-5" />
              Ana Sayfa
            </button>

            <div className="pt-3 pb-1 px-4">
              <span className="text-[10px] font-bold text-surface-400 uppercase tracking-widest">Dersler</span>
            </div>

            {categories.map(cat => {
              const color = getCatColor(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => { setCurrentView('dashboard'); setActiveCategory(cat); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
                    ${activeCategory?.id === cat.id && currentView === 'dashboard'
                      ? `${color.bgLight} ${color.bgDark} ${color.text} ${color.textDark} font-semibold`
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 hover:text-surface-700 dark:hover:text-surface-200'
                    }
                  `}
                >
                  <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${color.gradient}`}></div>
                  {cat.name}
                </button>
              );
            })}

            {user.role === 'admin' && (
              <>
                <div className="pt-4 pb-1 px-4">
                  <span className="text-[10px] font-bold text-surface-400 uppercase tracking-widest">Yonetim</span>
                </div>
                <button
                  onClick={() => { setCurrentView('admin'); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm
                    ${currentView === 'admin'
                      ? 'bg-brand-50 dark:bg-brand-900/15 text-brand-600 dark:text-brand-400'
                      : 'text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/50 hover:text-surface-900 dark:hover:text-white'}
                  `}
                >
                  <Icon name="Settings" className="w-5 h-5" />
                  Yonetici Paneli
                </button>
              </>
            )}
          </nav>

          {/* Bottom Actions */}
          <div className="mt-auto pt-4 space-y-1 border-t border-surface-100 dark:border-surface-700">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-700/50 hover:text-surface-700 dark:hover:text-white font-medium text-sm transition-colors"
            >
              <Icon name={isDarkMode ? "Sun" : "Moon"} className="w-4 h-4" />
              {isDarkMode ? 'Acik Tema' : 'Koyu Tema'}
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 font-medium text-sm transition-colors"
            >
              <Icon name="LogOut" className="w-4 h-4" />
              Cikis Yap
            </button>
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className={`flex-1 lg:ml-0 pt-14 lg:pt-0 min-h-screen pb-20 lg:pb-0 ${
        currentView === 'dashboard' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'
      }`}>
        <div className={`mx-auto ${
          currentView === 'dashboard'
            ? 'max-w-6xl h-[calc(100vh-56px)] lg:h-screen p-3 md:p-4 lg:p-5 flex flex-col overflow-hidden'
            : 'max-w-5xl p-5 md:p-8 lg:p-10'
        }`}>

          {/* ===== ADMIN VIEW ===== */}
          {currentView === 'admin' && (
            <div className="animate-fade-in space-y-6">
              <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-surface-800 dark:text-white mb-1">Yonetici Paneli</h1>
                <p className="text-surface-400 text-sm">Icerik havuzunu yonet ve genislet.</p>
              </div>

              <div className="bg-white dark:bg-surface-800 p-6 rounded-2xl shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-2">Kategori</label>
                    <select
                      value={adminSelectedCatId}
                      onChange={(e) => {
                        setAdminSelectedCatId(e.target.value);
                        setAdminSelectedTopicId('');
                        setAdminQuestionSearch('');
                        setAdminQuestionPage(1);
                        setIsAdminActionsOpen(false);
                        handleCloseAdminPreview();
                      }}
                      className="w-full h-12 px-4 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-brand-500 outline-none dark:text-white text-sm font-medium"
                    >
                      <option value="">Secim Yapiniz</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-2">Konu</label>
                    <select
                      value={adminSelectedTopicId}
                      onChange={(e) => {
                        setAdminSelectedTopicId(e.target.value);
                        setAdminQuestionSearch('');
                        setAdminQuestionPage(1);
                        setIsAdminActionsOpen(false);
                        handleCloseAdminPreview();
                      }}
                      disabled={!adminSelectedCatId}
                      className="w-full h-12 px-4 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-brand-500 outline-none dark:text-white text-sm font-medium disabled:opacity-40"
                    >
                      <option value="">{adminSelectedCatId ? "Konu Seciniz" : "—"}</option>
                      {categories.find(c => c.id === adminSelectedCatId)?.subCategories.map(sub => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-6 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-900/40 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-sm font-bold text-surface-800 dark:text-white flex items-center gap-2">
                      <Icon name="Flag" className="w-4 h-4 text-red-500" />
                      Hatali Soru Bildirimleri
                    </h3>
                    <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">
                      {questionReports.length} bildirim
                    </span>
                  </div>

                  {adminVisibleReports.length > 0 ? (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                      {adminVisibleReports.map((report) => {
                        const linkedQuestion = report.questionId ? questionLookup[report.questionId] : undefined;

                        return (
                          <div key={report.id || `${report.questionId}_${String(report.createdAt)}`} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 font-semibold">
                                {formatDateTime(report.createdAt)}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300 font-semibold">
                                {report.reporterUsername || "Kullanici"}
                              </span>
                              {!linkedQuestion && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 font-semibold">
                                  Soru bulunamadi
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-surface-700 dark:text-surface-200 font-semibold leading-relaxed">
                              {linkedQuestion?.questionText || report.questionTextSnapshot || "Soru metni yok"}
                            </p>

                            {report.note && (
                              <p className="mt-1 text-[11px] text-surface-500 dark:text-surface-400 leading-relaxed">
                                Not: {report.note}
                              </p>
                            )}

                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              <button
                                onClick={() => {
                                  if (linkedQuestion) handleOpenAdminPreview(linkedQuestion);
                                }}
                                disabled={!linkedQuestion}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Gor
                              </button>
                              <button
                                onClick={() => {
                                  if (!linkedQuestion) return;
                                  const ownerCategory = categories.find((cat) =>
                                    cat.subCategories.some((sub) => sub.id === linkedQuestion.topicId)
                                  );
                                  if (ownerCategory) {
                                    setAdminSelectedCatId(ownerCategory.id);
                                  }
                                  setAdminSelectedTopicId(linkedQuestion.topicId);
                                  setAdminQuestionSearch('');
                                  setAdminQuestionPage(1);
                                  handleStartEditQuestion(linkedQuestion, 0);
                                }}
                                disabled={!linkedQuestion}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800/40 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Duzenle
                              </button>
                              <button
                                onClick={() => {
                                  if (linkedQuestion?.id) {
                                    handleDeleteQuestion(linkedQuestion.id);
                                  }
                                }}
                                disabled={!linkedQuestion?.id}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/40 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Soruyu Sil
                              </button>
                              <button
                                onClick={() => {
                                  if (report.id) handleDeleteReport(report.id);
                                }}
                                disabled={!report.id}
                                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-600 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Bildirimi Sil
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-surface-400">Henuz soru bildirimi yok.</p>
                  )}
                </div>

                {adminSelectedTopicId && (
                  <div className="space-y-5 animate-fade-in">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-surface-100 dark:border-surface-700 pb-5 gap-3">
                      <h3 className="text-xl font-bold text-surface-800 dark:text-white">
                        Sorular <span className="text-surface-400 ml-1.5 text-sm font-medium">({adminTopicQuestions.length})</span>
                      </h3>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => setIsTopicModalOpen(true)}
                          className="px-4 py-2.5 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition font-bold text-xs"
                        >
                          Konu Ekle
                        </button>
                        <button
                          onClick={() => setIsQuestionModalOpen(true)}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition shadow-lg shadow-brand-600/20 font-bold text-xs"
                        >
                          <Icon name="Plus" className="w-3.5 h-3.5" />
                          Soru Ekle
                        </button>
                        <button
                          onClick={() => setIsBulkImportOpen(true)}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/20 font-bold text-xs"
                        >
                          <Icon name="Layers" className="w-3.5 h-3.5" />
                          Toplu Aktar
                        </button>
                        {adminTopicQuestions.length > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setIsAdminActionsOpen(prev => !prev)}
                              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition font-bold text-xs"
                            >
                              <Icon name="Settings" className="w-3.5 h-3.5" />
                              Toplu Islemler
                            </button>
                            {isAdminActionsOpen && (
                              <div className="absolute right-0 mt-2 w-44 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-xl z-20 overflow-hidden">
                                <button
                                  onClick={() => {
                                    setIsAdminActionsOpen(false);
                                    handleTagLatestQuestions();
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold text-surface-600 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-700 transition"
                                >
                                  Son X Etiketle
                                </button>
                                <button
                                  onClick={() => {
                                    setIsAdminActionsOpen(false);
                                    handleDeleteLatestQuestions();
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                                >
                                  Son X Sil
                                </button>
                                <button
                                  onClick={() => {
                                    setIsAdminActionsOpen(false);
                                    handleBulkDeleteQuestions();
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                                >
                                  Toplu Sil
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                      <div className="w-full md:max-w-md">
                        <input
                          type="text"
                          value={adminQuestionSearch}
                          onChange={(e) => {
                            setAdminQuestionSearch(e.target.value);
                            setAdminQuestionPage(1);
                          }}
                          placeholder="Soru, secenek, aciklama veya kaynakta ara..."
                          className="w-full h-10 px-3 rounded-lg bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm"
                        />
                      </div>
                      <div className="w-full md:w-auto flex items-center justify-between md:justify-end gap-2">
                        <span className="text-xs text-surface-400 font-medium">
                          {adminFilteredQuestions.length} sonuc
                        </span>
                        <button
                          onClick={() => setAdminQuestionPage(prev => Math.max(1, prev - 1))}
                          disabled={adminSafePage <= 1}
                          className="px-3 h-9 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold"
                        >
                          Geri
                        </button>
                        <span className="text-xs text-surface-500 dark:text-surface-400 font-semibold min-w-[56px] text-center">
                          {adminSafePage}/{adminTotalPages}
                        </span>
                        <button
                          onClick={() => setAdminQuestionPage(prev => Math.min(adminTotalPages, prev + 1))}
                          disabled={adminSafePage >= adminTotalPages}
                          className="px-3 h-9 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold"
                        >
                          Ileri
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {adminVisibleQuestions.length > 0 ? (
                        adminVisibleQuestions.map(({ question: q, originalIndex }, idx) => (
                          <div key={q.id || `${originalIndex}_${idx}`} className="bg-surface-50 dark:bg-surface-900/50 p-4 rounded-xl border border-surface-100 dark:border-surface-700 flex justify-between items-start gap-3 hover:border-brand-200 dark:hover:border-brand-800/50 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-white dark:bg-surface-800 text-[10px] font-bold rounded text-surface-500 border border-surface-100 dark:border-surface-700">#{adminPageStart + idx + 1}</span>
                                <span title="Doğru cevap" className="text-[9px] text-emerald-600 dark:text-emerald-400 font-black bg-emerald-50 dark:bg-emerald-900/20 px-1 py-0.5 rounded min-w-[18px] text-center">{String.fromCharCode(65 + q.correctOptionIndex)}</span>
                                {q.sourceTag && (
                                  <span className="text-[10px] text-slate-600 dark:text-slate-200 font-semibold bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded truncate max-w-[160px]">
                                    {q.sourceTag}
                                  </span>
                                )}
                              </div>
                              <p className="text-surface-700 dark:text-surface-200 font-medium text-sm leading-relaxed truncate">{q.questionText}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => handleOpenAdminPreview(q)}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                              >
                                <Icon name="Eye" className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleStartEditQuestion(q, originalIndex)}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                              >
                                <Icon name="PenLine" className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteQuestion(q.id!)}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                              >
                                <Icon name="Trash" className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-16">
                          <div className="w-14 h-14 bg-surface-100 dark:bg-surface-700 rounded-2xl flex items-center justify-center mx-auto mb-3 text-surface-300">
                            <Icon name="FileQuestion" className="w-6 h-6" />
                          </div>
                          <p className="text-surface-400 font-medium text-sm">
                            {adminTopicQuestions.length === 0 ? 'Bu konuda henuz soru bulunmuyor.' : 'Arama kriterine uygun soru bulunamadi.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== DASHBOARD - HOME ===== */}
          {currentView === 'dashboard' && !activeCategory && (
            <div className="animate-fade-in h-full flex flex-col overflow-hidden">
              <div className="mb-3 md:mb-4 shrink-0 rounded-2xl shadow-premium glass-card p-3 md:p-5 relative overflow-hidden">
                {/* Decorative gradient blob */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-brand-500/10 via-violet-500/5 to-transparent rounded-full blur-3xl"></div>

                <div className="flex items-center justify-between gap-3 sm:items-start sm:gap-4 relative z-10">
                  <div>
                    <p className="hidden sm:block text-gradient-primary font-bold text-xs md:text-sm mb-1">{getGreeting()}</p>
                    <h1 className="text-lg md:text-4xl font-black text-surface-800 dark:text-white mb-0.5 md:mb-1.5 tracking-tight">
                      {user.username}
                    </h1>
                    <p className="text-surface-600 dark:text-surface-400 text-[11px] md:text-sm max-w-2xl leading-snug md:leading-relaxed font-medium">
                      Bir ders seçerek devam et. Mobil görünüm tek ekrana optimize edildi.
                    </p>
                  </div>
                  <button
                    onClick={handleResetTopicProgressStats}
                    disabled={!hasAnyProgressStats}
                    className="h-8 md:h-10 px-3 md:px-4 rounded-xl border-2 border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[10px] md:text-sm font-bold hover:bg-red-100 dark:hover:bg-red-900/30 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 shadow-sm hover:shadow-md shrink-0"
                    title="Tüm istatistikleri sıfırla"
                  >
                    İstatistikleri Sıfırla
                  </button>
                </div>
              </div>

              <div className="hidden">
                <div className="glass-card rounded-xl p-3 border border-sky-100 dark:border-sky-900/30 shadow-premium hover-lift">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg flex items-center justify-center shadow-lg shadow-sky-500/25">
                      <Icon name="Target" className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.seenCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Karşına Çıkan</p>
                </div>
                <div className="glass-card rounded-xl p-3 border border-emerald-100 dark:border-emerald-900/30 shadow-premium hover-lift">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/25">
                      <Icon name="CheckCircle" className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.correctCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Doğru</p>
                </div>
                <div className="glass-card rounded-xl p-3 border border-red-100 dark:border-red-900/30 shadow-premium hover-lift">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-500/25">
                      <Icon name="CircleX" className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.wrongCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Yanlış</p>
                </div>
                <div className="glass-card rounded-xl p-3 border border-slate-100 dark:border-slate-700/50 shadow-premium hover-lift">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-slate-500 to-slate-600 rounded-lg flex items-center justify-center shadow-lg shadow-slate-500/25">
                      <Icon name="Minus" className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.blankCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Boş</p>
                </div>
              </div>

              <div className="hidden md:grid grid-cols-5 gap-3 mb-5 shrink-0 stagger-children">
                <div className="glass-card rounded-xl p-4 border border-brand-100 dark:border-brand-900/30 shadow-premium hover-lift animate-fade-in-scale">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/30">
                      <Icon name="Layers" className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-surface-800 dark:text-white mb-1 animate-count-up">{categories.length}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Kategori</p>
                </div>
                <div className="glass-card rounded-xl p-4 border border-emerald-100 dark:border-emerald-900/30 shadow-premium hover-lift animate-fade-in-scale">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                      <Icon name="BookOpen" className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-surface-800 dark:text-white mb-1 animate-count-up">{categories.reduce((sum, c) => sum + c.subCategories.length, 0)}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Konu</p>
                </div>
                <div className="glass-card rounded-xl p-4 border border-violet-100 dark:border-violet-900/30 shadow-premium hover-lift animate-fade-in-scale">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
                      <Icon name="FileQuestion" className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-surface-800 dark:text-white mb-1 animate-count-up">{getTotalQuestionCount()}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Soru</p>
                </div>
                <div className="glass-card rounded-xl p-4 border border-sky-100 dark:border-sky-900/30 shadow-premium hover-lift animate-fade-in-scale">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
                      <Icon name="Target" className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-surface-800 dark:text-white mb-1 animate-count-up">{overallProgressStats.seenCount}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Karşına Çıkan</p>
                </div>
                <div className="glass-card rounded-xl p-4 border border-amber-100 dark:border-amber-900/30 shadow-premium hover-lift animate-fade-in-scale">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                      <Icon name="CheckCircle" className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-2xl font-black text-surface-800 dark:text-white mb-1 animate-count-up">{overallProgressStats.correctCount}</p>
                  <p className="text-xs text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Toplam Doğru</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 flex-1 min-h-0 auto-rows-max content-start overflow-visible md:overflow-y-auto custom-scrollbar pr-0 md:pr-1.5 pb-0 md:pb-1">
                {categories.map((cat, index) => {
                  const color = getCatColor(cat.id);
                  const questionCount = cat.subCategories.reduce((sum, sub) => sum + (allQuestions[sub.id]?.length || 0), 0);

                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat)}
                      className="group relative w-full min-h-[98px] md:min-h-[150px] glass-card rounded-2xl p-2.5 md:p-4 shadow-premium hover:shadow-premium-lg hover:-translate-y-1 transition-all duration-300 text-left overflow-hidden animate-fade-in-scale flex flex-col"
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      {/* Animated gradient background blob */}
                      <div className={`pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gradient-to-br ${color.gradient} opacity-[0.08] blur-3xl transition-all duration-500 group-hover:opacity-[0.15] group-hover:scale-110`} />

                      {/* Shimmer effect on hover */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                        <div className="absolute inset-0 shimmer"></div>
                      </div>

                      <div className="relative z-10 h-full flex flex-col">
                        <div className="flex items-start justify-between mb-1.5 md:mb-3">
                          <div className={`w-8 h-8 md:w-11 md:h-11 rounded-lg md:rounded-xl bg-gradient-to-br ${color.gradient} flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                            <Icon name={cat.iconName} className="w-4 h-4 md:w-5.5 md:h-5.5 text-white" />
                          </div>
                          <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg bg-surface-100 dark:bg-surface-700/50 flex items-center justify-center text-surface-400 transition-all duration-300 group-hover:bg-gradient-to-br group-hover:${color.gradient} group-hover:text-white group-hover:scale-110`}>
                            <Icon name="ChevronRight" className="w-3 md:w-4 md:h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                          </div>
                        </div>

                        <h3 className="text-xs md:text-base font-black text-surface-800 dark:text-white mb-0.5 md:mb-1 line-clamp-1 tracking-tight">{cat.name}</h3>
                        <p className="hidden md:block text-surface-500 dark:text-surface-400 text-[11px] md:text-xs mb-auto leading-relaxed line-clamp-2 font-medium">{cat.description}</p>
                        <p className="md:hidden text-[10px] text-surface-500 dark:text-surface-400 font-bold mt-auto">{cat.subCategories.length} konu - {questionCount} soru</p>

                        <div className="hidden md:flex items-center gap-2 md:gap-3 text-[10px] md:text-xs text-surface-500 dark:text-surface-400 font-bold mt-3 pt-2.5 border-t border-surface-200/50 dark:border-surface-700/50">
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <Icon name="BookOpen" className="w-3.5 h-3.5" />
                            {cat.subCategories.length} konu
                          </span>
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <Icon name="FileQuestion" className="w-3.5 h-3.5" />
                            {questionCount} soru
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== DASHBOARD - SUBCATEGORIES ===== */}
          {currentView === 'dashboard' && activeCategory && (
            <div className="animate-fade-in h-full flex flex-col overflow-hidden">
              <button
                onClick={() => setActiveCategory(null)}
                className="inline-flex items-center gap-2 text-surface-400 hover:text-brand-500 transition-colors font-medium text-sm mb-3 shrink-0"
              >
                <Icon name="ArrowLeft" className="w-4 h-4" />
                Tum Dersler
              </button>

              <div className="mb-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-2.5 md:p-3.5 shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 md:w-9 md:h-9 rounded-lg ${getCatColor(activeCategory.id).bgLight} ${getCatColor(activeCategory.id).bgDark} flex items-center justify-center ${getCatColor(activeCategory.id).text} ${getCatColor(activeCategory.id).textDark}`}>
                      <Icon name={activeCategory.iconName} className="w-4 h-4 md:w-4.5 md:h-4.5" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-base md:text-xl font-extrabold text-surface-800 dark:text-white truncate">
                        {activeCategory.name}
                      </h1>
                    </div>
                  </div>
                  <span className="px-1.5 md:px-2 py-0.5 md:py-1 rounded-md bg-surface-50 dark:bg-surface-700 text-[10px] md:text-[11px] font-bold text-surface-500 dark:text-surface-300 whitespace-nowrap">
                    {activeCategory.subCategories.length} konu
                  </span>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-2">
                {activeCategory.subCategories.map((sub) => {
                  const questionCount = allQuestions[sub.id]?.length || 0;
                  const color = getCatColor(activeCategory.id);
                  const topicProgress = getTopicProgress(sub.id);
                  const seenCount = topicProgress.seenCount;
                  const attempted = topicProgress.correctCount + topicProgress.totalWrongAnswers;
                  const accuracy = attempted > 0 ? Math.round((topicProgress.correctCount / attempted) * 100) : 0;
                  const hasTopicProgressStats = seenCount > 0 || topicProgress.completedQuizCount > 0 || topicProgress.wrongCount > 0 || topicProgress.blankCount > 0;

                  return (
                    <button
                      key={sub.id}
                      onClick={() => openQuizSetup(activeCategory, sub)}
                      className="w-full text-left group cursor-pointer bg-white dark:bg-surface-800 rounded-xl p-2 md:p-2.5 border border-surface-100 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 transition-all duration-200 animate-fade-in"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-6 h-6 ${color.bgLight} ${color.bgDark} rounded-md flex items-center justify-center ${color.text} ${color.textDark}`}>
                            <Icon name={activeCategory.iconName} className="w-3 h-3" />
                          </div>
                          <div className="min-w-0 flex items-baseline gap-1.5">
                            <h3 className="text-[12px] md:text-[13px] font-bold text-surface-800 dark:text-surface-100 truncate">
                              {sub.name}
                            </h3>
                            <span className="text-[10px] md:text-[11px] text-surface-400 dark:text-surface-500 font-semibold whitespace-nowrap">
                              ({questionCount})
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${color.bgLight} ${color.bgDark} ${color.text} ${color.textDark}`}>
                            %{accuracy}
                          </span>
                          <span
                            role="button"
                            tabIndex={hasTopicProgressStats ? 0 : -1}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!hasTopicProgressStats) return;
                              handleResetSingleTopicProgressStats(sub.id, sub.name);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!hasTopicProgressStats) return;
                                handleResetSingleTopicProgressStats(sub.id, sub.name);
                              }
                            }}
                            className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                              hasTopicProgressStats
                                ? 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30 cursor-pointer'
                                : 'bg-surface-100 dark:bg-surface-700 text-surface-300 dark:text-surface-500 cursor-not-allowed'
                            }`}
                            title={hasTopicProgressStats ? 'Bu konunun istatistiklerini sifirla' : 'Bu konuda sifirlanacak istatistik yok'}
                          >
                            <Icon name="RotateCcw" className="w-2.5 h-2.5" />
                          </span>
                          <div className={`w-5 h-5 rounded-md bg-surface-50 dark:bg-surface-700 flex items-center justify-center group-hover:bg-gradient-to-r group-hover:${color.gradient} group-hover:text-white transition-all`}>
                            <Icon name="Play" className="w-2.5 h-2.5 text-surface-300 group-hover:text-white transition-colors" />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden bg-surface-50/70 dark:bg-surface-900/50">
                        <div className="grid grid-cols-4 divide-x divide-surface-200 dark:divide-surface-700 text-[9px] md:text-[11px]">
                          <div className="px-1.5 md:px-2 py-1">
                            <p className="font-semibold leading-none whitespace-nowrap">
                              <span className="text-surface-400 dark:text-surface-500">Gorulen:</span>{' '}
                              <span className="text-brand-600 dark:text-brand-300 font-bold">{seenCount}</span>
                            </p>
                          </div>
                          <div className="px-1.5 md:px-2 py-1">
                            <p className="font-semibold leading-none whitespace-nowrap">
                              <span className="text-surface-400 dark:text-surface-500">Dogru:</span>{' '}
                              <span className="text-emerald-700 dark:text-emerald-300 font-bold">{topicProgress.correctCount}</span>
                            </p>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openQuizSetup(activeCategory, sub, 'wrong');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                openQuizSetup(activeCategory, sub, 'wrong');
                              }
                            }}
                            className="block px-1.5 md:px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 transition cursor-pointer"
                            title="Yanlis sorulardan sinav olustur"
                          >
                            <p className="font-semibold leading-none whitespace-nowrap">
                              <span className="text-surface-400 dark:text-surface-500">Yanlis:</span>{' '}
                              <span className="text-red-700 dark:text-red-300 font-bold">{topicProgress.wrongCount}</span>
                            </p>
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openQuizSetup(activeCategory, sub, 'blank');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                openQuizSetup(activeCategory, sub, 'blank');
                              }
                            }}
                            className="block px-1.5 md:px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition cursor-pointer"
                            title="Bos sorulardan sinav olustur"
                          >
                            <p className="font-semibold leading-none whitespace-nowrap">
                              <span className="text-surface-400 dark:text-surface-500">Bos:</span>{' '}
                              <span className="text-slate-600 dark:text-slate-200 font-bold">{topicProgress.blankCount}</span>
                            </p>
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== MODALS ===== */}

      {/* Reset Stats Confirm Modal */}
      {isResetStatsModalOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancelResetTopicProgressStats();
          }}
        >
          <div className="relative w-full max-w-md rounded-3xl border border-red-200/70 dark:border-red-900/40 bg-white/95 dark:bg-surface-800/95 shadow-2xl overflow-hidden modal-content animate-fade-in-scale">
            <div className="absolute -top-14 -right-10 w-36 h-36 rounded-full bg-red-500/20 blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-16 -left-10 w-36 h-36 rounded-full bg-amber-500/15 blur-3xl pointer-events-none"></div>

            <div className="relative p-6 sm:p-7">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 flex items-center justify-center mb-4">
                <Icon name="CircleX" className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-extrabold text-surface-900 dark:text-white mb-2">
                {resetStatsTargetTopic ? 'Konu istatistiklerini sifirla' : 'Istatistikleri sifirla'}
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed mb-4">
                {resetStatsTargetTopic
                  ? `"${resetStatsTargetTopic.name}" konusu icin kayitli istatistikler silinecek. Bu islem geri alinamaz.`
                  : 'Tum istatistik kayitlariniz silinecek. Bu islem geri alinamaz.'}
              </p>

              <div className="grid grid-cols-2 gap-2 mb-6 text-[11px]">
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 px-3 py-2">
                  <p className="text-surface-400 mb-0.5">Karsina Cikan</p>
                  <p className="font-extrabold text-surface-700 dark:text-surface-100">{resetStatsPreview.seenCount}</p>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 px-3 py-2">
                  <p className="text-surface-400 mb-0.5">Dogru</p>
                  <p className="font-extrabold text-surface-700 dark:text-surface-100">{resetStatsPreview.correctCount}</p>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 px-3 py-2">
                  <p className="text-surface-400 mb-0.5">Yanlis</p>
                  <p className="font-extrabold text-surface-700 dark:text-surface-100">{resetStatsPreview.wrongCount}</p>
                </div>
                <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50 px-3 py-2">
                  <p className="text-surface-400 mb-0.5">Bos</p>
                  <p className="font-extrabold text-surface-700 dark:text-surface-100">{resetStatsPreview.blankCount}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleCancelResetTopicProgressStats}
                  className="flex-1 h-11 rounded-xl border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition text-sm font-bold"
                >
                  Vazgec
                </button>
                <button
                  onClick={handleConfirmResetTopicProgressStats}
                  className="flex-[1.2] h-11 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white text-sm font-bold shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition"
                >
                  {resetStatsTargetTopic ? 'Konuyu Sifirla' : 'Tumunu Sifirla'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Question Modal */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-surface-100 dark:border-surface-700 my-10 modal-content">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-surface-800 dark:text-white">Soru Ekle</h3>
              <button onClick={handleCloseQuestionModal} className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Görsel URL</label>
                <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={questionForm.imageUrl} onChange={e => setQuestionForm({...questionForm, imageUrl: e.target.value})} placeholder="https://..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Giriş Metni <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-16 resize-none text-sm" value={questionForm.contextText} onChange={e => setQuestionForm({...questionForm, contextText: e.target.value})} placeholder="Öncüllerin üstünde yer alan giriş metni..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Öncüller <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-20 resize-none text-sm"
                  placeholder={"I. Madde Bir\nII. Madde İki\nIII. Madde Üç"}
                  value={questionForm.itemsText}
                  onChange={e => setQuestionForm({...questionForm, itemsText: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Soru Kökü</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-24 text-sm font-medium" value={questionForm.questionRoot} onChange={e => setQuestionForm({...questionForm, questionRoot: e.target.value})} placeholder="Aşağıdakilerden hangisi...?" />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">ŞIKLAR (Her satıra bir şık)</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-28 font-mono text-xs" value={questionForm.optionsText} onChange={e => setQuestionForm({...questionForm, optionsText: e.target.value})} placeholder={"A) ...\nB) ...\nC) ...\nD) ...\nE) ..."} />
              </div>
              <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-1.5">Doğru</label>
                  <select className="w-full px-2 py-2.5 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white font-extrabold text-center text-xs" value={questionForm.correctOption} onChange={e => setQuestionForm({...questionForm, correctOption: parseInt(e.target.value)})}>
                    <option value={0}>A</option><option value={1}>B</option><option value={2}>C</option><option value={3}>D</option><option value={4}>E</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Açıklama</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={questionForm.explanation} onChange={e => setQuestionForm({...questionForm, explanation: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Kaynak Etiketi <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm"
                    value={questionForm.sourceTag}
                    onChange={e => setQuestionForm({...questionForm, sourceTag: e.target.value})}
                    placeholder="Örn: 2024 KPSS Deneme 3"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/70 dark:bg-surface-900/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-surface-400">Kayıt Listesi</p>
                  <span className="text-xs font-bold text-brand-600 dark:text-brand-400">{pendingQuestions.length} soru</span>
                </div>
                {pendingQuestions.length === 0 ? (
                  <p className="text-xs text-surface-400">Sorular önce listeye eklenir, sonra tek seferde kaydedilir.</p>
                ) : (
                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                    {pendingQuestions.map((q, idx) => (
                      <div key={`${q.questionText}-${idx}`} className="flex items-start justify-between gap-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-surface-700 dark:text-surface-200 truncate">{idx + 1}. {q.questionText}</p>
                          {q.sourceTag && (
                            <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                              {q.sourceTag}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemovePendingQuestion(idx)}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition shrink-0"
                        >
                          <Icon name="Trash" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-5 border-t border-surface-100 dark:border-surface-700">
              <button onClick={handleCloseQuestionModal} className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition">İptal</button>
              <button onClick={handleAddQuestionToQueue} className="flex-1 py-3 bg-amber-500 text-white font-bold text-sm rounded-xl hover:bg-amber-600 shadow-lg shadow-amber-500/20 transition">Listeye Ekle</button>
              <button
                onClick={handleSaveQuestion}
                disabled={pendingQuestions.length === 0}
                className="flex-1 py-3 bg-brand-600 text-white font-bold text-sm rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pendingQuestions.length > 0 ? `${pendingQuestions.length} Soruyu Kaydet` : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-surface-100 dark:border-surface-700 my-10 modal-content">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <Icon name="PenLine" className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-xl font-extrabold text-surface-800 dark:text-white">Soruyu Düzenle</h3>
              </div>
              <button onClick={() => setEditingQuestion(null)} className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Görsel URL</label>
                <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={editForm.imageUrl} onChange={e => setEditForm({...editForm, imageUrl: e.target.value})} placeholder="https://..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Giriş Metni <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-16 resize-none text-sm" value={editForm.contextText} onChange={e => setEditForm({...editForm, contextText: e.target.value})} placeholder="Öncüllerin üstünde yer alan giriş metni..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Öncüller <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-20 resize-none text-sm"
                  placeholder={"I. Madde Bir\nII. Madde İki\nIII. Madde Üç"}
                  value={editForm.itemsText}
                  onChange={e => setEditForm({...editForm, itemsText: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Soru Kökü</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-24 text-sm font-medium" value={editForm.questionRoot} onChange={e => setEditForm({...editForm, questionRoot: e.target.value})} placeholder="Aşağıdakilerden hangisi...?" />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">ŞIKLAR</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-28 font-mono text-xs" value={editForm.optionsText} onChange={e => setEditForm({...editForm, optionsText: e.target.value})} placeholder={"A) ...\nB) ...\nC) ...\nD) ...\nE) ..."} />
              </div>
              <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-1.5">Doğru</label>
                  <select className="w-full px-2 py-2.5 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white font-extrabold text-center text-xs" value={editForm.correctOption} onChange={e => setEditForm({...editForm, correctOption: parseInt(e.target.value)})}>
                    <option value={0}>A</option><option value={1}>B</option><option value={2}>C</option><option value={3}>D</option><option value={4}>E</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Açıklama</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={editForm.explanation} onChange={e => setEditForm({...editForm, explanation: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Kaynak Etiketi <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm"
                    value={editForm.sourceTag}
                    onChange={e => setEditForm({...editForm, sourceTag: e.target.value})}
                    placeholder="Örn: 2024 KPSS Deneme 3"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-5 border-t border-surface-100 dark:border-surface-700">
              <button onClick={() => setEditingQuestion(null)} className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition">İptal</button>
              <button onClick={handleSaveEditQuestion} className="flex-[2] py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-amber-500/20 transition flex items-center justify-center gap-2">
                <Icon name="CircleCheck" className="w-4 h-4" />
                Güncelle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Question Preview Modal */}
      {adminPreviewQuestion && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4 modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl border border-surface-100 dark:border-surface-700 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden modal-content">
            <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700">
              <div>
                <h3 className="text-lg font-extrabold text-surface-800 dark:text-white">Soru Test Onizleme</h3>
                <p className="text-xs text-surface-400">Sinav ekranina yakin gorunum</p>
              </div>
              <button onClick={handleCloseAdminPreview} className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {adminPreviewQuestion.sourceTag && (
                <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">
                  {adminPreviewQuestion.sourceTag}
                </span>
              )}
              {adminPreviewQuestion.contextText && (
                <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
                  {adminPreviewQuestion.contextText}
                </p>
              )}
              {adminPreviewQuestion.contentItems && adminPreviewQuestion.contentItems.length > 0 && (
                <div className="rounded-xl bg-surface-50 dark:bg-surface-900/50 border border-surface-100 dark:border-surface-700 p-3.5 space-y-1">
                  {adminPreviewQuestion.contentItems.map((item, idx) => (
                    <p key={idx} className="text-sm text-surface-700 dark:text-surface-300 font-medium">
                      {item}
                    </p>
                  ))}
                </div>
              )}
              <h4 className="text-base font-bold text-surface-800 dark:text-white leading-relaxed">
                {adminPreviewQuestion.questionText}
              </h4>

              <div className="space-y-2">
                {adminPreviewQuestion.options.map((option, idx) => {
                  const isSelected = adminPreviewSelectedOption === idx;
                  const isCorrect = idx === adminPreviewQuestion.correctOptionIndex;
                  const checkedWrong = adminPreviewChecked && isSelected && !isCorrect;
                  const checkedRight = adminPreviewChecked && isCorrect;

                  return (
                    <button
                      key={`${option}_${idx}`}
                      onClick={() => {
                        setAdminPreviewSelectedOption(idx);
                        setAdminPreviewChecked(false);
                      }}
                      className={`w-full text-left border-2 rounded-xl p-3.5 flex items-start gap-3 transition ${
                        checkedRight
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700'
                          : checkedWrong
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                            : isSelected
                              ? 'bg-brand-50 dark:bg-brand-900/20 border-brand-300 dark:border-brand-700'
                              : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-500'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                        checkedRight
                          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                          : checkedWrong
                            ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                            : isSelected
                              ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'
                              : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400'
                      }`}>
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span className="text-sm text-surface-700 dark:text-surface-200 font-medium leading-relaxed">{option}</span>
                    </button>
                  );
                })}
              </div>

              {adminPreviewChecked && adminPreviewQuestion.explanation && (
                <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 p-3.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-surface-400 mb-1.5">Aciklama</p>
                  <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">{adminPreviewQuestion.explanation}</p>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-surface-100 dark:border-surface-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <p className="text-xs font-semibold text-surface-500 dark:text-surface-400">
                {adminPreviewChecked && adminPreviewSelectedOption !== null
                  ? adminPreviewSelectedOption === adminPreviewQuestion.correctOptionIndex
                    ? 'Dogru cevap.'
                    : `Yanlis cevap. Dogru: ${String.fromCharCode(65 + adminPreviewQuestion.correctOptionIndex)}`
                  : 'Bir secenek secip cevabi kontrol edebilirsiniz.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAdminPreviewSelectedOption(null);
                    setAdminPreviewChecked(false);
                  }}
                  className="px-3.5 h-10 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition text-xs font-bold"
                >
                  Sifirla
                </button>
                <button
                  onClick={() => setAdminPreviewChecked(true)}
                  disabled={adminPreviewSelectedOption === null}
                  className="px-4 h-10 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Cevabi Kontrol Et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category/Topic Modal */}
      {(isCategoryModalOpen || isTopicModalOpen) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-surface-100 dark:border-surface-700 modal-content">
            <h3 className="text-xl font-extrabold text-surface-800 dark:text-white mb-5">{isCategoryModalOpen ? 'Kategori Ekle' : 'Konu Ekle'}</h3>
            <input
              type="text"
              value={isCategoryModalOpen ? newCategoryName : newTopicName}
              onChange={(e) => isCategoryModalOpen ? setNewCategoryName(e.target.value) : setNewTopicName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white mb-6 text-sm"
              placeholder="Isim giriniz..."
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => { setIsCategoryModalOpen(false); setIsTopicModalOpen(false); }} className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition">Iptal</button>
              <button onClick={isCategoryModalOpen ? handleAddCategory : handleAddTopic} className="flex-[2] py-3 bg-brand-600 text-white font-bold text-sm rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-600/20 transition">Ekle</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {isBulkImportOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-2xl border border-surface-100 dark:border-surface-700 modal-content w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-surface-100 dark:border-surface-700 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
                  <Icon name="Layers" className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-surface-800 dark:text-white">Toplu Soru Aktarimi</h3>
                  <p className="text-xs text-surface-400">{bulkStep === 'paste' ? 'Sorulari yapistirin' : `${bulkParsed.length} soru ayristirildi${bulkParseErrors.length > 0 ? `, ${bulkParseErrors.length} hata` : ''}`}</p>
                </div>
              </div>
              <button onClick={handleBulkClose} className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>

            {bulkStep === 'paste' ? (
              /* Paste Step */
              <div className="flex flex-col flex-1 overflow-hidden p-5 gap-4">
                <p className="text-xs text-surface-400">
                  Duz metin veya JSON formati desteklenir. JSON icin alanlar: <span className="font-mono">questionText</span>, <span className="font-mono">contentItems</span>, <span className="font-mono">options</span>, <span className="font-mono">answer</span>.
                </p>
                <textarea
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    if (bulkParseErrors.length > 0) setBulkParseErrors([]);
                  }}
                  className="flex-1 min-h-[250px] w-full p-4 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm font-mono resize-none"
                  placeholder={"Sorulari buraya yapistirin...\n\nDuz metin ornegi:\n1. Asagidakilerden hangisi...?\nA) Secenek 1\nB) Secenek 2\nC) Secenek 3\nD) Secenek 4\nE) Secenek 5\n\n1. COZUM: Aciklama... CEVAP: A\n\nJSON ornegi:\n[{\"questionText\":\"...\",\"contentItems\":[\"...\"],\"options\":[\"...\"],\"answer\":\"A\"}]"}
                />
                <button
                  onClick={handleBulkParse}
                  disabled={!bulkText.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-brand-600 to-brand-500 text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-brand-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Icon name="Sparkles" className="w-4 h-4" />
                  Ayristir ve Onizle
                </button>
              </div>
            ) : (
              /* Preview Step */
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {bulkParseErrors.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-2">Schema Hata Listesi</p>
                      <div className="space-y-1">
                        {bulkParseErrors.slice(0, 12).map((err, idx) => (
                          <p key={`${err}-${idx}`} className="text-xs text-amber-800 dark:text-amber-200">
                            {idx + 1}. {err}
                          </p>
                        ))}
                        {bulkParseErrors.length > 12 && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            +{bulkParseErrors.length - 12} hata daha...
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {bulkParsed.length === 0 ? (
                    <div className="text-center py-12">
                      <Icon name="FileQuestion" className="w-12 h-12 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
                      <p className="text-surface-400 text-sm font-medium">Hicbir soru ayristirilamadi.</p>
                      <p className="text-surface-300 dark:text-surface-500 text-xs mt-1">Lutfen formati kontrol edin.</p>
                    </div>
                  ) : (
                    bulkParsed.map((q, idx) => (
                      <div key={idx} className="bg-surface-50 dark:bg-surface-900/50 rounded-xl border border-surface-100 dark:border-surface-700 p-4 group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-xs font-bold shrink-0">{idx + 1}</span>
                              <p className="text-sm font-semibold text-surface-800 dark:text-white truncate">{q.questionText.substring(0, 80)}{q.questionText.length > 80 ? '...' : ''}</p>
                            </div>
                            {q.contentItems && q.contentItems.length > 0 && (
                              <div className="ml-8 mb-2 space-y-0.5">
                                {q.contentItems.map((item, i) => (
                                  <p key={i} className="text-xs text-surface-500 dark:text-surface-400">
                                    {item.substring(0, 60)}{item.length > 60 ? '...' : ''}
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="ml-8 flex flex-wrap gap-1.5">
                              {q.options.map((opt, oi) => (
                                <span key={oi} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${oi === q.correctOptionIndex ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold' : 'bg-surface-100 dark:bg-surface-800 text-surface-500'}`}>
                                  <span className="font-medium">{'ABCDE'[oi]})</span> {opt.substring(0, 30)}{opt.length > 30 ? '...' : ''}
                                </span>
                              ))}
                            </div>
                            {q.explanation && (
                              <p className="ml-8 mt-1.5 text-xs text-surface-400 dark:text-surface-500 italic truncate">Aciklama: {q.explanation.substring(0, 80)}...</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveBulkQuestion(idx)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition shrink-0 opacity-0 group-hover:opacity-100"
                          >
                            <Icon name="Trash" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {/* Footer */}
                <div className="p-5 border-t border-surface-100 dark:border-surface-700 shrink-0 flex gap-3">
                  <button
                    onClick={() => setBulkStep('paste')}
                    className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition"
                  >
                    Geri Don
                  </button>
                  <button
                    onClick={handleBulkSave}
                    disabled={bulkParsed.length === 0 || !adminSelectedTopicId}
                    className="flex-[2] py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-emerald-600/20 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Icon name="CircleCheck" className="w-4 h-4" />
                    {bulkParsed.length} Soruyu Kaydet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-surface-800/90 backdrop-blur-xl border-t border-surface-200 dark:border-surface-700 z-50 mobile-safe-bottom">
        <div className="flex items-center justify-around h-14">
          <button
            onClick={() => { setCurrentView('dashboard'); setActiveCategory(null); }}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
              currentView === 'dashboard' && !activeCategory ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400'
            }`}
          >
            <Icon name="Home" className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Ana Sayfa</span>
          </button>
          <button
            onClick={() => { setCurrentView('dashboard'); if (!activeCategory && categories.length > 0) setActiveCategory(categories[0]); }}
            className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
              currentView === 'dashboard' && activeCategory ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400'
            }`}
          >
            <Icon name="GraduationCap" className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Dersler</span>
          </button>
          {user.role === 'admin' && (
            <button
              onClick={() => setCurrentView('admin')}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 transition-colors ${
                currentView === 'admin' ? 'text-brand-600 dark:text-brand-400' : 'text-surface-400'
              }`}
            >
              <Icon name="Settings" className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Yonetim</span>
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center gap-0.5 px-4 py-1 text-surface-400 hover:text-red-500 transition-colors"
          >
            <Icon name="LogOut" className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Cikis</span>
          </button>
        </div>
      </div>
    </div>
  );
}
