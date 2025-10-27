import { promises as fs } from 'fs';
import path from 'path';
import { parseDictionaryFile, DictionaryEntry, PinyinDetail } from '../data/dictionary';

export const loadServerDictionaries = async (dictionaryFiles: string[]): Promise<DictionaryEntry[]> => {
  const mergedDictionaryMap = new Map<string, DictionaryEntry>();
  const rootDirectory = process.cwd();

  for (const filePath of dictionaryFiles) {
    try {
      const fullPath = path.join(rootDirectory, 'public', filePath);
      const fileContent = await fs.readFile(fullPath, 'utf-8');

      let sourceType: 'NewDictionary' | 'pouleng' = 'NewDictionary'; // Default to NewDictionary
      if (filePath.includes('Pouleng')) {
        sourceType = 'pouleng';
      }

      const currentDictionaryEntries = await parseDictionaryFile(fileContent, sourceType);

      for (const entry of currentDictionaryEntries) {
        if (mergedDictionaryMap.has(entry.word)) {
          const existingEntry = mergedDictionaryMap.get(entry.word)!;
          // Merge pinyins, ensuring uniqueness based on value and type
          for (const pinyinDetail of entry.pinyin) {
            if (!existingEntry.pinyin.some(p => p.value === pinyinDetail.value && p.type === pinyinDetail.type)) {
              existingEntry.pinyin.push(pinyinDetail);
            }
          }
          // Optionally, merge definitions if needed, or keep the first one
          // For now, we'll keep the first definition encountered for a word
        } else {
          mergedDictionaryMap.set(entry.word, { ...entry }); // Create a copy to avoid mutation issues
        }
      }

    } catch (error) {
      console.error(`Error loading dictionary from ${filePath} on server:`, error);
    }
  }
  return Array.from(mergedDictionaryMap.values());
};