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

export const loadDictionary = async (filePath: string): Promise<DictionaryEntry[]> => {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load dictionary from ${filePath}: ${response.statusText}`);
    }
    const fileContent = await response.text();
    return parseDictionaryFile(fileContent);
  } catch (error) {
    console.error(`Error loading dictionary from ${filePath}:`, error);
    return [];
  }
};

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
    let bestMatchPinyins: string[] = []; // Initialize as empty array
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
          if (!candidateEntry) { // If no direct match was found, use the traditional match
            candidateEntry = localDictionaryMap.get(traditionalInputWord)!;
            candidateDictionaryWord = traditionalInputWord;
          } else if (candidateEntry.word === currentInputWord) { // If direct match was found, but traditional also exists, merge pinyins
            const traditionalEntry = localDictionaryMap.get(traditionalInputWord)!;
            candidateEntry.pinyin = Array.from(new Set([...candidateEntry.pinyin, ...traditionalEntry.pinyin]));
          }
        }
      }
  
      // Attempt 3: If no match yet, and input is traditional, try simplified
      const simplifiedInputWord = t2sConverter(currentInputWord);
      if (simplifiedInputWord !== currentInputWord) { // Only try simplified if it's actually different
        if (localDictionaryMap.has(simplifiedInputWord)) {
          if (!candidateEntry) { // If no match yet, use the simplified match
            candidateEntry = localDictionaryMap.get(simplifiedInputWord)!;
            candidateDictionaryWord = simplifiedInputWord;
          } else if (candidateEntry.word === currentInputWord) { // If direct match was found, but simplified also exists, merge pinyins
            const simplifiedEntry = localDictionaryMap.get(simplifiedInputWord)!;
            candidateEntry.pinyin = Array.from(new Set([...candidateEntry.pinyin, ...simplifiedEntry.pinyin]));
          }
        }
      }
  
      if (candidateEntry) {
        bestMatchLength = len;
        bestMatchWord = currentInputWord;
        bestMatchPinyins = candidateEntry.pinyin; // Assign all pinyins from the entry
        bestMatchDictionaryWord = candidateDictionaryWord;
        bestMatchIsInputSimplified = isCurrentInputSimplified;
        bestMatchIsDictionaryMatchSimplified = isSimplified(candidateDictionaryWord || '');
        break; // Found the longest match, break from inner loop
      }
    }
  
    if (bestMatchLength > 0) {
      results.push({
        type: 'word',
        word: bestMatchWord,
        pinyin: bestMatchPinyins,
        selectedPinyinIndex: 0,
        dictionaryMatchWord: bestMatchDictionaryWord,
        isInputSimplified: bestMatchIsInputSimplified,
        isDictionaryMatchSimplified: bestMatchIsDictionaryMatchSimplified,
      });
      currentIndex += bestMatchLength;
    } else {
      // If no word match, treat as single character
      const char = sentence[currentIndex];
      const isCharSimplified = isSimplified(char);
      let charPinyins: string[] = [''];
      let charDictionaryMatchWord: string | undefined;
      let charIsDictionaryMatchSimplified: boolean | undefined;
  
      // Check for direct character match
      if (localDictionaryMap.has(char)) {
        const entry = localDictionaryMap.get(char)!;
        charPinyins = entry.pinyin;
        charDictionaryMatchWord = char;
        charIsDictionaryMatchSimplified = isSimplified(char);
      }
  
      // If no direct match, or if the input is simplified and we can find a traditional equivalent
      const traditionalChar = converter(char);
      if (traditionalChar !== char) {
        if (localDictionaryMap.has(traditionalChar)) {
          const entry = localDictionaryMap.get(traditionalChar)!;
          charPinyins = Array.from(new Set([...charPinyins, ...entry.pinyin]));
          if (!charDictionaryMatchWord) {
            charDictionaryMatchWord = traditionalChar;
            charIsDictionaryMatchSimplified = isSimplified(traditionalChar);
          }
        }
      }
  
      // If no match yet, and input is traditional, try simplified
      const simplifiedChar = t2sConverter(char);
      if (simplifiedChar !== char) {
        if (localDictionaryMap.has(simplifiedChar)) {
          const entry = localDictionaryMap.get(simplifiedChar)!;
          charPinyins = Array.from(new Set([...charPinyins, ...entry.pinyin]));
          if (!charDictionaryMatchWord) {
            charDictionaryMatchWord = simplifiedChar;
            charIsDictionaryMatchSimplified = isSimplified(simplifiedChar);
          }
        }
      }
  
      results.push({
        type: 'char',
        char: char,
        pinyin: charPinyins.length > 0 ? charPinyins : [''], // Ensure at least one empty pinyin if none found
        selectedPinyinIndex: 0,
        dictionaryMatchWord: charDictionaryMatchWord,
        isInputSimplified: isCharSimplified,
        isDictionaryMatchSimplified: charIsDictionaryMatchSimplified,
      });
      currentIndex++;
    }
  }
  return results;
};

export const searchDictionary = (query: string, dictionary: DictionaryEntry[]): DictionaryEntry[] => {
  const lowerCaseQuery = query.toLowerCase();
  return dictionary.filter(entry =>
    entry.word.includes(query) ||
    entry.pinyin.some(p => p.toLowerCase().includes(lowerCaseQuery))
  );
};

export interface DictionaryEntry {
  word: string;
  pinyin: string[];
  definition: string;
}