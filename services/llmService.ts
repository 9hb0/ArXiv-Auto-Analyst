
import { ArxivPaper, AnalyzedPaper } from '../types';

const SILICONFLOW_API_URL = "https://api.siliconflow.cn/v1/chat/completions";

interface ChatCompletionResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

const cleanJsonOutput = (text: string): string => {
  // Remove markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned;
};

const callSiliconFlow = async (
  apiKey: string, 
  model: string, 
  messages: { role: string; content: string }[]
): Promise<string> => {
  if (!apiKey) throw new Error("SiliconFlow API Key is missing. Please enter it in the settings.");

  const response = await fetch(SILICONFLOW_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      stream: false,
      response_format: { type: "json_object" } // Try to force JSON, though not all models support it equally
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`SiliconFlow API Error (${response.status}): ${err}`);
  }

  const data: ChatCompletionResponse = await response.json();
  return data.choices[0]?.message?.content || "";
};

/**
 * Stage 2: Fast filtering of papers.
 * Processes in batches to handle large datasets (e.g. 1000 papers).
 */
export const filterPapersWithLLM = async (
  papers: ArxivPaper[], 
  apiKey: string, 
  modelId: string
): Promise<AnalyzedPaper[]> => {
  
  const BATCH_SIZE = 50; // Process 50 papers at a time to avoid context limits
  const allFilteredPapers: AnalyzedPaper[] = [];

  const systemPrompt = `
    你是一位专业的 AI 研究助手。你的任务是筛选 ArXiv 论文，制作每日精选日报。
    请全程使用**中文**进行思考和输出。

    **目标领域：** 计算机视觉 (CV) 和 人工智能 (AI)。

    **核心关注点 (Core Research Focus) - 必须至少符合一项：**
    1. **Visual Language Models (VLMs)**：特别是轻量级、移动端、边缘端或高效架构。
    2. **Efficient Fine-tuning**：高效微调方法 (PEFT, LoRA, Adapters 等)。
    3. **Runtime Optimizations**：运行时优化 (量化, 剪枝, 推理加速, 移动/边缘部署)。
    4. **Pre-deployment Optimization**：部署前优化 (数据集剪枝, 网络架构搜索 NAS, 预训练效率)。
    5. **Lightweight Architectures**：轻量级架构 (MobileNet变体, 蒸馏等)。

    **重要信号 (Key Signals)：**
    - **已被接收 (Accepted Paper)**：检查 Comment 字段是否包含 "Accepted to..."。
    - **代码可用 (Code Available)**：检查摘要或 Comment 是否提到 "Code available" 或 GitHub 链接。

    **评分标准 (0-10)：**
    - **9-10分**：完全符合核心关注点，且 (有代码 或 已被接收)。
    - **7-8分**：核心关注点的强相关论文。
    - **< 7分**：不相关、纯理论无效率优化、或普通应用文。

    **输出格式：**
    请返回一个严格的 JSON 对象，包含一个 key "papers"，其值为数组。每个对象包含：
    - "id": (字符串, 对应输入的论文 ID)
    - "relevanceScore": (数字)
    - "hasCode": (布尔值)
    - "isAccepted": (布尔值)
    - "tags": (字符串数组, 例如 ["VLM", "Lightweight"])
    - "reasoning": (字符串, 请用**中文**简要说明入选理由)

    **仅返回分数 >= 7 的论文。**
  `;

  // Helper to process a single batch
  const processBatch = async (batch: ArxivPaper[], startIndex: number) => {
    // Send ID to ensure robust matching
    const paperSummaries = batch.map((p) => ({
      id: p.id,
      title: p.title,
      abstract: p.summary,
      comment: p.comment || ""
    }));

    const userPrompt = `这里有一批论文（共 ${batch.length} 篇）。请根据上述标准进行筛选。\n输入数据: ${JSON.stringify(paperSummaries)}`;

    try {
      const content = await callSiliconFlow(apiKey, modelId, [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]);

      const cleanedContent = cleanJsonOutput(content);
      const parsed = JSON.parse(cleanedContent);
      const results = parsed.papers || parsed; 

      if (!Array.isArray(results)) return [];

      return results.map((res: any) => {
        // Find original paper by ID to prevent index mismatch
        const original = batch.find(p => p.id === res.id); 
        if (!original) return null;
        
        return {
          ...original,
          relevanceScore: res.relevanceScore,
          hasCode: res.hasCode,
          isAccepted: res.isAccepted,
          tags: res.tags || [],
          reasoning: res.reasoning
        };
      }).filter((p): p is AnalyzedPaper => p !== null);

    } catch (e) {
      console.warn(`Batch processing failed for papers starting at index ${startIndex}`, e);
      return [];
    }
  };

  // Chunk loop
  for (let i = 0; i < papers.length; i += BATCH_SIZE) {
    const batch = papers.slice(i, i + BATCH_SIZE);
    console.log(`Processing filtering batch ${i / BATCH_SIZE + 1} of ${Math.ceil(papers.length / BATCH_SIZE)}`);
    const batchResults = await processBatch(batch, i);
    allFilteredPapers.push(...batchResults);
  }

  return allFilteredPapers;
};

/**
 * Stage 3: Deep analysis.
 */
export const deepAnalyzePapersWithLLM = async (
  papers: AnalyzedPaper[], 
  apiKey: string, 
  modelId: string
): Promise<AnalyzedPaper[]> => {
  
  const analyzeSingle = async (paper: AnalyzedPaper): Promise<AnalyzedPaper> => {
    const prompt = `
      请对这篇论文进行深度技术分析。请用**中文**输出。
      
      **标题:** ${paper.title}
      **摘要:** ${paper.summary}
      
      请输出严格的 JSON 对象，包含以下字段：
      - "innovations": (字符串, 最多50字, 它的核心创新点是什么？)
      - "methodology": (字符串, 最多50字, 他们具体是如何实现的？)
      - "value": (字符串, 最多30字, 对实际部署有什么价值？)
    `;

    try {
      const content = await callSiliconFlow(apiKey, modelId, [
        { role: "system", content: "你是一位精炼的技术分析师。请输出严格的 JSON 格式，内容使用中文。" },
        { role: "user", content: prompt }
      ]);
      
      const analysis = JSON.parse(cleanJsonOutput(content));
      return {
        ...paper,
        innovations: analysis.innovations,
        methodology: analysis.methodology,
        value: analysis.value
      };
    } catch (e) {
      console.error(`Error analyzing paper ${paper.id}`, e);
      return paper; 
    }
  };

  // Process in parallel
  // If list is large (e.g. 50+), we should concurrency limit this too, but Promise.all is okay for < 50
  const analyzed = await Promise.all(papers.map(analyzeSingle));
  return analyzed;
};
