import { Question } from '../types';

export function parseBulkQuestions(rawText: string): Question[] {
  let text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove SAYFA lines
  text = text.replace(/^SAYFA\s*\d+.*$/gm, '');

  // --- 1) Split questions section vs solutions section ---
  const solStartIdx = text.search(/\n\s*1\.\s*ÇÖZÜM/i);
  // Also check for a "ÇÖZÜMLER" header line
  const solHeaderIdx = text.search(/^.*ÇÖZÜM(?:LER)?\s*$/im);
  const splitIdx = solStartIdx !== -1 ? solStartIdx : solHeaderIdx !== -1 ? solHeaderIdx : -1;

  const qSection = splitIdx !== -1 ? text.substring(0, splitIdx) : text;
  const solSection = splitIdx !== -1 ? text.substring(splitIdx) : '';

  // --- 2) Parse solutions: number -> { explanation, answer } ---
  const answers = new Map<number, { explanation: string; answer: string }>();
  const solRegex = /(\d+)\.\s*ÇÖZÜM:\s*([\s\S]*?)CEVAP:\s*([A-E])/gi;
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
  const parts = raw.split(/(?=[A-E]\)\s*)/);
  const options: string[] = [];

  for (const part of parts) {
    const cleaned = part.replace(/^[A-E]\)\s*/, '').replace(/\n/g, ' ').trim();
    if (cleaned) options.push(cleaned);
  }

  return options;
}

/** Extract Roman numeral items and separate question text */
function extractRomanItems(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  // Check if Roman numerals exist
  const romanCheck = /(?:^|\n|\s)(?:I{1,3}|IV|V|VI{0,3}|VII|VIII|IX|X)\.\s/m;
  if (!romanCheck.test(body)) {
    return { contentItems: [], contextText: '', questionText: body };
  }

  // Detect format: multi-line (items on separate lines) vs inline (items within text)
  const hasMultilineRomans = /\n\s*I{1,3}\.\s/.test(body) || /^I{1,3}\.\s/.test(body.trim());

  if (hasMultilineRomans) {
    return extractMultilineRomans(body);
  } else {
    return extractInlineRomans(body);
  }
}

/** Multi-line Roman numerals: each on its own line with possible blank lines between */
function extractMultilineRomans(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  // Find all Roman numeral item positions
  const romanRegex = /(?:^|\n)\s*((?:I{1,3}|IV|V|VI{0,3}|VII|VIII|IX|X)\.)\s+/gm;
  const positions: { fullMatchStart: number; contentStart: number; numeral: string }[] = [];

  let rm: RegExpExecArray | null;
  while ((rm = romanRegex.exec(body)) !== null) {
    positions.push({
      fullMatchStart: rm.index,
      contentStart: rm.index + rm[0].length,
      numeral: rm[1],
    });
  }

  if (positions.length === 0) {
    return { contentItems: [], contextText: '', questionText: body };
  }

  // Text before first Roman numeral = contextText (intro paragraph)
  const intro = body.substring(0, positions[0].fullMatchStart).trim();

  // Extract each item text
  const items: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].contentStart;
    const end = i + 1 < positions.length ? positions[i + 1].fullMatchStart : body.length;
    items.push(body.substring(start, end).replace(/\n/g, ' ').trim());
  }

  // Check if last item contains the question root (ends with "?")
  const lastItem = items[items.length - 1];
  let questionRoot = '';

  if (lastItem.includes('?')) {
    // Try to split: find where question phrasing starts
    // Common patterns: "hangisi", "hangiler", "durumlarından", "yargılarından", "ifadelerinden"
    const splitMatch = lastItem.match(
      /^(.*?)\s+(durumlarından|yargılarından|ifadelerinden|özelliklerinden|bilgilerinden|gelişmelerinden|hangisi|hangileri)\s*(.*?\?)\s*$/i
    );
    if (splitMatch) {
      items[items.length - 1] = splitMatch[1].trim();
      questionRoot = splitMatch[2] + ' ' + splitMatch[3];
    } else {
      // Can't split cleanly - keep whole thing as question text part
      // The last item has the question embedded
      questionRoot = '';
    }
  }

  // Build question text - intro goes to contextText, questionRoot goes to questionText
  let questionText = questionRoot.trim();

  // If questionText is empty, fallback
  if (!questionText) {
    questionText = intro || lastItem;
    // If we used intro as questionText, don't duplicate it as contextText
    return { contentItems: items, contextText: '', questionText };
  }

  return { contentItems: items, contextText: intro, questionText };
}

/** Inline Roman numerals: I. X, II. Y, III. Z within a sentence */
function extractInlineRomans(body: string): { contentItems: string[]; contextText: string; questionText: string } {
  // Find inline Roman numeral items: "I. text, II. text, III. text"
  const romanInlineRegex = /((?:I{1,3}|IV|V|VI{0,3}|VII|VIII|IX|X)\.)\s+/g;
  const positions: { start: number; prefixEnd: number; numeral: string }[] = [];

  let rm: RegExpExecArray | null;
  while ((rm = romanInlineRegex.exec(body)) !== null) {
    positions.push({ start: rm.index, prefixEnd: rm.index + rm[0].length, numeral: rm[1] });
  }

  if (positions.length === 0) {
    return { contentItems: [], contextText: '', questionText: body };
  }

  const intro = body.substring(0, positions[0].start).trim();
  const afterItemsSection = body.substring(positions[0].start);

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

  // Last item likely contains the question tail
  const lastItem = items[items.length - 1];
  let questionRoot = '';

  if (lastItem.includes('?')) {
    // Find where the question part starts in the last item
    // Look for common question words
    const splitMatch = lastItem.match(
      /^(.*?)\s+(Yukarıdakilerden|durumlarından|yargılarından|dönemlerinin|devletlerinden|hangisi|hangileri|hangisine|hangilerinde|hangisinde)\s*(.*?\?)\s*$/i
    );
    if (splitMatch) {
      items[items.length - 1] = splitMatch[1].trim();
      questionRoot = splitMatch[2] + ' ' + splitMatch[3];
    }
  }

  let questionText = questionRoot.trim();
  if (!questionText) {
    questionText = intro || body;
    return { contentItems: items, contextText: '', questionText };
  }

  return { contentItems: items, contextText: intro, questionText };
}
