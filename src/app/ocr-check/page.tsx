"use client";

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import Image from 'next/image';
import JSZip from 'jszip'; // Import JSZip
import { useSearchParams } from 'next/navigation'; // Import useSearchParams

interface OcrDetectionItem {
  DetectedText: string;
  Confidence: number;
  ItemPolygon: {
    X: number;
    Y: number;
    Width: number;
    Height: number;
  };
  AdvancedInfo: string;
}

type OcrResult = OcrDetectionItem[];

export default function OcrCheckPage() {
  // 将组件内容包装在Suspense中以支持useSearchParams
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OcrCheckPageContent />
    </Suspense>
  );
}

// 实际的组件内容移到这个子组件中
function OcrCheckPageContent() {
  const searchParams = useSearchParams();
  const enableRemote = searchParams.get('remote') === 'true'; // Check if remote mode is enabled via URL parameter

  const [ocrData, setOcrData] = useState<OcrResult | null>(null);
  const [initialOcrData, setInitialOcrData] = useState<OcrResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [focusedElementIndex, setFocusedElementIndex] = useState<number | null>(null); // New state for tracking focused element
  // Insert a visual line break at the caret inside a contentEditable element
  const insertLineBreakAtCaret = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const br = document.createElement('br');
    range.insertNode(br);
    // Move caret after the inserted BR
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const [originalOcrDimensions, setOriginalOcrDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageRenderedDimensions, setImageRenderedDimensions] = useState<{ width: number; height: number; naturalWidth: number; naturalHeight: number; offsetX: number; offsetY: number; containerHeight: number } | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [fileIndex, setFileIndex] = useState<Record<string, { hasImage: boolean; hasJson: boolean }>>({});
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);
  const currentEditableInfo = useRef<{ element: HTMLElement; index: number; caretOffset?: number } | null>(null);
  const pinyinButtonsRef = useRef<HTMLDivElement>(null);
  const rightRawRef = useRef<HTMLDivElement>(null);
  const rightParagraphRef = useRef<HTMLDivElement>(null);
  const isSyncingScrollRef = useRef(false);
  const prevIsLocalModeRef = useRef<boolean | null>(null);

  // Local mode states
  const [imageZipFile, setImageZipFile] = useState<File | null>(null);
  const [jsonZipFile, setJsonZipFile] = useState<File | null>(null);
  const [localImageUrls, setLocalImageUrls] = useState<Record<string, string>>({});
  const [localJsonData, setLocalJsonData] = useState<Record<string, any>>({});
  const [editedLocalJsonData, setEditedLocalJsonData] = useState<Record<string, any>>({});
  const [isLocalMode, setIsLocalMode] = useState<boolean>(!enableRemote); // Set initial mode based on URL parameter

  // Image zoom states
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const [zoomedImageSrc, setZoomedImageSrc] = useState<string>('');

  // Local zoom states
  const [isLocalZoomActive, setIsLocalZoomActive] = useState(false);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });
  const [imageOffset, setImageOffset] = useState({ top: 0, left: 0 });

  // 添加控制图上定位文本位置的状态
  const [overlayPosition, setOverlayPosition] = useState<'left' | 'right'>('right');
  const [overlayOffset, setOverlayOffset] = useState<{ x: number; y: number }>({ x: 5, y: 5 });

  // 添加控制左侧图片是否放大的状态
  const [isLeftImageExpanded, setIsLeftImageExpanded] = useState(false);

  // 右侧视图模式：图上定位文本 / 原始 JSON / 段号排序文本
  const [rightViewMode, setRightViewMode] = useState<'overlay' | 'raw' | 'paragraph'>('overlay');

  // 同步左右两侧的滚动（在原始JSON/按段号模式下)
  useEffect(() => {
    const leftEl = leftPaneRef.current;
    const rightEl = rightViewMode === 'raw' ? rightRawRef.current : rightViewMode === 'paragraph' ? rightParagraphRef.current : null;
    if (!leftEl || !rightEl) return;

    // 初始同步一次滚动位置
    rightEl.scrollTop = leftEl.scrollTop;

    const handleLeftScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      rightEl.scrollTop = leftEl.scrollTop;
      isSyncingScrollRef.current = false;
    };
    const handleRightScroll = () => {
      if (isSyncingScrollRef.current) return;
      isSyncingScrollRef.current = true;
      leftEl.scrollTop = rightEl.scrollTop;
      isSyncingScrollRef.current = false;
    };

    leftEl.addEventListener('scroll', handleLeftScroll);
    rightEl.addEventListener('scroll', handleRightScroll);
    return () => {
      leftEl.removeEventListener('scroll', handleLeftScroll);
      rightEl.removeEventListener('scroll', handleRightScroll);
    };
  }, [rightViewMode]);

  // 从 AdvancedInfo 中安全读取 ParagNo
  const getParagNo = (item: OcrDetectionItem): number | null => {
    try {
      const adv = JSON.parse(item.AdvancedInfo || '{}');
      const val = adv?.Parag?.ParagNo;
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const n = Number(val);
        return Number.isNaN(n) ? null : n;
      }
      return null;
    } catch {
      return null;
    }
  };

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        // You can trigger save functionality here if needed
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 当overlayPosition改变时，如果移到左侧，则右侧自动切换到原始JSON视图
  useEffect(() => {
    if (overlayPosition === 'left' && rightViewMode === 'overlay') {
      setRightViewMode('raw');
    }
  }, [overlayPosition, rightViewMode]);

  // 计算段落行
  const paragraphLines = useMemo(() => {
    if (!ocrData || ocrData.length === 0) return [] as { paragNo: number | null; text: string }[];
    const groups = new Map<number | null, OcrDetectionItem[]>();
    for (const d of ocrData) {
      const key = getParagNo(d);
      const arr = groups.get(key) || [];
      arr.push(d);
      groups.set(key, arr);
    }
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
    const lines: { paragNo: number | null; text: string }[] = [];
    for (const k of sortedKeys) {
      const arr = groups.get(k)!;
      arr.sort((p, q) => {
        const py = p.ItemPolygon?.Y ?? 0;
        const qy = q.ItemPolygon?.Y ?? 0;
        if (py !== qy) return py - qy;
        const px = p.ItemPolygon?.X ?? 0;
        const qx = q.ItemPolygon?.X ?? 0;
        return px - qx;
      });
      const text = arr.map(x => (x.DetectedText || '').trim()).filter(Boolean).join(' ');
      lines.push({ paragNo: k, text });
    }
    return lines;
  }, [ocrData]);

  // Function to clean up object URLs only when component unmounts
  // 重要：移除localImageUrls依赖，防止每次更新时都清理URL
  useEffect(() => {
    return () => {
      // 添加安全检查
      try {
        const urls = Object.values(localImageUrls);
        console.log(`组件卸载时清理 ${urls.length} 个blob URLs`);
        urls.forEach(url => {
          if (url && url.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(url);
            } catch (e) {
              console.warn('撤销blob URL失败:', e);
            }
          }
        });
      } catch (error) {
        console.error('清理blob URLs时发生错误:', error);
      }
    };
  }, []); // 空依赖数组，确保只在组件卸载时执行

  const currentFileName = fileNames[currentImageIndex];
  const imageName = currentFileName ? `${currentFileName}.png` : '';
  const jsonName = currentFileName ? `${currentFileName}.json` : '';
  console.log("Current imageName:", imageName, "and jsonName:", jsonName);

  // Effect to update editedLocalJsonData when ocrData changes for the current file
  useEffect(() => {
    if (isLocalMode && currentFileName && ocrData) {
      setEditedLocalJsonData(prevData => ({
        ...prevData,
        [currentFileName]: {
          ...prevData[currentFileName],
          Response: {
            ...prevData[currentFileName]?.Response,
            TextDetections: ocrData,
          },
          TextDetections: ocrData, // Also update top-level if it exists
        },
      }));
    }
  }, [isLocalMode, currentFileName, ocrData]);

  // Handlers for local file uploads
  const handleImageZipUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      console.log('没有选择文件');
      return;
    }
    
    const file = files[0];
    console.log(`开始处理文件: ${file.name}, 大小: ${file.size} bytes, 类型: ${file.type}`);

    if (!isLocalMode) {
      console.log('切换到本地模式');
      setIsLocalMode(true);
    }
    
    setLoading(true);
    setError(null);

    try {
      // 检查是单个图片文件还是ZIP文件
      if (file.name.endsWith('.zip')) {
        // 处理ZIP文件
        setImageZipFile(file);
        
        // 显示进度提示
        const progressInterval = setInterval(() => {
          console.log('正在解压图片ZIP，请稍候...');
        }, 1000);

        try {
          console.log('开始加载ZIP文件...');
          const zip = await JSZip.loadAsync(file);
          console.log('ZIP文件加载成功，包含文件数量:', Object.keys(zip.files).length);
          const newImageUrls: Record<string, string> = {};
          const newFileNames: string[] = [];
          const totalFiles = Object.keys(zip.files).length;
          let processedCount = 0;

          for (const relativePath in zip.files) {
            const zipEntry = zip.files[relativePath];
            if (!zipEntry.dir && (relativePath.endsWith('.png') || relativePath.endsWith('.jpg') || relativePath.endsWith('.jpeg'))) {
              try {
                console.log(`处理ZIP内文件: ${relativePath}`);
                const blob = await zipEntry.async('blob');
                console.log(`文件 ${relativePath} 解压为blob成功，大小: ${blob.size} bytes, 类型: ${blob.type}`);
                
                // 创建blob的副本，确保引用不会被意外释放
                const blobCopy = new Blob([blob], { type: blob.type });
                console.log(`创建blob副本成功`);
                
                const url = URL.createObjectURL(blobCopy);
                const fileName = relativePath.split('/').pop()?.split('.')[0];
                
                if (fileName) {
                  console.log(`从ZIP添加图片URL: ${fileName} -> ${url}`);
                  newImageUrls[fileName] = url;
                  newFileNames.push(fileName);
                } else {
                  console.warn(`无法提取有效文件名: ${relativePath}`);
                }
              } catch (fileError) {
                console.error(`处理文件 ${relativePath} 时出错:`, fileError);
              }
              processedCount++;
            }
          }

          clearInterval(progressInterval);
          
          console.log(`ZIP文件处理完成，成功提取 ${Object.keys(newImageUrls).length} 个图片文件`);
          
          if (Object.keys(newImageUrls).length === 0) {
            throw new Error('ZIP文件中没有找到有效的图片文件(.png, .jpg, .jpeg)');
          }

          setLocalImageUrls(prev => {
            const updated = { ...prev, ...newImageUrls };
            console.log(`更新localImageUrls状态: 原大小 ${Object.keys(prev).length}, 新大小 ${Object.keys(updated).length}`);
            return updated;
          });
          // 更新fileNames数组，确保从ZIP加载的图片文件能够被正确引用
          setFileNames(prev => {
            const currentFileNames = [...prev];
            newFileNames.forEach(name => {
              if (!currentFileNames.includes(name)) {
                currentFileNames.push(name);
              }
            });
            return currentFileNames;
          });
          // 确保选中第一个新上传的文件
          if (newFileNames.length > 0) {
            // 使用setTimeout确保在fileNames更新后再设置currentImageIndex
            setTimeout(() => {
              setCurrentImageIndex(prevIndex => {
                console.log(`设置当前图片索引，新文件名列表:`, newFileNames);
                return 0; // 选择第一个文件
              });
            }, 0);
          }
          console.log(`成功加载 ${Object.keys(newImageUrls).length} 个图片文件`);
          
          // 提示用户加载结果
          if (Object.keys(localJsonData).length > 0) {
            alert(`成功从ZIP中加载 ${Object.keys(newImageUrls).length} 个图片文件。文件将与已加载的JSON进行匹配。`);
          }
        } finally {
          clearInterval(progressInterval);
        }
      } else {
        // 处理单个图片文件
        if (!file.type.startsWith('image/')) {
          throw new Error('请上传有效的图片文件');
        }
        
        // 为避免连续上传时的问题，创建新的file对象副本
        try {
          const fileCopy = new File([file], file.name, { type: file.type });
          console.log(`创建文件副本成功: ${fileCopy.name}`);
          
          const url = URL.createObjectURL(fileCopy);
          const fileName = file.name.replace(/\.[^/.]+$/, "");
          
          console.log(`创建blob URL成功: ${url}`);
          
          // 使用函数式更新确保状态的一致性
          setLocalImageUrls(prev => {
            console.log(`更新localImageUrls状态: 添加 ${fileName} -> ${url}`);
            return { ...prev, [fileName]: url };
          });
        } catch (urlError) {
          console.error('创建blob URL时出错:', urlError);
          throw new Error(`创建图片URL失败: ${urlError.message}`);
        }
        
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        
        // 更新fileNames数组，确保新上传的图片能够被正确引用
        setFileNames(prev => {
          const updated = !prev.includes(fileName) ? [...prev, fileName] : prev;
          console.log(`更新fileNames数组: 原长度 ${prev.length}, 新长度 ${updated.length}`);
          return updated;
        });
        
        // 使用setTimeout确保在fileNames更新后再设置currentImageIndex
        setTimeout(() => {
          setCurrentImageIndex(0); // 始终选择新上传的文件
          console.log(`设置currentImageIndex为0，选择新上传的文件: ${fileName}`);
        }, 0);
        
        console.log("已加载单个图片:", fileName);
        alert(`成功加载图片文件: ${fileName}`);
      }
    } catch (e: any) {
      console.error("加载图片文件出错:", e);
      const errorMessage = `加载图片文件出错: ${e.message || String(e)}`;
      setError(errorMessage);
      alert(`加载图片文件失败: ${e.message || String(e)}`);
    } finally {
      setLoading(false);
      // 重置文件输入，允许重复选择相同文件
      if (event.target) {
        event.target.value = '';
        console.log('重置文件输入，允许重复选择相同文件');
      }
    }
  }, [localJsonData, isLocalMode]);

  const handleJsonZipUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isLocalMode) setIsLocalMode(true);
    setLoading(true);
    setError(null);

    try {
      // 检查是单个JSON文件还是ZIP文件
      if (file.name.endsWith('.zip')) {
        // 处理ZIP文件
        setJsonZipFile(file);
        
        // 显示进度提示
        const progressInterval = setInterval(() => {
          console.log('正在解压JSON ZIP，请稍候...');
        }, 1000);

        try {
          const zip = await JSZip.loadAsync(file);
          const newJsonData: Record<string, any> = {};
          const failedFiles: string[] = [];
          const totalFiles = Object.keys(zip.files).length;

          for (const relativePath in zip.files) {
            const zipEntry = zip.files[relativePath];
            if (!zipEntry.dir && relativePath.endsWith('.json')) {
              try {
                const text = await zipEntry.async('string');
                const jsonData = JSON.parse(text);
                const fileName = relativePath.split('/').pop()?.split('.')[0];
                if (fileName) {
                  // 验证JSON结构是否包含必要的字段
                  if (!jsonData.Response?.TextDetections && !jsonData.TextDetections) {
                    console.warn(`JSON文件 ${relativePath} 缺少必要的TextDetections字段`);
                    failedFiles.push(relativePath);
                    continue;
                  }
                  newJsonData[fileName] = jsonData;
                }
              } catch (fileError) {
                console.warn(`处理文件 ${relativePath} 时出错:`, fileError);
                failedFiles.push(relativePath);
              }
            }
          }

          clearInterval(progressInterval);
          
          if (Object.keys(newJsonData).length === 0) {
            throw new Error('ZIP文件中没有找到有效的JSON文件或所有JSON文件格式不正确');
          }

          setLocalJsonData(prev => ({ ...prev, ...newJsonData }));
          setEditedLocalJsonData(prev => ({ ...prev, ...newJsonData }));
          // 更新fileNames数组，确保从ZIP加载的JSON文件能够被正确引用
          setFileNames(prev => {
            const currentFileNames = [...prev];
            Object.keys(newJsonData).forEach(name => {
              if (!currentFileNames.includes(name)) {
                currentFileNames.push(name);
              }
            });
            return currentFileNames;
          });
          console.log(`成功加载 ${Object.keys(newJsonData).length} 个JSON文件`);
          
          // 提示用户加载结果
          let message = `成功从ZIP中加载 ${Object.keys(newJsonData).length} 个JSON文件。`;
          if (failedFiles.length > 0) {
            message += ` 有 ${failedFiles.length} 个文件解析失败，请查看控制台了解详情。`;
          }
          if (Object.keys(localImageUrls).length > 0) {
            message += " 文件将与已加载的图片进行匹配。";
          }
          alert(message);
        } finally {
          clearInterval(progressInterval);
        }
      } else {
        // 处理单个JSON文件
        if (!file.name.endsWith('.json')) {
          throw new Error('请上传有效的JSON文件');
        }
        
        try {
          const text = await file.text();
          const jsonData = JSON.parse(text);
          
          // 验证JSON结构
          if (!jsonData.Response?.TextDetections && !jsonData.TextDetections) {
            throw new Error('JSON文件缺少必要的TextDetections字段');
          }
          
          const fileName = file.name.replace(/\.[^/.]+$/, "");
          setLocalJsonData(prev => ({ ...prev, [fileName]: jsonData }));
          setEditedLocalJsonData(prev => ({ ...prev, [fileName]: jsonData }));
          // 更新fileNames数组，确保新上传的JSON文件能够被正确引用
          setFileNames(prev => {
            if (!prev.includes(fileName)) {
              return [...prev, fileName];
            }
            return prev;
          });
          // 如果是第一个上传的文件，设置为当前选中文件
          setCurrentImageIndex(prevIndex => {
            if (fileNames.length === 0) {
              return 0;
            }
            return prevIndex;
          });
          console.log("已加载单个JSON:", fileName);
          alert(`成功加载JSON文件: ${fileName}`);
        } catch (parseError) {
          throw new Error('JSON文件解析失败，请检查文件格式');
        }
      }
    } catch (e: any) {
      console.error("加载JSON文件出错:", e);
      setError(`加载JSON文件出错: ${e.message}`);
      alert(`加载JSON文件失败: ${e.message}`);
    } finally {
      setLoading(false);
      // 重置文件输入，允许重复选择相同文件
      if (event.target) {
        event.target.value = '';
      }
    }
  }, [localImageUrls, isLocalMode]);

  // Effect to combine file names from both image and JSON zips
  useEffect(() => {
    if (isLocalMode) {
      // 使用文件索引来获取匹配的文件
      const matchedFiles = Object.entries(fileIndex)
        .filter(([_, info]) => info.hasImage && info.hasJson)
        .map(([fileName]) => fileName);
      
      // 对文件名进行自然排序
      const sortedMatchedFiles = matchedFiles.sort((a, b) => {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
      
      if (sortedMatchedFiles.length > 0) {
        setFileNames(sortedMatchedFiles);
        console.log(`找到 ${sortedMatchedFiles.length} 个同时有图片和JSON的文件`);
        
        // 设置初始OCR数据
        if (sortedMatchedFiles.length > 0) {
          const firstKey = sortedMatchedFiles[0];
          const data = localJsonData[firstKey];
          const textDetections = data?.Response?.TextDetections || data?.TextDetections;
          if (textDetections) {
            setOcrData(textDetections as OcrResult);
            setInitialOcrData(textDetections as OcrResult);
          } else {
            setOcrData([]);
            setInitialOcrData([]);
          }
          setCurrentImageIndex(0);
        }
      } else {
        // 如果没有完全匹配的文件，尝试使用智能匹配
        const allFiles = Object.keys(fileIndex);
        const sortedAllFiles = allFiles.sort((a, b) => {
          return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
        
        setFileNames(sortedAllFiles);
        
        if (allFiles.length > 0) {
          console.log(`找到 ${allFiles.length} 个文件，但没有完全匹配。尝试使用智能匹配。`);
        } else {
          console.log('没有找到任何文件');
        }
      }
      
      // 导出并显示文件统计信息
      const stats = exportFileStats();
      if (stats.totalFiles > 0 && stats.matchedFiles < stats.totalFiles) {
        console.log(`文件匹配情况: ${stats.matchedFiles}/${stats.totalFiles} 个文件完全匹配`);
      }
    }
  }, [isLocalMode, localImageUrls, localJsonData, fileIndex]);
    
    // 智能文件匹配函数 - 尝试找到最佳匹配的文件
    const findBestMatch = useCallback((fileName: string): string | null => {
      // 完全匹配
      if (fileIndex[fileName] && fileIndex[fileName].hasImage && fileIndex[fileName].hasJson) {
        return fileName;
      }
      
      // 尝试相似文件名匹配（处理数字后缀、空格等差异）
      const normalizedName = fileName.toLowerCase().replace(/\s+/g, '').replace(/\d+$/, '');
      
      for (const key in fileIndex) {
        if (fileIndex[key].hasImage && fileIndex[key].hasJson) {
          const normalizedKey = key.toLowerCase().replace(/\s+/g, '').replace(/\d+$/, '');
          if (normalizedName === normalizedKey) {
            return key;
          }
        }
      }
      
      return null;
    }, [fileIndex]);

    // 当前文件名变化时，尝试智能匹配
  useEffect(() => {
    if (isLocalMode && selectedFileName && !localJsonData[selectedFileName]) {
      const bestMatch = findBestMatch(selectedFileName);
      if (bestMatch && localJsonData[bestMatch]) {
        console.log(`智能匹配: 找不到 ${selectedFileName} 的JSON，使用 ${bestMatch} 的JSON数据`);
        const data = localJsonData[bestMatch];
        const textDetections = data?.Response?.TextDetections || data?.TextDetections;
        if (textDetections) {
          setOcrData(textDetections as OcrResult);
          setInitialOcrData(textDetections as OcrResult);
        }
      } else if (localJsonData[selectedFileName]) {
        // 直接使用匹配的JSON数据
        const data = localJsonData[selectedFileName];
        const textDetections = data?.Response?.TextDetections || data?.TextDetections;
        if (textDetections) {
          setOcrData(textDetections as OcrResult);
          setInitialOcrData(textDetections as OcrResult);
        } else {
          setOcrData([]);
          setInitialOcrData([]);
        }
      }
    }
  }, [isLocalMode, selectedFileName, localJsonData, findBestMatch]);
  
  // 文件索引缓存，用于快速查找和匹配（已在组件顶部定义）
  // 构建文件索引
  useEffect(() => {
    if (isLocalMode) {
      const imageKeys = Object.keys(localImageUrls);
      const jsonKeys = Object.keys(localJsonData);
      
      const newIndex: Record<string, { hasImage: boolean; hasJson: boolean }> = {};
      
      // 添加所有图片文件到索引
      imageKeys.forEach(key => {
        newIndex[key] = { ...newIndex[key], hasImage: true, hasJson: false };
      });
      
      // 添加所有JSON文件到索引
      jsonKeys.forEach(key => {
        newIndex[key] = { ...newIndex[key], hasJson: true, hasImage: false };
      });
      
      setFileIndex(newIndex);
      
      console.log('文件索引已更新，包含', Object.keys(newIndex).length, '个文件');
    } else {
      // 在远程模式下清空索引
      setFileIndex({});
    }
  }, [isLocalMode, localImageUrls, localJsonData]);
  


  // 选中的文件名状态（已在组件顶部定义）
  
  // 重置本地模式数据 - 优化版本
  const resetLocalData = useCallback(() => {
    try {
      // 记录开始时间用于性能监控
      const startTime = performance.now();
      
      // 清理blob URLs以避免内存泄漏，添加错误处理
      const blobUrls = Object.values(localImageUrls);
      let revokedCount = 0;
      let failedCount = 0;
      
      for (const url of blobUrls) {
        try {
          if (url && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
            revokedCount++;
          }
        } catch (error) {
          console.warn('清理Blob URL失败:', error);
          failedCount++;
        }
      }
      
      // 清理currentEditableInfo引用，避免潜在的内存泄漏
      if (currentEditableInfo.current) {
        currentEditableInfo.current = null;
      }
      
      // 重置状态
      setLocalImageUrls({});
      setLocalJsonData({});
      setEditedLocalJsonData({});
      setImageZipFile(null);
      setJsonZipFile(null);
      setFileNames([]);
      setSelectedFileName('');
      setOcrData([]);
      setInitialOcrData([]);
      setFileIndex({});
      setError(null);
      
      // 性能日志
      const endTime = performance.now();
      console.log(`本地数据重置完成: 清理了${revokedCount}个Blob URL, ${failedCount}个失败, 耗时${(endTime - startTime).toFixed(2)}ms`);
      
      // 使用setTimeout避免阻塞UI线程
      setTimeout(() => {
        // 检查DOM是否仍然存在且可访问
        if (typeof alert === 'function') {
          alert(`已重置所有本地数据\n\n清理统计:\n- Blob URL: ${revokedCount}个成功, ${failedCount}个失败\n- 文件数据: ${Object.keys(localImageUrls).length}个文件`);
        }
      }, 100);
      
    } catch (error) {
      console.error('重置本地数据时发生错误:', error);
      if (typeof alert === 'function') {
        alert('重置数据时发生错误，请刷新页面重试');
      }
    }
  }, [localImageUrls]);
  
  // 导出文件索引和匹配统计信息
  const exportFileStats = useCallback(() => {
    const stats = {
      totalFiles: Object.keys(fileIndex).length,
      matchedFiles: Object.values(fileIndex).filter(f => f.hasImage && f.hasJson).length,
      imageOnlyFiles: Object.values(fileIndex).filter(f => f.hasImage && !f.hasJson).length,
      jsonOnlyFiles: Object.values(fileIndex).filter(f => !f.hasImage && f.hasJson).length
    };
    
    console.log('文件统计信息:', stats);
    return stats;
  }, [fileIndex]);

  // Effect for fetching file names (remote mode) or setting OCR data (local mode)
  useEffect(() => {
    if (!isLocalMode && enableRemote) { // Only fetch in remote mode when it's enabled
      const fetchFileNames = async () => {
        try {
          setLoading(true);
          const response = await fetch('/api/files');
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data = await response.json();
          setFileNames(data.files);
          console.log("Fetched file names:", data.files);
        } catch (e: any) {
          console.error('Error fetching file names:', e);
          setError(e.message);
        } finally {
          setLoading(false);
        }
      };
      fetchFileNames();
    } else if (isLocalMode && currentFileName) {
      const data = localJsonData[currentFileName];
      const textDetections = data?.Response?.TextDetections || data?.TextDetections;
      if (textDetections) {
        setOcrData(textDetections as OcrResult);
        setInitialOcrData(textDetections as OcrResult);
      } else {
        setOcrData([]);
        setInitialOcrData([]);
      }
    }
  }, [isLocalMode, currentFileName, localJsonData, enableRemote]);

  // Effect for fetching OCR data (remote mode) or setting image dimensions (local mode)
  useEffect(() => {
    if (!isLocalMode && jsonName && enableRemote) { // Only fetch in remote mode when it's enabled
      async function fetchOcrData() {
        try {
          setLoading(true);
          const response = await fetch(`/ocr_results/wdzh/${jsonName}`);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const data: any = await response.json();
          const textDetections = data.Response?.TextDetections || data.TextDetections;
          if (!textDetections) {
            throw new Error("OCR data does not contain TextDetections.");
          }
          setOcrData(textDetections as OcrResult);
          setInitialOcrData(textDetections as OcrResult);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      }
      fetchOcrData();
    } else if (isLocalMode && currentFileName) {
      // In local mode, image dimensions are derived from the loaded image itself
      // No API call needed
      if (imageRef.current) {
        setOriginalOcrDimensions({ width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight });
      }
    }
  }, [isLocalMode, jsonName, currentFileName, localJsonData, enableRemote]);

  // Effect to reset states when isLocalMode changes
  useEffect(() => {
    if (prevIsLocalModeRef.current !== null && prevIsLocalModeRef.current === isLocalMode) {
      return;
    }
    prevIsLocalModeRef.current = isLocalMode;
    
    setOcrData(null);
    setInitialOcrData(null);
    setFileNames([]);
    setCurrentImageIndex(0);
    setLocalImageUrls({});
    setLocalJsonData({});
    setEditedLocalJsonData({});
    setError(null);
    setLoading(false);
  }, [isLocalMode]);

  // Effect for fetching image dimensions (remote mode)
  useEffect(() => {
    if (!isLocalMode && enableRemote) { // Only fetch in remote mode when it's enabled
      const fetchImageDimensions = async () => {
        console.log("Fetching image dimensions for: ", imageName);
        if (imageName) {
          try {
            const response = await fetch(`/api/image-info?imageName=${imageName}`);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            setOriginalOcrDimensions({ width: data.width, height: data.height });
            console.log("Fetched original image dimensions:", data);
          } catch (error) {
            console.error("Error fetching image dimensions:", error);
          }
        }
      };
      fetchImageDimensions();
    }
  }, [isLocalMode, imageName, currentImageIndex, fileNames, enableRemote]);

  useEffect(() => {
    if (ocrData) {
      let maxX = 0;
      let maxY = 0;

      ocrData.forEach(item => {
        const { X, Y, Width, Height } = item.ItemPolygon;
        if (X + Width > maxX) maxX = X + Width;
        if (Y + Height > maxY) maxY = Y + Height;
      });
      console.log("originalOcrDimensions:", { width: maxX, height: maxY });
    }
  }, [ocrData]);

  const handleImageLoad = () => {
    if (imageRef.current && imageContainerRef.current && leftPaneRef.current) {
      const { naturalWidth, naturalHeight, width, height } = imageRef.current;
      const imageRect = imageRef.current.getBoundingClientRect();
      const leftPaneRect = leftPaneRef.current.getBoundingClientRect();

      const offsetX = imageRect.left - leftPaneRef.current.offsetLeft;
      const offsetY = imageRect.top - leftPaneRef.current.offsetTop;
      const containerHeight = imageContainerRef.current.offsetHeight; // Get container height

      console.log("Image Ref Width:", width);
      console.log("Image Ref Height:", height);
      console.log("Image Container Offset Width:", imageContainerRef.current.offsetWidth);
      console.log("Image Container Offset Height:", imageContainerRef.current.offsetHeight);

      const dimensions = {
        naturalWidth,
        naturalHeight,
        width,
        height,
        offsetX,
        offsetY,
        containerHeight, // Add container height to state
      };
      setImageRenderedDimensions(dimensions);
    }
  };

  // Function to handle image zoom
  const handleZoomImage = () => {
    if (imageName) {
      const src = isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`;
      if (src) {
        setZoomedImageSrc(src);
        setIsImageZoomed(true);
      }
    }
  };

  // Function to close zoomed image
  const handleCloseZoom = () => {
    setIsImageZoomed(false);
    setZoomedImageSrc('');
  };

  // Function to handle local zoom
  const handleLocalZoom = () => {
    setIsLocalZoomActive(true);
  };

  // Function to hide local zoom
  const handleHideLocalZoom = () => {
    setIsLocalZoomActive(false);
  };

  // Re-instate handleResize effect to update image dimensions on window resize
  useEffect(() => {
    const handleResize = () => {
      handleImageLoad();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [imageRenderedDimensions]); // Depend on imageRenderedDimensions to re-run when it changes

  // 监听左侧图片放大状态变化，更新图片尺寸
  useEffect(() => {
    if (isLeftImageExpanded || !isLeftImageExpanded) {
      // 状态变化后稍微延迟一下再更新尺寸，确保布局已经完成
      const timer = setTimeout(() => {
        handleImageLoad();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isLeftImageExpanded]);

  const handlePrevious = () => {
    setCurrentImageIndex(prevIndex => Math.max(0, prevIndex - 1));
  };

  const handleNext = () => {
    setCurrentImageIndex(prevIndex => Math.min(fileNames.length - 1, prevIndex + 1));
  };

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex(prevIndex => Math.min(prevIndex + 1, fileNames.length - 1));
  }, [fileNames.length]);

  const handlePreviousImage = useCallback(() => {
    setCurrentImageIndex(prevIndex => Math.max(prevIndex - 1, 0));
  }, [fileNames.length]);

  // Re-add loading and error state checks
  if (loading) return <div className="flex justify-center items-center h-screen">加载中...</div>;
  if (error) return <div className="flex justify-center items-center h-screen text-red-500">错误: {error}</div>;

  const insertPinyin = (pinyin: string) => {
    if (!currentEditableInfo.current) return;
    const { element, index } = currentEditableInfo.current;

    // 保持焦点在可编辑元素
    element.focus();

    const selection = window.getSelection();
    if (!selection) return;

    // 计算插入前的起始字符偏移（从元素起点到选区起点的字符数）
    let range: Range;
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
      // 如果选区不在当前元素内，则移动到元素末尾
      if (!element.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
    } else {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }

    const startOffsetChars = (() => {
      const pre = range.cloneRange();
      pre.selectNodeContents(element);
      pre.setEnd(range.startContainer, range.startOffset);
      return pre.toString().length;
    })();

    // 删除当前选区内容并插入拼音字符
    range.deleteContents();
    const textNode = document.createTextNode(pinyin);
    range.insertNode(textNode);

    // 将光标临时放到新插入文本的末尾（避免立即跳到首位）
    const caretRange = document.createRange();
    caretRange.setStart(textNode, textNode.textContent ? textNode.textContent.length : pinyin.length);
    caretRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caretRange);

    // 计算新的光标偏移并保存，待状态更新后恢复
    const newCaretOffset = startOffsetChars + pinyin.length;
    currentEditableInfo.current = { element, index, caretOffset: newCaretOffset };

    // 更新 OCR 数据，并在渲染完成后恢复光标位置
    // 使用 requestAnimationFrame 确保 DOM 已完成更新和绘制
    setOcrData(prevOcrData => {
      if (!prevOcrData) return null;
      const next = [...prevOcrData];
      next[index] = { ...next[index], DetectedText: element.textContent || '' };
      return next;
    });

    const restoreCaret = () => {
      const info = currentEditableInfo.current;
      const target = info?.element || element;
      const offset = info?.caretOffset ?? newCaretOffset;

      // 将光标恢复到指定字符偏移位置
      const setCaretByOffset = (el: HTMLElement, charOffset: number) => {
        const sel = window.getSelection();
        if (!sel) return;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode() as Text | null;
        let traversed = 0;
        const range = document.createRange();
        while (node) {
          const nextTraversed = traversed + (node.textContent ? node.textContent.length : 0);
          if (charOffset <= nextTraversed) {
            const localOffset = Math.max(0, charOffset - traversed);
            range.setStart(node, localOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            return;
          }
          traversed = nextTraversed;
          node = walker.nextNode() as Text | null;
        }
        // 如果偏移超过文本长度，放到末尾
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      };

      if (document.activeElement !== target) target.focus();
      setCaretByOffset(target, offset);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(restoreCaret);
    });
  };

  // 拼音字符按钮，两行布局
  const pinyinRows: string[][] = [
    ['ā', 'á', 'ǎ', 'à', 'ē', 'é', 'ě', 'è', 'ī', 'í', 'ǐ', 'ì'],
    ['ō', 'ó', 'ǒ', 'ò', 'ū', 'ú', 'ǔ', 'ù', 'ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
  ];

  return (
    <div className="flex flex-col flex-grow">
      {/* Top Toolbar spanning both panes */}
      <div className="sticky top-0 z-50 bg-white p-4 border-b border-gray-300 flex justify-between items-center">
        {/* Left controls */}
        <div className="flex items-center space-x-2">
          {/* Import/Export section with consistent styling */}
          <div className="flex items-center space-x-2 bg-gray-100 p-1 rounded-lg">
            <input
              type="file"
              accept=".zip"
              onChange={handleImageZipUpload}
              className="hidden"
              id="imageZipUpload"
            />
            <label htmlFor="imageZipUpload" className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded cursor-pointer transition-all duration-200 transform hover:scale-105">
              <span className="flex items-center">
                📁 导入图片 ZIP
              </span>
            </label>

            <input
              type="file"
              accept=".zip"
              onChange={handleJsonZipUpload}
              className="hidden"
              id="jsonZipUpload"
            />
            <label htmlFor="jsonZipUpload" className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded cursor-pointer transition-all duration-200 transform hover:scale-105">
              <span className="flex items-center">
                📄 导入 JSON ZIP
              </span>
            </label>
          </div>

          {/* Only show mode toggle button when remote mode is enabled via URL parameter */}
          {enableRemote && (
            <button
              className={`py-2 px-4 rounded font-bold ${isLocalMode ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-800'}`}
              onClick={() => setIsLocalMode(!isLocalMode)}
            >
              {isLocalMode ? '本地模式' : '远程模式'}
            </button>
          )}

          <button
            onClick={handlePrevious}
            disabled={currentImageIndex === 0 || fileNames.length === 0}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <select
            value={currentImageIndex}
            onChange={(e) => setCurrentImageIndex(Number(e.target.value))}
            className="p-2 border rounded"
            disabled={fileNames.length === 0}
          >
            {fileNames.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={handleNext}
            disabled={currentImageIndex === fileNames.length - 1 || fileNames.length === 0}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center space-x-2">
          {/* Add zoom image button */}
          {imageName && (
            <button
              className={`bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded ${isLocalZoomActive ? 'ring-2 ring-yellow-300' : ''}`}
              onClick={() => setIsLocalZoomActive(!isLocalZoomActive)}
            >
              {isLocalZoomActive ? '关闭局部放大' : '开启局部放大'}
            </button>
          )}

          <button
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            onClick={async () => {
              if (isLocalMode) {
                try {
                  // Handle local save (download ZIP)
                  console.log('开始导出修改后的OCR数据...');
                  const zip = new JSZip();
                  let filesProcessed = 0;
                  
                  // 使用异步方式处理每个文件
                  for (const fileName in editedLocalJsonData) {
                    try {
                      const originalJson = editedLocalJsonData[fileName];
                      
                      // 检查文件是否有对应的OCR数据
                      const currentOcrData = ocrData;
                      if (currentOcrData && currentOcrData.length > 0) {
                        // 重建JSON结构，确保数据一致性
                        const newJson = {
                          ...originalJson,
                          // 确保Response对象存在
                          Response: {
                            ...originalJson.Response,
                            TextDetections: currentOcrData
                          },
                          // 同时更新顶层TextDetections
                          TextDetections: currentOcrData
                        };
                        
                        // 使用一致的文件名格式
                        const cleanFileName = fileName.replace(/\.(jpg|jpeg|png|json)$/i, '');
                        zip.file(`${cleanFileName}.json`, JSON.stringify(newJson, null, 2));
                        filesProcessed++;
                      }
                    } catch (fileError) {
                      console.error(`处理文件 ${fileName} 时出错:`, fileError);
                    }
                  }
                  
                  if (filesProcessed === 0) {
                    alert('没有找到可导出的OCR数据！');
                    return;
                  }
                  
                  // 生成ZIP文件并下载
                  console.log(`准备下载包含 ${filesProcessed} 个文件的ZIP包...`);
                  const content = await zip.generateAsync({ 
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 } // 平衡压缩率和性能
                  });
                  
                  const a = document.createElement('a');
                  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                  a.href = URL.createObjectURL(content);
                  a.download = `ocr_json_updated_${timestamp}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  
                  // 清理和反馈
                  setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href); // 释放URL对象，避免内存泄漏
                  }, 100);
                  
                  alert(`成功导出 ${filesProcessed} 个修改后的OCR数据文件！`);
                  console.log('OCR数据导出完成');
                } catch (error) {
                  console.error('导出OCR数据时出错:', error);
                  alert('导出OCR数据失败，请检查控制台日志！');
                }
              } else if (enableRemote) {
                // Original remote save logic - only execute when remote mode is enabled
                try {
                  const response = await fetch('/api/save-ocr', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(ocrData),
                  });
                  if (response.ok) {
                    alert('OCR data saved successfully!');
                  } else {
                    alert('Failed to save OCR data.');
                  }
                } catch (error) {
                  console.error('Error saving OCR data:', error);
                  alert('Error saving OCR data.');
                }
              } else {
                // Remote mode is disabled
                alert('远程模式未启用，无法保存到服务器。');
              }
            }}
          >
            <span className="flex items-center">
              💾 保存所有更改
            </span>
          </button>
          <button
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-all duration-200 transform hover:scale-105 flex items-center"
            onClick={() => {
              if (isLocalMode && currentFileName) {
                const data = localJsonData[currentFileName];
                const textDetections = data?.Response?.TextDetections || data?.TextDetections;
                if (textDetections) {
                  setOcrData(textDetections as OcrResult);
                  setInitialOcrData(textDetections as OcrResult);
                } else {
                  setOcrData([]);
                  setInitialOcrData([]);
                }
              } else if (enableRemote) {
                // Only reset from remote data when remote mode is enabled
                setOcrData(initialOcrData);
              } else {
                // Remote mode is disabled
                alert('远程模式未启用，无法重置数据。');
              }
            }}
          >
            <span className="flex items-center">
              🔄 重置所有更改
            </span>
          </button>
          <div className="space-y-2" ref={pinyinButtonsRef}>
            {pinyinRows.map((row, idx) => (
              <div key={idx} className="flex space-x-1">
                {row.map((char) => (
                  <button
                    key={`${idx}-${char}`}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Prevent button from taking focus
                    }}
                    onClick={() => {
                      if (currentEditableInfo.current) {
                        insertPinyin(char);
                      }
                    }}
                    className={`px-2 py-1 rounded text-sm font-medium ${char === '' ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 text-white'}`}
                    disabled={char === ''}
                  >
                    {char === '' ? '' : char}
                  </button>
                ))}
              </div>
            ))}
          </div> {/* Closing div for space-y-2 */}
          {/* 右侧视图模式切换（与拼音按钮同属sticky工具栏） */}
          <div className="flex items-center gap-2 text-sm">
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'overlay' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('overlay')}
            >
              图上定位文本
            </button>
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'raw' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('raw')}
            >
              原始 JSON
            </button>
            <button
              className={`px-2 py-1 rounded ${rightViewMode === 'paragraph' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              onClick={() => setRightViewMode('paragraph')}
            >
              按段号输出文本
            </button>
            {/* 控制图上定位文本显示位置的按钮，始终显示 */}
            <button
              className="px-2 py-1 rounded bg-gray-200 text-gray-800"
              onClick={() => {
                // 切换图上定位文本位置时，如果当前不是overlay模式，则切换到overlay模式
                if (rightViewMode !== 'overlay') {
                  setRightViewMode('overlay');
                }
                setOverlayPosition(overlayPosition === 'left' ? 'right' : 'left');
              }}
            >
              {overlayPosition === 'left' ? '移到右侧' : '移到左侧'}
            </button>

            {/* 控制左侧图片放大/缩小的按钮，仅当图上定位文本在左侧时显示 */}
            {overlayPosition === 'left' && (
              <button
                className="px-2 py-1 rounded bg-gray-200 text-gray-800"
                onClick={() => setIsLeftImageExpanded(!isLeftImageExpanded)}
              >
                {isLeftImageExpanded ? '缩小图片' : '放大图片'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Two panes below toolbar */}
      <div className="flex flex-grow">
        {/* Left Pane: Image with OCR overlay */}
        <div
          className={`p-4 border-r border-gray-300 overflow-auto ${isLeftImageExpanded ? 'flex-grow basis-0' : 'flex-grow basis-0'}`}
          ref={leftPaneRef}
          style={isLeftImageExpanded ? { flex: '0 0 100%' } : {}}
        >
          <div
            className="relative w-full h-auto"
            ref={imageContainerRef}
            onMouseMove={(e) => {
              if (isLocalZoomActive && imageContainerRef.current) {
                const rect = imageContainerRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setZoomPosition({ x, y });
              }
            }}
            onMouseLeave={() => setIsLocalZoomActive(false)}
          >
            {/* 浮动偏移控制面板 - 仅当图上定位文本在左侧时显示 */}
            {overlayPosition === 'left' && (
              <div className="absolute top-2 left-2 bg-white bg-opacity-80 rounded-lg shadow-lg p-2 z-10 flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <button
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, x: prev.x - 1 }))}
                  >
                    ←
                  </button>
                  <input
                    type="number"
                    value={overlayOffset.x}
                    onChange={(e) => setOverlayOffset(prev => ({ ...prev, x: parseInt(e.target.value) || 0 }))}
                    className="w-12 text-center border border-gray-300 rounded mx-1 text-xs"
                  />
                  <button
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, x: prev.x + 1 }))}
                  >
                    →
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <button
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, y: prev.y + 1 }))}
                  >
                    ↑
                  </button>
                  <input
                    type="number"
                    value={overlayOffset.y}
                    onChange={(e) => setOverlayOffset(prev => ({ ...prev, y: parseInt(e.target.value) || 0 }))}
                    className="w-12 text-center border border-gray-300 rounded mx-1 text-xs"
                  />
                  <button
                    className="w-6 h-6 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setOverlayOffset(prev => ({ ...prev, y: prev.y - 1 }))}
                  >
                    ↓
                  </button>
                </div>
              </div>
            )}

            {imageName && (isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`) && (
              <Image
                ref={imageRef}
                src={isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`}
                alt="OCR Image"
                layout="responsive"
                width={1000} // These are intrinsic width/height hints for Next.js, not necessarily rendered size
                height={1500}
                objectFit="contain"
                onLoad={handleImageLoad}
                onError={(e) => console.error("Image failed to load:", e.currentTarget.src)}
                unoptimized={isLocalMode} // Disable Next.js Image optimization for local Blob URLs
              />
            )}

            {/* OCR Overlay on image - 当位置为左侧时显示在图片上 */}
            {overlayPosition === 'left' && ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
              const { X, Y, Width, Height } = detection.ItemPolygon;
              // 只有在左侧且图片放大时才应用放大逻辑
              if (isLeftImageExpanded) {
                // 计算实际的缩放因子 - 基于图片实际显示尺寸的变化
                // 获取图片在正常状态和放大状态下的尺寸
                const normalScaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const normalScaleY = imageRenderedDimensions.height / originalOcrDimensions.height;

                // 直接使用实际测量的缩放因子，不再乘以额外系数
                const scaleX = normalScaleX;
                const scaleY = normalScaleY;

                // 偏移量也应根据放大状态调整
                const offsetX = overlayOffset.x;
                const offsetY = overlayOffset.y;

                return (
                  <div
                    key={`wrapper-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${X * scaleX + offsetX}px`,
                      top: `${Y * scaleY - offsetY}px`,
                      width: `${Width * scaleX}px`,
                      height: `${Height * scaleY}px`,
                    }}
                  >
                    <div
                      key={index}
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.1)'}`, // Dynamic border color based on focusedElementIndex
                        fontSize: '22px', // 放大时使用更大的字体
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        boxSizing: 'border-box',
                        color: `rgba(0, 0, 0, ${detection.Confidence === 100 ? 1 :
                            detection.Confidence === 99 ? 0.9 :
                              detection.Confidence === 98 ? 0.7 :
                                0.4
                          })`,
                      }}
                      title={detection.DetectedText}
                      contentEditable="true"
                      suppressContentEditableWarning={true}
                      onKeyDown={(e) => {
                        // Shift+Enter: insert visual line break
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                        // Enter: move focus to next editable element
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nextIndex = (index + 1) % ocrData.length;
                          setFocusedElementIndex(nextIndex);
                          setTimeout(() => {
                            const nextElement = document.querySelector(`[data-ocr-index="${nextIndex}"]`) as HTMLElement | null;
                            if (nextElement) {
                              nextElement.focus();
                              const range = document.createRange();
                              const sel = window.getSelection();
                              range.selectNodeContents(nextElement);
                              range.collapse(false);
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            }
                          }, 0);
                        }
                      }}
                      onFocus={(e) => {
                        setFocusedElementIndex(index);
                        currentEditableInfo.current = { element: e.currentTarget, index };
                      }}
                      onBlur={(e) => {
                        // Save the caret position when blurring
                        const selection = window.getSelection();
                        if (selection && selection.rangeCount > 0) {
                          const range = selection.getRangeAt(0);
                          const preCaretRange = range.cloneRange();
                          preCaretRange.selectNodeContents(e.currentTarget);
                          preCaretRange.setEnd(range.endContainer, range.endOffset);
                          currentEditableInfo.current = {
                            element: e.currentTarget,
                            index,
                            caretOffset: preCaretRange.toString().length
                          };
                        }
                      }}
                      data-ocr-index={index}
                    >
                      {detection.DetectedText}
                    </div>

                    {/* ParagNo 显示在左上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="页码 (ParagNo)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                        } catch {
                          return '';
                        }
                      })()}
                    </span>

                    {/* Confidence 显示在右上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="置信度 (Confidence)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {detection.Confidence}
                    </span>
                  </div>
                );
              } else {
                // 正常大小时使用原有逻辑
                const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;

                return (
                  <div
                    key={`wrapper-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${X * scaleX + overlayOffset.x}px`,
                      top: `${Y * scaleY - overlayOffset.y}px`,
                      width: `${Width * scaleX}px`,
                      height: `${Height * scaleY}px`,
                    }}
                  >
                    <div
                      key={index}
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.1)'}`, // Dynamic border color based on focusedElementIndex
                        fontSize: '12px', // 当在左侧时使用更小的字体
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        boxSizing: 'border-box',
                        color: `rgba(0, 0, 0, ${detection.Confidence === 100 ? 1 :
                            detection.Confidence === 99 ? 0.9 :
                              detection.Confidence === 98 ? 0.7 :
                                0.4
                          })`,
                      }}
                      title={detection.DetectedText}
                      contentEditable="true"
                      suppressContentEditableWarning={true}
                      onKeyDown={(e) => {
                        // Shift+Enter: insert visual line break
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                        // Enter: move focus to next editable element
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const nextIndex = (index + 1) % ocrData.length;
                          setFocusedElementIndex(nextIndex);
                          setTimeout(() => {
                            const nextElement = document.querySelector(`[data-ocr-index="${nextIndex}"]`) as HTMLElement | null;
                            if (nextElement) {
                              nextElement.focus();
                              const range = document.createRange();
                              const sel = window.getSelection();
                              range.selectNodeContents(nextElement);
                              range.collapse(false);
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                            }
                          }, 0);
                        }
                      }}
                      onFocus={(e) => {
                        setFocusedElementIndex(index);
                        currentEditableInfo.current = { element: e.currentTarget, index };
                      }}
                      onBlur={(e) => {
                        // Save the caret position when blurring
                        const selection = window.getSelection();
                        if (selection && selection.rangeCount > 0) {
                          const range = selection.getRangeAt(0);
                          const preCaretRange = range.cloneRange();
                          preCaretRange.selectNodeContents(e.currentTarget);
                          preCaretRange.setEnd(range.endContainer, range.endOffset);
                          currentEditableInfo.current = {
                            element: e.currentTarget,
                            index,
                            caretOffset: preCaretRange.toString().length
                          };
                        }
                      }}
                      data-ocr-index={index}
                    >
                      {detection.DetectedText}
                    </div>

                    {/* ParagNo 显示在左上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="页码 (ParagNo)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                        } catch {
                          return '';
                        }
                      })()}
                    </span>

                    {/* Confidence 显示在右上角，仅在左侧模式下显示 */}
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="置信度 (Confidence)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                      }}
                    >
                      {detection.Confidence}
                    </span>
                  </div>
                );
              }
            })}

            {/* Local zoom overlay */}
            {isLocalZoomActive && imageName && (
              <div
                className="absolute pointer-events-none"
                style={{
                  width: '200px',
                  height: '200px',
                  border: '2px solid white',
                  borderRadius: '8px',
                  boxShadow: '0 0 15px rgba(0, 0, 0, 0.8)',
                  top: `${zoomPosition.y - 100}px`,
                  left: `${zoomPosition.x - 100}px`,
                  transform: 'translate(0, 0)',
                  zIndex: 20,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: '1000px',
                    height: '1500px',
                    backgroundImage: `url(${isLocalMode ? localImageUrls[currentFileName] : `/images/wdzh/${imageName}`})`,
                    backgroundSize: '1000px 1500px',
                    backgroundPosition: `-${zoomPosition.x * 5 - 100}px -${zoomPosition.y * 5 - 100}px`,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Image Zoom Modal */}
        {isImageZoomed && (
          <div className="fixed inset-0 bg-black bg-opacity-75 z-[100] flex items-center justify-center p-4" onClick={handleCloseZoom}>
            <div className="relative max-w-6xl max-h-[90vh]">
              <button
                className="absolute top-2 right-2 bg-white rounded-full p-2 z-10 shadow-lg hover:bg-gray-200"
                onClick={handleCloseZoom}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-800" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="overflow-auto max-h-[90vh]">
                <img
                  src={zoomedImageSrc}
                  alt="Zoomed OCR Image"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {/* Right Pane: OCR data in different views (raw JSON, paragraph) or overlay on right */}
        <div
          className={`p-4 overflow-hidden flex flex-col flex-grow basis-0 min-h-0 ${isLeftImageExpanded ? 'hidden' : ''}`}
        >
          {/* 当位置为右侧且视图为overlay时，图上定位文本显示在右侧窗格中 */}
          {overlayPosition === 'right' && rightViewMode === 'overlay' && (
            <div
              className="relative border border-gray-300 overflow-y-auto"
              style={imageRenderedDimensions ? {
                height: `${imageRenderedDimensions.containerHeight}px`,
              } : {}}
            >
              {ocrData && imageRenderedDimensions && originalOcrDimensions && ocrData.map((detection, index) => {
                const { X, Y, Width, Height } = detection.ItemPolygon;
                const scaleX = imageRenderedDimensions.width / originalOcrDimensions.width;
                const scaleY = imageRenderedDimensions.height / originalOcrDimensions.height;

                return (
                  <div
                    key={`wrapper-${index}`}
                    style={{
                      position: 'absolute',
                      left: `${X * scaleX}px`,
                      top: `${Y * scaleY}px`,
                      width: `${Width * scaleX}px`,
                      height: `${Height * scaleY}px`,
                    }}
                  >
                    <div
                      key={index}
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        border: `1px solid ${focusedElementIndex === index ? 'blue' : 'rgba(0, 123, 255, 0.2)'}`, // Dynamic border color based on focusedElementIndex
                        fontSize: `${Math.max(8, 125 * Math.min(scaleX, scaleY))}px`, // Scale font size, with a minimum of 12px
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        boxSizing: 'border-box',
                        color: `rgba(0, 0, 0, ${detection.Confidence === 100 ? 1 :
                            detection.Confidence === 99 ? 0.9 :
                              detection.Confidence === 98 ? 0.7 :
                                0.4
                          })`,
                      }}
                      title={detection.DetectedText}
                      contentEditable="true"
                      suppressContentEditableWarning={true}
                      onKeyDown={(e) => {
                        // Shift+Enter: insert visual line break
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                        // Enter or Ctrl+Enter: exit edit (save on blur)
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).blur();
                        }
                      }}
                      onFocus={(e) => {
                        currentEditableInfo.current = { element: e.currentTarget, index };
                        setFocusedElementIndex(index); // Set focused element index
                      }}
                      onBlur={(e) => {
                        console.log("onBlur triggered. relatedTarget:", e.relatedTarget);
                        const isPinyinButtonFocused = pinyinButtonsRef.current && pinyinButtonsRef.current.contains(e.relatedTarget as Node);
                        console.log("isPinyinButtonFocused:", isPinyinButtonFocused);

                        // Check if the new focused element is within the pinyin buttons container
                        if (isPinyinButtonFocused) {
                          // If a pinyin button was clicked, do not clear currentEditableInfo and keep focusedElementIndex
                          return;
                        }

                        setFocusedElementIndex(null); // Clear focused element index
                        const newText = e.currentTarget.textContent || '';
                        setOcrData(prevOcrData => {
                          if (!prevOcrData) return null;
                          const newOcrData = [...prevOcrData];
                          newOcrData[index] = { ...newOcrData[index], DetectedText: newText };
                          return newOcrData;
                        });
                        console.log(`Edited text for item ${index}:`, newText);
                        currentEditableInfo.current = null;
                      }}
                    >
                      {detection.DetectedText}
                    </div>
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      left: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="页码 (ParagNo)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).blur();
                        }
                      }}
                      onBlur={(e) => {
                        const raw = (e.currentTarget.textContent || '').trim();
                        const nextNo = Number(raw);
                        if (Number.isNaN(nextNo)) {
                          e.currentTarget.textContent = String(
                            (function () {
                              try {
                                return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                              } catch {
                                return '';
                              }
                            })()
                          );
                          return;
                        }
                        setOcrData(prev => {
                          if (!prev) return null;
                          const next = [...prev];
                          const item = { ...next[index] } as any;
                          let adv: any = {};
                          try {
                            adv = JSON.parse(item.AdvancedInfo);
                          } catch (e) {
                            console.error("Error parsing AdvancedInfo:", e);
                          }
                          adv.Parag = { ...adv.Parag, ParagNo: nextNo };
                          item.AdvancedInfo = JSON.stringify(adv);
                          next[index] = item;
                          return next;
                        });
                      }}
                    >
                      {(function () {
                        try {
                          return JSON.parse(detection.AdvancedInfo).Parag?.ParagNo ?? '';
                        } catch {
                          return '';
                        }
                      })()}
                    </span>
                    <span style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      fontSize: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 5,
                    }}
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      title="置信度 (Confidence)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          insertLineBreakAtCaret();
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).blur();
                        }
                      }}
                      onBlur={(e) => {
                        const raw = (e.currentTarget.textContent || '').trim();
                        const nextVal = Number(raw);
                        if (Number.isNaN(nextVal)) {
                          e.currentTarget.textContent = String(detection.Confidence ?? '');
                          return;
                        }
                        setOcrData(prev => {
                          if (!prev) return null;
                          const next = [...prev];
                          next[index] = { ...next[index], Confidence: nextVal } as any;
                          return next;
                        });
                      }}
                    >
                      {detection.Confidence}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* 原始JSON视图 */}
          {rightViewMode === 'raw' && (
            <div className="border border-gray-300 p-2 overflow-y-auto" ref={rightRawRef}
              style={imageRenderedDimensions ? { height: `${imageRenderedDimensions.containerHeight}px` } : {}}>
              <pre className="font-mono text-xs whitespace-pre-wrap break-words">{JSON.stringify(ocrData ?? [], null, 2)}</pre>
            </div>
          )}
          {/* 按段号输出文本视图 */}
          {rightViewMode === 'paragraph' && (
            <div className="border border-gray-300 p-2 overflow-y-auto" ref={rightParagraphRef}
              style={imageRenderedDimensions ? { height: `${imageRenderedDimensions.containerHeight}px` } : {}}>
              <ol className="list-decimal pl-4 space-y-1 text-sm">
                {paragraphLines.map((line, idx) => (
                  <li key={`parag-${line.paragNo ?? 'none'}-${idx}`}>
                    <span className="text-gray-500 mr-2">{line.paragNo ?? '—'}</span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}