import { Question } from '../types';

type StructuredQuestion = Record<string, unknown>;
type InputFormat = 'text' | 'json';
type StructuredParseReport = { used: boolean; questions: Question[]; errors: string[] };
type StructuredConvertResult = { question: Question | null; errors: string[] };
type JsonParseResult = { parsed: unknown | null; repaired: boolean };

export type BulkParseReport = {
  questions: Question[];
  errors: string[];
  inputFormat: InputFormat;
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
};

const ROMAN_PATTERN = '(?:I|II|III|IV|V|VI|VII|VIII|IX|X)';
const SOLUTION_TOKEN = '[ÇC][OÖ]Z[ÜU]M';

export function parseBulkQuestions(rawText: string): Question[] {
  return parseBulkQuestionsWithReport(rawText).questions;
}

export function parseBulkQuestionsWithReport(rawText: string): BulkParseReport {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const structured = parseStructuredQuestionsWithReport(text);
  if (structured.used) {
    return {
      questions: structured.questions,
      errors: structured.errors,
      inputFormat: 'json',
    };
  }

  return {
    questions: parsePlainTextQuestions(text),
    errors: [],
    inputFormat: 'text',
  };
}

function parsePlainTextQuestions(text: string): Question[] {

  // Remove SAYFA lines
  text = text.replace(/^SAYFA\s*\d+.*$/gm, '');

  // --- 1) Split questions section vs solutions section ---
  const solStartRegex = new RegExp(`\\n\\s*1\\.\\s*${SOLUTION_TOKEN}`, 'i');
  const solHeaderRegex = new RegExp(`^.*${SOLUTION_TOKEN}(?:LER)?\\s*$`, 'im');
  const solRegex = new RegExp(`(\\d+)\\.\\s*${SOLUTION_TOKEN}:\\s*([\\s\\S]*?)CEVAP:\\s*([A-E])`, 'gi');

  const solStartIdx = text.search(solStartRegex);
  // Also check for a "ÇÖZÜMLER" header line
  const solHeaderIdx = text.search(solHeaderRegex);
  const splitIdx = solStartIdx !== -1 ? solStartIdx : solHeaderIdx !== -1 ? solHeaderIdx : -1;

  const qSection = splitIdx !== -1 ? text.substring(0, splitIdx) : text;
  const solSection = splitIdx !== -1 ? text.substring(splitIdx) : '';

  // --- 2) Parse solutions: number -> { explanation, answer } ---
  const answers = new Map<number, { explanation: string; answer: string }>();
  let sm: RegExpExecArray | null;
  while ((sm = solRegex.exec(solSection)) !== null) {
    answers.set(parseInt(sm[1]), {
      explanation: sm[2].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
      answer: sm[3],
    });
  }

  // --- 3) Split into question blocks ---
  // Each question starts with a number followed by period and space at line start
  const blocks = qSection.split(/\n(?=\d+\.\s)/).filter(b => b.trim());

  const results: Question[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();

    // Extract question number
    const numMatch = trimmed.match(/^(\d+)\.\s*/);
    if (!numMatch) continue;
    const qNum = parseInt(numMatch[1]);
    let body = trimmed.substring(numMatch[0].length);

    // --- 4) Separate question body from options ---
    // Options start at first "A)" - could be on its own line or inline
    const optIdx = body.search(/(?:^|\n)\s*A\)/m);
    let questionBody = optIdx !== -1 ? body.substring(0, optIdx).trim() : body.trim();
    const optionsRaw = optIdx !== -1 ? body.substring(optIdx).trim() : '';

    // --- 5) Parse options ---
    const options = parseOptions(optionsRaw);

    // --- 6) Extract Roman numeral items (contentItems), contextText and questionText ---
    const { contentItems, contextText, questionText } = extractRomanItems(questionBody);

    // --- 7) Get solution ---
    const sol = answers.get(qNum);
    const correctIndex = sol ? 'ABCDE'.indexOf(sol.answer) : -1;

    if (options.length < 2) continue; // Skip invalid questions

    results.push({
      id: `bulk_${Date.now()}_${qNum}`,
      contextText: contextText || undefined,
      contentItems: contentItems.length > 0 ? contentItems : undefined,
      questionText: questionText.trim(),
      options,
      correctOptionIndex: correctIndex >= 0 ? correctIndex : 0,
      explanation: sol?.explanation || '',
    });
  }

  return results;
}

/** Parse A)...E) options from raw text. Handles both multiline and single-line formats. */
function parseOptions(raw: string): string[] {
  if (!raw.trim()) return [];

  // Split by option letter pattern: A) B) C) D) E)
  const parts = raw.split(/(?=(?:^|\n|\s)[A-E][\)\.\-:]\s*)/);
  const options: string[] = [];

  for (const part of parts) {
    const cleaned = part.replace(/^[\s\n]*[A-E][\)\.\-:]\s*/, '').replace(/\n/g, ' ').trim();
    if (cleaned) options.push(cleaned);
  }

  return options;
}

/** Extract Roman numeral items and separate question text */
function extractRomanItems(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  const multiline = extractMultilineRomans(body);
  if (multiline.contentItems.length > 0) return multiline;

  const inline = extractInlineRomans(body);
  if (inline.contentItems.length > 0) return inline;

  return { contentItems: [], contextText: '', questionText: body };
}

/** Multi-line Roman numerals: each on its own line with possible blank lines between */
function extractMultilineRomans(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  // Find all Roman numeral item positions
  const romanRegex = new RegExp(`(?:^|\\n)\\s*((${ROMAN_PATTERN})\\.)\\s+`, 'gm');
  const positions: { fullMatchStart: number; contentStart: number; numeral: string }[] = [];

  let rm: RegExpExecArray | null;
  while ((rm = romanRegex.exec(body)) !== null) {
    positions.push({
      fullMatchStart: rm.index,
      contentStart: rm.index + rm[0].length,
      numeral: rm[2],
    });
  }

  if (!isSequentialRomanList(positions.map(p => p.numeral))) {
    return { contentItems: [], contextText: '', questionText: body };
  }

  // Text before first Roman numeral = contextText (intro paragraph)
  const intro = body.substring(0, positions[0].fullMatchStart).trim();

  // Extract each item text
  const items: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].contentStart;
    const end = i + 1 < positions.length ? positions[i + 1].fullMatchStart : body.length;
    items.push(body.substring(start, end).replace(/\n/g, ' ').trim().replace(/,\s*$/, ''));
  }

  const splitResult = splitQuestionTailFromItem(items[items.length - 1]);
  let questionRoot = splitResult.questionTail;
  if (splitResult.itemText !== items[items.length - 1]) {
    items[items.length - 1] = splitResult.itemText;
  }

  // Build question text - intro goes to contextText, questionRoot goes to questionText
  let questionText = questionRoot.trim();

  // If questionText is empty, fallback
  if (!questionText) {
    questionText = intro || items[items.length - 1];
    // If we used intro as questionText, don't duplicate it as contextText
    return { contentItems: items, contextText: '', questionText };
  }

  return { contentItems: items, contextText: intro, questionText };
}

/** Inline Roman numerals: I. X, II. Y, III. Z within a sentence */
function extractInlineRomans(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  // Find inline Roman numeral items: "I. text, II. text, III. text"
  const romanInlineRegex = new RegExp(`(${ROMAN_PATTERN})\\.\\s+`, 'g');
  const positions: { start: number; prefixEnd: number; numeral: string }[] = [];

  let rm: RegExpExecArray | null;
  while ((rm = romanInlineRegex.exec(body)) !== null) {
    const start = rm.index;
    const prevChar = start === 0 ? '\n' : body[start - 1];
    if (start !== 0 && !/[\s,(;]/.test(prevChar)) continue;
    positions.push({ start, prefixEnd: start + rm[0].length, numeral: rm[1] });
  }

  if (!isSequentialRomanList(positions.map(p => p.numeral))) {
    return { contentItems: [], contextText: '', questionText: body };
  }

  const intro = body.substring(0, positions[0].start).trim();

  // Extract items - each item ends at next Roman numeral or at a question keyword
  const items: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const contentStart = positions[i].prefixEnd;
    let contentEnd: number;
    if (i + 1 < positions.length) {
      // End before next Roman numeral, strip trailing comma
      contentEnd = positions[i + 1].start;
    } else {
      contentEnd = body.length;
    }
    let itemText = body.substring(contentStart, contentEnd).replace(/,\s*$/, '').trim();
    items.push(itemText);
  }

  const splitResult = splitQuestionTailFromItem(items[items.length - 1]);
  let questionRoot = splitResult.questionTail;
  if (splitResult.itemText !== items[items.length - 1]) {
    items[items.length - 1] = splitResult.itemText;
  }

  let questionText = questionRoot.trim();
  if (!questionText) {
    questionText = intro || body;
    return { contentItems: items, contextText: '', questionText };
  }

  return { contentItems: items, contextText: intro, questionText };
}

function splitQuestionTailFromItem(item: string): { itemText: string; questionTail: string } {
  if (!item.includes('?')) return { itemText: item, questionTail: '' };

  const splitMatch = item.match(
    /^(.*?)\s+(Yukarıdakilerden|Aşağıdakilerden|durumlarından|yargılarından|ifadelerinden|özelliklerinden|bilgilerinden|gelişmelerinden|hangisi|hangileri|hangisine|hangilerinde|hangisinde)\s*(.*?\?)\s*$/i
  );
  if (!splitMatch) return { itemText: item, questionTail: '' };

  return {
    itemText: splitMatch[1].trim().replace(/,\s*$/, ''),
    questionTail: `${splitMatch[2]} ${splitMatch[3]}`.trim(),
  };
}

function isSequentialRomanList(numerals: string[]): boolean {
  if (numerals.length < 2) return false;
  if (numerals[0] !== 'I') return false;

  for (let i = 1; i < numerals.length; i++) {
    const prev = ROMAN_VALUES[numerals[i - 1]];
    const current = ROMAN_VALUES[numerals[i]];
    if (!prev || !current || current !== prev + 1) return false;
  }
  return true;
}

function parseStructuredQuestionsWithReport(rawText: string): StructuredParseReport {
  const candidates = extractJsonCandidates(rawText);
  const userLikelyPastedJson = looksLikeStructuredInput(rawText);
  const payloadErrors: string[] = [];
  let hasParsedCandidate = false;

  for (const candidate of candidates) {
    const parsedResult = safeJsonParse(candidate);
    if (!parsedResult.parsed) continue;
    hasParsedCandidate = true;

    const list = normalizeQuestionPayload(parsedResult.parsed);
    if (!list || list.length === 0) {
      payloadErrors.push('JSON kokunde dizi veya `questions` dizisi bulunamadi.');
      continue;
    }

    const results: Question[] = [];
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const converted = convertStructuredQuestionWithErrors(list[i], i + 1);
      errors.push(...converted.errors);
      if (converted.question) results.push(converted.question);
    }

    if (results.length === 0 && errors.length === 0) {
      errors.push('JSON icinde gecerli soru kaydi bulunamadi.');
    }

    if (parsedResult.repaired) {
      errors.unshift('JSON icindeki sorunlu tirnak/satir sonlari otomatik duzeltildi.');
    }
    return { used: true, questions: results, errors: dedupeErrors(errors) };
  }

  if (hasParsedCandidate) {
    const errors = payloadErrors.length > 0 ? payloadErrors : ['JSON icinde gecerli soru kaydi bulunamadi.'];
    return { used: true, questions: [], errors: dedupeErrors(errors) };
  }

  if (userLikelyPastedJson) {
    return {
      used: true,
      questions: [],
      errors: ['JSON parse edilemedi. Gecerli bir JSON dizi veya {"questions":[...]} formatini kullanin. String icindeki cift tirnaklari \\\" seklinde kacirip tekrar deneyin.'],
    };
  }

  return { used: false, questions: [], errors: [] };
}

function extractJsonCandidates(rawText: string): string[] {
  const candidates: string[] = [rawText.trim()];
  const fencedMatches = rawText.match(/```(?:json)?\s*([\s\S]*?)```/gi) || [];
  for (const block of fencedMatches) {
    const inner = block.replace(/```(?:json)?/i, '').replace(/```$/, '').trim();
    if (inner) candidates.push(inner);
  }
  return candidates;
}

function looksLikeStructuredInput(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('{') || trimmed.startsWith('[') || /^```(?:json)?/i.test(trimmed);
}

function safeJsonParse(value: string): JsonParseResult {
  try {
    return { parsed: JSON.parse(value), repaired: false };
  } catch {
    const repaired = repairLikelyJson(value);
    if (repaired !== value) {
      try {
        return { parsed: JSON.parse(repaired), repaired: true };
      } catch {
        // keep falling through
      }
    }
    return { parsed: null, repaired: false };
  }
}

function repairLikelyJson(value: string): string {
  const normalizedQuotes = value.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < normalizedQuotes.length; i++) {
    const ch = normalizedQuotes[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '\r') {
      if (normalizedQuotes[i + 1] === '\n') i++;
      out += '\\n';
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      continue;
    }

    if (ch === '"') {
      const nextChar = nextNonWhitespaceChar(normalizedQuotes, i + 1);
      if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === '') {
        inString = false;
        out += '"';
      } else {
        out += '\\"';
      }
      continue;
    }

    out += ch;
  }

  return out;
}

function nextNonWhitespaceChar(input: string, startIndex: number): string {
  for (let i = startIndex; i < input.length; i++) {
    const ch = input[i];
    if (!/\s/.test(ch)) return ch;
  }
  return '';
}

function normalizeQuestionPayload(parsed: unknown): StructuredQuestion[] | null {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (!isRecord(parsed)) return null;

  const fromQuestions = parsed.questions;
  if (Array.isArray(fromQuestions)) {
    return fromQuestions.filter(isRecord);
  }
  return null;
}

function convertStructuredQuestionWithErrors(input: StructuredQuestion, index: number): StructuredConvertResult {
  const errors: string[] = [];

  const questionText =
    asNonEmptyString(readFirst(input, ['questionText', 'questionRoot', 'soruKoku', 'soruKökü', 'soru'])) || '';
  const contextText =
    asNonEmptyString(readFirst(input, ['contextText', 'ustMetin', 'üstMetin', 'girisMetni', 'girişMetni'])) || '';

  const rawItems = readFirst(input, ['contentItems', 'items', 'onculler', 'öncüller', 'onculListesi']);
  const contentItems = normalizeItems(rawItems);
  const options = normalizeOptions(readFirst(input, ['options', 'siklar', 'şıklar', 'secenekler', 'seçenekler']));

  if (!questionText) {
    errors.push(`Soru ${index}: questionText (soru koku) bos.`);
  }
  if (options.length < 2) {
    errors.push(`Soru ${index}: options alaninda en az 2 secenek olmali.`);
  }
  if (options.length > 0 && options.length !== 5) {
    errors.push(`Soru ${index}: options 5 secenek olmali (A-E).`);
  }

  const answerValidation = validateAnswerField(input, options.length, index);
  errors.push(...answerValidation.errors);
  if (!questionText || options.length < 2) {
    return { question: null, errors };
  }

  const correctOptionIndex = readCorrectOptionIndex(input, options.length);
  const explanation =
    asNonEmptyString(readFirst(input, ['explanation', 'cozum', 'çözüm', 'aciklama', 'açıklama'])) || '';
  const sourceTag = asNonEmptyString(readFirst(input, ['sourceTag', 'kaynak', 'kaynakEtiketi']));
  const imageUrl = asNonEmptyString(readFirst(input, ['imageUrl', 'gorselUrl', 'görselUrl']));
  const questionId = asNonEmptyString(readFirst(input, ['questionId', 'id']));

  return {
    question: {
      id: questionId || `bulk_${Date.now()}_${index}`,
      contextText: contextText || undefined,
      contentItems: contentItems.length > 0 ? contentItems : undefined,
      questionText,
      options,
      correctOptionIndex,
      explanation,
      sourceTag: sourceTag || undefined,
      imageUrl: imageUrl || undefined,
    },
    errors,
  };
}

function readCorrectOptionIndex(input: StructuredQuestion, optionLength: number): number {
  const numeric = readFirst(input, ['correctOptionIndex', 'correctIndex', 'dogruSecenekIndex', 'doğruSeçenekIndex']);
  if (typeof numeric === 'number' && Number.isFinite(numeric)) {
    const n = Math.trunc(numeric);
    if (n >= 0 && n < optionLength) return n;
  }

  const answerRaw = readFirst(input, ['answer', 'correctAnswer', 'dogruCevap', 'doğruCevap']);
  if (typeof answerRaw === 'number' && Number.isFinite(answerRaw)) {
    const n = Math.trunc(answerRaw);
    if (n >= 0 && n < optionLength) return n;
    if (n >= 1 && n <= optionLength) return n - 1;
  }
  if (typeof answerRaw === 'string') {
    const answer = answerRaw.trim().toUpperCase();
    const letterIndex = 'ABCDE'.indexOf(answer);
    if (letterIndex >= 0 && letterIndex < optionLength) return letterIndex;
  }

  return 0;
}

function validateAnswerField(input: StructuredQuestion, optionLength: number, questionIndex: number): { errors: string[] } {
  const errors: string[] = [];
  const answerRaw = readFirst(input, ['answer', 'correctAnswer', 'dogruCevap', 'doğruCevap']);
  if (answerRaw === undefined || answerRaw === null) return { errors };

  if (typeof answerRaw === 'number' && Number.isFinite(answerRaw)) {
    const n = Math.trunc(answerRaw);
    const zeroBasedValid = n >= 0 && n < optionLength;
    const oneBasedValid = n >= 1 && n <= optionLength;
    if (!zeroBasedValid && !oneBasedValid) {
      errors.push(`Soru ${questionIndex}: answer degeri secenek araliginda degil.`);
    }
    return { errors };
  }

  if (typeof answerRaw === 'string') {
    const answer = answerRaw.trim().toUpperCase();
    if ('ABCDE'.indexOf(answer) === -1) {
      errors.push(`Soru ${questionIndex}: answer harfi A-E araliginda olmali.`);
    }
    return { errors };
  }

  errors.push(`Soru ${questionIndex}: answer alani string veya number olmali.`);
  return { errors };
}

function dedupeErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => asNonEmptyString(v)).filter((v): v is string => Boolean(v));
  }
  if (typeof value !== 'string') return [];
  return parseOptions(value);
}

function normalizeItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => asNonEmptyString(v)).filter((v): v is string => Boolean(v));
  }
  if (typeof value !== 'string') return [];

  const lines = value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(stripRomanPrefix);
  if (lines.length > 1) return lines;

  const inlineParts = value
    .split(new RegExp(`\\s*(?=${ROMAN_PATTERN}\\.\\s+)`, 'g'))
    .map(s => s.trim())
    .filter(Boolean)
    .map(stripRomanPrefix);
  if (inlineParts.length > 1) return inlineParts;

  return lines;
}

function stripRomanPrefix(value: string): string {
  return value.replace(new RegExp(`^${ROMAN_PATTERN}\\.\\s+`, 'i'), '').trim();
}

function readFirst(input: StructuredQuestion, keys: string[]): unknown {
  for (const key of keys) {
    if (key in input) return input[key];
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
