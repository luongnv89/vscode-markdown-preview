import YAML from 'yaml';

export interface FrontmatterResult {
  frontmatter: Record<string, unknown> | null;
  body: string;
  linesConsumed: number;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

function isImageUrl(value: string): boolean {
  return /\.(png|svg|jpg|jpeg|gif|webp)(\?.*)?$/i.test(value) || /shields\.io/.test(value);
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') {
    if (isImageUrl(value)) {
      return `<img src="${escapeHtml(value)}" alt="badge" class="frontmatter-badge">`;
    }
    if (isUrl(value)) {
      return `<a href="${escapeHtml(value)}" class="frontmatter-link">${escapeHtml(value)}</a>`;
    }
    return escapeHtml(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return `<code>${String(value)}</code>`;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => `<span class="frontmatter-tag">${renderValue(item)}</span>`)
      .join(' ');
  }
  if (typeof value === 'object' && value !== null) {
    return `<code>${escapeHtml(JSON.stringify(value, null, 2))}</code>`;
  }
  return escapeHtml(String(value));
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: null, body: content, linesConsumed: 0 };
  }

  const raw = match[1].trim();
  if (!raw) {
    // Empty frontmatter block (---\n---)
    const linesConsumed = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0);
    return { frontmatter: null, body: content.slice(match[0].length), linesConsumed };
  }

  try {
    const parsed = YAML.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      const linesConsumed = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0);
      return { frontmatter: null, body: content.slice(match[0].length), linesConsumed };
    }
    const linesConsumed = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0);
    return {
      frontmatter: parsed as Record<string, unknown>,
      body: content.slice(match[0].length),
      linesConsumed,
    };
  } catch {
    // Malformed YAML — strip the block, skip card
    const linesConsumed = match[0].split('\n').length - (match[0].endsWith('\n') ? 1 : 0);
    return { frontmatter: null, body: content.slice(match[0].length), linesConsumed };
  }
}

export function renderFrontmatterHtml(data: Record<string, unknown>): string {
  const title = typeof data.title === 'string' ? escapeHtml(data.title) : 'Metadata';

  let rows = '';
  for (const [key, value] of Object.entries(data)) {
    rows += `<tr>
      <td class="frontmatter-key">${escapeHtml(key)}</td>
      <td class="frontmatter-value">${renderValue(value)}</td>
    </tr>\n`;
  }

  return `<details open class="frontmatter-card">
  <summary class="frontmatter-summary">${title}</summary>
  <table class="frontmatter-table">
    <tbody>
      ${rows}
    </tbody>
  </table>
</details>\n`;
}
