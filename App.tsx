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
  deleteField,
  setDoc,
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  where, 
  writeBatch, 
  getDocs
} from 'firebase/firestore';

type ViewState = 'dashboard' | 'statistics' | 'quiz-setup' | 'quiz' | 'admin';
type QuizConfirmAction = 'exit' | 'finish';
type TopicProgressStats = {
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  totalWrongAnswers: number;
  lastPlayedAt: number;
};
type LegacyTopicProgressStats = {
  seenQuestionIds: string[];
  correctQuestionIds: string[];
  wrongQuestionIds: string[];
  wrongRecoveryStreakByQuestionId: Record<string, number>;
  correctCount: number;
  wrongCount: number;
  lastPlayedAt: number;
};
type WrongQuestionStatus = 'active_wrong' | 'resolved';
type WrongQuestionStats = {
  questionTrackingId: string;
  topicId: string;
  status: WrongQuestionStatus;
  recoveryStreak: number;
  wrongCount: number;
  lastWrongAt: number;
  resolvedAt: number;
};
type FavoriteQuestionRecord = {
  questionTrackingId: string;
  topicId: string;
  questionId: string | null;
  questionText: string;
  sourceTag: string | null;
  createdAt: number;
  updatedAt: number;
};
type SeenQuestionStats = {
  questionTrackingId: string;
  topicId: string;
  questionId: string | null;
  questionText: string;
  sourceTag: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
};
type QuizStatusFilter = {
  wrong: boolean;
  favorite: boolean;
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
const BLANK_STATS_CLEANUP_KEY_PREFIX = 'kpsspro_blank_stats_cleanup_v1_';
const COMPLETED_QUIZ_COUNT_CLEANUP_KEY_PREFIX = 'kpsspro_completed_quiz_count_cleanup_v1_';

const STORAGE_KEYS = {
  theme: 'kpsspro_theme',
  lightThemeVariant: 'kpsspro_light_theme_variant',
  quizSize: 'kpsspro_quiz_size',
  categories: 'kpsspro_categories',
  topicProgressStats: 'kpsspro_topic_progress_stats',
  topicBloggerPages: 'kpsspro_topic_blogger_pages',
  persistSeenQuestionsToFirestore: 'kpsspro_persist_seen_questions_firestore',
} as const;
type LightThemeVariant = 'aura' | 'clean';
const UNTAGGED_SOURCE_KEY = '__untagged__';
const QUESTION_ID_MAX_LENGTH = 120;
const DEFAULT_BLOGGER_JSON_URL = 'https://kpsst.blogspot.com/p/kpss-iott.html';
const APP_CONFIG_COLLECTION = 'appConfig';
const CATEGORIES_CONFIG_DOC = 'categories';
const CATEGORIES_CONFIG_FIELD = 'categories';
const TOPIC_BLOGGER_PAGES_CONFIG_COLLECTION = APP_CONFIG_COLLECTION;
const TOPIC_BLOGGER_PAGES_CONFIG_DOC = 'topicBloggerPages';
const TOPIC_BLOGGER_PAGES_FIELD = 'pages';
const DELETED_TOPIC_IDS_FIELD = 'deletedTopicIds';
const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
const QUESTIONS_SOURCE = (runtimeEnv.VITE_QUESTIONS_SOURCE || 'blogger').toLowerCase();
const BLOGGER_JSON_URL = (runtimeEnv.VITE_BLOGGER_JSON_URL || DEFAULT_BLOGGER_JSON_URL).trim();
const DEFAULT_PERSIST_SEEN_QUESTIONS_TO_FIRESTORE = false;

const EMPTY_TOPIC_PROGRESS: TopicProgressStats = {
  seenCount: 0,
  correctCount: 0,
  wrongCount: 0,
  totalWrongAnswers: 0,
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
const getFavoriteQuestionDocId = (questionTrackingId: string): string => encodeURIComponent(questionTrackingId);
const getQuestionTrackingIdFromFavoriteDocId = (docId: string): string => {
  try {
    return decodeURIComponent(docId);
  } catch {
    return docId;
  }
};
const getSeenQuestionDocId = (questionTrackingId: string): string => encodeURIComponent(questionTrackingId);
const getQuestionTrackingIdFromSeenDocId = (docId: string): string => {
  try {
    return decodeURIComponent(docId);
  } catch {
    return docId;
  }
};

const sanitizeQuestionId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const compact = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[\/\\?#\[\]]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!compact) return null;
  return compact.slice(0, QUESTION_ID_MAX_LENGTH);
};

const createQuestionId = (topicId: string): string => {
  const safeTopicId = sanitizeQuestionId(topicId) || 'topic';
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${safeTopicId}_${Date.now()}_${randomPart}`;
};

const getQuestionStableId = (question: Question): string | null => {
  const explicitId = sanitizeQuestionId(question.questionId);
  if (explicitId) return explicitId;
  const fallbackId = sanitizeQuestionId(question.id);
  if (fallbackId) return fallbackId;
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeHttpUrl = (value: unknown): string | null => {
  const text = asNonEmptyString(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeQuestionOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const resolveCorrectOptionIndex = (raw: Record<string, unknown>, optionCount: number): number => {
  const fromIndex = raw.correctOptionIndex;
  if (typeof fromIndex === 'number' && Number.isFinite(fromIndex)) {
    const indexValue = Math.trunc(fromIndex);
    if (indexValue >= 0 && indexValue < optionCount) return indexValue;
  }

  const fromAnswer = raw.answer;
  if (typeof fromAnswer === 'string') {
    const answerIndex = 'ABCDE'.indexOf(fromAnswer.trim().toUpperCase());
    if (answerIndex >= 0 && answerIndex < optionCount) return answerIndex;
  }

  return 0;
};

const createFallbackQuestionId = (topicId: string, questionText: string, index: number): string => {
  const safeTopicId = sanitizeQuestionId(topicId) || 'topic';
  const safeQuestionPart = sanitizeQuestionId(questionText.toLocaleLowerCase('tr')) || `soru-${index + 1}`;
  return `${safeTopicId}_${index + 1}_${safeQuestionPart}`.slice(0, QUESTION_ID_MAX_LENGTH);
};

const normalizeExternalQuestion = (raw: unknown, topicId: string, index: number): Question | null => {
  if (!isRecord(raw)) return null;
  const questionText = asNonEmptyString(raw.questionText);
  if (!questionText) return null;

  const options = normalizeQuestionOptions(raw.options);
  if (options.length < 2) return null;
  const correctOptionIndex = resolveCorrectOptionIndex(raw, options.length);
  const parsedQuestionId =
    sanitizeQuestionId(raw.questionId) ||
    sanitizeQuestionId(raw.id) ||
    createFallbackQuestionId(topicId, questionText, index);

  const contentItems = Array.isArray(raw.contentItems)
    ? raw.contentItems
      .map((item) => asNonEmptyString(item))
      .filter((item): item is string => Boolean(item))
    : undefined;

  return {
    id: parsedQuestionId,
    questionId: parsedQuestionId,
    questionText,
    options,
    correctOptionIndex,
    contextText: asNonEmptyString(raw.contextText) || undefined,
    contentItems: contentItems && contentItems.length > 0 ? contentItems : undefined,
    sourceTag: asNonEmptyString(raw.sourceTag) || undefined,
    imageUrl: asNonEmptyString(raw.imageUrl) || undefined,
    explanation: asNonEmptyString(raw.explanation) || '',
  };
};

const appendExternalTopicQuestions = (
  groupedQuestions: Record<string, Question[]>,
  topicId: string,
  questions: unknown
) => {
  if (!Array.isArray(questions)) return;
  const safeTopicId = asNonEmptyString(topicId) || 'default-topic';
  const normalized = questions
    .map((rawQuestion, index) => normalizeExternalQuestion(rawQuestion, safeTopicId, index))
    .filter((question): question is Question => Boolean(question));
  if (normalized.length === 0) return;
  groupedQuestions[safeTopicId] = normalized;
};

const parseQuestionsFromExternalPayload = (payload: unknown): Record<string, Question[]> => {
  const groupedQuestions: Record<string, Question[]> = {};

  if (isRecord(payload) && Array.isArray(payload.topics)) {
    payload.topics.forEach((topicEntry) => {
      if (!isRecord(topicEntry)) return;
      appendExternalTopicQuestions(
        groupedQuestions,
        asNonEmptyString(topicEntry.topicId) || 'default-topic',
        topicEntry.questions
      );
    });
    return groupedQuestions;
  }

  if (isRecord(payload) && isRecord(payload.topic) && Array.isArray(payload.questions)) {
    const topicId = asNonEmptyString(payload.topic.topicId) || 'default-topic';
    appendExternalTopicQuestions(groupedQuestions, topicId, payload.questions);
    return groupedQuestions;
  }

  if (isRecord(payload) && Array.isArray(payload.questions)) {
    const topicId =
      asNonEmptyString(payload.topicId) ||
      (isRecord(payload.topic) ? asNonEmptyString(payload.topic.topicId) : null) ||
      'default-topic';
    appendExternalTopicQuestions(groupedQuestions, topicId, payload.questions);
    return groupedQuestions;
  }

  if (Array.isArray(payload)) {
    appendExternalTopicQuestions(groupedQuestions, 'default-topic', payload);
  }

  return groupedQuestions;
};

const extractJsonTextFromHtml = (html: string): string | null => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const candidates = [
    parsed.querySelector('script#kpss-json[type="application/json"]'),
    parsed.querySelector('pre#kpss-json'),
    parsed.querySelector('#kpss-json'),
  ];

  for (const candidate of candidates) {
    const text = candidate?.textContent?.trim();
    if (text) return text;
  }

  const looksLikeJson = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  };

  const fallbackNodes = Array.from(parsed.querySelectorAll('script[type="application/json"], pre'));
  for (const node of fallbackNodes) {
    const text = node.textContent?.trim();
    if (text && looksLikeJson(text)) return text;
  }

  return null;
};

const parseExternalJsonPayload = (rawText: string): unknown => {
  const tryParse = (value: string): unknown | null => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const plain = rawText.trim();
  const direct = tryParse(plain);
  if (direct !== null) return direct;

  const normalizedQuotes = plain
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const quoteNormalizedParsed = tryParse(normalizedQuotes);
  if (quoteNormalizedParsed !== null) return quoteNormalizedParsed;

  const firstBrace = normalizedQuotes.search(/[\[{]/);
  const lastBrace = Math.max(normalizedQuotes.lastIndexOf('}'), normalizedQuotes.lastIndexOf(']'));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = normalizedQuotes.slice(firstBrace, lastBrace + 1);
    const slicedParsed = tryParse(sliced);
    if (slicedParsed !== null) return slicedParsed;
  }

  throw new Error('JSON parse edilemedi.');
};

const normalizePageUrlForMatch = (value: string): string | null => {
  const safeUrl = normalizeHttpUrl(value);
  if (!safeUrl) return null;
  try {
    const parsed = new URL(safeUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${normalizedPath}`.toLowerCase();
  } catch {
    return null;
  }
};

const extractBloggerPageHtmlFromFeed = (payload: unknown, targetPageUrl: string): string | null => {
  if (!isRecord(payload) || !isRecord(payload.feed)) return null;
  const entries = Array.isArray(payload.feed.entry) ? payload.feed.entry : [];
  if (entries.length === 0) return null;

  const targetComparable = normalizePageUrlForMatch(targetPageUrl);
  const resolveHtml = (entry: unknown): string | null => {
    if (!isRecord(entry) || !isRecord(entry.content)) return null;
    return asNonEmptyString(entry.content.$t);
  };

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.link)) continue;
    const alternate = entry.link.find((item) => {
      if (!isRecord(item)) return false;
      return asNonEmptyString(item.rel) === 'alternate';
    });
    if (!isRecord(alternate)) continue;
    const href = normalizeHttpUrl(alternate.href);
    if (!href) continue;
    if (targetComparable && normalizePageUrlForMatch(href) === targetComparable) {
      const html = resolveHtml(entry);
      if (html) return html;
    }
  }

  for (const entry of entries) {
    const html = resolveHtml(entry);
    if (html) return html;
  }

  return null;
};

const fetchBloggerPageHtmlViaJsonp = async (pageUrl: string): Promise<string | null> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const safeUrl = normalizeHttpUrl(pageUrl);
  if (!safeUrl) return null;

  let feedUrl = '';
  try {
    const parsed = new URL(safeUrl);
    feedUrl = `${parsed.origin}/feeds/pages/default?alt=json-in-script&max-results=500`;
  } catch {
    return null;
  }

  const callbackName = `__kpssBloggerJsonp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const scriptSrc = `${feedUrl}&callback=${encodeURIComponent(callbackName)}`;

  return new Promise((resolve) => {
    const script = document.createElement('script');
    const globalScope = window as unknown as Record<string, unknown>;
    let timeoutId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      delete globalScope[callbackName];
      script.remove();
    };

    const settle = (html: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(html);
    };

    globalScope[callbackName] = (payload: unknown) => {
      const html = extractBloggerPageHtmlFromFeed(payload, safeUrl);
      settle(html);
    };

    script.async = true;
    script.src = scriptSrc;
    script.onerror = () => settle(null);
    timeoutId = window.setTimeout(() => settle(null), 12000);
    document.head.appendChild(script);
  });
};

const normalizeCategories = (value: unknown): Category[] | null => {
  if (!Array.isArray(value)) return null;
  const normalized: Category[] = [];

  for (const rawCategory of value) {
    if (!isRecord(rawCategory)) return null;

    const categoryId = asNonEmptyString(rawCategory.id);
    const categoryName = asNonEmptyString(rawCategory.name);
    const iconName = asNonEmptyString(rawCategory.iconName);
    const description = asNonEmptyString(rawCategory.description);
    if (!categoryId || !categoryName || !iconName || !description) return null;
    if (!Array.isArray(rawCategory.subCategories)) return null;

    const subCategories: SubCategory[] = [];
    for (const rawSubCategory of rawCategory.subCategories) {
      if (!isRecord(rawSubCategory)) return null;
      const subCategoryId = asNonEmptyString(rawSubCategory.id);
      const subCategoryName = asNonEmptyString(rawSubCategory.name);
      if (!subCategoryId || !subCategoryName) return null;
      subCategories.push({
        id: subCategoryId,
        name: subCategoryName,
      });
    }

    normalized.push({
      id: categoryId,
      name: categoryName,
      iconName,
      description,
      subCategories,
    });
  }

  return normalized;
};

const getStoredCategories = (): Category[] => {
  if (typeof window === 'undefined') return INITIAL_CATEGORIES;
  try {
    const rawCategories = window.localStorage.getItem(STORAGE_KEYS.categories);
    if (!rawCategories) return INITIAL_CATEGORIES;
    const parsed = JSON.parse(rawCategories);
    const normalized = normalizeCategories(parsed);
    return normalized ?? INITIAL_CATEGORIES;
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

const getStoredLightThemeVariant = (): LightThemeVariant => {
  if (typeof window === 'undefined') return 'clean';
  try {
    const storedVariant = window.localStorage.getItem(STORAGE_KEYS.lightThemeVariant);
    if (storedVariant === 'clean') return 'clean';
    if (storedVariant === 'aura') return 'aura';
  } catch {
    // Ignore storage errors and use default
  }
  return 'clean';
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

const getStoredPersistSeenQuestionsToFirestore = (): boolean => {
  if (typeof window === 'undefined') return DEFAULT_PERSIST_SEEN_QUESTIONS_TO_FIRESTORE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.persistSeenQuestionsToFirestore);
    if (stored === '1' || stored === 'true') return true;
    if (stored === '0' || stored === 'false') return false;
  } catch {
    // Ignore storage errors and use default
  }
  return DEFAULT_PERSIST_SEEN_QUESTIONS_TO_FIRESTORE;
};

const normalizeTopicBloggerPagesMap = (
  value: unknown,
  validTopicIds?: Set<string>
): Record<string, string> => {
  if (!isRecord(value)) return {};
  const next: Record<string, string> = {};
  Object.entries(value).forEach(([topicId, rawUrl]) => {
    const safeTopicId = asNonEmptyString(topicId);
    const safeUrl = normalizeHttpUrl(rawUrl);
    if (!safeTopicId || !safeUrl) return;
    if (validTopicIds && !validTopicIds.has(safeTopicId)) return;
    next[safeTopicId] = safeUrl;
  });
  return next;
};

const normalizeTopicIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((entry) => {
    const safeTopicId = asNonEmptyString(entry);
    if (!safeTopicId) return;
    unique.add(safeTopicId);
  });
  return Array.from(unique);
};

const areStringListsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const filterCategoriesByDeletedTopicIds = (
  source: Category[],
  deletedTopicIds: Set<string>
): Category[] => {
  if (deletedTopicIds.size === 0) return source;
  return source
    .map((category) => ({
      ...category,
      subCategories: category.subCategories.filter((subCategory) => !deletedTopicIds.has(subCategory.id)),
    }))
    .filter((category) => category.subCategories.length > 0);
};

const areCategoriesEqual = (left: Category[], right: Category[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((leftCategory, categoryIndex) => {
    const rightCategory = right[categoryIndex];
    if (!rightCategory) return false;
    if (
      leftCategory.id !== rightCategory.id ||
      leftCategory.name !== rightCategory.name ||
      leftCategory.iconName !== rightCategory.iconName ||
      leftCategory.description !== rightCategory.description ||
      leftCategory.subCategories.length !== rightCategory.subCategories.length
    ) {
      return false;
    }
    return leftCategory.subCategories.every((leftSubCategory, subCategoryIndex) => {
      const rightSubCategory = rightCategory.subCategories[subCategoryIndex];
      return Boolean(
        rightSubCategory &&
        leftSubCategory.id === rightSubCategory.id &&
        leftSubCategory.name === rightSubCategory.name
      );
    });
  });
};

const areTopicBloggerPagesEqual = (
  left: Record<string, string>,
  right: Record<string, string>
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
};

const getStoredTopicBloggerPages = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.topicBloggerPages);
    if (!raw) return {};
    return normalizeTopicBloggerPagesMap(JSON.parse(raw));
  } catch {
    return {};
  }
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
        wrongRecoveryStreakByQuestionId,
        correctCount: correctQuestionIds.length > 0
          ? correctQuestionIds.length
          : (Number.isFinite(typedValue.correctCount) ? Number(typedValue.correctCount) : 0),
        wrongCount: wrongQuestionIds.length > 0
          ? wrongQuestionIds.length
          : (Number.isFinite(typedValue.wrongCount) ? Number(typedValue.wrongCount) : 0),
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
  const totalWrongAnswers = Number.isFinite(value.totalWrongAnswers) ? Math.max(0, Number(value.totalWrongAnswers)) : wrongCount;

  return {
    seenCount,
    correctCount,
    wrongCount,
    totalWrongAnswers,
    lastPlayedAt: Number.isFinite(value.lastPlayedAt) ? Number(value.lastPlayedAt) : 0,
  };
};

const normalizeWrongQuestionStatus = (value: unknown): WrongQuestionStatus => {
  if (value === 'resolved') return 'resolved';
  if (value === 'active_wrong' || value === 'active_blank') return 'active_wrong';
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

const shuffleOptionsWithAnswer = (question: Question): Question => {
  const options = Array.isArray(question.options) ? [...question.options] : [];
  if (options.length < 2) {
    return { ...question, options };
  }

  const indexedOptions = options.map((option, originalIndex) => ({ option, originalIndex }));
  for (let i = indexedOptions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]];
  }

  const remappedCorrectIndex = indexedOptions.findIndex(
    (entry) => entry.originalIndex === question.correctOptionIndex
  );

  return {
    ...question,
    options: indexedOptions.map((entry) => entry.option),
    correctOptionIndex: remappedCorrectIndex >= 0 ? remappedCorrectIndex : question.correctOptionIndex,
  };
};

const normalizeQuestionTrackingText = (value: string): string => value.trim().toLocaleLowerCase('tr');

const getQuestionTrackingId = (question: Question, topicId: string, index: number): string => {
  const stableId = getQuestionStableId(question);
  if (stableId) return stableId;
  return `${topicId}_${index}_${normalizeQuestionTrackingText(question.questionText)}`;
};

const getLegacyTrackingTextKey = (questionTrackingId: string, topicId: string): string | null => {
  const topicPrefix = `${topicId}_`;
  if (!questionTrackingId.startsWith(topicPrefix)) return null;
  const withoutTopic = questionTrackingId.slice(topicPrefix.length);
  const firstSeparatorIndex = withoutTopic.indexOf('_');
  if (firstSeparatorIndex <= 0) return null;
  const maybeIndex = withoutTopic.slice(0, firstSeparatorIndex);
  if (!/^\d+$/.test(maybeIndex)) return null;
  const rawText = withoutTopic.slice(firstSeparatorIndex + 1);
  if (!rawText) return null;
  return normalizeQuestionTrackingText(rawText);
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
  questionId: string;
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
  const [favoriteQuestionsById, setFavoriteQuestionsById] = useState<Record<string, FavoriteQuestionRecord>>({});
  const [seenQuestionsById, setSeenQuestionsById] = useState<Record<string, SeenQuestionStats>>({});
  const [persistSeenQuestionsToFirestore, setPersistSeenQuestionsToFirestore] = useState<boolean>(() => getStoredPersistSeenQuestionsToFirestore());
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeTopic, setActiveTopic] = useState<{ cat: Category, sub: SubCategory } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => getStoredTheme());
  const [lightThemeVariant, setLightThemeVariant] = useState<LightThemeVariant>(() => getStoredLightThemeVariant());

  // Quiz Configuration State
  const [quizConfig, setQuizConfig] = useState({
    questionCount: 10,
    durationSeconds: 300,
  });
  const [questionCountInputValue, setQuestionCountInputValue] = useState('10');
  const [quizTagQuestionCounts, setQuizTagQuestionCounts] = useState<Record<string, number>>({});

  // --- SORULAR STATE (ARTIK BOŞ BAŞLIYOR) ---
  const [allQuestions, setAllQuestions] = useState<Record<string, Question[]>>({});
  const [topicBloggerPages, setTopicBloggerPages] = useState<Record<string, string>>(() => getStoredTopicBloggerPages());
  const [deletedTopicIds, setDeletedTopicIds] = useState<string[]>([]);

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
  const [quizStatusFilter, setQuizStatusFilter] = useState<QuizStatusFilter>({ wrong: false, favorite: false });
  const [topicSearchTerm, setTopicSearchTerm] = useState('');
  const [topicCardFilter, setTopicCardFilter] = useState<'all' | 'in_progress' | 'completed' | 'not_started'>('all');
  const [homeStatsCategoryFilter, setHomeStatsCategoryFilter] = useState<string>('all');
  const [statisticsScopeCategoryId, setStatisticsScopeCategoryId] = useState<string>('all');
  const [isStatisticsScopeMenuOpen, setIsStatisticsScopeMenuOpen] = useState(false);
  const [isHomeStatsExpanded, setIsHomeStatsExpanded] = useState(true);
  const [isRulesHelpModalOpen, setIsRulesHelpModalOpen] = useState(false);

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
  const [bulkSourceTagInput, setBulkSourceTagInput] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState<Question[]>([]);
  const [bulkParseErrors, setBulkParseErrors] = useState<string[]>([]);
  const [bulkStep, setBulkStep] = useState<'paste' | 'preview'>('paste');
  const isBulkSourceTagValid = bulkSourceTagInput === ' ' || bulkSourceTagInput.trim().length > 0;

  // Add Question Form State
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(EMPTY_QUESTION_FORM);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionDraft[]>([]);

  // Quiz Font Size: 0=compact, 1=normal, 2=large
  const [quizSize, setQuizSize] = useState<0 | 1 | 2>(() => getStoredQuizSize());

  // Mobile Menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileDashboardTab, setMobileDashboardTab] = useState<'stats' | 'categories'>('stats');

  // Timer Ref
  const timerRef = useRef<number | null>(null);
  // Auto-advance ref
  const autoAdvanceRef = useRef<number | null>(null);
  const categoriesRef = useRef<Category[]>(categories);
  const topicBloggerPagesRef = useRef<Record<string, string>>(topicBloggerPages);
  const statisticsScopeMenuRef = useRef<HTMLDivElement | null>(null);
  const categoriesSeedAttemptedRef = useRef(false);
  const topicBloggerPagesSeedAttemptedRef = useRef(false);
  const deletedTopicIdsRef = useRef<string[]>(deletedTopicIds);

  const saveTopicConfigToFirestore = async (options: {
    pages?: Record<string, string>;
    deletedTopicIds?: string[];
  }) => {
    const payload: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: user?.uid || null,
    };
    if (options.pages) {
      const validTopicIds = new Set<string>(
        categoriesRef.current.flatMap((cat) => cat.subCategories.map((sub) => sub.id))
      );
      payload[TOPIC_BLOGGER_PAGES_FIELD] = normalizeTopicBloggerPagesMap(options.pages, validTopicIds);
    }
    if (options.deletedTopicIds) {
      payload[DELETED_TOPIC_IDS_FIELD] = normalizeTopicIdList(options.deletedTopicIds).sort();
    }
    await setDoc(
      doc(db, TOPIC_BLOGGER_PAGES_CONFIG_COLLECTION, TOPIC_BLOGGER_PAGES_CONFIG_DOC),
      payload,
      { merge: true }
    );
  };

  const saveCategoriesToFirestore = async (nextCategories: Category[]) => {
    await setDoc(
      doc(db, APP_CONFIG_COLLECTION, CATEGORIES_CONFIG_DOC),
      {
        [CATEGORIES_CONFIG_FIELD]: nextCategories,
        updatedAt: new Date(),
        updatedBy: user?.uid || null,
      },
      { merge: true }
    );
  };

  const buildQuestionIdsByTopic = (status: WrongQuestionStatus): Record<string, string[]> => {
    const trackingIdsByTopic: Record<string, Set<string>> = {};
    const legacyTextKeysByTopic: Record<string, Set<string>> = {};
    (Object.values(wrongQuestionStatsById) as WrongQuestionStats[]).forEach((stats) => {
      if (stats.status !== status) return;
      if (!trackingIdsByTopic[stats.topicId]) trackingIdsByTopic[stats.topicId] = new Set<string>();
      trackingIdsByTopic[stats.topicId].add(stats.questionTrackingId);
      const legacyTextKey = getLegacyTrackingTextKey(stats.questionTrackingId, stats.topicId);
      if (!legacyTextKey) return;
      if (!legacyTextKeysByTopic[stats.topicId]) legacyTextKeysByTopic[stats.topicId] = new Set<string>();
      legacyTextKeysByTopic[stats.topicId].add(legacyTextKey);
    });

    const next: Record<string, string[]> = {};
    Object.keys(allQuestions).forEach((topicId) => {
      const topicQuestions = allQuestions[topicId] || [];
      const activeTrackingIds = trackingIdsByTopic[topicId];
      const legacyTextKeys = legacyTextKeysByTopic[topicId];
      if (!activeTrackingIds && !legacyTextKeys) return;
      const topicMatchedIds = new Set<string>();
      topicQuestions.forEach((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, topicId, index);
        if (activeTrackingIds?.has(questionTrackingId)) {
          topicMatchedIds.add(questionTrackingId);
          return;
        }
        if (!legacyTextKeys) return;
        const questionTextKey = normalizeQuestionTrackingText(question.questionText);
        if (legacyTextKeys.has(questionTextKey)) {
          topicMatchedIds.add(questionTrackingId);
        }
      });
      if (topicMatchedIds.size > 0) {
        next[topicId] = Array.from(topicMatchedIds);
      }
    });

    return next;
  };

  const wrongQuestionIdsByTopic = useMemo<Record<string, string[]>>(() => {
    return buildQuestionIdsByTopic('active_wrong');
  }, [wrongQuestionStatsById, allQuestions]);
  const favoriteQuestionIdsByTopic = useMemo<Record<string, string[]>>(() => {
    const trackingIdsByTopic: Record<string, Set<string>> = {};
    (Object.values(favoriteQuestionsById) as FavoriteQuestionRecord[]).forEach((favoriteRecord) => {
      if (!favoriteRecord.topicId || !favoriteRecord.questionTrackingId) return;
      if (!trackingIdsByTopic[favoriteRecord.topicId]) trackingIdsByTopic[favoriteRecord.topicId] = new Set<string>();
      trackingIdsByTopic[favoriteRecord.topicId].add(favoriteRecord.questionTrackingId);
    });

    const next: Record<string, string[]> = {};
    Object.keys(allQuestions).forEach((topicId) => {
      const topicQuestions = allQuestions[topicId] || [];
      const favoriteTrackingIds = trackingIdsByTopic[topicId];
      if (!favoriteTrackingIds) return;
      const topicMatchedIds = new Set<string>();
      topicQuestions.forEach((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, topicId, index);
        if (favoriteTrackingIds.has(questionTrackingId)) {
          topicMatchedIds.add(questionTrackingId);
        }
      });
      if (topicMatchedIds.size > 0) {
        next[topicId] = Array.from(topicMatchedIds);
      }
    });

    return next;
  }, [favoriteQuestionsById, allQuestions]);
  

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
    document.documentElement.classList.toggle('light-variant-clean', lightThemeVariant === 'clean');
    try {
      window.localStorage.setItem(STORAGE_KEYS.lightThemeVariant, lightThemeVariant);
    } catch {
      // Ignore storage errors
    }
  }, [lightThemeVariant]);

  useEffect(() => {
    setQuestionCountInputValue(String(Math.max(0, Math.floor(quizConfig.questionCount))));
  }, [quizConfig.questionCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(categories));
    } catch {
      // Ignore storage errors
    }
  }, [categories]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    deletedTopicIdsRef.current = deletedTopicIds;
  }, [deletedTopicIds]);

  useEffect(() => {
    topicBloggerPagesRef.current = topicBloggerPages;
  }, [topicBloggerPages]);

  useEffect(() => {
    const categoriesConfigRef = doc(db, APP_CONFIG_COLLECTION, CATEGORIES_CONFIG_DOC);
    const unsubscribe = onSnapshot(categoriesConfigRef, (snapshot) => {
      if (!snapshot.exists()) {
        const cachedCategories = normalizeCategories(categoriesRef.current);
        if (
          user?.role === 'admin' &&
          !categoriesSeedAttemptedRef.current &&
          cachedCategories &&
          cachedCategories.length > 0
        ) {
          categoriesSeedAttemptedRef.current = true;
          void setDoc(
            categoriesConfigRef,
            {
              [CATEGORIES_CONFIG_FIELD]: cachedCategories,
              updatedAt: new Date(),
              updatedBy: user?.uid || null,
            },
            { merge: true }
          ).catch((error) => {
            categoriesSeedAttemptedRef.current = false;
            console.error('Kategoriler Firestorea aktarilamadi:', error);
          });
        }
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      const remoteCategoriesRaw = data[CATEGORIES_CONFIG_FIELD] ?? data.categories;
      const remoteCategories = normalizeCategories(remoteCategoriesRaw);
      if (!remoteCategories) return;

      const deletedTopicSet = new Set<string>(deletedTopicIdsRef.current);
      const filteredCategories = filterCategoriesByDeletedTopicIds(remoteCategories, deletedTopicSet);
      setCategories((prev) => (areCategoriesEqual(prev, filteredCategories) ? prev : filteredCategories));
    }, (error) => {
      console.error('Kategoriler dinlenemedi:', error);
    });

    return () => unsubscribe();
  }, [user?.role, user?.uid]);

  useEffect(() => {
    const configRef = doc(db, TOPIC_BLOGGER_PAGES_CONFIG_COLLECTION, TOPIC_BLOGGER_PAGES_CONFIG_DOC);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      const validTopicIds = new Set<string>(
        categoriesRef.current.flatMap((cat) => cat.subCategories.map((sub) => sub.id))
      );
      if (!snapshot.exists()) {
        const cachedPages = normalizeTopicBloggerPagesMap(topicBloggerPagesRef.current, validTopicIds);
        if (
          user?.role === 'admin' &&
          !topicBloggerPagesSeedAttemptedRef.current &&
          Object.keys(cachedPages).length > 0
        ) {
          topicBloggerPagesSeedAttemptedRef.current = true;
          void setDoc(
            configRef,
            {
              [TOPIC_BLOGGER_PAGES_FIELD]: cachedPages,
              updatedAt: new Date(),
              updatedBy: user?.uid || null,
            },
            { merge: true }
          ).catch((error) => {
            topicBloggerPagesSeedAttemptedRef.current = false;
            console.error('Topic Blogger sayfa linkleri Firestorea aktarilamadi:', error);
          });
        }
        return;
      }

      const data = snapshot.data() as Record<string, unknown>;
      const remoteDeletedTopicIds = normalizeTopicIdList(data[DELETED_TOPIC_IDS_FIELD]).sort();
      const deletedTopicSet = new Set<string>(remoteDeletedTopicIds);
      setDeletedTopicIds((prev) => (areStringListsEqual(prev, remoteDeletedTopicIds) ? prev : remoteDeletedTopicIds));
      setCategories((prev) => {
        const filtered = filterCategoriesByDeletedTopicIds(prev, deletedTopicSet);
        return areCategoriesEqual(prev, filtered) ? prev : filtered;
      });
      const remotePagesRaw = data[TOPIC_BLOGGER_PAGES_FIELD] ?? data.topicBloggerPages;
      const remotePages = normalizeTopicBloggerPagesMap(remotePagesRaw, validTopicIds);
      const remotePagesWithoutDeleted: Record<string, string> = {};
      Object.entries(remotePages).forEach(([topicId, pageUrl]) => {
        if (deletedTopicSet.has(topicId)) return;
        remotePagesWithoutDeleted[topicId] = pageUrl;
      });
      setTopicBloggerPages((prev) => (
        areTopicBloggerPagesEqual(prev, remotePagesWithoutDeleted) ? prev : remotePagesWithoutDeleted
      ));
    }, (error) => {
      console.error('Topic Blogger sayfa linkleri dinlenemedi:', error);
    });

    return () => unsubscribe();
  }, [user?.role, user?.uid]);

  useEffect(() => {
    const validTopicIds = new Set<string>(
      categories.flatMap((cat) => cat.subCategories.map((sub) => sub.id))
    );
    setTopicBloggerPages((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(prev).forEach(([topicId, rawUrl]) => {
        const safeUrl = normalizeHttpUrl(rawUrl);
        if (!validTopicIds.has(topicId) || !safeUrl) {
          changed = true;
          return;
        }
        next[topicId] = safeUrl;
      });
      return changed ? next : prev;
    });
  }, [categories]);

  useEffect(() => {
    const loadedTopicIds = Object.keys(allQuestions);
    if (loadedTopicIds.length === 0) return;

    const currentTopicIds = new Set(
      categories.flatMap((cat) => cat.subCategories.map((sub) => sub.id))
    );
    const hasOverlapWithCurrent = loadedTopicIds.some((topicId) => currentTopicIds.has(topicId));
    if (hasOverlapWithCurrent) return;

    const defaultTopicIds = new Set(
      INITIAL_CATEGORIES.flatMap((cat) => cat.subCategories.map((sub) => sub.id))
    );
    const hasOverlapWithDefault = loadedTopicIds.some((topicId) => defaultTopicIds.has(topicId));
    if (!hasOverlapWithDefault) return;

    console.warn('Kayitli kategori kimlikleri yuklenen soru kimlikleriyle eslesmiyor. Varsayilan kategorilere donuluyor.');
    setCategories(filterCategoriesByDeletedTopicIds(INITIAL_CATEGORIES, new Set(deletedTopicIds)));
    setActiveCategory(null);
  }, [allQuestions, categories, deletedTopicIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.topicBloggerPages, JSON.stringify(topicBloggerPages));
    } catch {
      // Ignore storage errors
    }
  }, [topicBloggerPages]);

  useEffect(() => {
    if (homeStatsCategoryFilter === 'all') return;
    const hasSelectedCategory = categories.some((cat) => cat.id === homeStatsCategoryFilter);
    if (!hasSelectedCategory) {
      setHomeStatsCategoryFilter('all');
    }
  }, [categories, homeStatsCategoryFilter]);

  useEffect(() => {
    if (statisticsScopeCategoryId === 'all') return;
    const hasSelectedCategory = categories.some((cat) => cat.id === statisticsScopeCategoryId);
    if (!hasSelectedCategory) {
      setStatisticsScopeCategoryId('all');
    }
  }, [categories, statisticsScopeCategoryId]);

  useEffect(() => {
    if (!isStatisticsScopeMenuOpen) return;
    const handleOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const targetNode = event.target;
      if (!(targetNode instanceof Node)) return;
      if (!statisticsScopeMenuRef.current?.contains(targetNode)) {
        setIsStatisticsScopeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('touchstart', handleOutsidePointer);
    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('touchstart', handleOutsidePointer);
    };
  }, [isStatisticsScopeMenuOpen]);

  useEffect(() => {
    setIsStatisticsScopeMenuOpen(false);
  }, [statisticsScopeCategoryId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.quizSize, String(quizSize));
    } catch {
      // Ignore storage errors
    }
  }, [quizSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEYS.persistSeenQuestionsToFirestore,
        persistSeenQuestionsToFirestore ? '1' : '0'
      );
    } catch {
      // Ignore storage errors
    }
  }, [persistSeenQuestionsToFirestore]);

  // --- FIREBASE VERİ ÇEKME EFFECT'İ ---
  useEffect(() => {
    let isCancelled = false;
    let unsubscribeFirestore: (() => void) | null = null;

    const subscribeFirestoreQuestions = () => {
      const questionsQuery = query(collection(db, "questions"));
      unsubscribeFirestore = onSnapshot(questionsQuery, (snapshot) => {
        const groupedQuestions: Record<string, Question[]> = {};

        snapshot.forEach((questionDoc) => {
          const data = questionDoc.data();
          const stableQuestionId = sanitizeQuestionId(data.questionId) || questionDoc.id;
          const question = {
            ...data,
            id: questionDoc.id,
            questionId: stableQuestionId,
            options: data.options || [],
            contentItems: data.contentItems || undefined
          } as Question & { topicId: string };

          const topicId = question.topicId;
          if (!topicId) return;
          if (!groupedQuestions[topicId]) groupedQuestions[topicId] = [];
          groupedQuestions[topicId].push(question);
        });

        if (!isCancelled) {
          setAllQuestions(groupedQuestions);
        }
      }, (error) => {
        console.error("Firestore sorulari dinlenemedi:", error);
      });
    };

    const fetchGroupedQuestionsFromBloggerUrl = async (url: string): Promise<Record<string, Question[]> | null> => {
      const safeUrl = normalizeHttpUrl(url);
      if (!safeUrl) return null;
      try {
        const parseFromHtml = (html: string, source: 'fetch' | 'jsonp'): Record<string, Question[]> => {
          const jsonText = extractJsonTextFromHtml(html);
          if (!jsonText) {
            throw new Error(`${source}: kpss-json etiketinde JSON bulunamadi.`);
          }

          const parsedPayload = parseExternalJsonPayload(jsonText);
          const groupedQuestions = parseQuestionsFromExternalPayload(parsedPayload);
          if (Object.keys(groupedQuestions).length === 0) {
            throw new Error(`${source}: Blogger JSON icinde gecerli soru bulunamadi.`);
          }
          return groupedQuestions;
        };

        const isBloggerHost = (() => {
          try {
            const host = new URL(safeUrl).hostname.toLowerCase();
            return (
              host === 'blogspot.com' ||
              host.endsWith('.blogspot.com') ||
              host === 'blogger.com' ||
              host.endsWith('.blogger.com')
            );
          } catch {
            return false;
          }
        })();

        if (isBloggerHost) {
          const htmlFromJsonp = await fetchBloggerPageHtmlViaJsonp(safeUrl);
          if (!htmlFromJsonp) {
            throw new Error('jsonp: Blogger HTML alinamadi.');
          }
          return parseFromHtml(htmlFromJsonp, 'jsonp');
        }

        try {
          const response = await fetch(safeUrl, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Blogger istegi basarisiz: ${response.status}`);
          }
          const htmlFromFetch = await response.text();
          return parseFromHtml(htmlFromFetch, 'fetch');
        } catch (fetchOrParseError) {
          const htmlFromJsonp = await fetchBloggerPageHtmlViaJsonp(safeUrl);
          if (!htmlFromJsonp) {
            throw fetchOrParseError;
          }
          return parseFromHtml(htmlFromJsonp, 'jsonp');
        }
      } catch (error) {
        console.error(`Blogger sorulari yuklenemedi (${safeUrl}):`, error);
        return null;
      }
    };

    const bootstrapQuestions = async () => {
      const shouldUseFirestore = QUESTIONS_SOURCE === 'firestore';
      if (shouldUseFirestore) {
        subscribeFirestoreQuestions();
        return;
      }

      const baseQuestions = (await fetchGroupedQuestionsFromBloggerUrl(BLOGGER_JSON_URL)) || {};
      const mergedQuestions: Record<string, Question[]> = { ...baseQuestions };

      const topicOverrides = Object.entries(topicBloggerPages) as Array<[string, string]>;
      await Promise.all(topicOverrides.map(async ([topicId, overrideUrl]) => {
        const groupedFromTopicPage = await fetchGroupedQuestionsFromBloggerUrl(overrideUrl);
        if (!groupedFromTopicPage) return;

        const directTopicQuestions = groupedFromTopicPage[topicId];
        if (Array.isArray(directTopicQuestions) && directTopicQuestions.length > 0) {
          mergedQuestions[topicId] = directTopicQuestions;
          return;
        }

        const flattened = Object.values(groupedFromTopicPage).flat();
        if (flattened.length > 0) {
          mergedQuestions[topicId] = flattened;
        }
      }));

      if (Object.keys(mergedQuestions).length > 0) {
        if (!isCancelled) {
          setAllQuestions(mergedQuestions);
        }
        return;
      }

      if (!Object.keys(mergedQuestions).length) {
        subscribeFirestoreQuestions();
      }
    };

    void bootstrapQuestions();

    return () => {
      isCancelled = true;
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, [topicBloggerPages]);

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
        // Force refresh token to get latest custom claims (admin)
        const token = await firebaseUser.getIdTokenResult(true);
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
            totalWrongAnswers: legacyValue.wrongCount,
            lastPlayedAt: legacyValue.lastPlayedAt,
          });
          batch.set(doc(db, 'users', user.uid, 'topicStats', topicId), migratedTopicStats, { merge: true });
          opCount += 1;
          if (opCount >= 450) await commitCurrentBatch();

          const wrongSet = new Set(legacyValue.wrongQuestionIds);
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
  }, [user?.uid, persistSeenQuestionsToFirestore]);

  useEffect(() => {
    if (!user?.uid || typeof window === 'undefined') return;

    const cleanupKey = `${BLANK_STATS_CLEANUP_KEY_PREFIX}${user.uid}`;
    try {
      if (window.localStorage.getItem(cleanupKey) === '1') return;
    } catch {
      return;
    }

    const cleanupLegacyBlankStats = async () => {
      try {
        const [topicStatsSnapshot, seenQuestionsSnapshot, wrongQuestionsSnapshot] = await Promise.all([
          getDocs(query(collection(db, 'users', user.uid, 'topicStats'))),
          getDocs(query(collection(db, 'users', user.uid, 'seenQuestions'))),
          getDocs(query(collection(db, 'users', user.uid, 'wrongQuestions'))),
        ]);

        let batch = writeBatch(db);
        let opCount = 0;
        const commitCurrentBatch = async () => {
          if (opCount === 0) return;
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        };

        for (const topicStatsDoc of topicStatsSnapshot.docs) {
          const data = topicStatsDoc.data() as Record<string, unknown>;
          if (!('blankCount' in data) && !('totalBlankAnswers' in data)) continue;
          batch.set(topicStatsDoc.ref, {
            blankCount: deleteField(),
            totalBlankAnswers: deleteField(),
          }, { merge: true });
          opCount += 1;
          if (opCount >= 400) await commitCurrentBatch();
        }

        for (const seenDoc of seenQuestionsSnapshot.docs) {
          const data = seenDoc.data() as Record<string, unknown>;
          if (!('blankCount' in data)) continue;
          batch.set(seenDoc.ref, { blankCount: deleteField() }, { merge: true });
          opCount += 1;
          if (opCount >= 400) await commitCurrentBatch();
        }

        for (const wrongDoc of wrongQuestionsSnapshot.docs) {
          const data = wrongDoc.data() as Record<string, unknown>;
          if (data.status === 'active_blank') {
            batch.delete(wrongDoc.ref);
            opCount += 1;
            if (opCount >= 400) await commitCurrentBatch();
            continue;
          }
          if (!('blankCount' in data)) continue;
          batch.set(wrongDoc.ref, { blankCount: deleteField() }, { merge: true });
          opCount += 1;
          if (opCount >= 400) await commitCurrentBatch();
        }

        await commitCurrentBatch();
        try {
          window.localStorage.setItem(cleanupKey, '1');
        } catch {
          // ignore
        }
      } catch (error) {
        console.error('Blank istatistik temizligi basarisiz:', error);
      }
    };

    void cleanupLegacyBlankStats();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || typeof window === 'undefined') return;

    const cleanupKey = `${COMPLETED_QUIZ_COUNT_CLEANUP_KEY_PREFIX}${user.uid}`;
    try {
      if (window.localStorage.getItem(cleanupKey) === '1') return;
    } catch {
      return;
    }

    const cleanupCompletedQuizCountField = async () => {
      try {
        const topicStatsSnapshot = await getDocs(query(collection(db, 'users', user.uid, 'topicStats')));

        let batch = writeBatch(db);
        let opCount = 0;
        const commitCurrentBatch = async () => {
          if (opCount === 0) return;
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        };

        for (const topicStatsDoc of topicStatsSnapshot.docs) {
          const data = topicStatsDoc.data() as Record<string, unknown>;
          if (!('completedQuizCount' in data)) continue;
          batch.set(topicStatsDoc.ref, { completedQuizCount: deleteField() }, { merge: true });
          opCount += 1;
          if (opCount >= 400) await commitCurrentBatch();
        }

        await commitCurrentBatch();
        try {
          window.localStorage.setItem(cleanupKey, '1');
        } catch {
          // ignore
        }
      } catch (error) {
        console.error('Cozulen test sayaci temizligi basarisiz:', error);
      }
    };

    void cleanupCompletedQuizCountField();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setTopicProgressStats({});
      setWrongQuestionStatsById({});
      setFavoriteQuestionsById({});
      setSeenQuestionsById({});
      return;
    }

    const topicStatsQuery = query(collection(db, 'users', user.uid, 'topicStats'));
    const wrongQuestionsQuery = query(collection(db, 'users', user.uid, 'wrongQuestions'));
    const favoriteQuestionsQuery = query(collection(db, 'users', user.uid, 'favoriteQuestions'));

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
            totalWrongAnswers: data.totalWrongAnswers,
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
        const legacyBlankDocIds: string[] = [];

        snapshot.forEach((wrongDoc) => {
          const data = wrongDoc.data() as Record<string, unknown>;
          const questionTrackingId =
            (typeof data.questionTrackingId === 'string' && data.questionTrackingId.length > 0)
              ? data.questionTrackingId
              : getQuestionTrackingIdFromWrongDocId(wrongDoc.id);
          const topicId = typeof data.topicId === 'string' ? data.topicId : '';
          if (!questionTrackingId || !topicId) return;

          if (data.status === 'active_blank') {
            legacyBlankDocIds.push(wrongDoc.id);
            return;
          }

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
            lastWrongAt: getTimestampMillis(data.lastWrongAt),
            resolvedAt,
          };
        });

        setWrongQuestionStatsById(nextWrongStats);

        const wrongDocIdsToDelete = [...expiredResolvedDocIds, ...legacyBlankDocIds];
        if (wrongDocIdsToDelete.length > 0) {
          void cleanupExpiredResolvedWrongQuestions(user.uid, wrongDocIdsToDelete);
        }
      },
      (error) => {
        console.error('Yanlis soru havuzu okunamadi:', error);
        setWrongQuestionStatsById({});
      }
    );

    const unsubscribeFavoriteQuestions = onSnapshot(
      favoriteQuestionsQuery,
      (snapshot) => {
        const nextFavorites: Record<string, FavoriteQuestionRecord> = {};
        snapshot.forEach((favoriteDoc) => {
          const data = favoriteDoc.data() as Record<string, unknown>;
          const questionTrackingId =
            (typeof data.questionTrackingId === 'string' && data.questionTrackingId.length > 0)
              ? data.questionTrackingId
              : getQuestionTrackingIdFromFavoriteDocId(favoriteDoc.id);
          if (!questionTrackingId) return;
          const topicId = typeof data.topicId === 'string' ? data.topicId : '';
          const questionText = typeof data.questionText === 'string' ? data.questionText : '';
          nextFavorites[questionTrackingId] = {
            questionTrackingId,
            topicId,
            questionId: typeof data.questionId === 'string' ? data.questionId : null,
            questionText,
            sourceTag: typeof data.sourceTag === 'string' ? data.sourceTag : null,
            createdAt: getTimestampMillis(data.createdAt),
            updatedAt: getTimestampMillis(data.updatedAt),
          };
        });
        setFavoriteQuestionsById(nextFavorites);
      },
      (error) => {
        console.error('Favori sorular okunamadi:', error);
        setFavoriteQuestionsById({});
      }
    );

    let unsubscribeSeenQuestions = () => {};
    if (persistSeenQuestionsToFirestore) {
      const seenQuestionsQuery = query(collection(db, 'users', user.uid, 'seenQuestions'));
      unsubscribeSeenQuestions = onSnapshot(
        seenQuestionsQuery,
        (snapshot) => {
          const nextSeenQuestions: Record<string, SeenQuestionStats> = {};
          snapshot.forEach((seenDoc) => {
            const data = seenDoc.data() as Record<string, unknown>;
            const questionTrackingId =
              (typeof data.questionTrackingId === 'string' && data.questionTrackingId.length > 0)
                ? data.questionTrackingId
                : getQuestionTrackingIdFromSeenDocId(seenDoc.id);
            if (!questionTrackingId) return;
            const topicId = typeof data.topicId === 'string' ? data.topicId : '';
            const questionText = typeof data.questionText === 'string' ? data.questionText : '';
            nextSeenQuestions[questionTrackingId] = {
              questionTrackingId,
              topicId,
              questionId: typeof data.questionId === 'string' ? data.questionId : null,
              questionText,
              sourceTag: typeof data.sourceTag === 'string' ? data.sourceTag : null,
              firstSeenAt: getTimestampMillis(data.firstSeenAt),
              lastSeenAt: getTimestampMillis(data.lastSeenAt),
              seenCount: Number.isFinite(data.seenCount) ? Math.max(0, Math.floor(Number(data.seenCount))) : 0,
              answeredCount: Number.isFinite(data.answeredCount) ? Math.max(0, Math.floor(Number(data.answeredCount))) : 0,
              correctCount: Number.isFinite(data.correctCount) ? Math.max(0, Math.floor(Number(data.correctCount))) : 0,
              wrongCount: Number.isFinite(data.wrongCount) ? Math.max(0, Math.floor(Number(data.wrongCount))) : 0,
            };
          });
          setSeenQuestionsById(nextSeenQuestions);
        },
        (error) => {
          console.error('Cozulen soru istatistikleri okunamadi:', error);
          setSeenQuestionsById({});
        }
      );
    } else {
      setSeenQuestionsById({});
    }

    return () => {
      unsubscribeTopicStats();
      unsubscribeWrongQuestions();
      unsubscribeFavoriteQuestions();
      unsubscribeSeenQuestions();
    };
  }, [user?.uid]);

  // Timer Logic
  useEffect(() => {
    if (currentView === 'quiz' && quizState.isTimerActive && !quizState.showResults && quizState.timeLeft > 0) {
      timerRef.current = window.setInterval(() => {
        setQuizState(prev => {
          if (prev.timeLeft <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return { ...prev, timeLeft: 0, isTimerActive: false };
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
    if (currentView !== 'quiz') return;
    if (quizState.showResults) return;
    if (quizState.timeLeft !== 0) return;
    if (quizState.questions.length === 0) return;
    handleFinishQuiz();
  }, [currentView, quizState.showResults, quizState.timeLeft, quizState.questions.length]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  useEffect(() => {
    setTopicSearchTerm('');
    setTopicCardFilter('all');
  }, [activeCategory?.id]);

  useEffect(() => {
    if (currentView !== 'dashboard') {
      setIsRulesHelpModalOpen(false);
    }
  }, [currentView]);

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

      setIsDarkMode(true);
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

  const openQuizSetup = (category: Category, sub: SubCategory, preset: 'all' | 'wrong' | 'favorite' | 'wrong_favorite' = 'all') => {
    const topicQuestions = allQuestions[sub.id] || [];
    const wrongSet = new Set(wrongQuestionIdsByTopic[sub.id] || []);
    const favoriteSet = new Set(favoriteQuestionIdsByTopic[sub.id] || []);
    const nextStatusFilter =
      preset === 'wrong'
        ? { wrong: true, favorite: false }
        : preset === 'favorite'
          ? { wrong: false, favorite: true }
          : preset === 'wrong_favorite'
            ? { wrong: true, favorite: true }
            : { wrong: false, favorite: false };
    const statusActive = nextStatusFilter.wrong || nextStatusFilter.favorite;
    const filteredCount = statusActive
      ? topicQuestions.filter((question, index) => {
          const questionTrackingId = getQuestionTrackingId(question, sub.id, index);
          const includeWrong = nextStatusFilter.wrong && wrongSet.has(questionTrackingId);
          const includeFavorite = nextStatusFilter.favorite && favoriteSet.has(questionTrackingId);
          return includeWrong || includeFavorite;
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
    const favoriteSet = new Set(favoriteQuestionIdsByTopic[topicId] || []);
    const isStatusFilterActive = quizStatusFilter.wrong || quizStatusFilter.favorite;
    const topicQuestionsPool = (allQuestions[topicId] || []).filter((question, index) => {
      if (!isStatusFilterActive) return true;
      const questionTrackingId = getQuestionTrackingId(question, topicId, index);
      const includeWrong = quizStatusFilter.wrong && wrongSet.has(questionTrackingId);
      const includeFavorite = quizStatusFilter.favorite && favoriteSet.has(questionTrackingId);
      return includeWrong || includeFavorite;
    });
    const selectedTagEntries = Object.keys(quizTagQuestionCounts)
      .map((sourceKey) => ({
        sourceKey,
        count: Math.max(0, Math.floor(Number(quizTagQuestionCounts[sourceKey] || 0))),
      }))
      .filter((entry) => entry.count > 0);
    let remainingTagQuota = Math.max(0, quizConfig.questionCount);
    const boundedSelectedTagEntries = selectedTagEntries
      .map((entry) => {
        if (remainingTagQuota <= 0) return { ...entry, count: 0 };
        const boundedCount = Math.min(entry.count, remainingTagQuota);
        remainingTagQuota -= boundedCount;
        return { ...entry, count: boundedCount };
      })
      .filter((entry) => entry.count > 0);

    let selectedQuestions: Question[] = [];
    if (boundedSelectedTagEntries.length > 0) {
      const tagBuckets = topicQuestionsPool.reduce<Record<string, Question[]>>((acc, question) => {
        const sourceKey = getQuestionSourceKey(question);
        if (!acc[sourceKey]) acc[sourceKey] = [];
        acc[sourceKey].push(question);
        return acc;
      }, {});

      boundedSelectedTagEntries.forEach(({ sourceKey, count }) => {
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

    const selectedQuestionsWithShuffledOptions = selectedQuestions.map((question) => shuffleOptionsWithAnswer(question));

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
      if (selectedQuestionsWithShuffledOptions.length > 0) {
        setQuizState(prev => ({
          ...prev,
          questions: selectedQuestionsWithShuffledOptions,
          userAnswers: new Array(selectedQuestionsWithShuffledOptions.length).fill(null),
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

  const toggleFavoriteQuestion = async (question: Question, questionIndex: number): Promise<void> => {
    if (!user?.uid || !activeTopic) return;
    const topicId = activeTopic.sub.id;
    const questionTrackingId = getQuestionTrackingId(question, topicId, questionIndex);
    const alreadyFavorite = Boolean(favoriteQuestionsById[questionTrackingId]);
    const favoriteRef = doc(db, 'users', user.uid, 'favoriteQuestions', getFavoriteQuestionDocId(questionTrackingId));

    try {
      if (alreadyFavorite) {
        setFavoriteQuestionsById((prev) => {
          const next = { ...prev };
          delete next[questionTrackingId];
          return next;
        });
        await deleteDoc(favoriteRef);
        return;
      }

      const now = Date.now();
      const favoriteRecord: FavoriteQuestionRecord = {
        questionTrackingId,
        topicId,
        questionId: getQuestionStableId(question),
        questionText: question.questionText,
        sourceTag: typeof question.sourceTag === 'string' ? question.sourceTag : null,
        createdAt: now,
        updatedAt: now,
      };
      setFavoriteQuestionsById((prev) => ({
        ...prev,
        [questionTrackingId]: favoriteRecord,
      }));
      await setDoc(favoriteRef, favoriteRecord, { merge: true });
    } catch (error) {
      console.error('Favori sorular guncellenemedi:', error);
    }
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
      const nextSeenQuestionsById = persistSeenQuestionsToFirestore ? { ...seenQuestionsById } : null;
      const changedQuestionIds = new Set<string>();
      const changedSeenQuestionIds = new Set<string>();
      const prevTopicStats = topicProgressStats[topicId] || EMPTY_TOPIC_PROGRESS;
      const nextTopicStats: TopicProgressStats = {
        ...prevTopicStats,
        seenCount: prevTopicStats.seenCount + currentQuestions.length,
        correctCount: prevTopicStats.correctCount,
        wrongCount: prevTopicStats.wrongCount,
        totalWrongAnswers: prevTopicStats.totalWrongAnswers,
        lastPlayedAt: now,
      };

      currentQuestions.forEach((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, topicId, index);
        const prevWrongStats = nextWrongQuestionStatsById[questionTrackingId];
        const answer = currentAnswers[index];

        if (persistSeenQuestionsToFirestore && nextSeenQuestionsById) {
          const prevSeenStats = nextSeenQuestionsById[questionTrackingId];
          nextSeenQuestionsById[questionTrackingId] = {
            questionTrackingId,
            topicId,
            questionId: getQuestionStableId(question),
            questionText: question.questionText,
            sourceTag: typeof question.sourceTag === 'string' ? question.sourceTag : null,
            firstSeenAt: prevSeenStats?.firstSeenAt || now,
            lastSeenAt: now,
            seenCount: (prevSeenStats?.seenCount || 0) + 1,
            answeredCount: (prevSeenStats?.answeredCount || 0) + (answer === null || answer === undefined ? 0 : 1),
            correctCount: (prevSeenStats?.correctCount || 0) + (answer === question.correctOptionIndex ? 1 : 0),
            wrongCount: (prevSeenStats?.wrongCount || 0) + (answer !== null && answer !== undefined && answer !== question.correctOptionIndex ? 1 : 0),
          };
          changedSeenQuestionIds.add(questionTrackingId);
        }

        if (answer === null || answer === undefined) {
          return;
        }

        if (answer === question.correctOptionIndex) {
          nextTopicStats.correctCount += 1;
          if (prevWrongStats && prevWrongStats.status === 'active_wrong') {
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
          lastWrongAt: now,
          resolvedAt: 0,
        };
        changedQuestionIds.add(questionTrackingId);
      });

      const activeWrongCount = (Object.values(nextWrongQuestionStatsById) as WrongQuestionStats[]).reduce<number>((sum, stats) => {
        return stats.topicId === topicId && stats.status === 'active_wrong' ? sum + 1 : sum;
      }, 0);
      nextTopicStats.wrongCount = activeWrongCount;

      setTopicProgressStats((prev) => ({
        ...prev,
        [topicId]: nextTopicStats,
      }));
      setWrongQuestionStatsById(nextWrongQuestionStatsById);
      if (persistSeenQuestionsToFirestore && nextSeenQuestionsById) {
        setSeenQuestionsById(nextSeenQuestionsById);
      }

      const persistTopicAndWrongStats = async () => {
        try {
          const batch = writeBatch(db);
          batch.set(
            doc(db, 'users', user.uid, 'topicStats', topicId),
            {
              ...nextTopicStats,
              completedQuizCount: deleteField(),
              blankCount: deleteField(),
              totalBlankAnswers: deleteField(),
            },
            { merge: true }
          );

          changedQuestionIds.forEach((questionTrackingId) => {
            const wrongStats = nextWrongQuestionStatsById[questionTrackingId];
            if (!wrongStats) return;
            batch.set(
              doc(db, 'users', user.uid, 'wrongQuestions', getWrongQuestionDocId(questionTrackingId)),
              {
                ...wrongStats,
                blankCount: deleteField(),
              },
              { merge: true }
            );
          });

          if (persistSeenQuestionsToFirestore && nextSeenQuestionsById) {
            changedSeenQuestionIds.forEach((questionTrackingId) => {
              const seenStats = nextSeenQuestionsById[questionTrackingId];
              if (!seenStats) return;
              batch.set(
                doc(db, 'users', user.uid, 'seenQuestions', getSeenQuestionDocId(questionTrackingId)),
                {
                  ...seenStats,
                  blankCount: deleteField(),
                },
                { merge: true }
              );
            });
          }

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

  const downloadJsonFile = (filename: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = filename;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const buildExportQuestion = (question: Question, topicId: string) => {
    const questionId = getQuestionStableId(question) || createQuestionId(topicId);
    return {
      questionId,
      questionText: question.questionText,
      contextText: question.contextText || null,
      contentItems: Array.isArray(question.contentItems) ? question.contentItems : [],
      options: Array.isArray(question.options) ? question.options : [],
      correctOptionIndex: question.correctOptionIndex,
      answer: 'ABCDE'[question.correctOptionIndex] || null,
      explanation: question.explanation || '',
      sourceTag: question.sourceTag || null,
      imageUrl: question.imageUrl || null,
    };
  };

  const handleExportQuestionsByTopic = () => {
    if (!adminSelectedTopicId) return;
    const selectedCategory = categories.find((cat) => cat.id === adminSelectedCatId);
    const selectedTopic = selectedCategory?.subCategories.find((sub) => sub.id === adminSelectedTopicId);
    const topicQuestions = allQuestions[adminSelectedTopicId] || [];
    if (!selectedTopic || topicQuestions.length === 0) {
      alert('Export edilecek soru bulunamadi.');
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      topic: {
        categoryId: selectedCategory?.id || null,
        categoryName: selectedCategory?.name || null,
        topicId: selectedTopic.id,
        topicName: selectedTopic.name,
      },
      questionCount: topicQuestions.length,
      questions: topicQuestions.map((question) => buildExportQuestion(question, selectedTopic.id)),
    };

    const dateText = new Date().toISOString().slice(0, 10);
    downloadJsonFile(`sorular_${selectedTopic.id}_${dateText}.json`, payload);
  };

  const handleExportAllQuestionsByTopic = () => {
    const topicExports = categories.flatMap((cat) => (
      cat.subCategories
        .map((sub) => {
          const topicQuestions = allQuestions[sub.id] || [];
          if (topicQuestions.length === 0) return null;
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            topicId: sub.id,
            topicName: sub.name,
            questionCount: topicQuestions.length,
            questions: topicQuestions.map((question) => buildExportQuestion(question, sub.id)),
          };
        })
        .filter((value): value is {
          categoryId: string;
          categoryName: string;
          topicId: string;
          topicName: string;
          questionCount: number;
          questions: ReturnType<typeof buildExportQuestion>[];
        } => Boolean(value))
    ));

    if (topicExports.length === 0) {
      alert('Export edilecek soru bulunamadi.');
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      totalTopicCount: topicExports.length,
      totalQuestionCount: topicExports.reduce((sum, topicExport) => sum + topicExport.questionCount, 0),
      topics: topicExports,
    };

    const dateText = new Date().toISOString().slice(0, 10);
    downloadJsonFile(`sorular_konu_konu_${dateText}.json`, payload);
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
    const questionStableId = getQuestionStableId(question);
    if (!activeTopic || !questionStableId || isSubmittingReport) {
      if (!questionStableId) {
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
    if (!activeTopic || !reportingQuestion || isSubmittingReport) return;
    if (!auth.currentUser) {
      alert("Bildirim gonderebilmek icin once giris yapmalisiniz.");
      return;
    }
    const questionStableId = getQuestionStableId(reportingQuestion);
    if (!questionStableId) {
      alert("Bildirim gonderilemedi. Soru kimligi bulunamadi.");
      return;
    }
    setIsSubmittingReport(true);
    try {
      await addDoc(collection(db, "questionReports"), {
        questionId: questionStableId,
        topicId: activeTopic.sub.id,
        topicName: activeTopic.sub.name,
        categoryId: activeTopic.cat.id,
        categoryName: activeTopic.cat.name,
        reporterUsername: user?.username || "Kullanici",
        reporterRole: user?.role || "user",
        note: reportNote.trim() || null,
        questionTextSnapshot: reportingQuestion.questionText,
        sourceTag: reportingQuestion.sourceTag || null,
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
    const questionTopicId =
      ((q as Question & { topicId?: string }).topicId || adminSelectedTopicId || '').trim();
    if (questionTopicId && topicBloggerPages[questionTopicId]) {
      alert('Bu konu Blogger linkinden besleniyor. Duzenleme icin JSON kaynagini guncelleyin.');
      return;
    }
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
      questionId: getQuestionStableId(editingQuestion.question) || editingQuestion.question.id || createQuestionId(adminSelectedTopicId || 'topic'),
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

  const handleAddCategory = async () => {
    const nextCategoryName = newCategoryName.trim();
    if (!nextCategoryName) return;
    const newCat: Category = {
      id: Date.now().toString(),
      name: nextCategoryName,
      iconName: 'BookOpen',
      description: 'Yeni eklenen kategori',
      subCategories: []
    };
    const previousCategories = categories;
    const nextCategories = [...previousCategories, newCat];
    setCategories(nextCategories);
    setNewCategoryName('');
    setIsCategoryModalOpen(false);
    try {
      await saveCategoriesToFirestore(nextCategories);
    } catch (error) {
      console.error('Kategori kaydedilemedi:', error);
      setCategories(previousCategories);
      alert('Kategori kaydedilemedi. Lutfen tekrar deneyin.');
    }
  };

  const handleAddTopic = async () => {
    const nextTopicName = newTopicName.trim();
    if (!nextTopicName) return;
    let targetCatId = activeCategory?.id;
    if (currentView === 'admin' && adminSelectedCatId) targetCatId = adminSelectedCatId;
    if (!targetCatId) return;

    const newSub: SubCategory = { id: Date.now().toString(), name: nextTopicName };
    const previousCategories = categories;
    const previousActiveCategory = activeCategory;
    const updatedCategories = previousCategories.map(c => {
      if (c.id === targetCatId) return { ...c, subCategories: [...c.subCategories, newSub] };
      return c;
    });
    setCategories(updatedCategories);
    if (previousActiveCategory && previousActiveCategory.id === targetCatId) {
      setActiveCategory(updatedCategories.find((cat) => cat.id === targetCatId) || null);
    }
    setNewTopicName('');
    setIsTopicModalOpen(false);
    try {
      await saveCategoriesToFirestore(updatedCategories);
    } catch (error) {
      console.error('Konu kaydedilemedi:', error);
      setCategories(previousCategories);
      setActiveCategory(previousActiveCategory);
      alert('Konu kaydedilemedi. Lutfen tekrar deneyin.');
    }
  };

  const handleRenameTopic = async () => {
    if (!adminSelectedCatId || !adminSelectedTopicId) return;
    const selectedCategory = categories.find((cat) => cat.id === adminSelectedCatId);
    const selectedTopic = selectedCategory?.subCategories.find((sub) => sub.id === adminSelectedTopicId);
    if (!selectedTopic) return;

    const rawName = window.prompt('Yeni konu adini giriniz:', selectedTopic.name);
    if (rawName === null) return;
    const nextName = rawName.trim();
    if (!nextName) {
      alert('Konu adi bos olamaz.');
      return;
    }
    if (nextName === selectedTopic.name) return;

    const previousCategories = categories;
    const previousActiveCategory = activeCategory;
    const nextCategories = previousCategories.map((cat) => {
      if (cat.id !== adminSelectedCatId) return cat;
      return {
        ...cat,
        subCategories: cat.subCategories.map((sub) => (
          sub.id === adminSelectedTopicId
            ? { ...sub, name: nextName }
            : sub
        )),
      };
    });

    setCategories(nextCategories);
    if (previousActiveCategory && previousActiveCategory.id === adminSelectedCatId) {
      setActiveCategory(nextCategories.find((cat) => cat.id === adminSelectedCatId) || null);
    }

    try {
      await saveCategoriesToFirestore(nextCategories);
    } catch (error) {
      console.error('Konu adi kaydedilemedi:', error);
      setCategories(previousCategories);
      setActiveCategory(previousActiveCategory);
      alert('Konu adi kaydedilemedi. Lutfen tekrar deneyin.');
    }
  };

  const handleMoveTopicOrder = async (direction: 'up' | 'down') => {
    if (!adminSelectedCatId || !adminSelectedTopicId) return;
    const selectedCategory = categories.find((cat) => cat.id === adminSelectedCatId);
    if (!selectedCategory) return;

    const currentIndex = selectedCategory.subCategories.findIndex((sub) => sub.id === adminSelectedTopicId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= selectedCategory.subCategories.length) return;

    const previousCategories = categories;
    const previousActiveCategory = activeCategory;
    const nextCategories = previousCategories.map((cat) => {
      if (cat.id !== adminSelectedCatId) return cat;
      const nextSubCategories = [...cat.subCategories];
      const [moved] = nextSubCategories.splice(currentIndex, 1);
      nextSubCategories.splice(targetIndex, 0, moved);
      return {
        ...cat,
        subCategories: nextSubCategories,
      };
    });

    setCategories(nextCategories);
    if (previousActiveCategory && previousActiveCategory.id === adminSelectedCatId) {
      setActiveCategory(nextCategories.find((cat) => cat.id === adminSelectedCatId) || null);
    }

    try {
      await saveCategoriesToFirestore(nextCategories);
    } catch (error) {
      console.error('Konu siralamasi kaydedilemedi:', error);
      setCategories(previousCategories);
      setActiveCategory(previousActiveCategory);
      alert('Konu siralamasi kaydedilemedi. Lutfen tekrar deneyin.');
    }
  };

  const handleSetTopicBloggerPage = async () => {
    if (!adminSelectedTopicId) return;
    const currentUrl = topicBloggerPages[adminSelectedTopicId] || '';
    const rawUrl = window.prompt(
      'Bu konu icin Blogger sayfa linki girin.\nBos birakirsaniz link temizlenir.',
      currentUrl
    );
    if (rawUrl === null) return;

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      const previousPages = topicBloggerPages;
      if (!previousPages[adminSelectedTopicId]) return;
      const nextPages = { ...previousPages };
      delete nextPages[adminSelectedTopicId];
      setTopicBloggerPages(nextPages);
      try {
        await saveTopicConfigToFirestore({ pages: nextPages });
      } catch (error) {
        console.error('Topic Blogger linki temizlenemedi:', error);
        setTopicBloggerPages(previousPages);
        alert('Blogger linki kaydedilemedi. Lutfen tekrar deneyin.');
      }
      return;
    }

    const safeUrl = normalizeHttpUrl(trimmed);
    if (!safeUrl) {
      alert('Lutfen gecerli bir http/https linki girin.');
      return;
    }

    const previousPages = topicBloggerPages;
    const nextPages = {
      ...previousPages,
      [adminSelectedTopicId]: safeUrl,
    };
    if (areTopicBloggerPagesEqual(previousPages, nextPages)) return;
    setTopicBloggerPages(nextPages);
    try {
      await saveTopicConfigToFirestore({ pages: nextPages });
    } catch (error) {
      console.error('Topic Blogger linki kaydedilemedi:', error);
      setTopicBloggerPages(previousPages);
      alert('Blogger linki kaydedilemedi. Lutfen tekrar deneyin.');
    }
  };

  const handleDeleteTopic = async () => {
    if (!adminSelectedCatId || !adminSelectedTopicId) return;
    const selectedCategory = categories.find((cat) => cat.id === adminSelectedCatId);
    const selectedTopic = selectedCategory?.subCategories.find((sub) => sub.id === adminSelectedTopicId);
    if (!selectedTopic) return;

    const questionCount = (allQuestions[adminSelectedTopicId] || []).length;
    const confirmed = window.confirm(
      `"${selectedTopic.name}" konusu silinsin mi?\n\n` +
      `Bu islem konuyu kalici olarak kaldirir ve bu konudaki ${questionCount} soruyu da siler.`
    );
    if (!confirmed) return;

    try {
      const topicQuestionsSnapshot = await getDocs(
        query(collection(db, 'questions'), where('topicId', '==', adminSelectedTopicId))
      );
      const refsToDelete = topicQuestionsSnapshot.docs.map((topicQuestionDoc) => topicQuestionDoc.ref);
      for (let i = 0; i < refsToDelete.length; i += 400) {
        const batch = writeBatch(db);
        refsToDelete.slice(i, i + 400).forEach((ref) => {
          batch.delete(ref);
        });
        await batch.commit();
      }

      const previousCategories = categories;
      const previousActiveCategory = activeCategory;
      const nextCategories = previousCategories.map((cat) => {
        if (cat.id !== adminSelectedCatId) return cat;
        return {
          ...cat,
          subCategories: cat.subCategories.filter((sub) => sub.id !== adminSelectedTopicId),
        };
      });
      setCategories(nextCategories);
      if (previousActiveCategory && previousActiveCategory.id === adminSelectedCatId) {
        setActiveCategory(nextCategories.find((cat) => cat.id === adminSelectedCatId) || null);
      }

      if (activeTopic?.sub.id === adminSelectedTopicId) {
        resetQuiz();
        setActiveTopic(null);
        setCurrentView('dashboard');
      }

      const topicIdToDelete = adminSelectedTopicId;
      const previousPages = topicBloggerPages;
      const nextPages = { ...previousPages };
      delete nextPages[topicIdToDelete];
      const nextDeletedTopicIds = normalizeTopicIdList([...deletedTopicIds, topicIdToDelete]).sort();

      setAdminSelectedTopicId('');
      setAdminQuestionSearch('');
      setAdminQuestionPage(1);
      setIsAdminActionsOpen(false);
      if (!areCategoriesEqual(previousCategories, nextCategories)) {
        try {
          await saveCategoriesToFirestore(nextCategories);
        } catch (error) {
          console.error('Konu silme sonrasi kategori listesi kaydedilemedi:', error);
          alert('Konu silindi ancak kategori listesi senkronize edilemedi. Lutfen tekrar deneyin.');
        }
      }
      const shouldPersistConfig =
        !areTopicBloggerPagesEqual(previousPages, nextPages) ||
        !areStringListsEqual(deletedTopicIds, nextDeletedTopicIds);
      if (shouldPersistConfig) {
        await saveTopicConfigToFirestore({
          pages: nextPages,
          deletedTopicIds: nextDeletedTopicIds,
        });
        setTopicBloggerPages(nextPages);
        setDeletedTopicIds(nextDeletedTopicIds);
      }
      handleCloseAdminPreview();
    } catch (error) {
      console.error('Konu silme hatasi:', error);
      alert('Konu silinirken bir hata olustu.');
    }
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
      questionId: createQuestionId(topicId),
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
        const docRef = doc(db, "questions", draft.questionId);
        batch.set(docRef, {
          ...draft,
          questionId: draft.questionId,
        });
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
    if (!isBulkSourceTagValid) {
      alert('Etiket zorunlu. Bos gecmek icin sadece 1 adet bosluk girin.');
      return;
    }
    if (!bulkText.trim()) return;
    const report = parseBulkQuestionsWithReport(bulkText);
    setBulkParsed(report.questions);
    setBulkParseErrors(report.errors);
    setBulkStep('preview');
  };

  const handleBulkSave = async () => {
    if (!isBulkSourceTagValid) {
      alert('Etiket zorunlu. Bos gecmek icin sadece 1 adet bosluk girin.');
      return;
    }
    if (!adminSelectedTopicId || bulkParsed.length === 0) return;
    const bulkSourceTag = bulkSourceTagInput === ' ' ? null : bulkSourceTagInput.trim();
    
    try {
      const batch = writeBatch(db);
      const usedQuestionIds = new Set<string>();

      bulkParsed.forEach((q, index) => {
        const parsedQuestionId = sanitizeQuestionId(q.questionId) || sanitizeQuestionId(q.id);
        const baseQuestionId = parsedQuestionId || createQuestionId(adminSelectedTopicId);
        let uniqueQuestionId = baseQuestionId;
        let duplicateCounter = 2;
        while (usedQuestionIds.has(uniqueQuestionId)) {
          uniqueQuestionId = `${baseQuestionId}_${duplicateCounter}`;
          duplicateCounter += 1;
        }
        usedQuestionIds.add(uniqueQuestionId);

        const docRef = doc(db, "questions", uniqueQuestionId);
        batch.set(docRef, {
          questionId: uniqueQuestionId,
          imageUrl: q.imageUrl ?? null,
          contextText: q.contextText ?? null,
          contentItems: q.contentItems ?? null,
          sourceTag: bulkSourceTag,
          questionText: q.questionText,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation ?? '',
          topicId: adminSelectedTopicId,
          createdAt: new Date(Date.now() + index)
        });
      });

      await batch.commit(); // Hepsini tek seferde kaydet
      
      setBulkSourceTagInput('');
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
    setBulkSourceTagInput('');
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
  const adminSelectedCategory = categories.find((cat) => cat.id === adminSelectedCatId);
  const adminSelectedTopic = adminSelectedCategory?.subCategories.find((sub) => sub.id === adminSelectedTopicId);
  const adminSelectedTopicIndex = adminSelectedCategory
    ? adminSelectedCategory.subCategories.findIndex((sub) => sub.id === adminSelectedTopicId)
    : -1;
  const canMoveAdminTopicUp = adminSelectedTopicIndex > 0;
  const canMoveAdminTopicDown = Boolean(
    adminSelectedCategory &&
    adminSelectedTopicIndex >= 0 &&
    adminSelectedTopicIndex < adminSelectedCategory.subCategories.length - 1
  );
  const adminSelectedTopicBloggerPage = adminSelectedTopicId ? (topicBloggerPages[adminSelectedTopicId] || '') : '';
  const isAdminTopicExternallySourced = Boolean(adminSelectedTopicBloggerPage);

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
  }>(
    (acc, stats) => {
      acc.seenCount += stats.seenCount;
      acc.correctCount += stats.correctCount;
      acc.wrongCount += stats.wrongCount;
      return acc;
    },
    { seenCount: 0, correctCount: 0, wrongCount: 0 }
  );
  const allSeenQuestionStats = persistSeenQuestionsToFirestore
    ? (Object.values(seenQuestionsById) as SeenQuestionStats[])
    : [];
  const selectedHomeStatsCategory = homeStatsCategoryFilter === 'all'
    ? null
    : (categories.find((cat) => cat.id === homeStatsCategoryFilter) || null);
  const homeStatsTopicIds = useMemo<Set<string> | null>(() => {
    if (homeStatsCategoryFilter === 'all') return null;
    if (!selectedHomeStatsCategory) return new Set<string>();
    return new Set(selectedHomeStatsCategory.subCategories.map((sub) => sub.id));
  }, [homeStatsCategoryFilter, selectedHomeStatsCategory]);
  const homeStats = useMemo(() => {
    const includeTopic = (topicId: string): boolean => {
      if (!homeStatsTopicIds) return true;
      return homeStatsTopicIds.has(topicId);
    };
    const topicProgressEntries = Object.entries(topicProgressStats) as [string, TopicProgressStats][];

    const progressStats = topicProgressEntries.reduce<{
      seenCount: number;
      correctCount: number;
      wrongCount: number;
    }>((acc, [topicId, stats]) => {
      if (!includeTopic(topicId)) return acc;
      acc.seenCount += stats.seenCount;
      acc.correctCount += stats.correctCount;
      acc.wrongCount += stats.wrongCount;
      return acc;
    }, { seenCount: 0, correctCount: 0, wrongCount: 0 });

    const filteredTopicProgressStats = topicProgressEntries.filter(([topicId]) => includeTopic(topicId));
    const totalWrongAnswers = filteredTopicProgressStats.reduce((sum, [, stats]) => sum + stats.totalWrongAnswers, 0);

    const filteredSeenQuestionStats = allSeenQuestionStats.filter((stats) => includeTopic(stats.topicId));
    const uniqueSolvedCount = persistSeenQuestionsToFirestore
      ? filteredSeenQuestionStats.reduce((sum, stats) => (stats.answeredCount > 0 ? sum + 1 : sum), 0)
      : progressStats.seenCount;
    const totalAnsweredCount = persistSeenQuestionsToFirestore
      ? filteredSeenQuestionStats.reduce((sum, stats) => sum + stats.answeredCount, 0)
      : (progressStats.correctCount + totalWrongAnswers);

    const filteredFavoriteCount = (Object.values(favoriteQuestionsById) as FavoriteQuestionRecord[]).reduce((sum, favoriteRecord) => (
      includeTopic(favoriteRecord.topicId) ? sum + 1 : sum
    ), 0);

    const answeredAttemptCount = progressStats.correctCount + totalWrongAnswers;
    const accuracyPercent = answeredAttemptCount > 0
      ? Math.round((progressStats.correctCount / answeredAttemptCount) * 100)
      : 0;

    return {
      progressStats,
      uniqueSolvedCount,
      totalAnsweredCount,
      filteredFavoriteCount,
      totalWrongAnswers,
      accuracyPercent,
    };
  }, [allSeenQuestionStats, favoriteQuestionsById, homeStatsTopicIds, topicProgressStats]);
  const seenQuestionStatsByTopic = useMemo<Record<string, SeenQuestionStats[]>>(() => {
    const next: Record<string, SeenQuestionStats[]> = {};
    allSeenQuestionStats.forEach((stats) => {
      if (!next[stats.topicId]) next[stats.topicId] = [];
      next[stats.topicId].push(stats);
    });
    return next;
  }, [allSeenQuestionStats]);
  const statisticsTopicRows = useMemo(() => {
    return categories.flatMap((cat) => {
      return cat.subCategories.map((sub) => {
        const topicStats = topicProgressStats[sub.id] || EMPTY_TOPIC_PROGRESS;
        const seenStats = seenQuestionStatsByTopic[sub.id] || [];
        const uniqueSolvedCount = persistSeenQuestionsToFirestore
          ? seenStats.reduce((sum, stats) => (stats.answeredCount > 0 ? sum + 1 : sum), 0)
          : topicStats.seenCount;
        const totalAnsweredCount = persistSeenQuestionsToFirestore
          ? seenStats.reduce((sum, stats) => sum + stats.answeredCount, 0)
          : (topicStats.correctCount + topicStats.totalWrongAnswers);
        const correctCount = topicStats.correctCount;
        const wrongCount = topicStats.totalWrongAnswers;
        const accuracyPercent = totalAnsweredCount > 0
          ? Math.round((correctCount / totalAnsweredCount) * 100)
          : 0;

        return {
          categoryId: cat.id,
          categoryName: cat.name,
          categoryIconName: cat.iconName,
          topicId: sub.id,
          topicName: sub.name,
          uniqueSolvedCount,
          totalAnsweredCount,
          correctCount,
          wrongCount,
          accuracyPercent,
          hasProgress:
            uniqueSolvedCount > 0 ||
            totalAnsweredCount > 0 ||
            correctCount > 0 ||
            wrongCount > 0 ||
            topicStats.wrongCount > 0 ||
            topicStats.seenCount > 0,
        };
      });
    });
  }, [categories, persistSeenQuestionsToFirestore, seenQuestionStatsByTopic, topicProgressStats]);
  const statisticsCategoryRows = useMemo(() => {
    return categories
      .map((cat) => {
        const rows = statisticsTopicRows.filter((row) => row.categoryId === cat.id);
        const totals = rows.reduce(
          (acc, row) => {
            acc.uniqueSolvedCount += row.uniqueSolvedCount;
            acc.totalAnsweredCount += row.totalAnsweredCount;
            acc.correctCount += row.correctCount;
            acc.wrongCount += row.wrongCount;
            return acc;
          },
          { uniqueSolvedCount: 0, totalAnsweredCount: 0, correctCount: 0, wrongCount: 0 }
        );
        const accuracyPercent = totals.totalAnsweredCount > 0
          ? Math.round((totals.correctCount / totals.totalAnsweredCount) * 100)
          : 0;
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          categoryIconName: cat.iconName,
          topicCount: cat.subCategories.length,
          ...totals,
          accuracyPercent,
          hasProgress: rows.some((row) => row.hasProgress),
        };
      })
      .sort((a, b) => {
        if (b.totalAnsweredCount !== a.totalAnsweredCount) {
          return b.totalAnsweredCount - a.totalAnsweredCount;
        }
        return a.categoryName.localeCompare(b.categoryName, 'tr');
      });
  }, [categories, statisticsTopicRows]);
  const statisticsScopeCategory = statisticsScopeCategoryId === 'all'
    ? null
    : (categories.find((cat) => cat.id === statisticsScopeCategoryId) || null);
  const statisticsFilteredCategoryRows = useMemo(() => {
    if (statisticsScopeCategoryId === 'all') return statisticsCategoryRows;
    return statisticsCategoryRows.filter((row) => row.categoryId === statisticsScopeCategoryId);
  }, [statisticsCategoryRows, statisticsScopeCategoryId]);
  const statisticsFilteredTopicRows = useMemo(() => {
    const rows = statisticsScopeCategoryId === 'all'
      ? statisticsTopicRows
      : statisticsTopicRows.filter((row) => row.categoryId === statisticsScopeCategoryId);
    return [...rows].sort((a, b) => {
      if (b.totalAnsweredCount !== a.totalAnsweredCount) {
        return b.totalAnsweredCount - a.totalAnsweredCount;
      }
      if (b.correctCount !== a.correctCount) {
        return b.correctCount - a.correctCount;
      }
      return a.topicName.localeCompare(b.topicName, 'tr');
    });
  }, [statisticsScopeCategoryId, statisticsTopicRows]);
  const statisticsSummary = useMemo(() => {
    const baseRows = statisticsScopeCategoryId === 'all'
      ? statisticsCategoryRows
      : statisticsCategoryRows.filter((row) => row.categoryId === statisticsScopeCategoryId);
    const totals = baseRows.reduce(
      (acc, row) => {
        acc.uniqueSolvedCount += row.uniqueSolvedCount;
        acc.totalAnsweredCount += row.totalAnsweredCount;
        acc.correctCount += row.correctCount;
        acc.wrongCount += row.wrongCount;
        return acc;
      },
      { uniqueSolvedCount: 0, totalAnsweredCount: 0, correctCount: 0, wrongCount: 0 }
    );
    const accuracyPercent = totals.totalAnsweredCount > 0
      ? Math.round((totals.correctCount / totals.totalAnsweredCount) * 100)
      : 0;
    return {
      ...totals,
      accuracyPercent,
    };
  }, [statisticsCategoryRows, statisticsScopeCategoryId]);
  const statisticsScopeLabel = statisticsScopeCategory?.name || 'Tum Dersler';
  const isStatisticsTopicView = statisticsScopeCategoryId !== 'all';
  const hasProgressForTopic = (topicId: string): boolean => {
    const stats = getTopicProgress(topicId);
    const activeWrongCount = (wrongQuestionIdsByTopic[topicId] || []).length;
    return stats.seenCount > 0 || stats.wrongCount > 0 || activeWrongCount > 0;
  };
  const resetStatsPreview = resetStatsTargetTopic
    ? (() => {
        const topicStats = getTopicProgress(resetStatsTargetTopic.id);
        return {
          seenCount: topicStats.seenCount,
          correctCount: topicStats.correctCount,
          wrongCount: topicStats.wrongCount,
        };
      })()
    : EMPTY_TOPIC_PROGRESS;
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
    if (!resetStatsTargetTopic) {
      setIsResetStatsModalOpen(false);
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

      const topicId = resetStatsTargetTopic.id;
      const wrongQuestionsForTopic = await getDocs(query(collection(db, 'users', user.uid, 'wrongQuestions'), where('topicId', '==', topicId)));
      const seenQuestionsForTopic = await getDocs(query(collection(db, 'users', user.uid, 'seenQuestions'), where('topicId', '==', topicId)));
      const refsToDelete = wrongQuestionsForTopic.docs.map((wrongDoc) => wrongDoc.ref);
      refsToDelete.push(...seenQuestionsForTopic.docs.map((seenDoc) => seenDoc.ref));
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
      setSeenQuestionsById((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((questionTrackingId) => {
          if (next[questionTrackingId].topicId === topicId) {
            delete next[questionTrackingId];
          }
        });
        return next;
      });
    } catch (error) {
      console.error('Istatistik sifirlama hatasi:', error);
      alert('Istatistikler sifirlanamadi. Lutfen tekrar deneyin.');
    } finally {
      setIsResetStatsModalOpen(false);
      setResetStatsTargetTopic(null);
    }
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
    const favoriteQuestionIdSet = new Set(favoriteQuestionIdsByTopic[activeTopic.sub.id] || []);
    const statusFilterActive = quizStatusFilter.wrong || quizStatusFilter.favorite;
    const getFilteredQuestionsByStatus = (status: QuizStatusFilter) => {
      const isActive = status.wrong || status.favorite;
      if (!isActive) return allSetupTopicQuestions;
      return allSetupTopicQuestions.filter((question, index) => {
        const questionTrackingId = getQuestionTrackingId(question, activeTopic.sub.id, index);
        const includeWrong = status.wrong && wrongQuestionIdSet.has(questionTrackingId);
        const includeFavorite = status.favorite && favoriteQuestionIdSet.has(questionTrackingId);
        return includeWrong || includeFavorite;
      });
    };
    const setupTopicQuestions = getFilteredQuestionsByStatus(quizStatusFilter);
    const wrongOnlyQuestionCount = getFilteredQuestionsByStatus({ wrong: true, favorite: false }).length;
    const favoriteOnlyQuestionCount = getFilteredQuestionsByStatus({ wrong: false, favorite: true }).length;
    const maxQuestions = setupTopicQuestions.length;
    const activeSourceLabels = [
      quizStatusFilter.wrong ? 'yanlis' : '',
      quizStatusFilter.favorite ? 'favori' : '',
    ].filter((label) => label.length > 0);
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
    const selectedTagAvailableQuestionCount = sourceTagOptions.reduce((sum, option) => {
      const selectedCount = quizTagQuestionCounts[option.sourceKey] || 0;
      return selectedCount > 0 ? sum + option.totalCount : sum;
    }, 0);
    const questionCountMax = isTagDistributionActive ? selectedTagAvailableQuestionCount : maxQuestions;
    const effectiveQuestionCount = isTagDistributionActive ? selectedTagTotalQuestionCount : quizConfig.questionCount;
    const clampTagQuestionCountsToLimit = (
      counts: Record<string, number>,
      totalLimit: number
    ): Record<string, number> => {
      const safeLimit = Math.max(0, Math.floor(totalLimit));
      let remaining = safeLimit;
      const next: Record<string, number> = {};
      sourceTagOptions.forEach((option) => {
        const rawCount = Math.max(0, Math.floor(Number(counts[option.sourceKey] || 0)));
        const boundedByTag = Math.min(option.totalCount, rawCount);
        const bounded = Math.min(boundedByTag, remaining);
        if (bounded > 0) {
          next[option.sourceKey] = bounded;
          remaining -= bounded;
        }
      });
      return next;
    };
    const updateQuizStatusFilter = (nextStatusFilter: QuizStatusFilter) => {
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

    const updateTagQuestionCount = (sourceKey: string, nextCount: number) => {
      const targetOption = sourceTagOptions.find((option) => option.sourceKey === sourceKey);
      if (!targetOption) return;
      const normalizedCurrent = clampTagQuestionCountsToLimit(quizTagQuestionCounts, quizConfig.questionCount);
      const otherSelectedTotal = Object.entries(normalizedCurrent).reduce((sum, [key, value]) => {
        if (key === sourceKey) return sum;
        return sum + value;
      }, 0);
      const remainingForTarget = Math.max(0, quizConfig.questionCount - otherSelectedTotal);
      const clampedCount = Math.min(
        targetOption.totalCount,
        remainingForTarget,
        Math.max(0, Math.floor(nextCount))
      );

      let nextTagCounts: Record<string, number>;
      if (clampedCount <= 0) {
        const { [sourceKey]: _removed, ...rest } = normalizedCurrent;
        nextTagCounts = rest;
      } else {
        nextTagCounts = { ...normalizedCurrent, [sourceKey]: clampedCount };
      }

      setQuizTagQuestionCounts(nextTagCounts);

      const nextHasTagDistribution = Object.values(nextTagCounts).some((value) => value > 0);
      const nextSelectedTagAvailableMax = sourceTagOptions.reduce((sum, option) => {
        const selectedCount = nextTagCounts[option.sourceKey] || 0;
        return selectedCount > 0 ? sum + option.totalCount : sum;
      }, 0);
      const nextQuestionCountMax = nextHasTagDistribution ? nextSelectedTagAvailableMax : maxQuestions;

      setQuizConfig((prev) => {
        const clampedQuestionCount = Math.min(Math.max(0, prev.questionCount), Math.max(0, nextQuestionCountMax));
        if (clampedQuestionCount === prev.questionCount) return prev;
        return {
          ...prev,
          questionCount: clampedQuestionCount,
          durationSeconds: getAutoDurationForQuestionCount(clampedQuestionCount),
        };
      });
    };

    const applyQuestionCount = (nextRawQuestionCount: number) => {
      const normalizedQuestionCount = Math.min(
        Math.max(0, Math.floor(Number.isFinite(nextRawQuestionCount) ? nextRawQuestionCount : 0)),
        Math.max(0, questionCountMax)
      );
      setQuizConfig((prev) => ({
        ...prev,
        questionCount: normalizedQuestionCount,
        durationSeconds: getAutoDurationForQuestionCount(normalizedQuestionCount),
      }));
      setQuizTagQuestionCounts((prev) => clampTagQuestionCountsToLimit(prev, normalizedQuestionCount));
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
              {(wrongOnlyQuestionCount > 0 || favoriteOnlyQuestionCount > 0) && (
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => updateQuizStatusFilter({ wrong: !quizStatusFilter.wrong, favorite: quizStatusFilter.favorite })}
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
                      onClick={() => updateQuizStatusFilter({ wrong: quizStatusFilter.wrong, favorite: !quizStatusFilter.favorite })}
                      disabled={favoriteOnlyQuestionCount === 0}
                      className={`text-left rounded-xl border px-2.5 md:px-3 py-2 md:py-2.5 transition ${
                        quizStatusFilter.favorite
                          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <p className="text-[11px] md:text-xs font-bold text-surface-700 dark:text-surface-200">Favorilerim</p>
                      <p className="text-[11px] text-amber-600 dark:text-amber-300 mt-0.5">{favoriteOnlyQuestionCount} soru</p>
                    </button>
                  </div>

                  {statusFilterActive && (
                    <div className="mt-2.5 flex items-center justify-between">
                      <p className="text-[11px] text-brand-600 dark:text-brand-300 font-medium">
                        {`Sadece ${activeSourceLabels.join(' + ')} sorulardan secilecek.`}
                      </p>
                      <button
                        onClick={() => updateQuizStatusFilter({ wrong: false, favorite: false })}
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
                    Max: {questionCountMax}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max={questionCountMax}
                    value={quizConfig.questionCount}
                    onChange={(e) => {
                      const nextQuestionCount = parseInt(e.target.value, 10) || 0;
                      applyQuestionCount(nextQuestionCount);
                    }}
                    disabled={questionCountMax === 0}
                    className="w-full h-2 bg-surface-200 dark:bg-surface-700 rounded-lg cursor-pointer"
                  />
                  <input
                    type="number"
                    min={0}
                    max={questionCountMax}
                    value={questionCountInputValue}
                    onFocus={() => {
                      setQuestionCountInputValue('');
                      applyQuestionCount(0);
                    }}
                    onChange={(e) => {
                      const sanitized = e.target.value.replace(/[^\d]/g, '');
                      setQuestionCountInputValue(sanitized);
                      if (sanitized === '') {
                        applyQuestionCount(0);
                        return;
                      }
                      applyQuestionCount(parseInt(sanitized, 10) || 0);
                    }}
                    onBlur={() => {
                      if (questionCountInputValue.trim() !== '') return;
                      setQuestionCountInputValue('0');
                    }}
                    disabled={questionCountMax === 0}
                    className="w-14 h-10 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl font-extrabold text-lg text-surface-800 dark:text-white text-center outline-none focus:border-brand-500 disabled:opacity-50"
                  />
                </div>
                {questionCountMax === 0 && <p className="text-red-500 text-xs mt-2 font-medium">Bu konuda henuz soru bulunmuyor.</p>}
                {isTagDistributionActive && (
                  <p className="text-[11px] text-brand-600 dark:text-brand-300 mt-2 font-medium">
                    Etiket dagilimi aktif. Secili etiket toplam sorusu: {selectedTagTotalQuestionCount}.
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
                      Secili: {selectedTagTotalQuestionCount} / {quizConfig.questionCount}
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
                      const selectedWithoutCurrent = Math.max(0, selectedTagTotalQuestionCount - selectedCount);
                      const maxSelectableForOption = Math.min(
                        option.totalCount,
                        Math.max(0, quizConfig.questionCount - selectedWithoutCurrent)
                      );
                      const cannotSelectNew = !isSelected && maxSelectableForOption === 0;

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
                                onChange={(e) => updateTagQuestionCount(option.sourceKey, e.target.checked ? Math.min(1, maxSelectableForOption) : 0)}
                                disabled={cannotSelectNew}
                                className="w-4 h-4 accent-brand-600 mt-0.5"
                              />
                              <div className="min-w-0">
                                <p className="text-[13px] md:text-sm font-semibold text-surface-700 dark:text-surface-200 break-words leading-snug">{option.label}</p>
                                <p className="text-[11px] text-surface-400 mt-0.5">{option.totalCount} soru mevcut</p>
                              </div>
                            </label>

                            <div className="flex items-center gap-1.5 self-end sm:self-auto">
                              <button
                                onClick={() => updateTagQuestionCount(option.sourceKey, selectedCount - 1)}
                                disabled={selectedCount === 0}
                                className="w-8 h-8 md:w-7 md:h-7 rounded-md border border-surface-200 dark:border-surface-600 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={maxSelectableForOption}
                                value={selectedCount}
                                onChange={(e) => updateTagQuestionCount(option.sourceKey, parseInt(e.target.value, 10) || 0)}
                                className="w-14 h-8 md:h-7 rounded-md border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-center text-xs font-bold text-surface-700 dark:text-surface-200 outline-none focus:border-brand-500"
                              />
                              <button
                                onClick={() => updateTagQuestionCount(option.sourceKey, selectedCount + 1)}
                                disabled={selectedCount >= maxSelectableForOption}
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
                        ? `Toplam ${selectedTagTotalQuestionCount} soru etiket seciminden gelecek (ust limit: ${quizConfig.questionCount}).`
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
    const wrongCount = quizState.userAnswers.reduce((count, answer, index) => {
      if (answer === null || answer === undefined) return count;
      return answer !== quizState.questions[index].correctOptionIndex ? count + 1 : count;
    }, 0);
    const blankCount = quizState.userAnswers.reduce((count, answer) => {
      return answer === null || answer === undefined ? count + 1 : count;
    }, 0);
    const catColor = getCatColor(activeTopic.cat.id);
    const progressPercent = quizState.questions.length > 0 ? ((quizState.currentQuestionIndex + 1) / quizState.questions.length) * 100 : 0;
    const timerPercent = quizState.totalTime > 0 ? (quizState.timeLeft / quizState.totalTime) * 100 : 100;
    const scorePercent = quizState.questions.length > 0 ? (score / quizState.questions.length) * 100 : 0;
    const roundedScorePercent = Math.round(scorePercent);
    const resultFeedback = (() => {
      if (roundedScorePercent <= 20) {
        return {
          title: 'Temelden Başlayalım',
          detail: 'Bu başlangıç düzeyi normal. Konuyu kısa tekrar edip küçük bir setle yeniden dene.',
        };
      }
      if (roundedScorePercent <= 30) {
        return {
          title: 'Başlangıç Güzel',
          detail: 'Doğru yöndesin. Yanlış yaptığın noktaları not alıp bir tur daha çöz.',
        };
      }
      if (roundedScorePercent <= 40) {
        return {
          title: 'Ritim Kazanıyorsun',
          detail: 'Kavramlar oturmaya başlamış. Soru köklerini daha dikkatli okuyarak hızlanabilirsin.',
        };
      }
      if (roundedScorePercent <= 50) {
        return {
          title: 'Orta Seviyeye Geldin',
          detail: 'Temel doğru. Şimdi yanlış tiplerini hedefleyip isabet oranını artırma zamanı.',
        };
      }
      if (roundedScorePercent <= 60) {
        return {
          title: 'İyi İlerliyorsun',
          detail: 'Çözüm kaliten artıyor. Zorlandığın soru tiplerinde 10 soruluk mini tekrar yap.',
        };
      }
      if (roundedScorePercent <= 70) {
        return {
          title: 'Güçlü Performans',
          detail: 'Çoğu noktayı doğru yönetiyorsun. Süre yönetimine odaklanırsan sonuç daha da yükselir.',
        };
      }
      if (roundedScorePercent <= 80) {
        return {
          title: 'Çok İyi',
          detail: 'Konu hakimiyetin güçlü. Küçük hataları temizleyerek üst banda rahat çıkarsın.',
        };
      }
      if (roundedScorePercent <= 90) {
        return {
          title: 'Harika Seviye',
          detail: 'Netlerin çok iyi. Bu çizgiyi korumak için düzenli kısa tekrar yeterli.',
        };
      }
      return {
        title: 'Mükemmel',
        detail: 'Neredeyse kusursuz çözüm. Aynı disiplini sürdürerek standardını sabitle.',
      };
    })();
    const totalQuestions = quizState.questions.length;
    const hasCollapsedQuestionNav = totalQuestions > 7;
    const questionNavItems: Array<{ type: 'question'; index: number } | { type: 'jump' }> = hasCollapsedQuestionNav
      ? [
          { type: 'question', index: 0 },
          { type: 'question', index: 1 },
          { type: 'question', index: 2 },
          { type: 'jump' },
          { type: 'question', index: totalQuestions - 3 },
          { type: 'question', index: totalQuestions - 2 },
          { type: 'question', index: totalQuestions - 1 },
        ]
      : Array.from({ length: totalQuestions }, (_, idx) => ({ type: 'question' as const, index: idx }));
    const questionStemTextSizeClass = quizSize === 0
      ? 'text-[14px] leading-6'
      : quizSize === 1
        ? 'text-base leading-7'
        : 'text-lg leading-8';
    const currentQuestionTrackingId = currentQuestion
      ? getQuestionTrackingId(currentQuestion, activeTopic.sub.id, quizState.currentQuestionIndex)
      : null;
    const isCurrentQuestionFavorite = currentQuestionTrackingId
      ? Boolean(favoriteQuestionsById[currentQuestionTrackingId])
      : false;
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
        <header className={`flex-shrink-0 bg-white/85 dark:bg-surface-800/85 backdrop-blur-2xl border-b border-surface-200/80 dark:border-surface-700/70 px-2.5 sm:px-4 md:px-8 z-40 ${
          quizSize === 0 ? 'py-1.5' : 'py-2'
        }`}>
          <div className="md:hidden w-full rounded-2xl border border-surface-200/90 dark:border-surface-700/70 bg-white/90 dark:bg-surface-800/85 overflow-hidden">
            <div className="grid grid-cols-[52px_minmax(0,1fr)_62px_96px_52px] items-stretch">
              <button
                onClick={() => setQuizConfirmAction('exit')}
                className="h-12 flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                aria-label="Sinavdan cik"
              >
                <Icon name="X" className="w-4 h-4" />
              </button>

              <div className="h-12 min-w-0 px-3 border-l border-surface-200/80 dark:border-surface-700/70 flex items-center">
                <h2 className="text-[10px] font-semibold text-surface-800 dark:text-white leading-[1.05] overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                  {activeTopic.sub.name}
                </h2>
              </div>

              <div className="h-12 border-l border-surface-200/80 dark:border-surface-700/70 flex items-center justify-center">
                <span className={`text-xs font-black ${catColor.text} ${catColor.textDark}`}>
                  {quizState.questions.length > 0 ? `${quizState.currentQuestionIndex + 1}/${quizState.questions.length}` : '--'}
                </span>
              </div>

              <div className={`h-12 border-l border-surface-200/80 dark:border-surface-700/70 flex items-center justify-center gap-1.5 text-[12px] font-mono font-bold ${
                quizState.showResults
                  ? 'text-surface-500 dark:text-surface-300'
                  : quizState.timeLeft < 30
                    ? 'text-red-500 dark:text-red-300'
                    : quizState.timeLeft < 60
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-surface-700 dark:text-surface-200'
              }`}>
                {!quizState.showResults && <Icon name="Clock" className="w-3.5 h-3.5 opacity-75" />}
                {!quizState.showResults ? formatTime(quizState.timeLeft) : 'Sonuc'}
              </div>

              <button
                onClick={() => setIsDarkMode((prev) => !prev)}
                className="h-12 border-l border-surface-200/80 dark:border-surface-700/70 flex items-center justify-center text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
                title={isDarkMode ? 'Acik tema' : 'Koyu tema'}
                aria-label={isDarkMode ? 'Acik temaya gec' : 'Koyu temaya gec'}
              >
                <Icon name={isDarkMode ? 'Sun' : 'Moon'} className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className={`hidden md:flex items-center justify-between ${quizSize === 0 ? 'h-12' : 'h-14'}`}>
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

            {!quizState.showResults && quizState.questions.length > 0 && (
              <div className="text-xs font-bold text-surface-500 dark:text-surface-300 px-2.5 py-1 rounded-full border border-surface-200 dark:border-surface-600 bg-white/70 dark:bg-surface-700/60">
                <span className={`${catColor.text} ${catColor.textDark}`}>{quizState.currentQuestionIndex + 1}</span>
                <span className="mx-1">/</span>
                <span>{quizState.questions.length}</span>
              </div>
            )}

            {!quizState.showResults && (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setIsDarkMode((prev) => !prev)}
                  className={`flex items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors border border-surface-200 dark:border-surface-600 ${
                    quizSize === 0 ? 'w-9 h-9' : 'w-10 h-10'
                  }`}
                  title={isDarkMode ? 'Acik tema' : 'Koyu tema'}
                  aria-label={isDarkMode ? 'Acik temaya gec' : 'Koyu temaya gec'}
                >
                  <Icon name={isDarkMode ? 'Sun' : 'Moon'} className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setQuizSize(prev => ((prev + 1) % 3) as 0 | 1 | 2)}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors border border-surface-200 dark:border-surface-600"
                  title="Yazi boyutunu degistir"
                >
                  <span className={`font-bold transition-all ${quizSize === 0 ? 'text-[10px]' : quizSize === 1 ? 'text-xs' : 'text-sm'}`}>A</span>
                  <span className={`font-bold transition-all ${quizSize === 0 ? 'text-xs' : quizSize === 1 ? 'text-sm' : 'text-base'}`}>A</span>
                </button>

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
          </div>
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
                  <div className={`md:hidden rounded-xl border border-surface-200/85 dark:border-surface-700/70 bg-surface-50/80 dark:bg-surface-900/55 overflow-hidden ${
                    quizSize === 0 ? 'mb-3' : quizSize === 1 ? 'mb-4' : 'mb-5'
                  }`}>
                    <div className="grid grid-cols-[58px_minmax(0,1fr)_52px_52px] items-stretch">
                      <div className={`h-11 flex items-center justify-center font-black ${catColor.text} ${catColor.textDark} ${
                        quizSize === 0 ? 'text-sm' : 'text-base'
                      }`}>
                        {quizState.currentQuestionIndex + 1}
                      </div>
                      <div className="h-11 min-w-0 px-3 border-l border-surface-200/85 dark:border-surface-700/70 flex items-center">
                        <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-200 leading-[1.05] overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
                          {currentQuestion.sourceTag || 'Kaynak yok'}
                        </span>
                      </div>
                      <button
                        onClick={() => void toggleFavoriteQuestion(currentQuestion, quizState.currentQuestionIndex)}
                        className={`h-11 border-l border-surface-200/85 dark:border-surface-700/70 flex items-center justify-center transition ${
                          isCurrentQuestionFavorite
                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300'
                            : 'text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
                        }`}
                        title={isCurrentQuestionFavorite ? 'Favoriden cikar' : 'Favorilere ekle'}
                        aria-label={isCurrentQuestionFavorite ? 'Favoriden cikar' : 'Favorilere ekle'}
                      >
                        <Icon name="Star" className={`w-4 h-4 ${isCurrentQuestionFavorite ? 'fill-current' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleReportQuestion(currentQuestion)}
                        disabled={!currentQuestion.id || isSubmittingReport}
                        className="h-11 border-l border-surface-200/85 dark:border-surface-700/70 flex items-center justify-center text-red-600 dark:text-red-300 hover:bg-red-100/60 dark:hover:bg-red-900/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Hatali soruyu bildir"
                        aria-label="Hatali soruyu bildir"
                      >
                        <Icon name="Flag" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className={`hidden md:flex justify-between items-center gap-2 ${quizSize === 0 ? 'mb-3' : quizSize === 1 ? 'mb-4' : 'mb-5'}`}>
                    <span className={`${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark} font-black rounded-lg uppercase tracking-wider ${
                      quizSize === 0 ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1 text-xs'
                    }`}>
                      {quizState.currentQuestionIndex + 1}. Soru
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
                        onClick={() => void toggleFavoriteQuestion(currentQuestion, quizState.currentQuestionIndex)}
                        className={`inline-flex items-center gap-1 rounded-lg border font-semibold transition ${
                          isCurrentQuestionFavorite
                            ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300'
                            : 'border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-700/50 text-surface-500 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700'
                        } ${quizSize === 0 ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}
                        title={isCurrentQuestionFavorite ? 'Favoriden cikar' : 'Favorilere ekle'}
                      >
                        <Icon name="Star" className={`w-3 h-3 ${isCurrentQuestionFavorite ? 'fill-current' : ''}`} />
                        {isCurrentQuestionFavorite ? 'Favli' : 'Favla'}
                      </button>
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
              quizSize === 0 ? 'p-1.5' : 'p-2.5'
            }`}>
              <div className="max-w-2xl mx-auto">
                <div className="rounded-2xl border border-surface-200/90 dark:border-surface-700/80 bg-white/95 dark:bg-surface-800/95 overflow-hidden shadow-card dark:shadow-card-dark">
                  {/* Question Navigator */}
                  <div className="p-0.5 sm:p-1">
                    <div
                      className="grid rounded-xl border border-surface-200/85 dark:border-surface-700/80 overflow-hidden"
                      style={{
                        gridTemplateColumns: hasCollapsedQuestionNav
                          ? '1fr 1fr 1fr 1.25fr 1fr 1fr 1fr'
                          : `repeat(${Math.max(questionNavItems.length, 1)}, minmax(0, 1fr))`,
                      }}
                    >
                      {questionNavItems.map((item, navIndex) => {
                        const leftBorderClass = navIndex > 0 ? 'border-l border-surface-200/85 dark:border-surface-700/80' : '';
                        if (item.type === 'jump') {
                          return (
                            <button
                              key="jump"
                              onClick={handleJumpToQuestion}
                              title="Soru numarasina git"
                              className={`h-7 sm:h-8 flex items-center justify-center font-black tracking-wider text-[9px] bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition ${leftBorderClass}`}
                            >
                              ...
                            </button>
                          );
                        }

                        const isActive = item.index === quizState.currentQuestionIndex;
                        const isAnswered = quizState.userAnswers[item.index] !== null;

                        return (
                          <button
                            key={`q_${item.index}`}
                            onClick={() => goToQuestion(item.index)}
                            className={`h-7 sm:h-8 flex items-center justify-center font-bold text-[9px] transition-all duration-200 ${
                              isActive
                                ? `bg-gradient-to-r ${catColor.gradient} text-white shadow-sm`
                                : isAnswered
                                  ? `${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark}`
                                  : 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-300'
                            } ${leftBorderClass}`}
                          >
                            {item.index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Row */}
                  <div className="grid grid-cols-3 border-t border-surface-200/90 dark:border-surface-700/80">
                    <button
                      onClick={handlePrevQuestion}
                      disabled={quizState.currentQuestionIndex === 0}
                      className="h-9 sm:h-10 border-r border-surface-200/90 dark:border-surface-700/80 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 font-semibold text-[11px] hover:bg-surface-200 dark:hover:bg-surface-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Önceki
                    </button>

                    <button
                      onClick={() => setQuizConfirmAction('finish')}
                      className="h-9 sm:h-10 border-r border-surface-200/90 dark:border-surface-700/80 bg-gradient-to-r from-rose-800 to-red-700 hover:from-rose-900 hover:to-red-800 text-white font-bold text-[11px] transition"
                    >
                      Bitir
                    </button>

                    <button
                      onClick={handleNextQuestion}
                      className="h-9 sm:h-10 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1"
                    >
                      Sonraki
                      <Icon name="ChevronRight" className="w-3 h-3" />
                    </button>
                  </div>
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
                      <span className="text-xs text-surface-400 font-medium">Başarı</span>
                    </div>
                  </div>

                  <h3 className="text-2xl font-extrabold text-surface-800 dark:text-white mb-1">
                    {resultFeedback.title}
                  </h3>
                  <p className="text-surface-500 dark:text-surface-300 text-sm mb-1.5">
                    {resultFeedback.detail}
                  </p>
                  <p className="text-surface-400 text-sm mb-6">
                    {quizState.questions.length} sorudan {score} tanesini doğru yanıtladın.
                  </p>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Doğru</span>
                      <span className="text-2xl font-black text-emerald-500">{score}</span>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">Yanlış</span>
                      <span className="text-2xl font-black text-red-400">{wrongCount}</span>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded-xl">
                      <span className="block text-[10px] font-bold text-orange-600 dark:text-orange-300 uppercase tracking-wider mb-1">Boş</span>
                      <span className="text-2xl font-black text-orange-500 dark:text-orange-300">{blankCount}</span>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setActiveTopic(null); resetQuiz(); setCurrentView('dashboard'); }}
                      className="flex-1 py-3 rounded-xl font-bold text-sm text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 transition"
                    >
                      Ana Menü
                    </button>
                    <button
                      onClick={() => openQuizSetup(activeTopic.cat, activeTopic.sub)}
                      className={`flex-1 py-3 rounded-xl bg-gradient-to-r ${catColor.gradient} text-white font-bold text-sm hover:opacity-90 shadow-lg ${catColor.shadow} transition flex items-center justify-center gap-2`}
                    >
                      <Icon name="RotateCcw" className="w-3.5 h-3.5" />
                      Tekrar Çöz
                    </button>
                  </div>
                </div>

                {/* Question Review */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-surface-500 uppercase tracking-wider px-1">Soru Detayları</h4>
                  {quizState.questions.map((q, idx) => {
                    const userAnswer = quizState.userAnswers[idx];
                    const isCorrect = userAnswer === q.correctOptionIndex;
                    const isUnanswered = userAnswer === null;
                    const questionTrackingId = getQuestionTrackingId(q, activeTopic.sub.id, idx);
                    const isFavorite = Boolean(favoriteQuestionsById[questionTrackingId]);

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
                          <button
                            onClick={() => void toggleFavoriteQuestion(q, idx)}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${
                              isFavorite
                                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-300'
                                : 'border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-700 text-surface-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                            }`}
                            title={isFavorite ? 'Favoriden cikar' : 'Favorilere ekle'}
                          >
                            <Icon name="Star" className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
                          </button>
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
  const isDashboardLayoutView = currentView === 'dashboard' || currentView === 'statistics';
  const showMobileBottomNav = (currentView === 'dashboard' || currentView === 'statistics' || currentView === 'admin') && !isMobileMenuOpen;
  return (
    <div className={`min-h-screen flex bg-gradient-to-br ${
      lightThemeVariant === 'clean'
        ? 'from-[#f5f7fb] via-[#fafcff] to-[#f1f4f9]'
        : 'from-[#edf3ff] via-[#f7faff] to-[#eef4ff]'
    } dark:from-[#050a1a] dark:via-[#0b1533] dark:to-[#040814] transition-colors duration-300 relative overflow-hidden`}>
      {/* Background mesh gradient */}
      <div className={`fixed inset-0 mesh-gradient pointer-events-none ${lightThemeVariant === 'clean' ? 'opacity-45' : 'opacity-80'} dark:opacity-90`}></div>

      {/* Mobile Header */}
      <div className="lg:hidden mobile-top-header fixed top-0 inset-x-0 z-50 px-3 h-[68px] flex justify-between items-center kpss-neon-mobile-header">
        <div className="flex items-center gap-3 font-black text-[17px] tracking-tight">
          <div className="bg-gradient-to-br from-brand-500 via-violet-600 to-purple-600 p-2 rounded-xl shadow-lg shadow-brand-500/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
            <Icon name="Brain" className="w-5 h-5 text-white relative z-10" />
          </div>
          <span className="text-slate-900 dark:text-white">
            KPSS Pro
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2 rounded-xl border transition-all active:scale-95 ${
              isDarkMode
                ? 'text-slate-300 hover:text-cyan-200 bg-slate-900/45 border-slate-500/35'
                : 'text-slate-700 hover:text-brand-600 bg-white/85 border-slate-200 shadow-sm'
            }`}
          >
            <Icon name={isDarkMode ? "Sun" : "Moon"} className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={`p-2 rounded-xl border transition-all active:scale-95 ${
              isDarkMode
                ? 'text-slate-200 bg-slate-900/45 border-slate-500/35'
                : 'text-slate-700 bg-white/85 border-slate-200 shadow-sm'
            }`}
          >
            <Icon name={isMobileMenuOpen ? "X" : "Menu"} className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-[86%] max-w-[320px] lg:w-[280px] kpss-neon-sidebar transform transition-all duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static
        flex flex-col
      `}>
        <div className="flex flex-col h-full p-4 pt-5 md:p-6 relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-7 pl-1">
            <div className="bg-gradient-to-br from-brand-500 via-violet-600 to-pink-500 p-2.5 rounded-2xl shadow-[0_0_22px_rgba(168,85,247,0.45)] relative overflow-hidden hover:scale-105 transition-transform duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent"></div>
              <Icon name="Brain" className="w-6 h-6 text-white relative z-10" />
            </div>
            <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              KPSS Pro
            </span>
          </div>

          {/* User Card */}
          <div className={`p-4 md:p-5 rounded-2xl kpss-neon-usercard mb-6 relative overflow-hidden group hover:scale-[1.02] transition-all duration-300 ${
            isDarkMode ? 'text-white' : 'text-slate-900'
          }`}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-[60px] -mr-10 -mt-10"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-3.5">
                <div className={`w-11 h-11 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ${
                  isDarkMode
                    ? 'bg-white/15 ring-white/20'
                    : 'bg-white/70 ring-slate-200/80 shadow-sm'
                }`}>
                  <Icon name="User" className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base truncate mb-0.5">{user.username}</div>
                  <div className={`text-xs font-medium ${isDarkMode ? 'text-white/70' : 'text-slate-600'}`}>
                    {user.role === 'admin' ? 'Yonetici' : 'Premium Uye'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
            <button
              onClick={() => { setCurrentView('dashboard'); setActiveCategory(null); setMobileDashboardTab('stats'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm border
                ${currentView === 'dashboard' && !activeCategory
                  ? (isDarkMode
                      ? 'bg-fuchsia-500/10 border-fuchsia-400/55 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,0.32)]'
                      : 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 shadow-[0_8px_18px_rgba(217,70,239,0.18)]')
                  : (isDarkMode
                      ? 'border-slate-500/20 text-slate-300 hover:border-slate-400/35 hover:bg-slate-900/35 hover:text-white'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-white/80 hover:text-slate-900')}
              `}
            >
              <Icon name="Home" className="w-5 h-5" />
              Ana Sayfa
            </button>

            <button
              onClick={() => {
                setCurrentView('statistics');
                setActiveCategory(null);
                setMobileDashboardTab('stats');
                setIsMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm border
                ${currentView === 'statistics'
                  ? (isDarkMode
                      ? 'bg-amber-500/10 border-amber-400/55 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.32)]'
                      : 'bg-amber-50 border-amber-200 text-amber-700 shadow-[0_8px_18px_rgba(251,191,36,0.16)]')
                  : (isDarkMode
                      ? 'border-slate-500/20 text-slate-300 hover:border-slate-400/35 hover:bg-slate-900/35 hover:text-white'
                      : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-white/80 hover:text-slate-900')}
              `}
            >
              <Icon name="BarChart3" className="w-5 h-5" />
              Istatistikler
            </button>

            <div className="pt-3 pb-1 px-4">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Dersler</span>
            </div>

            {categories.map(cat => {
              const color = getCatColor(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => { setCurrentView('dashboard'); setActiveCategory(cat); setMobileDashboardTab('categories'); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border
                    ${activeCategory?.id === cat.id && currentView === 'dashboard'
                      ? (isDarkMode
                          ? 'border-cyan-400/55 bg-cyan-500/10 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                          : 'border-cyan-200 bg-cyan-50 text-cyan-700 shadow-[0_8px_16px_rgba(34,211,238,0.14)]')
                      : (isDarkMode
                          ? 'border-slate-500/20 text-slate-300 hover:border-slate-400/35 hover:bg-slate-900/35 hover:text-slate-100'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-white/80 hover:text-slate-900')
                    }
                  `}
                >
                  <span className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${color.gradient}`}></div>
                    {cat.name}
                  </span>
                  <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${color.gradient} shadow-[0_0_10px_rgba(255,255,255,0.45)]`} />
                </button>
              );
            })}

            {user.role === 'admin' && (
              <>
                <div className="pt-4 pb-1 px-4">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Yonetim</span>
                </div>
                <button
                  onClick={() => { setCurrentView('admin'); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-semibold text-sm border
                    ${currentView === 'admin'
                      ? (isDarkMode
                          ? 'bg-fuchsia-500/10 border-fuchsia-400/55 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,0.32)]'
                          : 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 shadow-[0_8px_18px_rgba(217,70,239,0.18)]')
                      : (isDarkMode
                          ? 'border-slate-500/20 text-slate-300 hover:border-slate-400/35 hover:bg-slate-900/35 hover:text-white'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-white/80 hover:text-slate-900')}
                  `}
                >
                  <Icon name="Settings" className="w-5 h-5" />
                  Yonetici Paneli
                </button>
              </>
            )}
          </nav>

          {/* Bottom Actions */}
          <div className={`mt-auto pt-4 space-y-1 border-t ${isDarkMode ? 'border-slate-500/20' : 'border-slate-200/90'}`}>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors border border-transparent ${
                isDarkMode
                  ? 'text-slate-300 hover:bg-slate-900/35 hover:text-white hover:border-slate-400/35'
                  : 'text-slate-700 hover:bg-white/80 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Icon name={isDarkMode ? "Sun" : "Moon"} className="w-4 h-4" />
              {isDarkMode ? 'Acik Tema' : 'Koyu Tema'}
            </button>
            {!isDarkMode && (
              <div className="px-1 pt-1">
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Acik Tema Stili
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setLightThemeVariant('aura')}
                    className={`h-9 rounded-lg text-xs font-semibold border transition-colors ${
                      lightThemeVariant === 'aura'
                        ? 'bg-brand-50 text-brand-700 border-brand-200'
                        : 'bg-white/80 text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    Aura
                  </button>
                  <button
                    onClick={() => setLightThemeVariant('clean')}
                    className={`h-9 rounded-lg text-xs font-semibold border transition-colors ${
                      lightThemeVariant === 'clean'
                        ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                        : 'bg-white/80 text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    Sade
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors border border-transparent ${
                isDarkMode
                  ? 'text-red-300 hover:bg-red-500/10 hover:text-red-100 hover:border-red-400/45'
                  : 'text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
              }`}
            >
              <Icon name="LogOut" className="w-4 h-4" />
              Cikis Yap
            </button>
          </div>
        </div>
      </aside>

      {/* Main Panel */}
      <main className={`flex-1 min-w-0 lg:ml-0 pt-[calc(68px+max(env(safe-area-inset-top,0px),6px)+4px)] lg:pt-0 min-h-screen ${
        showMobileBottomNav ? 'pb-[88px]' : 'pb-0'
      } lg:pb-0 ${
        isDashboardLayoutView ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'
      }`}>
        <div className={`mx-auto ${
          isDashboardLayoutView
            ? 'max-w-[1320px] min-w-0 h-[calc(100vh-(68px+max(env(safe-area-inset-top,0px),6px)+4px))] lg:h-screen px-3 pb-2 pt-2 md:px-4 md:pb-3 md:pt-3 lg:px-5 lg:pb-4 lg:pt-5 flex flex-col overflow-hidden mobile-safe-x'
            : 'max-w-5xl p-5 md:p-8 lg:p-10'
        }`}>

          {/* ===== ADMIN VIEW ===== */}
          {currentView === 'admin' && (
            <div className="animate-fade-in space-y-6">
              <div className="mb-6">
                <h1 className="text-3xl font-extrabold text-surface-800 dark:text-white mb-1">Yonetici Paneli</h1>
                <p className="text-surface-400 text-sm">Icerik havuzunu yonet ve genislet.</p>
              </div>

              <div className="bg-white dark:bg-surface-800 p-4 rounded-2xl shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-surface-800 dark:text-white">SeenQuestions Kalici Yazim</h3>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                      Kapaliysa sadece yanlis soru havuzu ve konu ozet istatistikleri yazilir (write maliyeti dusurur).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPersistSeenQuestionsToFirestore((prev) => !prev)}
                    className={`inline-flex items-center justify-center px-3 py-2 rounded-lg text-xs font-bold border transition ${
                      persistSeenQuestionsToFirestore
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-surface-50 dark:bg-surface-900/40 text-surface-600 dark:text-surface-300 border-surface-200 dark:border-surface-700'
                    }`}
                  >
                    {persistSeenQuestionsToFirestore ? 'Acik' : 'Kapali'}
                  </button>
                </div>
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
                      <option value="">{adminSelectedCatId ? "Konu Seciniz" : "-"}</option>
                      {categories.find(c => c.id === adminSelectedCatId)?.subCategories.map(sub => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-6 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setIsTopicModalOpen(false);
                      setIsCategoryModalOpen(true);
                    }}
                    className="px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition font-bold text-xs"
                  >
                    Kategori Ekle
                  </button>
                  <button
                    onClick={() => {
                      setIsCategoryModalOpen(false);
                      setIsTopicModalOpen(true);
                    }}
                    disabled={!adminSelectedCatId}
                    className="px-4 py-2.5 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Konu Ekle
                  </button>
                </div>

                {adminSelectedCatId && (
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-900/40 p-3">
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                      Secili ders: <span className="font-bold text-surface-700 dark:text-surface-200">{adminSelectedCategory?.name || adminSelectedCatId}</span>
                    </p>
                  </div>
                )}

                {adminSelectedTopic && (
                  <div className="mb-6 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-900/40 p-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <p className="text-xs text-surface-500 dark:text-surface-400">
                          Secili konu: <span className="font-bold text-surface-700 dark:text-surface-200">{adminSelectedTopic.name}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { void handleMoveTopicOrder('up'); }}
                            disabled={!canMoveAdminTopicUp}
                            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 text-xs font-bold hover:bg-surface-100 dark:hover:bg-surface-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Konuyu bir sira yukari tasir"
                          >
                            Yukari
                          </button>
                          <button
                            onClick={() => { void handleMoveTopicOrder('down'); }}
                            disabled={!canMoveAdminTopicDown}
                            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 text-xs font-bold hover:bg-surface-100 dark:hover:bg-surface-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Konuyu bir sira asagi tasir"
                          >
                            Asagi
                          </button>
                          <button
                            onClick={handleSetTopicBloggerPage}
                            className="px-3 py-2 rounded-lg border border-sky-200 dark:border-sky-800/40 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 text-xs font-bold hover:bg-sky-100 dark:hover:bg-sky-900/30 transition"
                          >
                            Blogger Linki
                          </button>
                          <button
                            onClick={handleRenameTopic}
                            className="px-3 py-2 rounded-lg border border-brand-200 dark:border-brand-800/40 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 text-xs font-bold hover:bg-brand-100 dark:hover:bg-brand-900/30 transition"
                          >
                            Adi Duzenle
                          </button>
                          <button
                            onClick={() => { void handleDeleteTopic(); }}
                            className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/30 transition"
                          >
                            Konuyu Sil
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-surface-500 dark:text-surface-400 truncate">
                        Kaynak: {adminSelectedTopicBloggerPage ? adminSelectedTopicBloggerPage : 'Firestore / varsayilan kaynak'}
                      </p>
                      {isAdminTopicExternallySourced && (
                        <p className="text-[11px] text-sky-600 dark:text-sky-300">
                          Bu konu dis kaynaktan okunuyor. Duzenleme icin Blogger JSON kaynagini guncelleyin.
                        </p>
                      )}
                    </div>
                  </div>
                )}

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
                        const linkedQuestionIsExternal = Boolean(
                          linkedQuestion?.topicId && topicBloggerPages[linkedQuestion.topicId]
                        );

                        return (
                          <div key={report.id || `${report.questionId}_${String(report.createdAt)}`} className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 font-semibold">
                                {formatDateTime(report.createdAt)}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300 font-semibold">
                                {report.reporterUsername || "Kullanici"}
                              </span>
                              {report.topicId && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 font-semibold">
                                  Konu: {report.topicName || report.topicId}
                                </span>
                              )}
                              {report.questionId && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold font-mono">
                                  ID: {report.questionId}
                                </span>
                              )}
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
                                disabled={!linkedQuestion || linkedQuestionIsExternal}
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
                                disabled={!linkedQuestion?.id || linkedQuestionIsExternal}
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
                          onClick={() => setIsQuestionModalOpen(true)}
                          disabled={isAdminTopicExternallySourced}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition shadow-lg shadow-brand-600/20 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Icon name="Plus" className="w-3.5 h-3.5" />
                          Soru Ekle
                        </button>
                        <button
                          onClick={() => setIsBulkImportOpen(true)}
                          disabled={isAdminTopicExternallySourced}
                          className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition shadow-lg shadow-emerald-600/20 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Icon name="Layers" className="w-3.5 h-3.5" />
                          Toplu Aktar
                        </button>
                        {adminTopicQuestions.length > 0 && !isAdminTopicExternallySourced && (
                          <div className="relative">
                            <button
                              onClick={() => setIsAdminActionsOpen(prev => !prev)}
                              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition font-bold text-xs"
                            >
                              <Icon name="Settings" className="w-3.5 h-3.5" />
                              Toplu Islemler
                            </button>
                            {isAdminActionsOpen && (
                              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 shadow-xl z-20 overflow-hidden">
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
                                <button
                                  onClick={() => {
                                    setIsAdminActionsOpen(false);
                                    handleExportQuestionsByTopic();
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition"
                                >
                                  Bu Konuyu JSON Export
                                </button>
                                <button
                                  onClick={() => {
                                    setIsAdminActionsOpen(false);
                                    handleExportAllQuestionsByTopic();
                                  }}
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition"
                                >
                                  Konu Konu JSON Export
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
                                disabled={isAdminTopicExternallySourced}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Icon name="PenLine" className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteQuestion(q.id!)}
                                disabled={isAdminTopicExternallySourced}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

          {/* ===== STATISTICS VIEW ===== */}
          {currentView === 'statistics' && (
            <div className="animate-fade-in h-full w-full min-w-0 flex flex-col gap-2 md:gap-3 overflow-hidden">
              <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-[26px] md:text-[36px] font-black text-slate-800 dark:text-white tracking-tight">Istatistikler</h1>
                <span className="inline-flex items-center h-8 px-3 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-200 bg-white/60 dark:bg-slate-900/40 border border-white/70 dark:border-slate-600/30">
                  {statisticsScopeLabel}
                </span>
              </div>

              <section className="kpss-neon-panel rounded-2xl p-3 md:p-4 shrink-0">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 md:items-center mb-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-300">Genel Istatistik</p>
                    <p className="text-lg md:text-xl font-black text-slate-900 dark:text-white">{statisticsScopeLabel}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 w-full sm:w-[240px]" ref={statisticsScopeMenuRef}>
                      <button
                        type="button"
                        onClick={() => setIsStatisticsScopeMenuOpen((prev) => !prev)}
                        className={`h-10 w-full px-3 rounded-xl text-[12px] font-semibold outline-none flex items-center justify-between transition border ${
                          isDarkMode
                            ? 'border-slate-400/35 bg-slate-900/35 text-slate-100 hover:border-slate-300/55'
                            : 'border-slate-200 bg-white/90 text-slate-700 hover:border-slate-300'
                        }`}
                        aria-haspopup="listbox"
                        aria-expanded={isStatisticsScopeMenuOpen}
                        aria-label="Istatistik ders secimi"
                      >
                        <span className="truncate text-left">{statisticsScopeLabel}</span>
                        <Icon
                          name="ChevronRight"
                          className={`w-4 h-4 shrink-0 transition-transform ${isStatisticsScopeMenuOpen ? 'rotate-90' : ''}`}
                        />
                      </button>
                      {isStatisticsScopeMenuOpen && (
                        <div
                          className={`mt-2 rounded-xl border p-1 shadow-xl ${
                            isDarkMode
                              ? 'bg-slate-900/98 border-slate-500/35'
                              : 'bg-white border-slate-200'
                          }`}
                          role="listbox"
                          aria-label="Istatistik ders secenekleri"
                        >
                          <div className="max-h-56 overflow-y-auto custom-scrollbar">
                            {[
                              { id: 'all', name: 'Tum Dersler' },
                              ...categories.map((cat) => ({ id: cat.id, name: cat.name })),
                            ].map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setStatisticsScopeCategoryId(option.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-[12px] font-semibold transition flex items-center justify-between gap-2 ${
                                statisticsScopeCategoryId === option.id
                                  ? (isDarkMode
                                      ? 'bg-cyan-500/18 text-cyan-100'
                                      : 'bg-cyan-50 text-cyan-700')
                                  : (isDarkMode
                                      ? 'text-slate-100 hover:bg-slate-800/70'
                                      : 'text-slate-700 hover:bg-slate-50')
                              }`}
                              role="option"
                              aria-selected={statisticsScopeCategoryId === option.id}
                            >
                              <span className="truncate">{option.name}</span>
                              {statisticsScopeCategoryId === option.id && (
                                <Icon name="CircleCheck" className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-cyan-300' : 'text-cyan-600'}`} />
                              )}
                            </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 md:gap-2">
                  {[
                    { id: 'total_answered', label: 'Toplam Cevap', mobileLabel: 'Cevap', value: statisticsSummary.totalAnsweredCount, tone: 'kpss-neon-mini-blue' },
                    { id: 'unique_solved', label: 'Farkli Cozulen', mobileLabel: 'Farkli', value: statisticsSummary.uniqueSolvedCount, tone: 'kpss-neon-mini-fuchsia' },
                    { id: 'correct', label: 'Toplam Dogru', mobileLabel: 'Dogru', value: statisticsSummary.correctCount, tone: 'kpss-neon-mini-amber' },
                    { id: 'wrong', label: 'Toplam Yanlis', mobileLabel: 'Yanlis', value: statisticsSummary.wrongCount, tone: 'kpss-neon-mini-cyan' },
                  ].map((card) => (
                    <div key={card.id} className={`kpss-neon-mini-card statistics-summary-mini-card min-w-0 ${card.tone}`}>
                      <p className="kpss-neon-mini-label">
                        <span className="md:hidden">{card.mobileLabel}</span>
                        <span className="hidden md:inline">{card.label}</span>
                      </p>
                      <p className="kpss-neon-mini-value">{card.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300 font-medium">
                  <span className={`px-2 py-1 rounded-md ${
                    isDarkMode
                      ? 'bg-slate-900/30 border border-slate-400/25'
                      : 'bg-white border border-slate-200'
                  }`}>
                    Basari Orani: %{statisticsSummary.accuracyPercent}
                  </span>
                </div>
              </section>

              {isStatisticsTopicView && (
                <section className="kpss-neon-panel rounded-2xl p-3 md:p-4 flex-1 min-h-0 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h2 className="text-base md:text-lg font-extrabold text-slate-900 dark:text-white">
                      {statisticsScopeLabel} Konulari
                    </h2>
                  </div>

                  <div className="h-full overflow-y-auto custom-scrollbar pr-0.5 pb-24 md:pb-2">
                    {statisticsFilteredTopicRows.length > 0 ? (
                      <div className="space-y-2">
                        {statisticsFilteredTopicRows.map((row) => (
                          <div
                            key={row.topicId}
                            className={`rounded-2xl p-3 border ${
                              isDarkMode
                                ? 'border-slate-500/30 bg-slate-900/45'
                                : 'border-slate-200 bg-white/90'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.3)]">
                                  <Icon name="BookOpen" className="w-4 h-4 text-white" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-900 dark:text-white truncate">{row.topicName}</p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-300">{(allQuestions[row.topicId] || []).length} soru</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300">%{row.accuracyPercent}</p>
                                <p className="text-[10px] font-semibold text-cyan-600 dark:text-cyan-300">Konu</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 md:grid-cols-2 gap-1 md:gap-1.5 text-[10px] md:text-[11px]">
                              <div className="rounded-lg px-1.5 py-1 md:px-2 md:py-1.5 bg-slate-100/70 dark:bg-slate-800/60 min-w-0">
                                <p className="font-semibold text-slate-500 dark:text-slate-300 truncate">
                                  <span className="md:hidden">Cevap</span>
                                  <span className="hidden md:inline">Toplam Cevap</span>
                                </p>
                                <p className="font-black text-slate-900 dark:text-white leading-none mt-0.5">{row.totalAnsweredCount}</p>
                              </div>
                              <div className="rounded-lg px-1.5 py-1 md:px-2 md:py-1.5 bg-slate-100/70 dark:bg-slate-800/60 min-w-0">
                                <p className="font-semibold text-slate-500 dark:text-slate-300 truncate">
                                  <span className="md:hidden">Farkli</span>
                                  <span className="hidden md:inline">Farkli Soru</span>
                                </p>
                                <p className="font-black text-slate-900 dark:text-white leading-none mt-0.5">{row.uniqueSolvedCount}</p>
                              </div>
                              <div className="rounded-lg px-1.5 py-1 md:px-2 md:py-1.5 bg-emerald-50 dark:bg-emerald-900/20 min-w-0">
                                <p className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">Dogru</p>
                                <p className="font-black text-emerald-700 dark:text-emerald-300 leading-none mt-0.5">{row.correctCount}</p>
                              </div>
                              <div className="rounded-lg px-1.5 py-1 md:px-2 md:py-1.5 bg-red-50 dark:bg-red-900/20 min-w-0">
                                <p className="font-semibold text-red-700 dark:text-red-300 truncate">Yanlis</p>
                                <p className="font-black text-red-700 dark:text-red-300 leading-none mt-0.5">{row.wrongCount}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full min-h-[160px] flex items-center justify-center rounded-2xl border border-dashed border-slate-300/60 dark:border-slate-600/60 text-[13px] font-semibold text-slate-500 dark:text-slate-300">
                        Bu derste gosterilecek konu istatistigi yok.
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ===== DASHBOARD - HOME ===== */}
          {currentView === 'dashboard' && !activeCategory && (
            <div className="animate-fade-in h-full w-full min-w-0 flex flex-col gap-2 md:gap-3 overflow-hidden">
              <div className={`${mobileDashboardTab === 'categories' ? 'hidden lg:flex' : 'flex'} shrink-0 items-center justify-between gap-2`}>
                <h1 className="text-[26px] md:text-[36px] font-black text-slate-800 dark:text-white tracking-tight">Dashboard</h1>
                <span className="hidden sm:inline-flex items-center h-8 px-3 rounded-full text-[11px] font-semibold text-slate-600 dark:text-slate-200 bg-white/60 dark:bg-slate-900/40 border border-white/70 dark:border-slate-600/30">
                  {user.username}
                </span>
              </div>
              <div className="hidden">
                <div className="glass-card rounded-xl p-3 border border-sky-100 dark:border-sky-900/30 shadow-premium hover-lift">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-7 h-7 bg-gradient-to-br from-sky-500 to-sky-600 rounded-lg flex items-center justify-center shadow-lg shadow-sky-500/25">
                      <Icon name="Target" className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.seenCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Karsina Cikan</p>
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
                  <p className="text-xl font-black text-surface-800 dark:text-white leading-none mb-1">{overallProgressStats.wrongCount}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 font-bold uppercase tracking-wide">Yanlış (Aktif)</p>
                </div>
              </div>

              <div className={`${mobileDashboardTab === 'categories' ? 'hidden lg:grid' : 'grid'} w-full min-w-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-2.5 shrink-0 stagger-children`}>
                {[
                  { id: 'kategori', label: 'KATEGORI', value: categories.length, icon: 'Layers', tone: 'kpss-neon-stat-fuchsia' },
                  { id: 'konu', label: 'KONU', value: categories.reduce((sum, c) => sum + c.subCategories.length, 0), icon: 'BookOpen', tone: 'kpss-neon-stat-blue' },
                  { id: 'soru', label: 'SORU', value: getTotalQuestionCount(), icon: 'FileQuestion', tone: 'kpss-neon-stat-emerald' },
                  { id: 'karsina_cikan', label: 'KARSINA CIKAN', value: overallProgressStats.seenCount, icon: 'User', tone: 'kpss-neon-stat-cyan' },
                  { id: 'toplam_dogru', label: 'TOPLAM DOGRU', value: overallProgressStats.correctCount, icon: 'CircleCheck', tone: 'kpss-neon-stat-amber' },
                ].map((card) => (
                  <div
                    key={card.id}
                    className={`kpss-neon-stat-card w-full min-w-0 ${card.tone} animate-fade-in-scale ${card.id === 'toplam_dogru' ? 'col-span-2 sm:col-span-1' : ''}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="kpss-neon-stat-icon w-10 h-10 md:w-11 md:h-11 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0">
                        <Icon name={card.icon} className="w-4 h-4 text-slate-800 dark:text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] md:text-[11px] text-slate-600 dark:text-slate-200/80 font-bold uppercase tracking-[0.12em] leading-none">{card.label}</p>
                        <p className="text-[30px] sm:text-[34px] md:text-[36px] font-black text-slate-900 dark:text-white leading-none mt-0">{card.value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {mobileDashboardTab === 'stats' && (
                <div className="lg:hidden flex-1 min-h-0 overflow-hidden pr-0.5 pb-0.5">
                <section className="kpss-neon-panel h-full mb-0 rounded-2xl p-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Istatistiklerim</h2>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                      isDarkMode
                        ? 'bg-slate-900/35 border border-slate-400/35 text-slate-200'
                        : 'bg-white border border-slate-200 text-slate-600'
                    }`}>
                      Bugun
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="kpss-neon-mini-card kpss-neon-mini-fuchsia">
                      <p className="kpss-neon-mini-label">Farkli Cozulen</p>
                      <p className="kpss-neon-mini-value">{homeStats.uniqueSolvedCount}</p>
                    </div>
                    <div className="kpss-neon-mini-card kpss-neon-mini-blue">
                      <p className="kpss-neon-mini-label">Toplam Cevap</p>
                      <p className="kpss-neon-mini-value">{homeStats.totalAnsweredCount}</p>
                    </div>
                    <div className="kpss-neon-mini-card kpss-neon-mini-emerald">
                      <p className="kpss-neon-mini-label">Favori Soru</p>
                      <p className="kpss-neon-mini-value">{homeStats.filteredFavoriteCount}</p>
                    </div>
                    <div className="kpss-neon-mini-card kpss-neon-mini-amber">
                      <p className="kpss-neon-mini-label">Toplam Dogru</p>
                      <p className="kpss-neon-mini-value">{homeStats.progressStats.correctCount}</p>
                    </div>
                    <div className="kpss-neon-mini-card kpss-neon-mini-cyan">
                      <p className="kpss-neon-mini-label">Yanlis Cevap</p>
                      <p className="kpss-neon-mini-value">{homeStats.totalWrongAnswers}</p>
                    </div>
                    <div className="kpss-neon-mini-card kpss-neon-mini-red">
                      <p className="kpss-neon-mini-label">Basari Orani</p>
                      <p className="kpss-neon-mini-value">%{homeStats.accuracyPercent}</p>
                    </div>
                  </div>
                </section>
                </div>
              )}

              <section className="hidden lg:block shrink-0 kpss-neon-panel rounded-2xl p-4 md:p-5">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 mb-2.5 sm:items-center">
                  <h2 className="text-[34px] leading-none font-black text-slate-900 dark:text-white tracking-tight">Istatistiklerim</h2>
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-start sm:justify-end gap-2">
                    <span className="hidden md:inline text-[12px] font-semibold text-slate-500 dark:text-slate-300">Kapsam:</span>
                    <select
                      value={homeStatsCategoryFilter}
                      onChange={(e) => setHomeStatsCategoryFilter(e.target.value)}
                      className="kpss-neon-select h-10 min-w-0 flex-1 sm:flex-none sm:w-[220px] max-w-full px-3 rounded-xl text-[12px] font-semibold text-slate-700 dark:text-slate-100 outline-none"
                    >
                      <option value="all">Toplam (Tum Dersler)</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsHomeStatsExpanded((prev) => !prev)}
                      className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-[12px] font-semibold transition-colors ${
                        isDarkMode
                          ? 'border border-slate-400/35 bg-slate-900/30 text-slate-200 hover:border-slate-300/55'
                          : 'border border-slate-200 bg-white/90 text-slate-700 hover:border-slate-300'
                      }`}
                      aria-expanded={isHomeStatsExpanded}
                      aria-label={isHomeStatsExpanded ? 'Istatistikler bolumunu kapat' : 'Istatistikler bolumunu ac'}
                    >
                      <Icon
                        name="ChevronRight"
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${isHomeStatsExpanded ? 'rotate-90' : 'rotate-0'}`}
                      />
                      {isHomeStatsExpanded ? 'Kapat' : 'Ac'}
                    </button>
                    <span className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-[12px] font-semibold whitespace-nowrap ${
                      isDarkMode
                        ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-400/45'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isDarkMode ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-emerald-500'}`} />
                      Canli takip
                    </span>
                  </div>
                </div>
                {isHomeStatsExpanded && (
                  <>
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-3">
                      {homeStatsCategoryFilter === 'all' ? 'Gorunum: Tum Dersler' : `Gorunum: ${selectedHomeStatsCategory?.name || 'Secili Ders'}`}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
                      <div className="kpss-neon-mini-card kpss-neon-mini-fuchsia">
                        <p className="kpss-neon-mini-label">Farkli Cozulen</p>
                        <p className="kpss-neon-mini-value">{homeStats.uniqueSolvedCount}</p>
                      </div>
                      <div className="kpss-neon-mini-card kpss-neon-mini-blue">
                        <p className="kpss-neon-mini-label">Toplam Cevap</p>
                        <p className="kpss-neon-mini-value">{homeStats.totalAnsweredCount}</p>
                      </div>
                      <div className="kpss-neon-mini-card kpss-neon-mini-emerald">
                        <p className="kpss-neon-mini-label">Favori Soru</p>
                        <p className="kpss-neon-mini-value">{homeStats.filteredFavoriteCount}</p>
                      </div>
                      <div className="kpss-neon-mini-card kpss-neon-mini-amber">
                        <p className="kpss-neon-mini-label">Toplam Dogru</p>
                        <p className="kpss-neon-mini-value">{homeStats.progressStats.correctCount}</p>
                      </div>
                      <div className="kpss-neon-mini-card kpss-neon-mini-cyan">
                        <p className="kpss-neon-mini-label">Yanlis Cevap</p>
                        <p className="kpss-neon-mini-value">{homeStats.totalWrongAnswers}</p>
                      </div>
                      <div className="kpss-neon-mini-card kpss-neon-mini-red">
                        <p className="kpss-neon-mini-label">Basari Orani</p>
                        <p className="kpss-neon-mini-value">%{homeStats.accuracyPercent}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300 font-medium">
                      <span className={`px-1.5 py-0.5 rounded-md ${
                        isDarkMode
                          ? 'bg-slate-900/30 border border-slate-400/25'
                          : 'bg-white border border-slate-200'
                      }`}>
                        Yanlis cevap: {homeStats.totalWrongAnswers}
                      </span>
                    </div>
                  </>
                )}
              </section>

              {mobileDashboardTab === 'categories' && (
                <div className={`lg:hidden mb-0.5 flex items-center justify-between rounded-xl px-3 py-2.5 ${
                  isDarkMode
                    ? 'border border-slate-400/30 bg-slate-900/45'
                    : 'border border-slate-200 bg-white/85 shadow-sm'
                }`}>
                  <p className="text-[12px] font-extrabold text-slate-900 dark:text-white">Dersler</p>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300">{categories.length} ders</span>
                </div>
              )}

              <div className={`${mobileDashboardTab === 'categories' ? 'grid' : 'hidden'} lg:grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 auto-rows-max gap-2.5 md:gap-3 flex-1 min-h-0 content-start overflow-y-auto custom-scrollbar pr-0.5 md:pr-1.5 pb-1`}>
                {categories.map((cat, index) => {
                  const color = getCatColor(cat.id);

                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat)}
                      className={`group relative w-full min-h-[76px] rounded-2xl px-3 py-2.5 md:px-4 md:py-3 hover:-translate-y-0.5 transition-all duration-300 text-left overflow-hidden animate-fade-in-scale flex items-center justify-between cursor-pointer ${
                        isDarkMode
                          ? 'border border-slate-500/30 bg-slate-900/45 shadow-[0_10px_24px_rgba(2,6,23,0.42)]'
                          : 'border border-slate-200 bg-white/85 shadow-[0_10px_24px_rgba(15,23,42,0.1)]'
                      }`}
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      {/* Animated gradient background blob */}
                      <div className={`pointer-events-none absolute -right-14 -top-14 h-28 w-28 rounded-full bg-gradient-to-br ${color.gradient} opacity-[0.2] blur-2xl transition-all duration-500 group-hover:opacity-[0.35]`} />

                      <div className="relative z-10 flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color.gradient} flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.35)]`}>
                          <Icon name={cat.iconName} className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="text-[22px] leading-[1.15] font-black text-slate-900 dark:text-white truncate tracking-tight py-[1px]">{cat.name}</h3>
                      </div>

                      <div className={`relative z-10 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                        isDarkMode
                          ? 'bg-slate-800/70 border border-slate-500/35 text-slate-300 lg:group-hover:text-white lg:group-hover:border-slate-300/40'
                          : 'bg-slate-100 border border-slate-200 text-slate-500 lg:group-hover:text-slate-800 lg:group-hover:border-slate-300'
                      }`}>
                        <Icon name="ChevronRight" className="w-4 h-4 lg:transition-transform lg:duration-300 lg:group-hover:translate-x-0.5" />
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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 shrink-0">
                <button
                  onClick={() => { setActiveCategory(null); setMobileDashboardTab('categories'); }}
                  className="inline-flex items-center gap-2 text-surface-500 dark:text-surface-300 hover:text-brand-500 transition-colors font-semibold text-sm px-3 py-2 rounded-xl bg-white/80 dark:bg-surface-800/80 border border-surface-200/80 dark:border-surface-700/80"
                >
                  <Icon name="ArrowLeft" className="w-4 h-4" />
                  Tum Dersler
                </button>
                <div className="w-full sm:w-auto flex items-center gap-2">
                  <div className="relative flex-1 sm:w-64">
                    <Icon name="Search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      value={topicSearchTerm}
                      onChange={(e) => setTopicSearchTerm(e.target.value)}
                      placeholder="Konu ara..."
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-700 dark:text-surface-200 placeholder:text-surface-400 outline-none focus:border-brand-500"
                    />
                  </div>
                  <select
                    value={topicCardFilter}
                    onChange={(e) => setTopicCardFilter(e.target.value as 'all' | 'in_progress' | 'completed' | 'not_started')}
                    className="h-10 px-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-700 dark:text-surface-200 outline-none focus:border-brand-500"
                  >
                    <option value="all">Tum Konular</option>
                    <option value="in_progress">Devam Edenler</option>
                    <option value="completed">Tamamlananlar</option>
                    <option value="not_started">Baslanmayanlar</option>
                  </select>
                </div>
              </div>

              {(() => {
                const color = getCatColor(activeCategory.id);
                const topicCards = activeCategory.subCategories.map((sub) => {
                  const questionCount = allQuestions[sub.id]?.length || 0;
                  const hasExternalSource = Boolean(topicBloggerPages[sub.id]);
                  const topicProgress = getTopicProgress(sub.id);
                  const topicFavoriteCount = (favoriteQuestionIdsByTopic[sub.id] || []).length;
                  const topicSeenStats = seenQuestionStatsByTopic[sub.id] || [];
                  const uniqueSolvedCount = persistSeenQuestionsToFirestore
                    ? topicSeenStats.reduce((sum, stats) => (stats.answeredCount > 0 ? sum + 1 : sum), 0)
                    : Math.min(questionCount, topicProgress.seenCount);
                  const progressPercent = questionCount > 0 ? Math.min(100, Math.round((uniqueSolvedCount / questionCount) * 100)) : 0;
                  const attempted = topicProgress.correctCount + topicProgress.totalWrongAnswers;
                  const accuracy = attempted > 0 ? Math.round((topicProgress.correctCount / attempted) * 100) : 0;
                  const hasTopicProgressStats =
                    uniqueSolvedCount > 0 ||
                    topicProgress.wrongCount > 0;
                  const wrongOrFavoriteCount = new Set([
                    ...(wrongQuestionIdsByTopic[sub.id] || []),
                    ...(favoriteQuestionIdsByTopic[sub.id] || []),
                  ]).size;
                  const status: 'completed' | 'in_progress' | 'not_started' =
                    progressPercent >= 100 && questionCount > 0
                      ? 'completed'
                      : uniqueSolvedCount > 0
                        ? 'in_progress'
                        : 'not_started';
                  return {
                    sub,
                    questionCount,
                    topicProgress,
                    uniqueSolvedCount,
                    progressPercent,
                    accuracy,
                    topicFavoriteCount,
                    wrongOrFavoriteCount,
                    hasTopicProgressStats,
                    hasExternalSource,
                    status,
                  };
                });
                const normalizedSearch = topicSearchTerm.trim().toLocaleLowerCase('tr');
                const filteredTopicCards = topicCards.filter((topicCard) => {
                  if (normalizedSearch && !topicCard.sub.name.toLocaleLowerCase('tr').includes(normalizedSearch)) {
                    return false;
                  }
                  if (topicCardFilter === 'all') return true;
                  return topicCard.status === topicCardFilter;
                });
                const totalQuestionCount = topicCards.reduce((sum, topicCard) => sum + topicCard.questionCount, 0);
                const totalSolvedUniqueCount = topicCards.reduce((sum, topicCard) => sum + topicCard.uniqueSolvedCount, 0);
                const categoryProgressPercent = totalQuestionCount > 0 ? Math.min(100, Math.round((totalSolvedUniqueCount / totalQuestionCount) * 100)) : 0;

                return (
                  <>
                    <div className="mb-3 rounded-2xl border border-brand-200/50 dark:border-brand-900/40 bg-gradient-to-r from-surface-900 via-surface-800 to-surface-900 p-4 md:p-5 shadow-card shrink-0 overflow-hidden relative">
                      <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-brand-500/15 to-transparent pointer-events-none" />
                      <div className="relative z-10">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${color.gradient} flex items-center justify-center text-white shadow-lg`}>
                              <Icon name={activeCategory.iconName} className="w-4.5 h-4.5" />
                            </div>
                            <div className="min-w-0">
                              <h1 className="text-base md:text-lg font-black text-white truncate">{activeCategory.name}</h1>
                              <p className="text-[11px] md:text-xs text-surface-300">
                                {activeCategory.subCategories.length} konu - {totalQuestionCount} soru
                              </p>
                            </div>
                          </div>
                          <span className="px-2 py-1 rounded-lg text-[11px] font-bold bg-brand-500/20 text-brand-200 border border-brand-400/30 whitespace-nowrap">
                            %{categoryProgressPercent} tamamlandi
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-surface-700/90 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-brand-400 to-emerald-400 rounded-full transition-all duration-500" style={{ width: `${categoryProgressPercent}%` }} />
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 pb-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                        {filteredTopicCards.map(({ sub, questionCount, topicProgress, uniqueSolvedCount, progressPercent, accuracy, topicFavoriteCount, wrongOrFavoriteCount, hasTopicProgressStats, hasExternalSource, status }) => {
                          const statusLabel =
                            status === 'completed'
                              ? 'Tamamlandi'
                              : status === 'in_progress'
                                ? 'Devam Ediyor'
                                : 'Baslanmadi';
                          const statusClass =
                            status === 'completed'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/40'
                              : status === 'in_progress'
                                ? 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/40'
                                : 'bg-surface-100 text-surface-500 border-surface-200 dark:bg-surface-700/60 dark:text-surface-300 dark:border-surface-600';
                          const actionLabel =
                            status === 'completed'
                              ? 'Tekrar Coz'
                              : status === 'in_progress'
                                ? 'Devam Et'
                                : 'Basla';

                          return (
                            <article
                              key={sub.id}
                              className="group bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 md:p-5 hover:border-brand-300 dark:hover:border-brand-700/60 transition-all duration-200 shadow-card dark:shadow-card-dark flex flex-col"
                            >
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color.gradient} text-white flex items-center justify-center shadow-md`}>
                                  <Icon name={activeCategory.iconName} className="w-4.5 h-4.5" />
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {hasExternalSource && (
                                    <span className="px-2 py-1 rounded-md text-[10px] font-bold border whitespace-nowrap bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800/40">
                                      Blogger
                                    </span>
                                  )}
                                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold border whitespace-nowrap ${statusClass}`}>
                                    {statusLabel}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (!hasTopicProgressStats) return;
                                      handleResetSingleTopicProgressStats(sub.id, sub.name);
                                    }}
                                    className={`w-7 h-7 rounded-lg border flex items-center justify-center transition ${
                                      hasTopicProgressStats
                                        ? 'border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-900/20'
                                        : 'border-surface-200 text-surface-300 dark:border-surface-700 dark:text-surface-500 cursor-not-allowed'
                                    }`}
                                    title={hasTopicProgressStats ? 'Bu konunun istatistiklerini sifirla' : 'Bu konuda sifirlanacak istatistik yok'}
                                  >
                                    <Icon name="RotateCcw" className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              <h3 className="text-base font-extrabold text-surface-800 dark:text-white mb-2 line-clamp-2">{sub.name}</h3>

                              <div className="space-y-2 mb-4">
                                <div className="flex items-center justify-between text-[11px] text-surface-500 dark:text-surface-400">
                                  <span>{uniqueSolvedCount} / {questionCount} soru</span>
                                  <span className="font-bold">%{progressPercent}</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                                  <div className={`h-full bg-gradient-to-r ${color.gradient} rounded-full transition-all duration-500`} style={{ width: `${progressPercent}%` }} />
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-surface-500 dark:text-surface-400">Basari: <span className="font-bold text-surface-700 dark:text-surface-200">%{accuracy}</span></span>
                                  <span className="text-surface-500 dark:text-surface-400">Yanlis: <span className="font-bold text-red-600 dark:text-red-300">{topicProgress.wrongCount}</span></span>
                                  <span className="text-surface-500 dark:text-surface-400">Fav: <span className="font-bold text-amber-600 dark:text-amber-300">{topicFavoriteCount}</span></span>
                                </div>
                              </div>

                              <div className="mt-auto flex items-center gap-2">
                                <button
                                  onClick={() => openQuizSetup(activeCategory, sub)}
                                  className={`flex-1 h-9 rounded-lg bg-gradient-to-r ${color.gradient} text-white text-sm font-bold hover:opacity-90 transition flex items-center justify-center gap-1.5`}
                                >
                                  <Icon name="Play" className="w-3.5 h-3.5" />
                                  {actionLabel}
                                </button>
                                <button
                                  onClick={() => openQuizSetup(activeCategory, sub, 'wrong')}
                                  className="h-9 px-2 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-300 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                                  title="Yanlis sorulardan basla"
                                >
                                  Y
                                </button>
                                <button
                                  onClick={() => openQuizSetup(activeCategory, sub, 'favorite')}
                                  disabled={topicFavoriteCount === 0}
                                  className={`h-9 px-2 rounded-lg border text-xs font-bold transition ${
                                    topicFavoriteCount > 0
                                      ? 'border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                      : 'border-surface-200 dark:border-surface-700 text-surface-300 dark:text-surface-500 cursor-not-allowed'
                                  }`}
                                  title={topicFavoriteCount > 0 ? 'Favori sorulardan basla' : 'Bu konuda favori soru yok'}
                                >
                                  F
                                </button>
                                <button
                                  onClick={() => openQuizSetup(activeCategory, sub, 'wrong_favorite')}
                                  disabled={wrongOrFavoriteCount === 0}
                                  className={`h-9 px-2 rounded-lg border text-xs font-bold transition ${
                                    wrongOrFavoriteCount > 0
                                      ? 'border-violet-200 dark:border-violet-900/40 text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20'
                                      : 'border-surface-200 dark:border-surface-700 text-surface-300 dark:text-surface-500 cursor-not-allowed'
                                  }`}
                                  title={wrongOrFavoriteCount > 0 ? 'Yanlis + favori sorulardan basla' : 'Bu konuda yanlis veya favori soru yok'}
                                >
                                  Y+F
                                </button>
                              </div>
                            </article>
                          );
                        })}

                        {filteredTopicCards.length === 0 && (
                          <div className="col-span-full rounded-2xl border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center text-sm text-surface-500 dark:text-surface-400">
                            Filtreye uygun konu bulunamadi.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
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
                Konu istatistiklerini sifirla
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed mb-4">
                {`"${resetStatsTargetTopic?.name ?? 'Secili konu'}" konusu icin kayitli istatistikler silinecek. Bu islem geri alinamaz.`}
              </p>

              <div className="grid grid-cols-3 gap-2 mb-6 text-[11px]">
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
                  Konuyu Sifirla
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

            <div className="px-5 pt-4 pb-1 shrink-0">
              <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">
                Kaynak Etiketi <span className="normal-case text-red-500">*</span>
              </label>
              <input
                type="text"
                value={bulkSourceTagInput}
                onChange={(e) => setBulkSourceTagInput(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-xl bg-surface-50 dark:bg-surface-900 border outline-none focus:border-brand-500 dark:text-white text-sm ${
                  isBulkSourceTagValid
                    ? 'border-surface-200 dark:border-surface-700'
                    : 'border-red-300 dark:border-red-500'
                }`}
                placeholder="Etiket girin (bos gecmek icin sadece 1 adet bosluk)"
              />
              <p className={`mt-1 text-[11px] ${isBulkSourceTagValid ? 'text-surface-400' : 'text-red-500'}`}>
                Etiket zorunlu. Bos gecmek icin sadece 1 kez Space tusuna basin.
              </p>
            </div>

            {bulkStep === 'paste' ? (
              /* Paste Step */
              <div className="flex flex-col flex-1 overflow-hidden p-5 gap-4">
                <p className="text-xs text-surface-400">
                  Duz metin veya JSON formati desteklenir. JSON icin alanlar: <span className="font-mono">questionId</span>, <span className="font-mono">questionText</span>, <span className="font-mono">contentItems</span>, <span className="font-mono">options</span>, <span className="font-mono">answer</span>.
                </p>
                <textarea
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    if (bulkParseErrors.length > 0) setBulkParseErrors([]);
                  }}
                  className="flex-1 min-h-[250px] w-full p-4 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm font-mono resize-none"
                  placeholder={"Sorulari buraya yapistirin...\n\nDuz metin ornegi:\n1. Asagidakilerden hangisi...?\nA) Secenek 1\nB) Secenek 2\nC) Secenek 3\nD) Secenek 4\nE) Secenek 5\n\n1. COZUM: Aciklama... CEVAP: A\n\nJSON ornegi:\n[{\"questionId\":\"123\",\"questionText\":\"...\",\"contentItems\":[\"...\"],\"options\":[\"...\"],\"answer\":\"A\"}]"}
                />
                <button
                  onClick={handleBulkParse}
                  disabled={!bulkText.trim() || !isBulkSourceTagValid}
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
                    disabled={bulkParsed.length === 0 || !adminSelectedTopicId || !isBulkSourceTagValid}
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

      {/* Dashboard Rules Help */}
      {currentView === 'dashboard' && (
        <button
          onClick={() => setIsRulesHelpModalOpen(true)}
          className="fixed right-3 md:right-4 lg:right-6 bottom-20 lg:bottom-6 z-[56] w-11 h-11 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 transition flex items-center justify-center"
          title="Puanlama ve sayac kurallarini goster"
          aria-label="Puanlama ve sayac kurallarini goster"
        >
          <Icon name="Info" className="w-5 h-5" />
        </button>
      )}

      {isRulesHelpModalOpen && (
        <div className="fixed inset-0 z-[58] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4 modal-backdrop">
          <div className="w-full max-w-2xl bg-white dark:bg-surface-800 rounded-2xl shadow-2xl border border-surface-100 dark:border-surface-700 overflow-hidden modal-content">
            <div className="flex items-center justify-between p-4 border-b border-surface-100 dark:border-surface-700">
              <div>
                <h3 className="text-base md:text-lg font-extrabold text-surface-800 dark:text-white">Puanlama ve Sayac Kurallari</h3>
                <p className="text-xs text-surface-400">Istatistiklerin nasil hesaplandigi</p>
              </div>
              <button
                onClick={() => setIsRulesHelpModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600 transition"
                aria-label="Kapat"
              >
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>
            <div className="p-4 md:p-5 space-y-3 md:space-y-4 text-[12px] text-surface-600 dark:text-surface-300 max-h-[72vh] overflow-y-auto custom-scrollbar">
              <div className="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-surface-50/80 dark:bg-surface-900/50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">Istatistik formulleri</p>
                <ul className="space-y-1.5">
                  <li><span className="font-bold text-surface-700 dark:text-surface-200">Basari Orani</span> = Toplam Dogru / (Toplam Dogru + Yanlis Deneme) x 100.</li>
                  <li><span className="font-bold text-surface-700 dark:text-surface-200">Farkli Cozulen</span> = En az bir kez cevapladigin tekil soru sayisi. Ayni soruyu tekrar cozersen bu sayi artmaz.</li>
                  <li><span className="font-bold text-surface-700 dark:text-surface-200">Toplam Cevap</span> = Tum cevaplama denemelerin. Ayni soruyu her cevaplayisinda bu sayi artar.</li>
                  <li><span className="font-bold text-surface-700 dark:text-surface-200">Karsina Cikan</span> = Testte gosterilen toplam soru adedi. Tekrar gelen sorular dahildir.</li>
                  <li><span className="font-bold text-surface-700 dark:text-surface-200">Yanlis Cevap</span> = Toplam yanlis cevap denemelerin.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-surface-200/80 dark:border-surface-700/80 bg-surface-50/80 dark:bg-surface-900/50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-surface-500 dark:text-surface-400 mb-1.5">Yanlis havuzu</p>
                <ul className="space-y-1.5">
                  <li>Soru yanlis cevaplanirsa <span className="font-bold text-red-600 dark:text-red-300">Yanlislarim</span> havuzuna eklenir.</li>
                  <li>Ayni soru art arda dogru yapildikca toparlanma sayaci artar.</li>
                  <li>Toparlanma sayaci <span className="font-bold text-surface-800 dark:text-white">3</span> olunca soru havuzdan cikar (cozulmus olur).</li>
                  <li>Soru tekrar yanlis olursa sayac sifirlanir ve soru yeniden aktif olur.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      {showMobileBottomNav && (
        <div className="lg:hidden fixed bottom-2 left-2 right-2 rounded-2xl bg-slate-900/85 backdrop-blur-2xl border border-slate-400/30 shadow-[0_10px_26px_rgba(2,6,23,0.6)] z-50 mobile-safe-bottom">
          <div className="flex items-center justify-around h-14 px-1">
            <button
              onClick={() => { setCurrentView('dashboard'); setActiveCategory(null); setMobileDashboardTab('stats'); }}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all ${
                currentView === 'dashboard' && !activeCategory && mobileDashboardTab === 'stats'
                  ? 'bg-fuchsia-500/15 border border-fuchsia-400/45 text-fuchsia-100 shadow-[0_0_14px_rgba(217,70,239,0.32)]'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Icon name="Home" className="w-5 h-5" />
              <span className="mobile-nav-label text-[10px] font-semibold">Ana Sayfa</span>
            </button>
            <button
              onClick={() => { setCurrentView('statistics'); setActiveCategory(null); }}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all ${
                currentView === 'statistics'
                  ? 'bg-amber-500/15 border border-amber-400/45 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.32)]'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Icon name="BarChart3" className="w-5 h-5" />
              <span className="mobile-nav-label text-[10px] font-semibold">Istatistik</span>
            </button>
            <button
              onClick={() => { setCurrentView('dashboard'); setActiveCategory(null); setMobileDashboardTab('categories'); }}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all ${
                currentView === 'dashboard' && (mobileDashboardTab === 'categories' || Boolean(activeCategory))
                  ? 'bg-cyan-500/15 border border-cyan-400/45 text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.32)]'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Icon name="GraduationCap" className="w-5 h-5" />
              <span className="mobile-nav-label text-[10px] font-semibold">Dersler</span>
            </button>
            {user.role === 'admin' && (
              <button
                onClick={() => setCurrentView('admin')}
                className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl transition-all ${
                  currentView === 'admin'
                    ? 'bg-fuchsia-500/15 border border-fuchsia-400/45 text-fuchsia-100 shadow-[0_0_14px_rgba(217,70,239,0.32)]'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Icon name="Settings" className="w-5 h-5" />
                <span className="mobile-nav-label text-[10px] font-semibold">Yonetim</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
            >
              <Icon name="LogOut" className="w-5 h-5" />
              <span className="mobile-nav-label text-[10px] font-semibold">Cikis</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


