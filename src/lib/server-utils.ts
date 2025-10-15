import fs from 'fs';
import path from 'path';
import { DictionaryEntry, parseDictionaryFile } from '../data/dictionary';

export async function loadDictionary(): Promise<DictionaryEntry[]> {
  const dictionariesPath = path.join(process.cwd(), 'src', 'data', 'dictionaries');
  let allEntries: DictionaryEntry[] = [];

  try {
    console.log('尝试从', dictionariesPath, '加载词典...');
    const files = await fs.promises.readdir(dictionariesPath);
    console.log('找到的词典文件:', files);
    const dictFiles = files.filter(file => file === 'Pouleng.dict.yaml');

    for (const file of dictFiles) {
      const filePath = path.join(dictionariesPath, file);
      const fileContent = await fs.promises.readFile(filePath, 'utf8');
      console.log('读取文件:', file, ', 内容长度:', fileContent.length);
      console.log('文件内容 (前500字符):', fileContent.substring(0, 500));

      // Find the end of the YAML header (marked by '...')
      const endOfHeaderIndex = fileContent.indexOf('...');
      let dictionaryContent = fileContent;

      if (endOfHeaderIndex !== -1) {
        // Extract content after the '...' line
        dictionaryContent = fileContent.substring(endOfHeaderIndex + 3);
      }

      const parsedEntries = await parseDictionaryFile(dictionaryContent);

      console.log('解析文件:', file, ', 条目数:', parsedEntries.length);
      allEntries = allEntries.concat(parsedEntries);
    }
    console.log('总共加载的词典条目数:', allEntries.length);
  } catch (error) {
    console.error('加载词典失败:', error);
  }

  return allEntries;
}