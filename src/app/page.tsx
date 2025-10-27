import DictionarySearch from '../components/DictionarySearch';
import { DictionaryEntry } from '../data/dictionary';
import { loadServerDictionaries } from '../lib/server-dictionary-utils';

export default async function Home() {
  const dictionaryFiles = [
    '/dictionaries/HinghuaBUC.dict.yaml',
    '/dictionaries/Pouleng.dict.yaml',
    '/dictionaries/NewDictionary.dict.yaml',
  ];

  const initialDictionary: DictionaryEntry[] = await loadServerDictionaries(dictionaryFiles);

  // console.log('Combined Dictionary:', initialDictionary);
  // console.log('矮字在字典中:', initialDictionary.find(entry => entry.word === '矮'));

  return <DictionarySearch initialDictionary={initialDictionary} />;
}
