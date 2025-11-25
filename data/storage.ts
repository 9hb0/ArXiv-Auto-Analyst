
import { ArxivPaper, AnalyzedPaper, DailyReport, RawDataStorage, FilteredDataStorage } from '../types';

// Mock File System Paths
const PATH_RAW_DIR = 'data/raw/';
const PATH_FILTERED_DIR = 'data/filtered/';
const PATH_REPORTS_DIR = 'data/reports/';
const PATH_MANIFEST = 'data/reports/manifest.json';

export const StorageService = {
  
  // --- File System Helpers ---
  
  getRawPath: (date: string) => `${PATH_RAW_DIR}${date}.json`,
  getFilteredPath: (date: string) => `${PATH_FILTERED_DIR}${date}.json`,
  getReportPath: (date: string) => `${PATH_REPORTS_DIR}${date}.json`,

  // --- Raw Data Management (1 Day Retention) ---

  saveRawData: async (papers: ArxivPaper[], cloudUrl?: string) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const filePath = StorageService.getRawPath(todayStr);
      
      const data: RawDataStorage = {
        date: todayStr,
        papers: papers
      };
      
      // 1. Write to "Local Disk"
      localStorage.setItem(filePath, JSON.stringify(data));
      console.log(`[FS] Wrote raw file: ${filePath} (${papers.length} records)`);

      // 2. Cleanup old raw files (Keep only today)
      StorageService.cleanupDirectory(PATH_RAW_DIR, filePath);

      // 3. Sync to Cloud
      if (cloudUrl) {
        await StorageService.uploadToCloud(cloudUrl, 'raw_data', filePath, data);
      }

    } catch (e) {
      console.error("Failed to save raw data", e);
    }
  },

  loadRawData: (): ArxivPaper[] | null => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const filePath = StorageService.getRawPath(todayStr);
      
      console.log(`[FS] Reading raw file: ${filePath}`);
      const rawJson = localStorage.getItem(filePath);
      
      if (!rawJson) {
        console.log(`[FS] File not found: ${filePath}`);
        return null;
      }

      const parsed: RawDataStorage = JSON.parse(rawJson);
      return parsed.papers;

    } catch (e) {
      console.error("Error loading raw data", e);
      return null;
    }
  },

  // --- Filtered Data Management (Intermediate Step) ---

  saveFilteredData: async (papers: AnalyzedPaper[], cloudUrl?: string) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const filePath = StorageService.getFilteredPath(todayStr);
      
      const data: FilteredDataStorage = {
        date: todayStr,
        papers: papers
      };
      
      // 1. Write to "Local Disk"
      localStorage.setItem(filePath, JSON.stringify(data));
      console.log(`[FS] Wrote filtered file: ${filePath} (${papers.length} records)`);

      // 2. Cleanup old filtered files
      StorageService.cleanupDirectory(PATH_FILTERED_DIR, filePath);

      // 3. Sync to Cloud
      if (cloudUrl) {
        await StorageService.uploadToCloud(cloudUrl, 'filtered_data', filePath, data);
      }
    } catch (e) {
      console.error("Failed to save filtered data", e);
    }
  },

  loadFilteredData: (): AnalyzedPaper[] | null => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const filePath = StorageService.getFilteredPath(todayStr);
      
      console.log(`[FS] Reading filtered file: ${filePath}`);
      const json = localStorage.getItem(filePath);
      
      if (!json) return null;

      const parsed: FilteredDataStorage = JSON.parse(json);
      return parsed.papers;
    } catch (e) {
      console.error("Error loading filtered data", e);
      return null;
    }
  },

  // --- History Management (7 Days Retention) ---

  saveReport: async (papers: AnalyzedPaper[], cloudUrl?: string) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const filePath = StorageService.getReportPath(todayStr);

      const reportData: DailyReport = {
        date: todayStr,
        timestamp: Date.now(),
        papers: papers
      };

      // 1. Write Report File
      localStorage.setItem(filePath, JSON.stringify(reportData));
      console.log(`[FS] Wrote report file: ${filePath}`);

      // 2. Update Manifest (Directory Index)
      const manifest = StorageService.getManifest();
      if (!manifest.includes(todayStr)) {
        manifest.unshift(todayStr); // Add to top
        localStorage.setItem(PATH_MANIFEST, JSON.stringify(manifest));
      }

      // 3. Cleanup Old Files (> 7 days)
      if (manifest.length > 7) {
        const toRemove = manifest.slice(7);
        const toKeep = manifest.slice(0, 7);
        
        toRemove.forEach(date => {
          const oldPath = StorageService.getReportPath(date);
          console.log(`[FS] Deleting old report: ${oldPath}`);
          localStorage.removeItem(oldPath);
        });

        localStorage.setItem(PATH_MANIFEST, JSON.stringify(toKeep));
      }

      // 4. Sync to Cloud
      if (cloudUrl) {
        await StorageService.uploadToCloud(cloudUrl, 'daily_report', filePath, reportData);
      }

    } catch (e) {
      console.error("Failed to save history report", e);
    }
  },

  getManifest: (): string[] => {
    try {
      const json = localStorage.getItem(PATH_MANIFEST);
      return json ? JSON.parse(json) : [];
    } catch {
      return [];
    }
  },

  getHistory: (): DailyReport[] => {
    try {
      const dates = StorageService.getManifest();
      const reports: DailyReport[] = [];

      dates.forEach(date => {
        const path = StorageService.getReportPath(date);
        const content = localStorage.getItem(path);
        if (content) {
          reports.push(JSON.parse(content));
        }
      });
      
      return reports;
    } catch (e) {
      console.error("Error loading history", e);
      return [];
    }
  },

  // --- Helper: Cleanup Directory ---
  cleanupDirectory: (dirPrefix: string, currentFile: string) => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // If it's in the directory AND NOT the file we just wrote
      if (key && key.startsWith(dirPrefix) && key !== currentFile) {
        console.log(`[FS] Deleting stale file: ${key}`);
        localStorage.removeItem(key);
      }
    }
  },

  // --- Cloud Sync ---
  
  uploadToCloud: async (url: string, type: 'raw_data' | 'filtered_data' | 'daily_report', filePath: string, payload: any) => {
    try {
      console.log(`[Cloud] Uploading ${type} to ${url} (Path: ${filePath})...`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        // We explicitly send the 'filePath' so the server knows where to save it
        body: JSON.stringify({ 
          type, 
          filePath, // e.g., "data/raw/2023-11-25.json"
          timestamp: Date.now(), 
          content: payload 
        })
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[Cloud] Upload successful.`);
    } catch (e) {
      console.error("[Cloud] Upload failed. Check your Webhook URL and CORS settings.", e);
    }
  }
};
