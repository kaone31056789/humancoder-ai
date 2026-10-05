// Best-effort language identification from editor hints or code content.

const ALIASES: Record<string, string> = {
  'c++': 'cpp', cpp: 'cpp', cxx: 'cpp', c_cpp: 'cpp', 'text/x-c++src': 'cpp', 'text/x-csrc': 'c',
  c: 'c', python: 'python', python3: 'python', py: 'python',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', 'text/javascript': 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  java: 'java', 'text/x-java': 'java', csharp: 'csharp', 'c#': 'csharp', cs: 'csharp',
  go: 'go', golang: 'go', rust: 'rust', rs: 'rust', kotlin: 'kotlin', kt: 'kotlin',
  ruby: 'ruby', rb: 'ruby', php: 'php', sql: 'sql', mysql: 'sql', html: 'html', css: 'css',
};

/** Normalises an editor-reported language/mode id (e.g. "ace/mode/c_cpp", "text/x-java"). */
export function normalizeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  const last = s.split('/').pop() ?? s;
  return ALIASES[s] ?? ALIASES[last] ?? (last.length <= 20 ? last : null);
}

export function detectLanguage(code: string): string | null {
  const c = code.slice(0, 5000);
  if (/#include\s*<(iostream|bits\/stdc\+\+\.h|vector|string)>|std::|using namespace std|cout\s*<</.test(c)) return 'cpp';
  if (/#include\s*<stdio\.h>|printf\s*\(|scanf\s*\(/.test(c)) return 'c';
  if (/^\s*(def |import |from \w+ import |class \w+\s*(\(|:))/m.test(c) && !/[{;]\s*$/m.test(c)) return 'python';
  if (/public\s+(static\s+)?class\s|System\.out\.print/.test(c)) return 'java';
  if (/^\s*package main|func \w+\(|fmt\.Print/m.test(c)) return 'go';
  if (/fn main\(\)|let mut |println!\(/.test(c)) return 'rust';
  if (/using System;|Console\.Write/.test(c)) return 'csharp';
  if (/:\s*(string|number|boolean)\b|interface \w+ \{|<\w+>\(/.test(c) && /(const|let|function)\s/.test(c)) return 'typescript';
  if (/(const|let|var)\s+\w+\s*=|function\s*\w*\(|=>|console\.log/.test(c)) return 'javascript';
  if (/<\?php/.test(c)) return 'php';
  if (/^\s*(SELECT|INSERT|UPDATE|CREATE TABLE)\b/im.test(c)) return 'sql';
  return null;
}
