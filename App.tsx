import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_CATEGORIES, INITIAL_QUESTIONS } from './constants';
import { Category, User, SubCategory, Question, QuizState } from './types';
import { Icon } from './components/Icon';
import { parseBulkQuestions } from './services/questionParser';

type ViewState = 'dashboard' | 'quiz-setup' | 'quiz' | 'admin';

// Category color map for visual distinction
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

export default function App() {
  // -- State --
  const [user, setUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<ViewState>('dashboard');

  // Login State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [activeTopic, setActiveTopic] = useState<{ cat: Category, sub: SubCategory } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Quiz Configuration State
  const [quizConfig, setQuizConfig] = useState({
    questionCount: 10,
    durationSeconds: 300,
  });

  // Questions State
  const [allQuestions, setAllQuestions] = useState<Record<string, Question[]>>(INITIAL_QUESTIONS);

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
    questionRoot: '',
    optionsText: '',
    correctOption: 0,
    explanation: ''
  });

  // Bulk Import State
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkParsed, setBulkParsed] = useState<Question[]>([]);
  const [bulkStep, setBulkStep] = useState<'paste' | 'preview'>('paste');

  // Add Question Form State
  const [questionForm, setQuestionForm] = useState({
    imageUrl: '',
    contextText: '',
    itemsText: '',
    questionRoot: '',
    optionsText: '',
    correctOption: 0,
    explanation: ''
  });

  // Quiz Font Size: 0=compact, 1=normal, 2=large
  const [quizSize, setQuizSize] = useState<0 | 1 | 2>(0);

  // Mobile Menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Timer Ref
  const timerRef = useRef<number | null>(null);
  // Auto-advance ref
  const autoAdvanceRef = useRef<number | null>(null);

  // -- Effects --
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDarkMode(true);
    }
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

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

  // -- Handlers --

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Kullanici adi ve sifre giriniz.');
      return;
    }

    if (loginUsername === 'admin' && loginPassword === 'admin') {
      setUser({ username: 'Yonetici', role: 'admin' });
    } else {
      setUser({ username: loginUsername, role: 'user' });
    }
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView('dashboard');
    setActiveCategory(null);
    setActiveTopic(null);
    setLoginUsername('');
    setLoginPassword('');
    setLoginError('');
    resetQuiz();
  };

  const resetQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
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

  const openQuizSetup = (category: Category, sub: SubCategory) => {
    setActiveTopic({ cat: category, sub: sub });
    const availableCount = allQuestions[sub.id]?.length || 0;
    setQuizConfig({
      questionCount: availableCount > 0 ? Math.min(10, availableCount) : 0,
      durationSeconds: 120,
    });
    setCurrentView('quiz-setup');
  };

  const handleStartQuiz = () => {
    if (!activeTopic) return;

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

    const topicQuestions = allQuestions[activeTopic.sub.id] || [];
    const selectedQuestions = topicQuestions.slice(0, quizConfig.questionCount);

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

  const handleFinishQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
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

  // --- Admin Handlers ---
  const handleDeleteQuestion = (questionId: string, topicId: string) => {
    if (!user || user.role !== 'admin') return;
    if (!window.confirm("Bu soruyu kalici olarak silmek istediginize emin misiniz?")) return;
    const updatedTopicQuestions = (allQuestions[topicId] || []).filter(q => q.id !== questionId);
    setAllQuestions(prev => ({ ...prev, [topicId]: updatedTopicQuestions }));
  };

  const handleBulkDeleteQuestions = () => {
    if (!adminSelectedTopicId) return;
    const count = allQuestions[adminSelectedTopicId]?.length || 0;
    if (count === 0) return;
    if (!window.confirm(`Bu konudaki ${count} sorunun tamamini silmek istediginize emin misiniz?`)) return;
    setAllQuestions(prev => ({ ...prev, [adminSelectedTopicId]: [] }));
  };

  const handleStartEditQuestion = (q: Question, idx: number) => {
    setEditingQuestion({ index: idx, question: q });
    setEditForm({
      imageUrl: q.imageUrl || '',
      contextText: q.contextText || '',
      itemsText: q.contentItems ? q.contentItems.join('\n') : '',
      questionRoot: q.questionText,
      optionsText: q.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n'),
      correctOption: q.correctOptionIndex,
      explanation: q.explanation,
    });
  };

  const handleSaveEditQuestion = () => {
    if (!editingQuestion || !adminSelectedTopicId) return;
    const options = parseOptions(editForm.optionsText);
    const contentItems = parseItems(editForm.itemsText);

    const updatedQuestion: Question = {
      ...editingQuestion.question,
      imageUrl: editForm.imageUrl.trim() || undefined,
      contextText: editForm.contextText.trim() || undefined,
      contentItems: contentItems.length > 0 ? contentItems : undefined,
      questionText: editForm.questionRoot,
      options,
      correctOptionIndex: editForm.correctOption,
      explanation: editForm.explanation,
    };

    setAllQuestions(prev => {
      const topicQs = [...(prev[adminSelectedTopicId] || [])];
      topicQs[editingQuestion.index] = updatedQuestion;
      return { ...prev, [adminSelectedTopicId]: topicQs };
    });
    setEditingQuestion(null);
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

  const handleSaveQuestion = () => {
    let topicId = '';
    if (currentView === 'admin' && adminSelectedTopicId) topicId = adminSelectedTopicId;
    else return;

    if (!topicId) return;

    const options = parseOptions(questionForm.optionsText);
    const contentItems = parseItems(questionForm.itemsText);

    const newQuestion: Question = {
      id: Date.now().toString(),
      imageUrl: questionForm.imageUrl.trim() || undefined,
      contextText: questionForm.contextText.trim() || undefined,
      contentItems: contentItems.length > 0 ? contentItems : undefined,
      questionText: questionForm.questionRoot,
      options: options,
      correctOptionIndex: questionForm.correctOption,
      explanation: questionForm.explanation
    };

    setAllQuestions(prev => ({
      ...prev,
      [topicId]: [...(prev[topicId] || []), newQuestion]
    }));

    setQuestionForm({ imageUrl: '', contextText: '', itemsText: '', questionRoot: '', optionsText: '', correctOption: 0, explanation: '' });
    setIsQuestionModalOpen(false);
  };

  // Bulk import handlers
  const handleBulkParse = () => {
    if (!bulkText.trim()) return;
    const parsed = parseBulkQuestions(bulkText);
    setBulkParsed(parsed);
    setBulkStep('preview');
  };

  const handleBulkSave = () => {
    if (!adminSelectedTopicId || bulkParsed.length === 0) return;
    setAllQuestions(prev => ({
      ...prev,
      [adminSelectedTopicId]: [...(prev[adminSelectedTopicId] || []), ...bulkParsed]
    }));
    setBulkText('');
    setBulkParsed([]);
    setBulkStep('paste');
    setIsBulkImportOpen(false);
  };

  const handleBulkClose = () => {
    setIsBulkImportOpen(false);
    setBulkText('');
    setBulkParsed([]);
    setBulkStep('paste');
  };

  const handleRemoveBulkQuestion = (index: number) => {
    setBulkParsed(prev => prev.filter((_, i) => i !== index));
  };

  const calculateScore = () => {
    if (!quizState.questions || quizState.questions.length === 0) return 0;
    let correct = 0;
    quizState.questions.forEach((q, idx) => {
        if (quizState.userAnswers[idx] === q.correctOptionIndex) correct++;
    });
    return correct;
  };

  const getTotalQuestionCount = () => {
    return Object.values(allQuestions).reduce((sum, qs) => sum + qs.length, 0);
  };

  // Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Gunaydin';
    if (hour < 18) return 'Iyi gunler';
    return 'Iyi aksamlar';
  };


  // ===== RENDER VIEWS =====

  // 1. LOGIN VIEW
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-brand-600/15 rounded-full blur-[100px] animate-pulse-soft"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-violet-600/15 rounded-full blur-[100px] animate-pulse-soft" style={{ animationDelay: '1s' }}></div>
          <div className="absolute top-[40%] left-[50%] w-[30%] h-[30%] bg-emerald-600/10 rounded-full blur-[80px] animate-pulse-soft" style={{ animationDelay: '2s' }}></div>
        </div>

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

        <div className="w-full max-w-md relative z-10 px-5">
          <div className="animate-fade-in">
            {/* Logo & Title */}
            <div className="text-center mb-10">
              <div className="inline-flex p-4 bg-gradient-to-br from-brand-500 to-violet-600 rounded-2xl shadow-lg shadow-brand-500/25 mb-6 animate-float">
                <Icon name="Brain" className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-black text-white mb-2 tracking-tight">KPSS Pro</h1>
              <p className="text-surface-400 text-base">Akilli hazirlik ile basariya bir adim daha yakin.</p>
            </div>

            {/* Login Card */}
            <div className="bg-white/[0.06] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-7 shadow-2xl">
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2 ml-1">Kullanici Adi</label>
                  <div className="relative group">
                    <input
                      type="text"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.06] border border-white/[0.08] rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-white placeholder-surface-500 outline-none transition-all text-sm"
                      placeholder="Kullanici adinizi giriniz"
                    />
                    <Icon name="User" className="w-4.5 h-4.5 text-surface-500 absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors group-focus-within:text-brand-400" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2 ml-1">Sifre</label>
                  <div className="relative group">
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.06] border border-white/[0.08] rounded-xl focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-white placeholder-surface-500 outline-none transition-all text-sm"
                      placeholder="Sifrenizi giriniz"
                    />
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-500 transition-colors group-focus-within:text-brand-400">
                       <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                  </div>
                </div>

                {loginError && (
                  <div className="p-3.5 bg-red-500/10 border border-red-500/15 rounded-xl text-red-300 text-sm flex items-center gap-2.5">
                     <Icon name="XCircle" className="w-4 h-4 text-red-400 flex-shrink-0" />
                     {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3.5 px-6 bg-gradient-to-r from-brand-600 to-violet-600 text-white font-bold rounded-xl hover:shadow-lg hover:shadow-brand-600/25 transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 mt-2"
                >
                  Giris Yap
                  <Icon name="ChevronRight" className="w-4 h-4" />
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-white/[0.06] text-center">
                <p className="text-xs text-surface-500">
                  Demo giris: <code className="text-surface-300 bg-white/[0.06] px-1.5 py-0.5 rounded mx-0.5 font-mono text-xs">admin</code> / <code className="text-surface-300 bg-white/[0.06] px-1.5 py-0.5 rounded mx-0.5 font-mono text-xs">admin</code>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. QUIZ SETUP VIEW
  if (currentView === 'quiz-setup' && activeTopic) {
    const maxQuestions = allQuestions[activeTopic.sub.id]?.length || 0;
    const catColor = getCatColor(activeTopic.cat.id);

    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 flex items-center justify-center p-4">
        <div className="w-full max-w-lg animate-fade-in-scale">
          {/* Back Button */}
          <button
            onClick={() => { setActiveTopic(null); setCurrentView('dashboard'); }}
            className="flex items-center gap-2 text-surface-400 hover:text-surface-700 dark:hover:text-white transition-colors mb-6 font-medium text-sm"
          >
            <Icon name="ArrowLeft" className="w-4 h-4" />
            Geri Don
          </button>

          <div className="bg-white dark:bg-surface-800 rounded-3xl shadow-card dark:shadow-card-dark p-7 md:p-9 border border-surface-100 dark:border-surface-700">
            {/* Header */}
            <div className="text-center mb-8">
              <div className={`w-16 h-16 ${catColor.bgLight} ${catColor.bgDark} rounded-2xl mx-auto flex items-center justify-center mb-5 ${catColor.text} ${catColor.textDark}`}>
                <Icon name="Settings" className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-extrabold text-surface-800 dark:text-white mb-1">Sinavi Ozellestir</h2>
              <p className="text-surface-400 text-sm">{activeTopic.cat.name} &middot; {activeTopic.sub.name}</p>
            </div>

            {/* Settings */}
            <div className="space-y-6">
              {/* Question Count */}
              <div className="bg-surface-50 dark:bg-surface-900/50 p-5 rounded-2xl border border-surface-100 dark:border-surface-700/50">
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
                    min="1"
                    max={maxQuestions}
                    value={quizConfig.questionCount}
                    onChange={(e) => setQuizConfig({...quizConfig, questionCount: parseInt(e.target.value)})}
                    disabled={maxQuestions === 0}
                    className="w-full h-2 bg-surface-200 dark:bg-surface-700 rounded-lg cursor-pointer"
                  />
                  <div className="w-14 h-10 flex items-center justify-center bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl font-extrabold text-lg text-surface-800 dark:text-white flex-shrink-0">
                    {quizConfig.questionCount}
                  </div>
                </div>
                {maxQuestions === 0 && <p className="text-red-500 text-xs mt-2 font-medium">Bu konuda henuz soru bulunmuyor.</p>}
              </div>

              {/* Duration */}
              <div className="bg-surface-50 dark:bg-surface-900/50 p-5 rounded-2xl border border-surface-100 dark:border-surface-700/50">
                <label className="block font-bold text-surface-700 dark:text-surface-200 text-sm mb-3 flex items-center gap-2">
                  <Icon name="Timer" className="w-4 h-4 text-surface-400" />
                  Sure
                </label>
                <div className="flex items-center gap-2 overflow-hidden">
                  <button
                    onClick={() => setQuizConfig(prev => ({...prev, durationSeconds: Math.max(30, prev.durationSeconds - 30)}))}
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
            <div className="flex gap-3 mt-8">
              <button
                onClick={() => { setActiveTopic(null); setCurrentView('dashboard'); }}
                className="flex-1 py-3.5 rounded-xl font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700/50 transition"
              >
                Vazgec
              </button>
              <button
                onClick={handleStartQuiz}
                disabled={maxQuestions === 0 || quizConfig.questionCount === 0}
                className={`flex-[2] py-3.5 rounded-xl bg-gradient-to-r ${catColor.gradient} text-white font-bold text-sm hover:opacity-90 shadow-lg ${catColor.shadow} transition transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2`}
              >
                <Icon name="Play" className="w-4 h-4" />
                Sinavi Baslat
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

    return (
      <div className="h-screen overflow-hidden bg-surface-50 dark:bg-surface-900 flex flex-col transition-colors duration-300">

        {/* Top Progress Bar */}
        <div className="w-full h-1 bg-surface-200 dark:bg-surface-800 flex-shrink-0">
          <div
            className={`h-full bg-gradient-to-r ${catColor.gradient} transition-all duration-500 ease-out`}
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>

        {/* Header */}
        <header className={`flex-shrink-0 bg-white/80 dark:bg-surface-800/80 backdrop-blur-xl border-b border-surface-200 dark:border-surface-700 flex items-center justify-between px-4 md:px-8 z-40 ${
          quizSize === 0 ? 'h-12' : 'h-16'
        }`}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if(window.confirm("Sinavdan cikmak istediginize emin misiniz?")) {
                  setActiveTopic(null); resetQuiz(); setCurrentView('dashboard');
                }
              }}
              className={`flex items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors ${
                quizSize === 0 ? 'w-8 h-8' : 'w-9 h-9'
              }`}
            >
              <Icon name="X" className="w-4 h-4" />
            </button>

            <div className="hidden sm:block">
              <h2 className={`font-bold text-surface-800 dark:text-white leading-tight ${quizSize === 0 ? 'text-xs' : 'text-sm'}`}>{activeTopic.sub.name}</h2>
              <span className="text-xs text-surface-400">{activeTopic.cat.name}</span>
            </div>
          </div>

          {/* Question Counter */}
          {!quizState.showResults && quizState.questions.length > 0 && (
            <div className="text-xs font-bold text-surface-400">
              <span className={`${catColor.text} ${catColor.textDark}`}>{quizState.currentQuestionIndex + 1}</span>
              <span className="mx-1">/</span>
              <span>{quizState.questions.length}</span>
            </div>
          )}

          {/* Timer + Size Control */}
          {!quizState.showResults && (
            <div className="flex items-center gap-2">
              {/* Size Toggle */}
              <button
                onClick={() => setQuizSize(prev => ((prev + 1) % 3) as 0 | 1 | 2)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors border border-surface-200 dark:border-surface-600"
                title="Yazi boyutunu degistir"
              >
                <span className={`font-bold transition-all ${quizSize === 0 ? 'text-[10px]' : quizSize === 1 ? 'text-xs' : 'text-sm'}`}>A</span>
                <span className={`font-bold transition-all ${quizSize === 0 ? 'text-xs' : quizSize === 1 ? 'text-sm' : 'text-base'}`}>A</span>
              </button>

              {/* Timer */}
              <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-mono font-bold border
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
              <div className={`max-w-2xl mx-auto pb-36 ${
                quizSize === 0 ? 'px-3 py-3' : quizSize === 1 ? 'px-4 py-5 md:px-6' : 'px-4 py-6 md:px-6'
              }`}>

                {/* Question Card */}
                <div className={`bg-white dark:bg-surface-800 rounded-2xl shadow-card dark:shadow-card-dark border border-surface-100 dark:border-surface-700 animate-fade-in ${
                  quizSize === 0 ? 'p-3.5 mb-3 rounded-xl' : quizSize === 1 ? 'p-5 md:p-7 mb-4' : 'p-6 md:p-8 mb-5'
                }`}>
                  <div className={`flex justify-between items-center ${quizSize === 0 ? 'mb-2.5' : quizSize === 1 ? 'mb-4' : 'mb-5'}`}>
                    <span className={`${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark} font-black rounded-md uppercase tracking-wider ${
                      quizSize === 0 ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'
                    }`}>
                      Soru {quizState.currentQuestionIndex + 1}
                    </span>
                  </div>

                  {currentQuestion.imageUrl && (
                    <div className={`rounded-lg overflow-hidden border border-surface-100 dark:border-surface-700 ${
                      quizSize === 0 ? 'mb-3 max-h-40' : quizSize === 1 ? 'mb-5 max-h-60' : 'mb-6 max-h-72'
                    }`}>
                      <img src={currentQuestion.imageUrl} alt="Soru" className="w-full h-auto object-contain bg-surface-50 dark:bg-surface-900" style={{ maxHeight: quizSize === 0 ? '160px' : quizSize === 1 ? '240px' : '288px' }} />
                    </div>
                  )}

                  {currentQuestion.contextText && (
                    <p className={`text-surface-600 dark:text-surface-300 leading-relaxed ${
                      quizSize === 0 ? 'text-xs mb-2' : quizSize === 1 ? 'text-sm mb-3' : 'text-sm mb-4'
                    }`}>
                      {currentQuestion.contextText}
                    </p>
                  )}

                  {currentQuestion.contentItems && (
                    <div className={`bg-surface-50 dark:bg-surface-900/50 rounded-lg border border-surface-100 dark:border-surface-700/50 ${
                      quizSize === 0 ? 'mb-3 p-2.5' : quizSize === 1 ? 'mb-5 p-3.5' : 'mb-6 p-4'
                    }`}>
                      {currentQuestion.contentItems.map((item, i) => (
                        <div key={i} className={`flex gap-2 text-surface-700 dark:text-surface-300 font-medium last:mb-0 ${
                          quizSize === 0 ? 'text-xs mb-1' : quizSize === 1 ? 'text-sm mb-1.5' : 'text-sm mb-1.5 gap-3'
                        }`}>
                          <span className={`flex items-center justify-center bg-surface-200 dark:bg-surface-700 rounded-full font-bold text-surface-500 dark:text-surface-400 mt-0.5 flex-shrink-0 ${
                            quizSize === 0 ? 'w-4 h-4 text-[8px]' : 'w-5 h-5 text-[10px]'
                          }`}>{['I','II','III','IV','V','VI','VII','VIII','IX','X'][i] || i+1}</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 className={`font-bold text-surface-800 dark:text-white leading-relaxed ${
                    quizSize === 0 ? 'text-[13px] leading-snug' : quizSize === 1 ? 'text-base md:text-lg' : 'text-lg md:text-xl'
                  }`}>
                    {currentQuestion.questionText}
                  </h3>
                </div>

                {/* Options */}
                <div key={quizState.currentQuestionIndex} className={`stagger-children ${quizSize === 0 ? 'space-y-1.5' : quizSize === 1 ? 'space-y-2' : 'space-y-2.5'}`}>
                  {currentQuestion.options.map((option, idx) => {
                    const isSelected = quizState.userAnswers[quizState.currentQuestionIndex] === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => handleSelectOption(idx)}
                        className={`w-full text-left border-2 transition-all duration-200 flex items-center group animate-fade-in ${
                          quizSize === 0 ? 'p-2.5 rounded-lg gap-2.5' : quizSize === 1 ? 'p-3.5 md:p-4 rounded-xl gap-3' : 'p-4 md:p-5 rounded-xl gap-4'
                        } ${isSelected
                            ? `bg-gradient-to-r ${catColor.gradient} border-transparent shadow-lg ${catColor.shadow}`
                            : 'bg-white dark:bg-surface-800 border-surface-100 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-500 shadow-card dark:shadow-card-dark'
                          }
                        `}
                      >
                        <span className={`flex flex-shrink-0 items-center justify-center rounded-lg font-bold transition-colors ${
                          quizSize === 0 ? 'w-7 h-7 text-xs' : quizSize === 1 ? 'w-8 h-8 text-sm' : 'w-9 h-9 text-sm'
                        } ${isSelected
                            ? 'bg-white/25 text-white'
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 group-hover:bg-surface-200 dark:group-hover:bg-surface-600'
                          }
                        `}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span className={`font-medium ${
                          quizSize === 0 ? 'text-xs' : quizSize === 1 ? 'text-sm' : 'text-sm md:text-base'
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
            <div className={`absolute bottom-0 w-full bg-white/90 dark:bg-surface-800/90 backdrop-blur-lg border-t border-surface-200 dark:border-surface-700 z-50 mobile-safe-bottom ${
              quizSize === 0 ? 'p-2.5' : 'p-4'
            }`}>
              <div className="max-w-2xl mx-auto">
                {/* Question dots navigator */}
                <div className={`flex justify-center flex-wrap ${quizSize === 0 ? 'gap-1 mb-2' : 'gap-1.5 mb-3'}`}>
                  {quizState.questions.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => goToQuestion(idx)}
                      className={`rounded-md font-bold transition-all duration-200 ${
                        quizSize === 0 ? 'w-6 h-6 text-[9px]' : 'w-7 h-7 text-[10px] rounded-lg'
                      } ${idx === quizState.currentQuestionIndex
                          ? `bg-gradient-to-r ${catColor.gradient} text-white shadow-sm`
                          : quizState.userAnswers[idx] !== null
                            ? `${catColor.bgLight} ${catColor.bgDark} ${catColor.text} ${catColor.textDark}`
                            : 'bg-surface-100 dark:bg-surface-700 text-surface-400'
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
                    className={`flex-1 rounded-xl font-bold text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600 transition disabled:opacity-40 disabled:cursor-not-allowed ${
                      quizSize === 0 ? 'py-2 text-xs' : 'py-3 text-sm'
                    }`}
                  >
                    Onceki
                  </button>

                  <button
                    onClick={handleNextQuestion}
                    className={`flex-[2] rounded-xl font-bold text-white shadow-lg transition transform active:scale-[0.98] flex items-center justify-center gap-2 ${
                      quizSize === 0 ? 'py-2 text-xs' : 'py-3 text-sm'
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
        </main>
      </div>
    );
  }

  // 4. DASHBOARD & ADMIN LAYOUT
  return (
    <div className="min-h-screen flex bg-surface-50 dark:bg-surface-900 transition-colors duration-300">

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 w-full bg-white/80 dark:bg-surface-900/80 backdrop-blur-xl z-50 border-b border-surface-200 dark:border-surface-800 px-4 h-14 flex justify-between items-center">
        <div className="flex items-center gap-2.5 font-extrabold text-lg text-surface-800 dark:text-white">
          <div className="bg-gradient-to-tr from-brand-600 to-violet-600 p-1.5 rounded-lg shadow-glow">
            <Icon name="Brain" className="w-4 h-4 text-white" />
          </div>
          KPSS Pro
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 text-surface-400 hover:text-surface-600 dark:hover:text-white bg-surface-100 dark:bg-surface-800 rounded-lg transition-colors"
          >
            <Icon name={isDarkMode ? "Sun" : "Moon"} className="w-4 h-4" />
          </button>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-800 rounded-lg">
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
        fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-surface-800 border-r border-surface-200 dark:border-surface-700 transform transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static
        flex flex-col
      `}>
        <div className="flex flex-col h-full p-5">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 pl-1 pt-1">
            <div className="bg-gradient-to-tr from-brand-600 to-violet-600 p-2 rounded-xl shadow-glow">
              <Icon name="Brain" className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-black text-surface-800 dark:text-white tracking-tight">
              KPSS Pro
            </span>
          </div>

          {/* User Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-surface-900 to-surface-800 dark:from-surface-700 dark:to-surface-800 text-white shadow-lg mb-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-brand-500 rounded-full blur-[40px] opacity-15 -mr-8 -mt-8"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center">
                  <Icon name="User" className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-sm truncate">{user.username}</div>
                  <div className="text-[10px] text-surface-400">{user.role === 'admin' ? 'Yonetici' : 'Premium Uye'}</div>
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
      <main className="flex-1 lg:ml-0 pt-14 lg:pt-0 min-h-screen overflow-y-auto custom-scrollbar pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto p-5 md:p-8 lg:p-10">

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
                      onChange={(e) => { setAdminSelectedCatId(e.target.value); setAdminSelectedTopicId(''); }}
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
                      onChange={(e) => setAdminSelectedTopicId(e.target.value)}
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

                {adminSelectedTopicId && (
                  <div className="space-y-5 animate-fade-in">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-surface-100 dark:border-surface-700 pb-5 gap-3">
                      <h3 className="text-xl font-bold text-surface-800 dark:text-white">
                        Sorular <span className="text-surface-400 ml-1.5 text-sm font-medium">({allQuestions[adminSelectedTopicId]?.length || 0})</span>
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
                        {(allQuestions[adminSelectedTopicId]?.length || 0) > 0 && (
                          <button
                            onClick={handleBulkDeleteQuestions}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition shadow-lg shadow-red-600/20 font-bold text-xs"
                          >
                            <Icon name="Trash" className="w-3.5 h-3.5" />
                            Toplu Sil
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {allQuestions[adminSelectedTopicId]?.length > 0 ? (
                        allQuestions[adminSelectedTopicId].map((q, idx) => (
                          <div key={q.id || idx} className="bg-surface-50 dark:bg-surface-900/50 p-4 rounded-xl border border-surface-100 dark:border-surface-700 flex justify-between items-start gap-3 hover:border-brand-200 dark:hover:border-brand-800/50 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-white dark:bg-surface-800 text-[10px] font-bold rounded text-surface-500 border border-surface-100 dark:border-surface-700">#{idx + 1}</span>
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">Cevap: {String.fromCharCode(65 + q.correctOptionIndex)}</span>
                              </div>
                              <p className="text-surface-700 dark:text-surface-200 font-medium text-sm leading-relaxed truncate">{q.questionText}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => handleStartEditQuestion(q, idx)}
                                className="p-2 bg-white dark:bg-surface-800 text-surface-300 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors"
                              >
                                <Icon name="PenLine" className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteQuestion(q.id!, adminSelectedTopicId)}
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
                          <p className="text-surface-400 font-medium text-sm">Bu konuda henuz soru bulunmuyor.</p>
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
            <div className="animate-fade-in">
              {/* Hero */}
              <div className="mb-10 pt-2">
                <p className="text-brand-500 font-bold text-sm mb-1">{getGreeting()}</p>
                <h1 className="text-3xl md:text-4xl font-extrabold text-surface-800 dark:text-white mb-3 tracking-tight">
                  {user.username}
                </h1>
                <p className="text-surface-400 text-sm max-w-lg">
                  Bugunku calismana hangi dersten baslamak istersin? Asagidaki kategorilerden birini sec.
                </p>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                <div className="bg-white dark:bg-surface-800 rounded-xl p-4 border border-surface-100 dark:border-surface-700 shadow-card dark:shadow-card-dark">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-brand-50 dark:bg-brand-900/20 rounded-lg flex items-center justify-center">
                      <Icon name="Layers" className="w-3.5 h-3.5 text-brand-500" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-surface-800 dark:text-white">{categories.length}</p>
                  <p className="text-[11px] text-surface-400 font-medium">Kategori</p>
                </div>
                <div className="bg-white dark:bg-surface-800 rounded-xl p-4 border border-surface-100 dark:border-surface-700 shadow-card dark:shadow-card-dark">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center">
                      <Icon name="BookOpen" className="w-3.5 h-3.5 text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-surface-800 dark:text-white">{categories.reduce((sum, c) => sum + c.subCategories.length, 0)}</p>
                  <p className="text-[11px] text-surface-400 font-medium">Konu</p>
                </div>
                <div className="bg-white dark:bg-surface-800 rounded-xl p-4 border border-surface-100 dark:border-surface-700 shadow-card dark:shadow-card-dark">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-violet-50 dark:bg-violet-900/20 rounded-lg flex items-center justify-center">
                      <Icon name="FileQuestion" className="w-3.5 h-3.5 text-violet-500" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-surface-800 dark:text-white">{getTotalQuestionCount()}</p>
                  <p className="text-[11px] text-surface-400 font-medium">Soru</p>
                </div>
                <div className="bg-white dark:bg-surface-800 rounded-xl p-4 border border-surface-100 dark:border-surface-700 shadow-card dark:shadow-card-dark">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-center">
                      <Icon name="Zap" className="w-3.5 h-3.5 text-amber-500" />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-surface-800 dark:text-white">Pro</p>
                  <p className="text-[11px] text-surface-400 font-medium">Uyelik</p>
                </div>
              </div>

              {/* Categories Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger-children">
                {categories.map((cat) => {
                  const color = getCatColor(cat.id);
                  const questionCount = cat.subCategories.reduce((sum, sub) => sum + (allQuestions[sub.id]?.length || 0), 0);

                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat)}
                      className="group relative bg-white dark:bg-surface-800 rounded-2xl p-6 shadow-card dark:shadow-card-dark hover:shadow-card-hover border border-surface-100 dark:border-surface-700 transition-all duration-300 text-left overflow-hidden animate-fade-in"
                    >
                      {/* Hover glow */}
                      <div className={`absolute top-0 right-0 w-48 h-48 bg-gradient-to-br ${color.gradient} rounded-full blur-[60px] opacity-0 group-hover:opacity-[0.06] transition-opacity duration-500 translate-x-16 -translate-y-16 pointer-events-none`}></div>

                      <div className="relative z-10">
                        <div className="flex items-start justify-between mb-4">
                          <div className={`w-12 h-12 rounded-xl ${color.bgLight} ${color.bgDark} flex items-center justify-center ${color.text} ${color.textDark} group-hover:scale-110 transition-transform duration-300`}>
                            <Icon name={cat.iconName} className="w-6 h-6" />
                          </div>
                          <div className={`w-8 h-8 rounded-lg bg-surface-50 dark:bg-surface-700 flex items-center justify-center text-surface-300 group-hover:bg-gradient-to-r group-hover:${color.gradient} group-hover:text-white transition-all`}>
                            <Icon name="ChevronRight" className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>

                        <h3 className="text-lg font-bold text-surface-800 dark:text-white mb-1 group-hover:text-surface-900 dark:group-hover:text-white transition-colors">{cat.name}</h3>
                        <p className="text-surface-400 text-sm mb-4 leading-relaxed line-clamp-2">{cat.description}</p>

                        <div className="flex items-center gap-3 text-xs text-surface-400 font-medium">
                          <span className="flex items-center gap-1">
                            <Icon name="BookOpen" className="w-3 h-3" />
                            {cat.subCategories.length} konu
                          </span>
                          <span className="flex items-center gap-1">
                            <Icon name="FileQuestion" className="w-3 h-3" />
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
            <div className="animate-fade-in">
              {/* Breadcrumb */}
              <button
                onClick={() => setActiveCategory(null)}
                className="inline-flex items-center gap-2 text-surface-400 hover:text-brand-500 transition-colors font-medium text-sm mb-5"
              >
                <Icon name="ArrowLeft" className="w-4 h-4" />
                Tum Dersler
              </button>

              {/* Category Header */}
              <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-xl ${getCatColor(activeCategory.id).bgLight} ${getCatColor(activeCategory.id).bgDark} flex items-center justify-center ${getCatColor(activeCategory.id).text} ${getCatColor(activeCategory.id).textDark}`}>
                    <Icon name={activeCategory.iconName} className="w-5 h-5" />
                  </div>
                  <h1 className="text-2xl md:text-3xl font-extrabold text-surface-800 dark:text-white">
                    {activeCategory.name}
                  </h1>
                </div>
                <p className="text-surface-400 text-sm ml-[52px]">{activeCategory.description}</p>
              </div>

              {/* Subcategories Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
                {activeCategory.subCategories.map((sub) => {
                  const questionCount = allQuestions[sub.id]?.length || 0;
                  const color = getCatColor(activeCategory.id);

                  return (
                    <div
                      key={sub.id}
                      onClick={() => openQuizSetup(activeCategory, sub)}
                      className="group cursor-pointer bg-white dark:bg-surface-800 rounded-2xl p-5 shadow-card dark:shadow-card-dark hover:shadow-card-hover border border-surface-100 dark:border-surface-700 hover:border-surface-200 dark:hover:border-surface-600 transition-all duration-300 relative overflow-hidden animate-fade-in"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className={`w-10 h-10 ${color.bgLight} ${color.bgDark} rounded-xl flex items-center justify-center ${color.text} ${color.textDark} group-hover:scale-110 transition-transform duration-300`}>
                          <Icon name={activeCategory.iconName} className="w-5 h-5" />
                        </div>
                        <div className={`w-8 h-8 rounded-lg bg-surface-50 dark:bg-surface-700 flex items-center justify-center group-hover:bg-gradient-to-r group-hover:${color.gradient} group-hover:text-white transition-all`}>
                          <Icon name="Play" className="w-3.5 h-3.5 text-surface-300 group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <h3 className="text-base font-bold text-surface-800 dark:text-surface-100 mb-1 group-hover:text-surface-900 dark:group-hover:text-white transition-colors">
                        {sub.name}
                      </h3>
                      <p className="text-xs text-surface-400 font-medium flex items-center gap-1.5">
                        <Icon name="FileQuestion" className="w-3 h-3" />
                        {questionCount} soru mevcut
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== MODALS ===== */}

      {/* Question Modal */}
      {isQuestionModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto modal-backdrop">
          <div className="bg-white dark:bg-surface-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-surface-100 dark:border-surface-700 my-10 modal-content">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-extrabold text-surface-800 dark:text-white">Soru Ekle</h3>
              <button onClick={() => setIsQuestionModalOpen(false)} className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Gorsel URL</label>
                <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={questionForm.imageUrl} onChange={e => setQuestionForm({...questionForm, imageUrl: e.target.value})} placeholder="https://..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Giris Metni <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-16 resize-none text-sm" value={questionForm.contextText} onChange={e => setQuestionForm({...questionForm, contextText: e.target.value})} placeholder="Oncullerin ustunde yer alan giris metni..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Onculler <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-20 resize-none text-sm"
                  placeholder={"I. Madde Bir\nII. Madde Iki\nIII. Madde Uc"}
                  value={questionForm.itemsText}
                  onChange={e => setQuestionForm({...questionForm, itemsText: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Soru Koku</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-24 text-sm font-medium" value={questionForm.questionRoot} onChange={e => setQuestionForm({...questionForm, questionRoot: e.target.value})} placeholder="Asagidakilerden hangisi...?" />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Siklar (Her satira bir sik)</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-28 font-mono text-xs" value={questionForm.optionsText} onChange={e => setQuestionForm({...questionForm, optionsText: e.target.value})} placeholder={"A) ...\nB) ...\nC) ...\nD) ...\nE) ..."} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Dogru Cevap</label>
                  <select className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white font-bold text-sm" value={questionForm.correctOption} onChange={e => setQuestionForm({...questionForm, correctOption: parseInt(e.target.value)})}>
                    <option value={0}>A</option><option value={1}>B</option><option value={2}>C</option><option value={3}>D</option><option value={4}>E</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Aciklama</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={questionForm.explanation} onChange={e => setQuestionForm({...questionForm, explanation: e.target.value})} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-5 border-t border-surface-100 dark:border-surface-700">
              <button onClick={() => setIsQuestionModalOpen(false)} className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition">Iptal</button>
              <button onClick={handleSaveQuestion} className="flex-[2] py-3 bg-brand-600 text-white font-bold text-sm rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-600/20 transition">Kaydet</button>
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
                <h3 className="text-xl font-extrabold text-surface-800 dark:text-white">Soruyu Duzenle</h3>
              </div>
              <button onClick={() => setEditingQuestion(null)} className="p-2 bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Gorsel URL</label>
                <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={editForm.imageUrl} onChange={e => setEditForm({...editForm, imageUrl: e.target.value})} placeholder="https://..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Giris Metni <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-16 resize-none text-sm" value={editForm.contextText} onChange={e => setEditForm({...editForm, contextText: e.target.value})} placeholder="Oncullerin ustunde yer alan giris metni..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Onculler <span className="normal-case font-medium text-surface-300">(Opsiyonel)</span></label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-20 resize-none text-sm"
                  placeholder={"I. Madde Bir\nII. Madde Iki\nIII. Madde Uc"}
                  value={editForm.itemsText}
                  onChange={e => setEditForm({...editForm, itemsText: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Soru Koku</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-24 text-sm font-medium" value={editForm.questionRoot} onChange={e => setEditForm({...editForm, questionRoot: e.target.value})} placeholder="Asagidakilerden hangisi...?" />
              </div>
              <div>
                <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Siklar</label>
                <textarea className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white h-28 font-mono text-xs" value={editForm.optionsText} onChange={e => setEditForm({...editForm, optionsText: e.target.value})} placeholder={"A) ...\nB) ...\nC) ...\nD) ...\nE) ..."} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Dogru Cevap</label>
                  <select className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white font-bold text-sm" value={editForm.correctOption} onChange={e => setEditForm({...editForm, correctOption: parseInt(e.target.value)})}>
                    <option value={0}>A</option><option value={1}>B</option><option value={2}>C</option><option value={3}>D</option><option value={4}>E</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-surface-400 uppercase tracking-wider mb-1.5">Aciklama</label>
                  <input type="text" className="w-full px-4 py-3 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm" value={editForm.explanation} onChange={e => setEditForm({...editForm, explanation: e.target.value})} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-5 border-t border-surface-100 dark:border-surface-700">
              <button onClick={() => setEditingQuestion(null)} className="flex-1 py-3 font-bold text-sm text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl transition">Iptal</button>
              <button onClick={handleSaveEditQuestion} className="flex-[2] py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm rounded-xl hover:shadow-lg hover:shadow-amber-500/20 transition flex items-center justify-center gap-2">
                <Icon name="CircleCheck" className="w-4 h-4" />
                Guncelle
              </button>
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
                  <p className="text-xs text-surface-400">{bulkStep === 'paste' ? 'Sorulari yapistirin' : `${bulkParsed.length} soru ayristirildi`}</p>
                </div>
              </div>
              <button onClick={handleBulkClose} className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-600 transition">
                <Icon name="X" className="w-4 h-4 text-surface-500" />
              </button>
            </div>

            {bulkStep === 'paste' ? (
              /* Paste Step */
              <div className="flex flex-col flex-1 overflow-hidden p-5 gap-4">
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  className="flex-1 min-h-[250px] w-full p-4 rounded-xl bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 outline-none focus:border-brand-500 dark:text-white text-sm font-mono resize-none"
                  placeholder={"Sorulari buraya yapistirin...\n\nOrnek format:\n1. Asagidakilerden hangisi...?\nA) Secenek 1\nB) Secenek 2\nC) Secenek 3\nD) Secenek 4\nE) Secenek 5\n\n1. COZUM: Aciklama... CEVAP: A"}
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
                                    <span className="font-medium text-surface-400 dark:text-surface-500 mr-1">{['I','II','III','IV','V','VI','VII','VIII','IX','X'][i] || i+1}.</span> {item.substring(0, 60)}{item.length > 60 ? '...' : ''}
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
