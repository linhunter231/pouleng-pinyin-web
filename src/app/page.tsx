import DictionarySearch from '../components/DictionarySearch';
import { loadDictionary } from '../lib/server-utils';

export default async function Home() {
  const initialDictionary = await loadDictionary();

  return <DictionarySearch initialDictionary={initialDictionary} />;
}
