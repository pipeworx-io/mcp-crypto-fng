interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Crypto Fear & Greed Index MCP.
 *
 * The Crypto Fear & Greed Index (alternative.me) — a daily 0–100 market-sentiment
 * gauge for crypto, where 0 = Extreme Fear and 100 = Extreme Greed. Widely cited
 * as a contrarian signal: extreme fear can mean buyers are oversold, extreme greed
 * can mean a correction is due. Keyless, updated once per day.
 */


const BASE = 'https://api.alternative.me';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'current_index',
    description:
      "Get today's Crypto Fear & Greed Index — a 0–100 market-sentiment gauge for crypto (0 = Extreme Fear, 100 = Extreme Greed). Returns the current value, its classification, the date, and seconds until the next daily update. Keyless.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'index_history',
    description:
      'Get historical Crypto Fear & Greed Index values (most recent first), plus a summary (latest, average, min, max). Each entry has a date, the 0–100 value, and its classification. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of days of history to return (default 30, max 365).',
        },
      },
    },
  },
];

interface FngEntry {
  value: number;
  classification: string;
  date: string;
}

function mapEntry(raw: Record<string, unknown>): FngEntry {
  const ts = Number(raw.timestamp);
  return {
    value: Number(raw.value),
    classification: String(raw.value_classification ?? ''),
    date: new Date(ts * 1000).toISOString(),
  };
}

async function fngGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`alternative.me: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'current_index':
        return currentIndex();
      case 'index_history':
        return indexHistory(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function currentIndex(): Promise<unknown> {
  const body = await fngGet('/fng/?limit=1&format=json');
  const data = (body.data as Array<Record<string, unknown>> | undefined) ?? [];
  const raw = data[0];
  if (!raw) return { error: 'no index data returned' };

  const entry = mapEntry(raw);
  return {
    value: entry.value,
    classification: entry.classification,
    date: entry.date,
    seconds_until_next_update:
      raw.time_until_update != null ? Number(raw.time_until_update) : null,
  };
}

async function indexHistory(args: Record<string, unknown>): Promise<unknown> {
  let limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : 30;
  if (limit < 1) limit = 1;
  if (limit > 365) limit = 365;

  const body = await fngGet(`/fng/?limit=${limit}&format=json`);
  const data = (body.data as Array<Record<string, unknown>> | undefined) ?? [];
  const history = data.map(mapEntry);

  if (history.length === 0) {
    return { count: 0, summary: null, history: [] };
  }

  const values = history.map((h) => h.value);
  const average = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  return {
    count: history.length,
    summary: {
      latest: history[0].value,
      average,
      min: Math.min(...values),
      max: Math.max(...values),
    },
    history,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
