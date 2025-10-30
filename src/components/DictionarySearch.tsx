'use client';

import React, { useState, useEffect } from 'react';
import { DictionaryEntry, lookupPinyinForSentence, searchDictionary, PinyinSegment, sortPinyins } from '../data/dictionary';

interface DictionarySearchProps {
  initialDictionary: DictionaryEntry[];
}

const DictionarySearch: React.FC<DictionarySearchProps> = ({ initialDictionary }) => {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PinyinSegment[][]>([]); // For sentence segmentation
  const [wordSearchResults, setWordSearchResults] = useState<DictionaryEntry[]>([]); // For direct word/pinyin search
  const [currentDictionary, setCurrentDictionary] = useState<DictionaryEntry[]>([]);
  const [showAllPinyins, setShowAllPinyins] = useState(true); // New state for toggling pinyin display
  const [readingPreference, setReadingPreference] = useState<'文' | '白' | undefined>('文'); // New state for reading preference
  const [showDebug, setShowDebug] = useState(false); // Debug panel toggle
  const [copyFeedback, setCopyFeedback] = useState(''); // New state for copy feedback

  useEffect(() => {
    setCurrentDictionary(initialDictionary);
  }, [initialDictionary]);

  // Effect to read readingPreference from URL on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlReadingPreference = params.get('readingPreference');
    if (urlReadingPreference === '文' || urlReadingPreference === '白') {
      setReadingPreference(urlReadingPreference);
    }
    const debugParam = params.get('debug');
    if (debugParam === '1' || debugParam === 'true') {
      setShowDebug(true);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setSearchResults([]);
      setWordSearchResults([]);
      return;
    }

    // Heuristic: treat a single Han character as segmentation to show per-char details
    const trimmed = query.trim();
    const isSingleHanChar = trimmed.length === 1 && /^\p{Script=Han}$/u.test(trimmed);
    const isSentenceSearch = isSingleHanChar || trimmed.includes(' ') || (trimmed.length > 1 && !/^\p{Script=Han}$/u.test(trimmed));

    if (isSentenceSearch) {
      setWordSearchResults([]); // Clear word search results
      const lines = query.split(/\r?\n/); // Split query by newlines
      const resultsPerLine: PinyinSegment[][] = [];

      for (const line of lines) {
        if (line.trim() === '') {
          resultsPerLine.push([]); // Add an empty array for empty lines
        } else {
          let segments = lookupPinyinForSentence(currentDictionary, line, readingPreference);
          // Sort pinyins within each segment based on preference
          segments = segments.map(segment => ({
            ...segment,
            pinyin: sortPinyins(segment.pinyin, readingPreference),
          }));
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

  const handleCopyResults = () => {
    if (searchResults.length === 0) {
      setCopyFeedback('没有可复制的结果');
      setTimeout(() => setCopyFeedback(''), 2000);
      return;
    }

    let formattedLines: string[] = [];

    searchResults.forEach(lineSegments => {
      const segmentData: { hanzi: string; pinyin: string }[] = [];
      lineSegments.forEach(segment => {
        const hanzi = (segment.type === 'char' ? segment.char : segment.word) || '';
        const selectedPinyinDetail = segment.pinyin[segment.selectedPinyinIndex || 0];
        const pinyin = selectedPinyinDetail ? selectedPinyinDetail.value : '';
        segmentData.push({ hanzi, pinyin });
      });

      let hanziLine = '';
      let pinyinLine = '';

      segmentData.forEach(data => {
        const hanziLen = data.hanzi.length;
        const pinyinLen = data.pinyin.length;

        const maxLen = Math.max(hanziLen, pinyinLen);

        hanziLine += data.hanzi.padEnd(maxLen, ' ') + ' '; // Add an extra space for separation
        pinyinLine += data.pinyin.padEnd(maxLen, ' ') + ' '; // Add an extra space for separation
      });

      formattedLines.push(hanziLine.trim());
      formattedLines.push(pinyinLine.trim());
    });

    const copiedText = formattedLines.join('\n');

    navigator.clipboard.writeText(copiedText.trim())
      .then(() => {
        setCopyFeedback('已复制！');
        setTimeout(() => setCopyFeedback(''), 2000);
      })
      .catch(err => {
        console.error('复制失败:', err);
        setCopyFeedback('复制失败');
        setTimeout(() => setCopyFeedback(''), 2000);
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
          <button
            type="button"
            onClick={handleCopyResults}
            className="ml-2 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            复制结果
          </button>
          {copyFeedback && <span className="ml-2 text-green-600">{copyFeedback}</span>}
          <div className="ml-4 flex items-center">
            <span className="mr-2">拼音偏好:</span>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio"
                name="readingPreference"
                value="文"
                checked={readingPreference === '文'}
                onChange={() => setReadingPreference('文')}
              />
              <span className="ml-1">文读</span>
            </label>
            <label className="inline-flex items-center ml-2">
              <input
                type="radio"
                className="form-radio"
                name="readingPreference"
                value="白"
                checked={readingPreference === '白'}
                onChange={() => setReadingPreference('白')}
              />
              <span className="ml-1">白读</span>
            </label>
            <label className="inline-flex items-center ml-2">
              <input
                type="radio"
                className="form-radio"
                name="readingPreference"
                value="无"
                checked={readingPreference === undefined}
                onChange={() => setReadingPreference(undefined)}
              />
              <span className="ml-1">无偏好</span>
            </label>
          </div>
        </div>
      </form>

      <div className="bg-gray-100 p-4 rounded-md">
        {wordSearchResults.length > 0 ? (
          <div>
            {wordSearchResults.map((entry, index) => (
              <div key={index} className="mb-2 p-2 border rounded-md bg-white">
                <p className="font-bold text-lg">{entry.word}</p>
                <div className="flex flex-wrap gap-1">
                  {entry.pinyin.map((pinyinDetail, pIndex) => (
                    <span key={pIndex} className="text-blue-700 text-lg">{pinyinDetail.value}</span>
                  ))}
                </div>
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
                      const selectedPinyinDetail = segment.pinyin[segment.selectedPinyinIndex || 0];
                      let displaySelectedPinyinValue = selectedPinyinDetail.value;

                      // Add the marker if it's a '文' or '白' type
                      if (showAllPinyins && (selectedPinyinDetail.type === '文' || selectedPinyinDetail.type === '白')) {
                        displaySelectedPinyinValue += `(${selectedPinyinDetail.type})`;
                      }

                      const otherPinyinDetails = segment.pinyin.filter((_, i) => i !== (segment.selectedPinyinIndex || 0));

                      return (
                        <div key={segmentIndex} className="flex flex-col items-center mx-1 min-w-[30px]">
                          {segment.type === 'char' ? (
                            <span className="font-bold text-lg text-center w-full">
                              {segment.char}
                            </span>
                          ) : (
                            <span className="font-bold text-lg text-center w-full">
                              {segment.word}
                            </span>
                          )}
                          <div className="flex flex-col items-center text-blue-700 text-lg text-center w-full min-h-[1.5em]">
                            <span
                              className="cursor-pointer font-bold text-blue-700"
                              onClick={() => handlePinyinClick(lineIndex, segmentIndex, segment.selectedPinyinIndex || 0)}
                              title={selectedPinyinDetail.definition}
                            >
                              {displaySelectedPinyinValue || ''}
                              {showAllPinyins && selectedPinyinDetail && selectedPinyinDetail.fromTraditional && segment.traditional && (
                                <span className="tag text-gray-500 ml-1 text-sm">({segment.traditional})</span>
                              )}
                              {showAllPinyins && selectedPinyinDetail && selectedPinyinDetail.fromSimplified && segment.simplified && (
                                <span className="tag text-gray-500 ml-1 text-sm">({segment.simplified})</span>
                              )}
                              {showAllPinyins && segment.dictionaryMatchWord &&
                                (segment.type === 'char' ? segment.char : segment.word) !== segment.dictionaryMatchWord &&
                                segment.dictionaryMatchWord !== segment.traditional &&
                                segment.dictionaryMatchWord !== segment.simplified && (
                                <span className="tag text-gray-500 ml-1 text-sm">
                                  ({segment.dictionaryMatchWord})
                                </span>
                              )}
                            </span>
                            {showAllPinyins && otherPinyinDetails.map((pinyinDetail, i) => {
                              let displayOtherPinyinValue = pinyinDetail.value;
                              if (showAllPinyins && (pinyinDetail.type === '文' || pinyinDetail.type === '白')) {
                                displayOtherPinyinValue += `(${pinyinDetail.type})`;
                              }
                                  return (
                                    <span
                                      key={i}
                                      className="cursor-pointer text-gray-500"
                                      onClick={() => handlePinyinClick(lineIndex, segmentIndex, segment.pinyin.indexOf(pinyinDetail))}
                                      title={pinyinDetail.definition}
                                    >
                                      {displayOtherPinyinValue || ''}
                                      {pinyinDetail && pinyinDetail.fromTraditional && segment.traditional && (
                                        <span className="tag text-gray-500 ml-1 text-sm">({segment.traditional})</span>
                                      )}
                                      {pinyinDetail && pinyinDetail.fromSimplified && segment.simplified && (
                                        <span className="tag text-gray-500 ml-1 text-sm">({segment.simplified})</span>
                                      )}
                                      {showAllPinyins && segment.dictionaryMatchWord &&
                                        (segment.type === 'char' ? segment.char : segment.word) !== segment.dictionaryMatchWord &&
                                        segment.dictionaryMatchWord !== segment.traditional &&
                                        segment.dictionaryMatchWord !== segment.simplified && (
                                        <span className="tag text-gray-500 ml-1 text-sm">
                                          ({segment.dictionaryMatchWord})
                                        </span>
                                      )}
                                    </span>
                                  );
                              })}
                          </div>
                          {showDebug && showAllPinyins && (
                            <div className="mt-1 text-xs text-gray-500 w-full text-center">
                              调试: {segment.type === 'char' ? `char=${segment.char}` : `word=${segment.word}`} | traditional={segment.traditional || ''} | isTraditionalMatch={segment.isTraditionalMatch ? 'true' : 'false'} | simplified={segment.simplified || ''} | isSimplifiedMatch={segment.isSimplifiedMatch ? 'true' : 'false'} | dictionaryMatchWord={segment.dictionaryMatchWord || ''}
                            </div>
                          )}
                          {segment.type === 'word' && segment.word && segment.word.length > 1 && showAllPinyins && segment.charPinyinDetails && (
                            <div className="flex flex-col items-center mt-2 text-sm text-gray-600"> {/* Outer container for char-pinyin pairs */}
                              <div className="flex justify-center w-full"> {/* Row for pinyins */}
                                {segment.charPinyinDetails.map((charDetail, charIndex) => (
                                  <div key={charIndex} className="flex flex-col items-center mx-1 min-w-[30px]"> {/* Container for each character's pinyins */}
                                    {charDetail.pinyinDetails.map((pinyinItem, pinyinIndex) => {
                                      const displayMarker = showAllPinyins && pinyinItem.type && (pinyinItem.type === '文' || pinyinItem.type === '白');
                                      return (
                                        <div key={`${charIndex}-${pinyinIndex}`} className="text-xs text-gray-500 min-h-[1.2em]" title={pinyinItem.definition}>
                                          {pinyinItem.value}{displayMarker && `(${pinyinItem.type})`}
                                          {pinyinItem.fromTraditional && charDetail.charTraditional && (
                                            <span className="tag text-gray-500 ml-1">({charDetail.charTraditional})</span>
                                          )}
                                          {pinyinItem.fromSimplified && charDetail.charSimplified && (
                                            <span className="tag text-gray-500 ml-1">({charDetail.charSimplified})</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
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
        数据来源: 《莆仙方言文读字汇》
      </div>
      <div className="mt-2 text-sm text-gray-600">
        友情链接: <a href="https://hinghwa.cn/Home" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">興化語記：莆仙方言在线工具</a>
      </div>
    </div>
  );
};

export default DictionarySearch;