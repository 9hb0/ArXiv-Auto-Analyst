
import React, { useState, useEffect } from 'react';
import { fetchLatestPapers } from './services/arxivService';
import { filterPapersWithLLM, deepAnalyzePapersWithLLM } from './services/llmService';
import { StorageService } from './data/storage';
import { ArxivPaper, AnalyzedPaper, ProcessingStatus, SILICONFLOW_MODELS, DailyReport } from './types';
import { PaperList } from './components/PaperList';
import { CountdownTimer } from './components/CountdownTimer';
import { ExportView } from './components/ExportView';

const App = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [analyzedPapers, setAnalyzedPapers] = useState<AnalyzedPaper[]>([]);
  const [allFetchedPapers, setAllFetchedPapers] = useState<ArxivPaper[]>([]);
  const [history, setHistory] = useState<DailyReport[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [rawCount, setRawCount] = useState(0);

  // Settings State
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState(SILICONFLOW_MODELS[0].id);
  const [cloudUrl, setCloudUrl] = useState(''); 
  const [showSettings, setShowSettings] = useState(true);

  const addLog = (msg: string) => setProgressLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  // --- Initialization ---
  useEffect(() => {
    // 1. Load User Settings
    const storedKey = localStorage.getItem('siliconflow_api_key');
    const storedModel = localStorage.getItem('siliconflow_model');
    const storedCloud = localStorage.getItem('cloud_webhook_url');
    
    if (storedKey) {
      setApiKey(storedKey);
      setShowSettings(false);
    }
    if (storedModel && SILICONFLOW_MODELS.some(m => m.id === storedModel)) {
      setSelectedModel(storedModel);
    }
    if (storedCloud) setCloudUrl(storedCloud);

    // 2. Load History (Last 7 Days)
    const historyData = StorageService.getHistory();
    setHistory(historyData);

    // 3. Load Raw Data (Only Today's) for display
    const cachedPapers = StorageService.loadRawData();
    if (cachedPapers) {
      setAllFetchedPapers(cachedPapers);
      setRawCount(cachedPapers.length);
      const today = new Date().toISOString().split('T')[0];
      addLog(`Loaded ${cachedPapers.length} raw papers from data/raw/${today}.json`);
    } else {
      addLog("No local data file found for today. Ready to fetch.");
    }
  }, []);

  const saveSettings = () => {
    localStorage.setItem('siliconflow_api_key', apiKey);
    localStorage.setItem('siliconflow_model', selectedModel);
    localStorage.setItem('cloud_webhook_url', cloudUrl);
    setShowSettings(false);
    addLog("Settings saved.");
  };

  const runPipeline = async () => {
    if (!apiKey) {
      alert("Please enter your SiliconFlow API Key in settings first.");
      setShowSettings(true);
      return;
    }

    try {
      setStatus(ProcessingStatus.FETCHING);
      setProgressLog([]);
      setAnalyzedPapers([]);
      setAllFetchedPapers([]);
      addLog(`Starting pipeline with model: ${selectedModel}`);
      
      const today = new Date().toISOString().split('T')[0];

      // ==========================================
      // Step 1: FETCH & SAVE RAW
      // ==========================================
      addLog("Step 1: Fetching latest papers from ArXiv...");
      let fetchedData = await fetchLatestPapers();
      
      if (fetchedData.length === 0) {
        // Fallback: check if we have cached raw data to proceed
        const cachedRaw = StorageService.loadRawData();
        if (cachedRaw && cachedRaw.length > 0) {
             addLog("Fetch returned 0, but found cached raw file. Asking user...");
             if (confirm("Fetch returned 0 papers. Use existing cached file from today?")) {
                 fetchedData = cachedRaw;
             } else {
                 setStatus(ProcessingStatus.COMPLETED);
                 return;
             }
        } else {
            setStatus(ProcessingStatus.COMPLETED);
            addLog("No new papers found today.");
            return;
        }
      }
      
      // Update UI state
      setRawCount(fetchedData.length);
      setAllFetchedPapers(fetchedData);
      
      // Save Raw Data to Disk
      await StorageService.saveRawData(fetchedData, cloudUrl);
      addLog(`[FILE] Saved raw data to data/raw/${today}.json`);


      // ==========================================
      // Step 2: LOAD RAW -> FILTER -> SAVE FILTERED
      // ==========================================
      setStatus(ProcessingStatus.FILTERING);
      addLog(`[FILE] Reading data/raw/${today}.json for filtering...`);
      
      const papersToFilter = StorageService.loadRawData();
      if (!papersToFilter || papersToFilter.length === 0) throw new Error("Could not load raw data file.");

      addLog("Step 2: Intelligent Filtering (SiliconFlow)...");
      const filteredResults = await filterPapersWithLLM(papersToFilter, apiKey, selectedModel);
      addLog(`Filtered down to ${filteredResults.length} relevant papers.`);

      // Save Filtered Data to Disk
      await StorageService.saveFilteredData(filteredResults, cloudUrl);
      addLog(`[FILE] Saved intermediate results to data/filtered/${today}.json`);

      if (filteredResults.length === 0) {
        setAnalyzedPapers([]);
        setStatus(ProcessingStatus.COMPLETED);
        addLog("No relevant papers found. Stopping pipeline.");
        return;
      }


      // ==========================================
      // Step 3: LOAD FILTERED -> ANALYZE -> SAVE REPORT
      // ==========================================
      setStatus(ProcessingStatus.ANALYZING);
      addLog(`[FILE] Reading data/filtered/${today}.json for analysis...`);
      
      const papersToAnalyze = StorageService.loadFilteredData();
      if (!papersToAnalyze || papersToAnalyze.length === 0) throw new Error("Could not load filtered data file.");

      addLog("Step 3: Deep Reading & Analysis...");
      const finalReport = await deepAnalyzePapersWithLLM(papersToAnalyze, apiKey, selectedModel);
      
      // Save Final Report to Disk
      await StorageService.saveReport(finalReport, cloudUrl);
      addLog(`[FILE] Saved final report to data/reports/${today}.json`);


      // ==========================================
      // FINALIZATION
      // ==========================================
      setAnalyzedPapers(finalReport);
      setHistory(StorageService.getHistory()); // Refresh history UI
      setStatus(ProcessingStatus.COMPLETED);
      addLog("Pipeline completed successfully.");

    } catch (error) {
      console.error(error);
      setStatus(ProcessingStatus.ERROR);
      addLog(`Error: ${(error as Error).message}`);
    }
  };

  // Auto-run simulation check (every minute)
  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      if (now.getHours() === 23 && now.getMinutes() === 59 && status === ProcessingStatus.IDLE) {
        if (apiKey) runPipeline();
      }
    };
    const interval = setInterval(checkTime, 60000);
    return () => clearInterval(interval);
  }, [status, apiKey]);

  // Helper to download JSON
  const downloadRawData = () => {
    if (allFetchedPapers.length === 0) {
      alert("No data fetched yet.");
      return;
    }
    const dataStr = JSON.stringify(allFetchedPapers, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `arxiv_raw_papers_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadHistoryItem = (report: DailyReport) => {
    setAnalyzedPapers(report.papers);
    addLog(`Loaded archived report from data/reports/${report.date}.json`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans selection:bg-blue-500/30">
      
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/50">
               <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">ArXiv Auto-Analyst</h1>
              <p className="text-xs text-gray-500">Powered by SiliconFlow</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <CountdownTimer />
            <button
              onClick={runPipeline}
              disabled={status !== ProcessingStatus.IDLE && status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR}
              className={`px-6 py-2 rounded-lg font-semibold transition-all shadow-lg flex items-center gap-2 ${
                status === ProcessingStatus.FETCHING || status === ProcessingStatus.FILTERING || status === ProcessingStatus.ANALYZING
                  ? 'bg-gray-800 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 text-white hover:shadow-blue-900/40'
              }`}
            >
              {status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETED || status === ProcessingStatus.ERROR ? (
                <>Run Now</>
              ) : (
                <>Processing...</>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-8">
        
        {/* Left Sidebar */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          
          {/* Settings Panel */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 shadow-lg">
            <div className="flex justify-between items-center mb-4">
               <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Configuration</h2>
               <button onClick={() => setShowSettings(!showSettings)} className="text-xs text-blue-400 hover:text-blue-300">
                 {showSettings ? 'Hide' : 'Edit'}
               </button>
            </div>
            
            {(showSettings || !apiKey) ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">SiliconFlow API Key</label>
                  <input 
                    type="password" 
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Model Selection</label>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                    {SILICONFLOW_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Cloud Webhook (Optional)</label>
                  <input 
                    type="text" 
                    value={cloudUrl}
                    onChange={(e) => setCloudUrl(e.target.value)}
                    placeholder="https://api.yourcloud.com/sync"
                    className="w-full bg-gray-950 border border-gray-700 rounded p-2 text-sm text-white focus:border-blue-500 focus:outline-none placeholder-gray-700"
                  />
                </div>
                <div className="flex gap-2 text-xs text-gray-500 mt-2">
                   <button onClick={saveSettings} className="flex-1 bg-green-700 hover:bg-green-600 text-white py-1 rounded">
                     Save
                   </button>
                </div>
              </div>
            ) : (
               <div className="text-xs text-gray-500 space-y-1">
                 <p>Model: <span className="text-gray-300">{SILICONFLOW_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}</span></p>
                 <p>Key: <span className="text-green-500">********</span></p>
                 <p>Cloud: <span className={cloudUrl ? "text-blue-400" : "text-gray-700"}>{cloudUrl ? 'Configured' : 'Disabled'}</span></p>
               </div>
            )}
          </div>

          {/* 7-Day History Panel */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 shadow-lg">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">7-Day History</h2>
            {history.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No archived reports yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((report) => (
                  <li key={report.date}>
                    <button 
                      onClick={() => loadHistoryItem(report)}
                      className="w-full text-left flex justify-between items-center text-xs p-2 rounded hover:bg-gray-800 transition group"
                    >
                      <span className="text-gray-300 group-hover:text-white">{report.date}</span>
                      <span className="text-gray-500 bg-gray-950 px-2 py-0.5 rounded border border-gray-800">
                        {report.papers.length} Papers
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pipeline Status */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 shadow-lg">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Pipeline Status</h2>
            <div className="space-y-4">
              <StatusStep label="1. ArXiv Fetch & Save" active={status === ProcessingStatus.FETCHING} completed={rawCount > 0} />
              <StatusStep label="2. Filter & Save" active={status === ProcessingStatus.FILTERING} completed={analyzedPapers.length > 0 || status === ProcessingStatus.ANALYZING || status === ProcessingStatus.COMPLETED} />
              <StatusStep label="3. Analyze & Report" active={status === ProcessingStatus.ANALYZING} completed={status === ProcessingStatus.COMPLETED && analyzedPapers.length > 0} />
            </div>

            {progressLog.length > 0 && (
              <div className="mt-6 p-3 bg-black/50 rounded border border-gray-800 font-mono text-xs text-green-500 h-48 overflow-y-auto">
                {progressLog.map((log, i) => (
                  <div key={i} className="mb-1">{log}</div>
                ))}
              </div>
            )}
          </div>

          {/* Data Management */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 shadow-lg">
             <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Data Management</h2>
             <div className="space-y-3">
               <button 
                onClick={downloadRawData}
                disabled={allFetchedPapers.length === 0}
                className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white text-xs py-2 rounded border border-gray-700 flex items-center justify-center gap-2"
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                 Download Raw JSON ({allFetchedPapers.length})
               </button>
               
               <button 
                onClick={() => setShowExport(true)}
                disabled={analyzedPapers.length === 0}
                className="w-full bg-blue-900/30 hover:bg-blue-900/50 disabled:opacity-50 text-blue-200 text-xs py-2 rounded border border-blue-900/50 flex items-center justify-center gap-2"
               >
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                 View/Export Report ({analyzedPapers.length})
               </button>
             </div>
             {allFetchedPapers.length > 0 && (
               <div className="mt-3 text-[10px] text-gray-500 text-center">
                 * Raw data cached locally for 24h
               </div>
             )}
          </div>
        </aside>

        {/* Main Content: Results */}
        <section className="col-span-12 lg:col-span-9">
          <div className="flex justify-between items-center mb-6">
             <h2 className="text-2xl font-bold text-white">
                Daily Insights <span className="text-sm font-normal text-gray-500 ml-2">
                  {analyzedPapers.length > 0 ? `(${analyzedPapers.length} papers)` : ''}
                </span>
             </h2>
             {analyzedPapers.length > 0 && (
               <button 
                onClick={() => setShowExport(true)}
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded border border-gray-700 flex items-center gap-2 text-sm transition"
               >
                 Export to Notion
               </button>
             )}
          </div>

          <PaperList papers={analyzedPapers} />

        </section>
      </main>

      {showExport && <ExportView papers={analyzedPapers} onClose={() => setShowExport(false)} />}
    </div>
  );
};

const StatusStep = ({ label, active, completed }: { label: string, active: boolean, completed: boolean }) => (
  <div className={`flex items-center gap-3 ${active ? 'text-blue-400' : completed ? 'text-green-400' : 'text-gray-600'}`}>
    <div className={`w-3 h-3 rounded-full ${active ? 'bg-blue-500 animate-pulse' : completed ? 'bg-green-500' : 'bg-gray-700'}`}></div>
    <span className={`text-sm font-medium ${active && 'animate-pulse'}`}>{label}</span>
    {completed && <span className="ml-auto text-xs">✓</span>}
  </div>
);

export default App;
