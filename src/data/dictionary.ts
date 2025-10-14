import * as OpenCC from 'opencc-js';

interface DictionaryEntry {
  word: string;
  pinyin: string[];
  definition: string;
}

interface CharacterPinyinPair {
  char: string;
  pinyin: string[];
}

interface WordPinyinPair {
  word: string;
  pinyin: string[];
}

export type PinyinSegment = (CharacterPinyinPair | WordPinyinPair) & { selectedPinyinIndex?: number };

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
      const definition = parts.slice(2).join('\t');

      if (dictionaryMap.has(word)) {
        // If word already exists, add new pinyin to its pinyin array
        const existingEntry = dictionaryMap.get(word)!;
        if (!existingEntry.pinyin.includes(pinyin)) {
          existingEntry.pinyin.push(pinyin);
        }
      } else {
        dictionaryMap.set(word, { word, pinyin: [pinyin], definition });
      }
    }
  }
  return Array.from(dictionaryMap.values());
}

const converter = OpenCC.Converter({ from: 'cn', to: 't' });

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
      let entry = dictionaryMap.get(subSentence);

      if (!entry) {
        // If not found with simplified, try with traditional
        const traditionalSubSentence = converter(subSentence);
        entry = dictionaryMap.get(traditionalSubSentence);
      }

      if (entry && subSentence.length > bestMatchLength) {
        bestMatchWord = subSentence; // Keep the original simplified word for display
        bestMatchPinyins = entry.pinyin;
        bestMatchLength = subSentence.length;
      }
    }

    if (bestMatchLength > 0) {
      // Found a word/character match (could be single char or multi-char word)
      results.push({ type: 'word', word: bestMatchWord, pinyin: bestMatchPinyins, selectedPinyinIndex: 0 });
      currentIndex += bestMatchLength;
    } else {
      // If no match found for any length, treat the current character as a single segment
      const char = sentence[currentIndex];
      let entry = dictionaryMap.get(char);

      if (!entry) {
        const traditionalChar = converter(char);
        entry = dictionaryMap.get(traditionalChar);
      }
      results.push({ type: 'char', char: char, pinyin: entry ? entry.pinyin : [''], selectedPinyinIndex: 0 }); // If no pinyin, provide an empty array
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