export interface DictionaryEntry {
  word: string;
  pinyin: string[]; // Changed to string array
}

export interface CharacterPinyinPair {
  type: 'char';
  char: string;
  pinyin: string[]; // Changed to string array
}

export interface WordPinyinPair {
  type: 'word';
  word: string;
  pinyin: string[]; // Changed to string array
}

export type PinyinSegment = CharacterPinyinPair | WordPinyinPair;

// 从词典文件解析数据
export function parseDictionaryFile(fileContent: string): DictionaryEntry[] {
  const lines = fileContent.split('\n');
  const dictionaryMap = new Map<string, DictionaryEntry>();

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const parts = trimmedLine.split('\t');
    if (parts.length >= 2) {
      const word = parts[0];
      const pinyin = parts[1];

      if (dictionaryMap.has(word)) {
        dictionaryMap.get(word)?.pinyin.push(pinyin);
      } else {
        dictionaryMap.set(word, { word, pinyin: [pinyin] });
      }
    }
  }
  return Array.from(dictionaryMap.values());
}

export function lookupPinyinForSentence(dictionary: DictionaryEntry[], sentence: string): PinyinSegment[] {
  const results: PinyinSegment[] = [];
  let currentIndex = 0;

  const dictionaryMap = new Map<string, DictionaryEntry>();
  for (const entry of dictionary) {
    dictionaryMap.set(entry.word, entry);
  }

  while (currentIndex < sentence.length) {
    let bestMatchWord = '';
    let bestMatchPinyins: string[] = [];
    let bestMatchLength = 0;

    // Try to find the longest match starting from currentIndex
    for (let i = currentIndex; i < sentence.length; i++) {
      const subSentence = sentence.substring(currentIndex, i + 1);
      const entry = dictionaryMap.get(subSentence);

      if (entry && subSentence.length > bestMatchLength) {
        bestMatchWord = entry.word;
        bestMatchPinyins = entry.pinyin;
        bestMatchLength = subSentence.length;
      }
    }

    if (bestMatchLength > 0) {
      // Found a word/character match (could be single char or multi-char word)
      results.push({ type: 'word', word: bestMatchWord, pinyin: bestMatchPinyins });
      currentIndex += bestMatchLength;
    } else {
      // If no match found for any length, treat the current character as a single segment
      const char = sentence[currentIndex];
      const entry = dictionaryMap.get(char);
      results.push({ type: 'char', char: char, pinyin: entry ? entry.pinyin : [''] }); // If no pinyin, provide an empty array
      currentIndex++;
    }
  }

  return results;
}

// The existing searchDictionary function will be kept for direct word/pinyin search if needed.
export function searchDictionary(dictionary: DictionaryEntry[], query: string): DictionaryEntry[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();

  return dictionary.filter(entry => 
    entry.word.includes(lowerQuery) || 
    entry.pinyin.some(p => p.toLowerCase().includes(lowerQuery))
  );
}