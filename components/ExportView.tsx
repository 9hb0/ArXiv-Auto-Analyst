import React from 'react';
import { AnalyzedPaper } from '../types';

interface ExportViewProps {
  papers: AnalyzedPaper[];
  onClose: () => void;
}

export const ExportView: React.FC<ExportViewProps> = ({ papers, onClose }) => {
  const today = new Date().toISOString().split('T')[0];

  const generateMarkdown = () => {
    let md = `# Daily Paper Report - ${today}\n\n`;
    md += `**Focus:** VLMs, Efficient Fine-tuning, Pre-deployment\n`;
    md += `**Total Processed:** ${papers.length} high-value papers found.\n\n`;
    md += `---\n\n`;

    papers.forEach((p, idx) => {
      md += `### ${idx + 1}. [${p.title}](${p.link})\n`;
      md += `**Tags:** ${p.tags.join(', ')} | **Score:** ${p.relevanceScore}/10\n`;
      if (p.isAccepted) md += `**Status:** Accepted ✅\n`;
      if (p.hasCode) md += `**Code:** Available 💻\n`;
      
      md += `\n**💡 Innovation:** ${p.innovations || 'N/A'}\n`;
      md += `**🛠 Methodology:** ${p.methodology || 'N/A'}\n`;
      md += `**🚀 Practical Value:** ${p.value || 'N/A'}\n`;
      md += `\n> **Summary:** ${p.summary.slice(0, 200)}...\n\n`;
      md += `---\n\n`;
    });

    return md;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generateMarkdown());
    alert("Copied to clipboard! Paste into Notion.");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-gray-900 w-full max-w-4xl max-h-[90vh] rounded-xl border border-gray-700 flex flex-col shadow-2xl">
        <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-950 rounded-t-xl">
          <h2 className="text-xl font-bold text-white">Notion Export Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        
        <div className="flex-1 overflow-auto p-6 bg-gray-900">
          <pre className="font-mono text-sm text-gray-300 whitespace-pre-wrap bg-gray-950 p-4 rounded border border-gray-800">
            {generateMarkdown()}
          </pre>
        </div>

        <div className="p-6 border-t border-gray-800 bg-gray-950 rounded-b-xl flex justify-end gap-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition">
            Close
          </button>
          <button 
            onClick={copyToClipboard}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-semibold shadow-lg shadow-blue-900/20 transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
            Copy Markdown
          </button>
        </div>
      </div>
    </div>
  );
};