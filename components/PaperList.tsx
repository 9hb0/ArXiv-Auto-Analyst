import React from 'react';
import { AnalyzedPaper } from '../types';

interface PaperListProps {
  papers: AnalyzedPaper[];
}

export const PaperList: React.FC<PaperListProps> = ({ papers }) => {
  if (papers.length === 0) {
    return (
      <div className="text-gray-400 text-center py-10 italic">
        No high-relevance papers found in this batch based on your filters.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {papers.map((paper) => (
        <div key={paper.id} className="bg-gray-850 border border-gray-750 rounded-lg p-6 hover:border-blue-500 transition-colors duration-300">
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-xl font-bold text-blue-300 flex-1 mr-4">
              <a href={paper.link} target="_blank" rel="noreferrer" className="hover:underline">
                {paper.title}
              </a>
            </h3>
            <span className={`px-2 py-1 rounded text-xs font-bold ${paper.relevanceScore >= 9 ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
              Score: {paper.relevanceScore}/10
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {paper.isAccepted && (
              <span className="px-2 py-0.5 rounded text-xs bg-indigo-900 text-indigo-200 border border-indigo-700">
                Accepted
              </span>
            )}
            {paper.hasCode && (
              <span className="px-2 py-0.5 rounded text-xs bg-teal-900 text-teal-200 border border-teal-700">
                Code Available
              </span>
            )}
            {paper.tags?.map((tag, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
                {tag}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm text-gray-300 bg-gray-950/50 p-4 rounded border border-gray-800">
            <div>
              <span className="text-purple-400 font-semibold uppercase text-xs tracking-wider block mb-1">Innovation</span>
              <p>{paper.innovations || "Analyzing..."}</p>
            </div>
            <div>
              <span className="text-emerald-400 font-semibold uppercase text-xs tracking-wider block mb-1">Value</span>
              <p>{paper.value || "Analyzing..."}</p>
            </div>
          </div>

          <p className="text-gray-400 text-sm line-clamp-3 mb-2 italic border-l-2 border-gray-600 pl-3">
            {paper.summary}
          </p>
          
          <div className="mt-2 text-xs text-gray-500">
             Reasoning: {paper.reasoning}
          </div>
        </div>
      ))}
    </div>
  );
};