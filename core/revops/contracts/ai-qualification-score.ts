/**
 * ============================================
 * Pre-CRM Engine — Gemini AI Scoring Module
 * ============================================
 * Sends enriched firmographic data to the Gemini API
 * and returns a structured scoring response.
 *
 * Tech stack (see .clinerules):
 *   * Gemini API for AI Scoring & Intelligence
 *   * Clean TypeScript for n8n custom code nodes
 *   * Security first: API key via process.env, never hardcoded
 *
 * Output shape:
 *   {
 *     icp_score: number,            // 0-100
 *     buying_intent: string,        // e.g. "high" | "medium" | "low"
 *     personalized_icebreaker: string
 *   }
 *
 * Usage in an n8n Code node (JavaScript mode):
 *   The n8n workflow uses embedded copies of this logic in
 *   supabase/snippets/n8n-gemini-score.js (prompt builder) and
 *   supabase/snippets/n8n-gemini-parse.js (response validator) —
 *   keep this standalone module in sync with those.
 *   const { scoreLeadWithGemini } = require('./src/gemini-scoring');
 * ============================================
 */

/** Gemini API endpoint (v1beta, generateContent). */
const GEMINI_ENDPOINT =
  process.env.GEMINI_ENDPOINT ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

/** Structured scoring result returned by Gemini. */
export interface GeminiScore {
  icp_score: number;
  buying_intent: 'high' | 'medium' | 'low';
  personalized_icebreaker: string;
}

/** Enriched firmographic data used to score a lead. */
export interface Firmographics {
  company_name?: string;
  industry?: string;
  employees?: number;
  tech_stack?: string[];
  monthly_spend?: number;
  [key: string]: unknown;
}

/** Build the prompt that instructs Gemini to score the lead. */
export function buildScoringPrompt(firmographics: Firmographics): string {
  return [
    'You are a B2B RevOps lead-scoring assistant.',
    'Analyze the following enriched firmographic data for a prospective company.',
    'Return a STRICT JSON object (no markdown, no commentary) with exactly these keys:',
    '  - "icp_score": an integer from 0 to 100 representing how well the company fits our ICP.',
    '  - "buying_intent": one of "high", "medium", or "low" based on signals like tech stack maturity and monthly spend.',
    '  - "personalized_icebreaker": a short, professional, personalized opening message (max 2 sentences) referencing the company\'s tech stack and monthly spend.',
    '',
    'Firmographic data:',
    JSON.stringify(firmographics, null, 2),
    '',
    'Respond with only the JSON object.',
  ].join('\n');
}

/** Parse and validate the Gemini response into a GeminiScore. */
export function parseGeminiResponse(raw: string): GeminiScore {
  // Strip any markdown code fences if present.
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<GeminiScore>;

  const icp_score = Number(parsed.icp_score);
  const buying_intent = parsed.buying_intent;
  const personalized_icebreaker = parsed.personalized_icebreaker;

  if (
    Number.isNaN(icp_score) ||
    icp_score < 0 ||
    icp_score > 100 ||
    !['high', 'medium', 'low'].includes(buying_intent as string) ||
    typeof personalized_icebreaker !== 'string'
  ) {
    throw new Error('Gemini returned an unexpected scoring shape.');
  }

  return {
    icp_score,
    buying_intent: buying_intent as GeminiScore['buying_intent'],
    personalized_icebreaker,
  };
}

/**
 * Score a lead by sending its firmographics to Gemini.
 * Returns the structured scoring result.
 */
export async function scoreLeadWithGemini(
  firmographics: Firmographics
): Promise<GeminiScore> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in the environment.');
  }

  const prompt = buildScoringPrompt(firmographics);

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no text content.');
  }

  return parseGeminiResponse(text);
}
