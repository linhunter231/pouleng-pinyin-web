'use client';

import React, { useState, useEffect } from 'react';
import { DictionaryEntry, lookupPinyinForSentence, searchDictionary } from '../data/dictionary';

interface DictionarySearchProps {
  initialDictionary: DictionaryEntry[];
}

const DictionarySearch: React.FC<DictionarySearchProps> = ({ initialDictionary }) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PinyinSegment[][]>([]); // For sentence segmentation
  const [wordSearchResults, setWordSearchResults] = useState<DictionaryEntry[]>([]); // For direct word/pinyin search
  const [currentDictionary, setCurrentDictionary] = useState<DictionaryEntry[]>([]);
  const [showAllPinyins, setShowAllPinyins] = useState(true); // New state for toggling pinyin display

  useEffect(() => {
    setCurrentDictionary(initialDictionary);
    console.log('DictionarySearch: initialDictionary', initialDictionary.length);
  }, [initialDictionary]);

  useEffect(() => {
    console.log('DictionarySearch: current dictionary state', currentDictionary.length);
  }, [currentDictionary]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setSearchResults([]);
      setWordSearchResults([]);
      return;
    }

    // Heuristic to determine if it's a sentence or a single word/character search
    const isSentenceSearch = query.trim().includes(' ') || query.trim().length > 1 && !/^\p{Script=Han}$/u.test(query.trim());

    if (isSentenceSearch) {
      setWordSearchResults([]); // Clear word search results
      const lines = query.split(/\r?\n/); // Split query by newlines
      const resultsPerLine: PinyinSegment[][] = [];

      for (const line of lines) {
        if (line.trim() === '') {
          resultsPerLine.push([]); // Add an empty array for empty lines
        } else {
          const segments = lookupPinyinForSentence(currentDictionary, line);
          resultsPerLine.push(segments);
        }
      }
      setSearchResults(resultsPerLine);
    } else {
      setSearchResults([]); // Clear sentence search results
      const results = searchDictionary(query, currentDictionary);
      setWordSearchResults(results);
    }
  };

  const handlePinyinClick = (lineIndex: number, segmentIndex: number, pinyinIndex: number) => {
    setSearchResults(prevResults => {
      const newResults = [...prevResults];
      const segment = newResults[lineIndex][segmentIndex];
      if (segment) {
        segment.selectedPinyinIndex = pinyinIndex;
      }
      return newResults;
    });
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">莆仙话拼音查询</h1>
      <form onSubmit={handleSearch} className="mb-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入汉字或拼音查询..."
          className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={4} // 设置为多行文本框，并指定行数
        />
        <div className="flex items-center mt-2">
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            查询
          </button>
          <button
            type="button"
            onClick={() => setShowAllPinyins(!showAllPinyins)}
            className="ml-2 px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            {showAllPinyins ? '隐藏多余拼音' : '显示所有拼音'}
          </button>
        </div>
      </form>

      <div className="bg-gray-100 p-4 rounded-md">
        {wordSearchResults.length > 0 ? (
          <div>
            {wordSearchResults.map((entry, index) => (
              <div key={index} className="mb-2 p-2 border rounded-md bg-white">
                <p className="font-bold text-lg">{entry.word}</p>
                <div className="flex flex-wrap gap-1">
                  {entry.pinyin.map((p, pIndex) => (
                    <span key={pIndex} className="text-blue-700 text-lg">{p}</span>
                  ))}
                </div>
                <p className="text-gray-600">{entry.definition}</p>
              </div>
            ))}
          </div>
        ) : searchResults.length > 0 ? (
          <>
            <p className="text-sm text-gray-500 mb-2">提示：点击拼音可选择不同的读音。</p>
            {searchResults.map((lineSegments, lineIndex) => (
              <div key={lineIndex} className="mb-2">
                {lineSegments.length > 0 ? (
                  <div className="flex flex-wrap">
                    {lineSegments.map((segment, segmentIndex) => {
                      const selectedPinyin = segment.pinyin[segment.selectedPinyinIndex || 0];
                      const otherPinyins = segment.pinyin.filter((_, i) => i !== (segment.selectedPinyinIndex || 0));

                      return (
                        <div key={segmentIndex} className="flex flex-col items-center mx-1 min-w-[30px]">
                          {segment.type === 'char' ? (
                            <span className="font-bold text-lg text-center w-full">{segment.char}</span>
                          ) : (
                            <span className="font-bold text-lg text-center w-full">{segment.word}</span>
                          )}
                          <div className="flex flex-col items-center text-blue-700 text-lg text-center w-full min-h-[1.5em]">
                            <span
                              className="cursor-pointer font-bold text-blue-700"
                              onClick={() => handlePinyinClick(lineIndex, segmentIndex, segment.selectedPinyinIndex || 0)}
                            >
                              {selectedPinyin || ''}
                              {segment.dictionaryMatchWord && (segment.type === 'char' ? segment.char : segment.word) !== segment.dictionaryMatchWord && (
                                <span className="tag">
                                  ({segment.dictionaryMatchWord})
                                </span>
                              )}
                            </span>
                            {showAllPinyins && otherPinyins.map((p, i) => (
                              <span
                                key={i}
                                className="cursor-pointer text-gray-500"
                                onClick={() => handlePinyinClick(lineIndex, segmentIndex, segment.pinyin.indexOf(p))}
                              >
                                {p || ''}
                                {segment.dictionaryMatchWord && (segment.type === 'char' ? segment.char : segment.word) !== segment.dictionaryMatchWord && (
                                  <span className="tag">
                                    ({segment.dictionaryMatchWord})
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                          {segment.type === 'word' && segment.word.length > 1 && showAllPinyins && (
                            <div className="flex flex-col items-center mt-2 text-sm text-gray-600"> {/* Outer container for char-pinyin pairs */}
                              <div className="flex justify-center w-full"> {/* Row for pinyins */}
                                {segment.word.split('').map((char, charIndex) => {
                                  const charEntries = currentDictionary.filter(entry => entry.word === char);
                                  return (
                                    <div key={charIndex} className="flex flex-col items-center mx-1 min-w-[30px]"> {/* Container for each character's pinyins */}
                                      {charEntries && charEntries.length > 0 ? (
                                        charEntries.map((entry) => (
                                          entry.pinyin.map((pinyinItem, pinyinIndex) => (
                                            <div key={`${entry.id}-${pinyinIndex}`} className="text-xs text-gray-500 min-h-[1.2em]">
                                              {pinyinItem}
                                            </div>
                                          ))
                                        ))
                                      ) : (
                                        <div className="text-xs text-gray-500 min-h-[1.2em]"></div> // Placeholder for no pinyin
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-6"></div>
                )}
              </div>
            ))}
          </>
        ) : (
          <p>请输入查询内容或未找到结果。</p>
        )}
      </div>

      <div className="mt-4 text-sm text-gray-600">
        数据来源于此项目: <a href="https://github.com/Yaryou/HinghuaFactory" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">HinghuaFactory</a>
      </div>
      <div className="mt-2 text-sm text-gray-600">
        友情链接: <a href="https://hinghwa.cn/Home" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">興化語記：莆仙方言在线工具</a>
      </div>
    </div>
  );
};

export default DictionarySearch;