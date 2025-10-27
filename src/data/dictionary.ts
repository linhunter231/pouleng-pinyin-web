import * as OpenCC from 'opencc-js';

export interface PinyinDetail {
  value: string;
  type: '文' | '白' | 'pouleng' | 'unknown';
}

export const parseDictionaryFile = async (fileContent: string, sourceType: 'NewDictionary' | 'pouleng'): Promise<DictionaryEntry[]> => {
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
      let pinyinValue = parts[1];
      const definition = parts.slice(2).join('\t');

      let pinyinType: '文' | '白' | 'pouleng' | 'unknown' = 'unknown';

      if (sourceType === 'NewDictionary') {
        if (definition.includes('文读')) {
          pinyinType = '文';
        } else if (definition.includes('白读')) {
          pinyinType = '白';
        }
      } else if (sourceType === 'pouleng') {
        pinyinType = 'pouleng';
      }

      const pinyinDetail: PinyinDetail = { value: pinyinValue, type: pinyinType };

      if (localDictionaryMap.has(word)) {
        const existingEntry = localDictionaryMap.get(word)!;
        // Check if pinyinDetail with same value and type already exists
        if (!existingEntry.pinyin.some(p => p.value === pinyinDetail.value && p.type === pinyinDetail.type)) {
          existingEntry.pinyin.push(pinyinDetail);
        }
      } else {
        localDictionaryMap.set(word, { word, pinyin: [pinyinDetail], definition });
      }
    }
  }
  return Array.from(localDictionaryMap.values());
};

export const loadDictionary = async (filePath: string, sourceType: 'NewDictionary' | 'pouleng'): Promise<DictionaryEntry[]> => {
  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to load dictionary from ${filePath}: ${response.statusText}`);
    }
    const fileContent = await response.text();
    return parseDictionaryFile(fileContent, sourceType);
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
  pinyin: PinyinDetail[];
  selectedPinyinIndex: number;
  dictionaryMatchWord?: string;
  isInputSimplified?: boolean; // New field
  isDictionaryMatchSimplified?: boolean; // New field
  readingType?: '文' | '白'; // New field to indicate reading type
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
    let bestMatchPinyins: PinyinDetail[] = []; // Initialize as empty array
    let bestMatchWord: string = ''; // This will be the original input word segment
    let bestMatchDictionaryWord: string | undefined; // This will be the word found in the dictionary (could be traditional)
    let bestMatchIsInputSimplified: boolean | undefined;
    let bestMatchIsDictionaryMatchSimplified: boolean | undefined;
    let bestMatchReadingType: '文' | '白' | undefined; // New variable for reading type
  
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

        // Determine reading type from definition
        const wenDuPinyin = candidateEntry.pinyin.find(p => p.type === '文');
        const baiDuPinyin = candidateEntry.pinyin.find(p => p.type === '白');
        if (wenDuPinyin) {
          bestMatchReadingType = '文';
        } else if (baiDuPinyin) {
          bestMatchReadingType = '白';
        }
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
        readingType: bestMatchReadingType, // Assign reading type
      });
      currentIndex += bestMatchLength;
    } else {
      // If no word match, treat as single character
      const char = sentence[currentIndex];
      const isCharSimplified = isSimplified(char);
      let charPinyins: PinyinDetail[] = [];
      let charDictionaryMatchWord: string | undefined;
      let charIsDictionaryMatchSimplified: boolean | undefined;
      let charReadingType: '文' | '白' | undefined; // New variable for reading type
  
      // Check for direct character match
      if (localDictionaryMap.has(char)) {
        const entry = localDictionaryMap.get(char)!;
        charPinyins = entry.pinyin;
        charDictionaryMatchWord = char;
        charIsDictionaryMatchSimplified = isSimplified(char);
        const wenDuPinyin = entry.pinyin.find(p => p.type === '文');
        const baiDuPinyin = entry.pinyin.find(p => p.type === '白');
        if (wenDuPinyin) {
          charReadingType = '文';
        } else if (baiDuPinyin) {
          charReadingType = '白';
        }
      }
  
      // If no direct match, or if the input is simplified and we can find a traditional equivalent
      const traditionalChar = converter(char);
      if (traditionalChar !== char) {
        if (localDictionaryMap.has(traditionalChar)) {
          const entry = localDictionaryMap.get(traditionalChar)!;
          // Merge pinyins, ensuring no duplicates based on value and type
          for (const p of entry.pinyin) {
            if (!charPinyins.some(cp => cp.value === p.value && cp.type === p.type)) {
              charPinyins.push(p);
            }
          }
          if (!charDictionaryMatchWord) {
            charDictionaryMatchWord = traditionalChar;
            charIsDictionaryMatchSimplified = isSimplified(traditionalChar);
            const wenDuPinyin = entry.pinyin.find(p => p.type === '文');
            const baiDuPinyin = entry.pinyin.find(p => p.type === '白');
            if (wenDuPinyin) {
              charReadingType = '文';
            } else if (baiDuPinyin) {
              charReadingType = '白';
            }
          }
        }
      }
  
      // If no match yet, and input is traditional, try simplified
      const simplifiedChar = t2sConverter(char);
      if (simplifiedChar !== char) {
        if (localDictionaryMap.has(simplifiedChar)) {
          const entry = localDictionaryMap.get(simplifiedChar)!;
          // Merge pinyins, ensuring no duplicates based on value and type
          for (const p of entry.pinyin) {
            if (!charPinyins.some(cp => cp.value === p.value && cp.type === p.type)) {
              charPinyins.push(p);
            }
          }
          if (!charDictionaryMatchWord) {
            charDictionaryMatchWord = simplifiedChar;
            charIsDictionaryMatchSimplified = isSimplified(simplifiedChar);
            const wenDuPinyin = entry.pinyin.find(p => p.type === '文');
            const baiDuPinyin = entry.pinyin.find(p => p.type === '白');
            if (wenDuPinyin) {
              charReadingType = '文';
            } else if (baiDuPinyin) {
              charReadingType = '白';
            }
          }
        }
      }
  
      results.push({
        type: 'char',
        char: char,
        pinyin: charPinyins.length > 0 ? charPinyins : [{ value: '', type: 'unknown' }], // Ensure at least one empty pinyin if none found
        selectedPinyinIndex: 0,
        dictionaryMatchWord: charDictionaryMatchWord,
        isInputSimplified: isCharSimplified,
        isDictionaryMatchSimplified: charIsDictionaryMatchSimplified,
        readingType: charReadingType, // Assign reading type
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
    entry.pinyin.some(p => p.value.toLowerCase().includes(lowerCaseQuery))
  );
};

export interface DictionaryEntry {
  word: string;
  pinyin: PinyinDetail[];
  definition: string;
}