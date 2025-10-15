import * as OpenCC from 'opencc-js';

export const parseDictionaryFile = async (fileContent: string): Promise<DictionaryEntry[]> => {
  const lines = fileContent.split('\n');
  const localDictionaryMap = new Map<string, DictionaryEntry>();

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const parts = trimmedLine.split('\t');
    if (parts.length >= 2) {
      const word = parts[0];
      const pinyin = parts[1];
      const definition = parts.slice(2).join('\t');

      if (localDictionaryMap.has(word)) {
        const existingEntry = localDictionaryMap.get(word)!;
        if (!existingEntry.pinyin.includes(pinyin)) {
          existingEntry.pinyin.push(pinyin);
        }
      } else {
        localDictionaryMap.set(word, { word, pinyin: [pinyin], definition });
      }
    }
  }
  return Array.from(localDictionaryMap.values());
};

export const loadDictionary = async (filePath: string): Promise<void> => {};

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' }); // Simplified to Traditional
const t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' }); // Traditional to Simplified

export interface PinyinSegment {
  type: 'char' | 'word';
  char?: string; // For type 'char'
  word?: string; // For type 'word'
  pinyin: string[];
  selectedPinyinIndex: number;
  dictionaryMatchWord?: string;
  isInputSimplified?: boolean; // New field
  isDictionaryMatchSimplified?: boolean; // New field
}

// Function to check if a character/word is simplified
const isSimplified = (text: string): boolean => {
  return t2sConverter(converter(text)) === text;
};

export const lookupPinyinForSentence = (dictionary: DictionaryEntry[], sentence: string): PinyinSegment[] => {
  const results: PinyinSegment[] = [];
  let currentIndex = 0;

  const localDictionaryMap = new Map<string, DictionaryEntry>();
  for (const entry of dictionary) {
    localDictionaryMap.set(entry.word, entry);
  }

  while (currentIndex < sentence.length) {
    let bestMatchLength = 0;
    let bestMatchPinyins: string[] = [''];
    let bestMatchWord: string = ''; // This will be the original input word segment
    let bestMatchDictionaryWord: string | undefined; // This will be the word found in the dictionary (could be traditional)
    let bestMatchIsInputSimplified: boolean | undefined;
    let bestMatchIsDictionaryMatchSimplified: boolean | undefined;

    // Try to match multi-character words first
    // Iterate from longest possible word to shortest (1 character)
    for (let len = sentence.length - currentIndex; len >= 1; len--) {
      const currentInputWord = sentence.substring(currentIndex, currentIndex + len);
      const isCurrentInputSimplified = isSimplified(currentInputWord);

      let candidateEntry: DictionaryEntry | undefined;
      let candidateDictionaryWord: string | undefined;

      // Attempt 1: Direct match with the input word (simplified or traditional as-is)
      if (localDictionaryMap.has(currentInputWord)) {
        candidateEntry = localDictionaryMap.get(currentInputWord)!;
        candidateDictionaryWord = currentInputWord;
      }

      // Attempt 2: If no direct match, or if the input is simplified and we can find a traditional equivalent
      const traditionalInputWord = converter(currentInputWord);
      if (traditionalInputWord !== currentInputWord) { // Only try traditional if it's actually different
        if (localDictionaryMap.has(traditionalInputWord)) {
          if (!candidateEntry) { // Only consider traditional if simplified was not found
            candidateEntry = localDictionaryMap.get(traditionalInputWord)!;
            candidateDictionaryWord = traditionalInputWord;
          }
        }
      }

      if (candidateEntry && len > bestMatchLength) {
        bestMatchLength = len;
        bestMatchWord = currentInputWord; // Original input word segment
        bestMatchPinyins = candidateEntry.pinyin;
        bestMatchDictionaryWord = candidateDictionaryWord;
        bestMatchIsInputSimplified = isCurrentInputSimplified;
        bestMatchIsDictionaryMatchSimplified = isSimplified(candidateDictionaryWord!); // Ensure non-null assertion
      }
    }

    if (bestMatchLength > 0) {
      const segment: PinyinSegment = {
        type: 'word',
        word: bestMatchWord,
        pinyin: bestMatchPinyins,
        selectedPinyinIndex: 0,
        dictionaryMatchWord: bestMatchDictionaryWord,
        isInputSimplified: bestMatchIsInputSimplified,
        isDictionaryMatchSimplified: bestMatchIsDictionaryMatchSimplified,
      };
      results.push(segment);
      currentIndex += bestMatchLength;
    } else {
      // Fallback to character if no word match
      const char = sentence[currentIndex];
      const isCharSimplified = isSimplified(char);

      let charEntry = localDictionaryMap.get(char);
      let matchedCharInDictionary: string | undefined = char;

      // Try traditional character if direct simplified not found
      const traditionalChar = converter(char);
      if (traditionalChar !== char) {
        if (localDictionaryMap.has(traditionalChar)) {
          if (!charEntry) { // Only consider traditional if simplified was not found
            charEntry = localDictionaryMap.get(traditionalChar)!;
            matchedCharInDictionary = traditionalChar;
          }
        }
      }

      const segment: PinyinSegment = {
        type: 'char',
        char: char,
        pinyin: charEntry ? charEntry.pinyin : [''],
        selectedPinyinIndex: 0,
        dictionaryMatchWord: matchedCharInDictionary,
        isInputSimplified: isCharSimplified,
        isDictionaryMatchSimplified: charEntry ? isSimplified(charEntry.word) : undefined,
      };
      results.push(segment);
      currentIndex++;
    }
  }
  return results;
};

export const searchDictionary = (query: string, dictionary: DictionaryEntry[]): DictionaryEntry[] => {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();

  return dictionary.filter(entry =>
    entry.word.includes(lowerQuery) ||
    entry.pinyin.some(p => p.toLowerCase().includes(lowerQuery))
  );
};

export interface DictionaryEntry {
  word: string;
  pinyin: string[];
  definition: string;
}