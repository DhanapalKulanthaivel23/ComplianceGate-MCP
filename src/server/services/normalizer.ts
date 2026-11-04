/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import crypto from 'crypto';

/**
 * Unicode-preserving text normalization:
 * 1. NFKC normalization
 * 2. Case folding (lowercase)
 * 3. Preserve Arabic, CJK (Chinese/Japanese/Korean), Cyrillic, and Latin characters
 * 4. Flatten Latin diacritics (e.g., Müller -> muller, Ömer -> omer) while retaining Arabic/CJK scripts untouched
 * 5. Strip non-word punctuation and collapse whitespace
 */
export function normalizeEntityName(input: string): string {
  if (!input) return '';

  // Step 1: NFKC Unicode normalization
  let text = input.normalize('NFKC');

  // Step 1b: Map common Cyrillic confusable homoglyphs to Latin equivalents ONLY if text contains Latin letters (mixed-script homoglyph evasion)
  if (/[a-zA-Z]/.test(text)) {
    text = text.replace(/[\u0430\u0410\u0435\u0415\u043E\u041E\u0440\u0420\u0441\u0421\u0443\u0423\u0445\u0425\u0456\u0406\u0458\u0408\u0455\u0405]/g, (ch) => {
      switch (ch) {
        case '\u0430': case '\u0410': return 'a';
        case '\u0435': case '\u0415': return 'e';
        case '\u043E': case '\u041E': return 'o';
        case '\u0440': case '\u0420': return 'p';
        case '\u0441': case '\u0421': return 'c';
        case '\u0443': case '\u0423': return 'y';
        case '\u0445': case '\u0425': return 'x';
        case '\u0456': case '\u0406': return 'i';
        case '\u0458': case '\u0408': return 'j';
        case '\u0455': case '\u0405': return 's';
        default: return ch;
      }
    });
  }

  // Step 2: Separate Latin accents without mangling Arabic/CJK
  // We decompose Latin characters with diacritics
  text = text.replace(/[\u00C0-\u024F\u1E00-\u1EFF]/g, (char) => {
    return char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  });

  // Step 3: Lowercase
  text = text.toLocaleLowerCase();

  // Step 4: Remove punctuation, control characters, but strictly preserve letters/numbers across Arabic, CJK, Cyrillic, Latin
  // Regex keeping Unicode letters (\p{L}), numbers (\p{N}), and whitespace
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  // Step 4b: Handle whole-run single-letter fragmentation while strictly preserving word boundaries
  // Separate tokens by multi-space boundaries if present (e.g., "O c e a n i c   A u r o r a")
  const segments = text.split(/\s{2,}/);
  const defragmentedSegments = segments.map((seg) => {
    // Check if the entire segment consists of single characters separated by spaces: "o c e a n i c"
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => t.length === 1)) {
      return tokens.join('');
    }
    // Handle runs of 3 or more single letters inside a larger segment: "co o c e a n i c ltd"
    return seg.replace(/\b(?:[\p{L}\p{N}]\s+){2,}[\p{L}\p{N}]\b/gu, (match) => {
      return match.replace(/\s+/g, '');
    });
  });
  text = defragmentedSegments.join(' ');

  // Step 5: Collapse multiple whitespaces and trim
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes an identifier:
 * Uppercases, strips spaces, hyphens, slashes, and periods.
 */
export function normalizeIdentifier(type: string, value: string): string {
  if (!value) return '';
  const clean = value.replace(/[\s\-_./\\:]/g, '').toUpperCase();
  
  if (type === 'IMO') {
    // If prefixed with "IMO", strip it
    return clean.replace(/^IMO/, '');
  }
  return clean;
}

/**
 * Validates IMO number (7 digits).
 * Optional IMO check digit:
 * Sum of the first 6 digits multiplied by 7, 6, 5, 4, 3, 2 modulo 10 equals 7th digit.
 */
export function validateImoNumber(imo: string): { isValid: boolean; reason?: string } {
  const clean = normalizeIdentifier('IMO', imo);
  if (!/^\d{7}$/.test(clean)) {
    return { isValid: false, reason: 'IMO number must be exactly 7 digits.' };
  }
  const digits = clean.split('').map(Number);
  const weights = [7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    sum += digits[i] * weights[i];
  }
  const checkDigit = sum % 10;
  if (checkDigit !== digits[6]) {
    return {
      isValid: false,
      reason: `IMO checksum failure: expected check digit ${checkDigit}, but got ${digits[6]}.`,
    };
  }
  return { isValid: true };
}

/**
 * Computes Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Computes Jaro-Winkler similarity (0.0 to 1.0).
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const m = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const match1 = new Array(s1.length).fill(false);
  const match2 = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - m);
    const end = Math.min(i + m + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (!match2[j] && s1[i] === s2[j]) {
        match1[i] = true;
        match2[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (match1[i]) {
      while (!match2[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const jaro =
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3.0;

  // Winkler prefix boost
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return Math.min(1.0, jaro + prefix * 0.1 * (1.0 - jaro));
}

/**
 * Computes Token Sort Ratio (0.0 to 1.0):
 * Tokenizes, sorts tokens alphabetically, then computes character similarity.
 */
export function tokenSortRatio(str1: string, str2: string): number {
  const norm1 = normalizeEntityName(str1);
  const norm2 = normalizeEntityName(str2);

  if (!norm1 || !norm2) return 0.0;
  if (norm1 === norm2) return 1.0;

  const tokens1 = norm1.split(' ').filter(Boolean).sort().join(' ');
  const tokens2 = norm2.split(' ').filter(Boolean).sort().join(' ');

  if (tokens1 === tokens2) return 1.0;

  const maxLen = Math.max(tokens1.length, tokens2.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(tokens1, tokens2);
  const levRatio = 1.0 - dist / maxLen;
  const jwRatio = jaroWinklerSimilarity(tokens1, tokens2);

  // Return weighted blend
  return Math.max(0.0, Math.min(1.0, Number((levRatio * 0.4 + jwRatio * 0.6).toFixed(4))));
}

/**
 * Computes Token Set Ratio (0.0 to 1.0):
 * Breaks strings into unique token sets. Checks if all tokens of the shorter string
 * are contained in the longer string (subset containment, common in noisy transaction narratives).
 * Also tests intersection token similarity against the full string.
 */
export function tokenSetRatio(str1: string, str2: string): number {
  const norm1 = normalizeEntityName(str1);
  const norm2 = normalizeEntityName(str2);

  if (!norm1 || !norm2) return 0.0;
  if (norm1 === norm2) return 1.0;

  const tokens1 = norm1.split(' ').filter(Boolean);
  const tokens2 = norm2.split(' ').filter(Boolean);

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const minSet = set1.size <= set2.size ? set1 : set2;
  const largerSet = set1.size <= set2.size ? set2 : set1;

  const matchCount = Array.from(minSet).filter((t) => largerSet.has(t)).length;
  const subsetFraction = matchCount / minSet.size;

  // If 100% of the target entity's tokens are found inside the narrative
  if (subsetFraction === 1.0 && minSet.size >= 2) {
    return 0.95;
  }

  // If >= 75% of target entity tokens are found
  if (subsetFraction >= 0.75 && minSet.size >= 3) {
    return 0.85;
  }

  return tokenSortRatio(str1, str2);
}


/**
 * Deep recursive key sorting for canonical JSON serialization.
 */
function canonicalStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Masks account numbers, national IDs, passport identifiers, local IDs, and sanitizes raw snippets
 * to prevent leakage of unredacted PII into LLM model contexts.
 */
export function redactSensitiveDataForAgent(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Redact IBAN / Account numbers
    let redacted = obj.replace(/[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}/g, (iban) => `${iban.slice(0, 4)}****${iban.slice(-4)}`);
    // Redact passport-like strings
    redacted = redacted.replace(/([A-Z]{2}-DEMO-)\d{5,8}/g, '$1****');
    // Redact national tax IDs
    redacted = redacted.replace(/(RU-DEMO-INN-)\d{6,12}/g, '$1****');
    redacted = redacted.replace(/(CN-DEMO-)\d{10,20}/g, '$1****');
    return redacted;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveDataForAgent);
  }
  if (typeof obj === 'object') {
    const copy: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'accountNumber' && typeof value === 'string') {
        copy[key] = value.length > 6 ? `${value.slice(0, 4)}****${value.slice(-3)}` : '****';
      } else if (key === 'rawSnippet' || key === 'rawMessageSnippet') {
        // Redact raw snippet lines containing account numbers or IDs
        if (typeof value === 'string') {
          copy[key] = value
            .replace(/\/[A-Z0-9]+/g, '/***REDACTED_ACCOUNT***')
            .replace(/([A-Z]{2}-DEMO-)\d+/g, '$1****');
        } else {
          copy[key] = '[REDACTED_FOR_AGENT_CONTEXT]';
        }
      } else if (key === 'identifiers' && Array.isArray(value)) {
        copy[key] = value.map((id: any) => ({
          ...id,
          value: id.value ? `${id.value.slice(0, 2)}****${id.value.slice(-2)}` : '****',
        }));
      } else {
        copy[key] = redactSensitiveDataForAgent(value);
      }
    }
    return copy;
  }
  return obj;
}

/**
 * Calculates SHA-256 hex digest of any string or canonical JSON object.
 */
export function sha256(data: string | object): string {
  const str = typeof data === 'string' ? data : canonicalStringify(data);
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}
