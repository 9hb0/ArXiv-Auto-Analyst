import { GoogleGenAI, Type } from "@google/genai";
import { ArxivPaper, AnalyzedPaper, SEARCH_KEYWORDS } from '../types';

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

/**
 * Stage 2: Fast filtering of papers based on criteria.
 * We send a batch of papers to Gemini and ask it to filter interesting ones.
 */
export const filterPapersWithGemini = async (papers: ArxivPaper[]): Promise<AnalyzedPaper[]> => {
  const ai = getAIClient();
  const model = "gemini-2.5-flash";

  // Prepare a condensed list to save tokens
  const paperSummaries = papers.map((p, index) => ({
    index: index,
    title: p.title,
    abstract: p.summary,
    comment: p.comment || ""
  }));

  const prompt = `
    You are an expert AI Researcher assistant. 
    Your task is to filter the following list of ArXiv papers based on specific criteria for a daily digest.
    
    **Target Domain:** Computer Vision (CV) and Artificial Intelligence (AI).

    **Core Research Focus (Must Match At Least One):**
    1. **Visual Language Models (VLMs)**: Specifically lightweight, mobile, edge-optimized, or efficient architectures.
    2. **Efficient Fine-tuning**: Methods like PEFT, LoRA, Adapters, etc.
    3. **Runtime Optimizations**: Quantization, Pruning, Inference acceleration, Mobile/Edge deployment.
    4. **Pre-deployment Optimization**: Techniques applied before model deployment (e.g., Dataset Pruning, Neural Architecture Search, Pre-training efficiency).
    5. **Lightweight Architectures**: Small backbones, student-teacher distillation, compact models suitable for mobile devices.

    **Key Signals (High Priority):**
    - **Accepted Paper**: The comment field mentions "Accepted to [Conference/Journal]".
    - **Code Available**: The abstract or comments explicitly mention "Code available" or provide a GitHub link.

    **Scoring Instructions:**
    - Assign a **relevanceScore** (0-10).
    - **Score 9-10**: Explicitly addresses a Core Research Focus AND (has Code OR is Accepted).
    - **Score 7-8**: Strong match for a Core Research Focus (Efficiency/VLM/Optimization/Lightweight).
    - **Score < 7**: General AI/CV papers, theoretical papers without efficiency focus, or pure applications without method innovation in efficiency.
    
    **Output Requirement:**
    - Return ONLY papers with a score >= 7.
    - Extract boolean flags: 'hasCode', 'isAccepted'.
    - **reasoning**: Concise explanation of why it fits the Efficiency/VLM/Deployment/Lightweight criteria.

    **Input Data:**
    ${JSON.stringify(paperSummaries)}
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.NUMBER },
              relevanceScore: { type: Type.NUMBER },
              hasCode: { type: Type.BOOLEAN },
              isAccepted: { type: Type.BOOLEAN },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              reasoning: { type: Type.STRING }
            },
            required: ["index", "relevanceScore", "hasCode", "isAccepted", "reasoning"]
          }
        }
      }
    });

    const results = JSON.parse(response.text || "[]");
    
    // Map back to original paper objects
    const filteredPapers: AnalyzedPaper[] = results.map((res: any) => {
      const original = papers[res.index];
      return {
        ...original,
        relevanceScore: res.relevanceScore,
        hasCode: res.hasCode,
        isAccepted: res.isAccepted,
        tags: res.tags || [],
        reasoning: res.reasoning
      };
    });

    return filteredPapers;
  } catch (e) {
    console.error("Gemini Filtering Error", e);
    return [];
  }
};

/**
 * Stage 3: Deep analysis of the selected "Breakthrough" papers.
 */
export const deepAnalyzePapers = async (papers: AnalyzedPaper[]): Promise<AnalyzedPaper[]> => {
  const ai = getAIClient();
  const model = "gemini-2.5-flash"; 

  // We process these in parallel or small batches since we want detailed text.
  
  const analyzeSingle = async (paper: AnalyzedPaper): Promise<AnalyzedPaper> => {
    const prompt = `
      Perform a deep technical review of this paper abstract and metadata.
      
      **Title:** ${paper.title}
      **Abstract:** ${paper.summary}
      
      **Goal:** Identify the specific breakthrough regarding Efficiency, VLM, Pre-deployment, Lightweight design, or Optimization.
      
      Output JSON with three fields:
      1. innovations: What is strictly new here? (Max 50 words)
      2. methodology: How did they achieve it? (Max 50 words)
      3. value: Why does this matter for practical deployment? (Max 30 words)
    `;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    innovations: { type: Type.STRING },
                    methodology: { type: Type.STRING },
                    value: { type: Type.STRING },
                }
            }
        }
      });
      
      const analysis = JSON.parse(response.text || "{}");
      return {
        ...paper,
        innovations: analysis.innovations,
        methodology: analysis.methodology,
        value: analysis.value
      };
    } catch (e) {
      return paper; // Return without extra details on error
    }
  };

  // Limit concurrency slightly if list is huge, but for filter results (<20) Promise.all is fine
  const analyzed = await Promise.all(papers.map(analyzeSingle));
  return analyzed;
};