import { ArxivPaper, TARGET_CATEGORIES } from '../types';

// Helper to parse XML response from ArXiv
const parseArxivXML = (xmlText: string): ArxivPaper[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const entries = xmlDoc.getElementsByTagName("entry");
  
  const papers: ArxivPaper[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const idUrl = entry.getElementsByTagName("id")[0]?.textContent || "";
    const title = entry.getElementsByTagName("title")[0]?.textContent?.replace(/\n/g, " ").trim() || "";
    const summary = entry.getElementsByTagName("summary")[0]?.textContent?.replace(/\n/g, " ").trim() || "";
    const published = entry.getElementsByTagName("published")[0]?.textContent || "";
    
    // Authors
    const authorTags = entry.getElementsByTagName("author");
    const authors: string[] = [];
    for (let j = 0; j < authorTags.length; j++) {
      authors.push(authorTags[j].getElementsByTagName("name")[0]?.textContent || "");
    }

    // Categories
    const categoryTags = entry.getElementsByTagName("category");
    const categories: string[] = [];
    for (let j = 0; j < categoryTags.length; j++) {
      const term = categoryTags[j].getAttribute("term");
      if (term) categories.push(term);
    }

    // Comment (often contains "Accepted to...")
    const comment = entry.getElementsByTagName("arxiv:comment")[0]?.textContent || "";

    papers.push({
      id: idUrl,
      title,
      summary,
      authors,
      published,
      link: idUrl,
      categories,
      comment
    });
  }

  return papers;
};

// Robust fetch with multiple proxy strategies including JSON wrapping to bypass strict CORS
const fetchWithProxies = async (url: string): Promise<string> => {
  const strategies = [
    {
      name: 'AllOrigins (JSON)',
      // Returns JSON { contents: "response body" }
      url: (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}&t=${Date.now()}`,
      isJsonWrapper: true
    },
    {
      name: 'AllOrigins (Raw)',
      // Returns raw text
      url: (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}&t=${Date.now()}`,
      isJsonWrapper: false
    },
    {
      name: 'CodeTabs',
      url: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
      isJsonWrapper: false
    },
    {
      name: 'ThingProxy',
      url: (u: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
      isJsonWrapper: false
    }
  ];

  for (const strategy of strategies) {
    try {
      const proxyUrl = strategy.url(url);
      const response = await fetch(proxyUrl);
      if (!response.ok) continue;

      if (strategy.isJsonWrapper) {
        const data = await response.json();
        if (data.contents) {
          return data.contents;
        }
      } else {
        const text = await response.text();
        if (text) {
          return text;
        }
      }
    } catch (e) {
      // console.warn(`Proxy ${strategy.name} failed`, e);
    }
  }
  throw new Error('All proxy attempts failed to fetch ArXiv data.');
};

// Extracts ArXiv IDs (e.g., 2402.12345) from HTML content
const extractIdsFromHtml = (html: string): string[] => {
  // Matches href="/abs/2402.12345" which is standard in the list view
  const regex = /href="\/abs\/(\d+\.\d+)"/g;
  const ids = new Set<string>();
  let match;
  while ((match = regex.exec(html)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
};

export const fetchLatestPapers = async (): Promise<ArxivPaper[]> => {
  const listUrls = [
    "https://arxiv.org/list/cs.AI/new",
    "https://arxiv.org/list/cs.CV/new"
  ];

  try {
    // 1. Scrape IDs from both "New" pages in parallel
    // We use the proxy to get the HTML of the list page
    const scrapePromises = listUrls.map(url => 
        fetchWithProxies(url)
            .then(extractIdsFromHtml)
            .catch(err => {
                console.warn(`Failed to scrape ${url}`, err);
                return [];
            })
    );

    const idLists = await Promise.all(scrapePromises);
    // Merge and deduplicate IDs
    const uniqueIds = Array.from(new Set(idLists.flat()));

    // Fallback: If scraping fails (e.g., layout change), use the generic search API
    if (uniqueIds.length === 0) {
      console.warn("No IDs found via scraping 'new' lists. Falling back to general API search.");
      return fetchPapersFallback();
    }

    console.log(`Scraped ${uniqueIds.length} unique papers from New lists. Fetching details...`);

    // 2. Batch fetch details from ArXiv API
    // The API handles ~50-100 IDs well in one go. We chunk to be safe.
    const chunkedPapers: ArxivPaper[] = [];
    const chunkSize = 40; 
    
    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize);
      const idListStr = chunk.join(',');
      const apiUrl = `https://export.arxiv.org/api/query?id_list=${idListStr}&start=0&max_results=${chunkSize}`;
      
      try {
        const xml = await fetchWithProxies(apiUrl);
        const papers = parseArxivXML(xml);
        chunkedPapers.push(...papers);
      } catch (e) {
        console.error("Error fetching batch from API", e);
      }
    }

    return chunkedPapers;

  } catch (error) {
    console.error("Error fetching papers:", error);
    // Ultimate fallback
    return fetchPapersFallback();
  }
};

const fetchPapersFallback = async (): Promise<ArxivPaper[]> => {
  // Query matches: cat:cs.AI OR cat:cs.CV
  const query = `cat:${TARGET_CATEGORIES.join('+OR+cat:')}`;
  const sortBy = 'submittedDate';
  const sortOrder = 'descending';
  
  // Ceiling limit, will likely stop earlier based on date
  const totalToFetch = 1000;
  const batchSize = 100;

  const allPapers: ArxivPaper[] = [];
  let newestPaperDate: Date | null = null; // Track the date of the newest paper found
  let timeWindowDays = 1.2; // Default strict window for Tue-Fri

  for (let start = 0; start < totalToFetch; start += batchSize) {
    const targetUrl = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=${sortBy}&sortOrder=${sortOrder}&start=${start}&max_results=${batchSize}`;
    
    try {
      console.log(`Fetching fallback batch: ${start} to ${start + batchSize}`);
      const text = await fetchWithProxies(targetUrl);
      const papers = parseArxivXML(text);
      
      if (papers.length === 0) break; // Stop if no more papers

      // Initialize anchor date from the very first (newest) paper of the first batch
      if (!newestPaperDate && papers.length > 0) {
        newestPaperDate = new Date(papers[0].published);
        
        // --- ADAPTIVE WEEKEND LOGIC ---
        // If the newest paper is Monday (Day 1), we must allow a larger gap to catch Friday papers.
        // ArXiv Monday release covers submissions from Fri 14:00 EST to Mon.
        const dayOfWeek = newestPaperDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        
        if (dayOfWeek === 1) { 
          // It's a Monday batch. Allow 4 days to cover back to Friday/Thursday afternoon.
          timeWindowDays = 4.0;
          console.log("Detected Monday batch. Widening time window to 4 days to include weekend submissions.");
        } else {
          // Regular weekday (Tue-Fri). Strict window to strictly separate from yesterday's batch.
          // 1.2 days ensures we capture the full 24h cycle plus a tiny buffer for timezone shifts, but not 48h.
          timeWindowDays = 1.2; 
          console.log(`Detected weekday batch (${dayOfWeek}). Using strict ${timeWindowDays}-day window.`);
        }
      }

      // Smart Date Filtering
      const relevantPapers: ArxivPaper[] = [];
      let stopFetching = false;

      for (const paper of papers) {
        const paperDate = new Date(paper.published);
        
        // If newestPaperDate wasn't set above (e.g., first paper invalid date), set it here
        if (!newestPaperDate) newestPaperDate = paperDate;

        // Calculate difference in days relative to the newest paper found
        const diffTime = newestPaperDate.getTime() - paperDate.getTime();
        const diffDays = diffTime / (1000 * 3600 * 24);

        if (diffDays > timeWindowDays) {
          stopFetching = true;
          break; // Stop adding papers from this batch
        }
        relevantPapers.push(paper);
      }

      allPapers.push(...relevantPapers);
      
      if (stopFetching) {
        console.log(`Stopped fetching: Reached papers older than ${timeWindowDays} days from newest submission.`);
        break;
      }
      
      // Small delay to prevent rate limiting
      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.warn(`Error fetching fallback batch starting at ${start}`, error);
    }
  }

  // Deduplicate results
  const uniquePapers = Array.from(new Map(allPapers.map(item => [item.id, item])).values());
  console.log(`Fallback fetch completed. Retrieved ${uniquePapers.length} papers for the current cycle.`);
  
  return uniquePapers;
};