// The on-device meaning model's WordPiece tokenizer (10.0 Wave 2, 2 Nov 2026 to real find-by-meaning, worked out on
// this PC only). Reads resources/models/all-MiniLM-L6-v2/tokenizer.json once and encodes exactly as it says:
// lower-case, punctuation split off, greedy longest WordPiece with ##, [CLS] and [SEP], at most 256 tokens. Main
// process only (it reads a file); the encode itself is pure given the loaded vocab.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EMBED_MAX_TOKENS, RERANK_MAX_QUERY_TOKENS, RERANK_MAX_TEXT_TOKENS } from '../shared/meaning';

export interface MeaningTokenizer {
  vocab: ReadonlyMap<string, number>;
  unk: string;
  unkId: number;
  clsId: number;
  sepId: number;
}

/** The vocab as tokenizer.json keeps it, with the ids the model was taught. */
export function loadTokenizer(modelDir: string): MeaningTokenizer {
  let raw: { model?: { vocab?: Record<string, number>; unk_token?: string }; added_tokens?: { id: number; content: string }[] };
  try {
    raw = JSON.parse(readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')) as typeof raw;
  } catch {
    throw new Error(`the meaning model's words file is missing (${path.join(modelDir, 'tokenizer.json')})`);
  }
  const vocab = raw?.model?.vocab;
  if (!vocab || typeof vocab !== 'object' || !Object.keys(vocab).length) throw new Error('the meaning model’s words file is damaged');
  const unk = raw?.model?.unk_token && vocab[raw.model.unk_token] !== undefined ? String(raw.model.unk_token) : '[UNK]';
  const at = (token: string, fallback: number): number => (vocab[token] ?? raw?.added_tokens?.find((t) => t.content === token)?.id ?? fallback);
  return { vocab: new Map(Object.entries(vocab)), unk, unkId: at(unk, 100), clsId: at('[CLS]', 101), sepId: at('[SEP]', 102) };
}

/** A CJK character gets spaces around it (as the tokenizer's own normalizer does). */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/gu;
/** What splits off its own token: ASCII punctuation, or Unicode punctuation (BERT's own reading). */
const isPunct = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) return true;
  return /\p{P}/u.test(ch);
};

/** Lower-case, cleaned and CJK-spaced: the tokenizer.json normalizer (clean_text, lowercase, accents off). */
export function normalizeForModel(text: string): string {
  // Controls and odd formatting marks go (BERT's clean_text); CJK keeps its spaces below.
  let out = text.replace(/[\u0000\uFFFD\p{Cc}\p{Cf}]/gu, '');
  // Lower-case, then accents off (é reads as e), as strip_accents does when lower-casing.
  out = out.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
  out = out.replace(CJK, ' $& ');
  // Whitespace runs read as one space.
  return out.replace(/\s+/gu, ' ').trim();
}

const splitPunct = (word: string): string[] => {
  const parts: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (isPunct(ch)) {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
      parts.push(ch);
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
};

/** One word's WordPiece tokens, greedy longest-first (a word past 100 characters reads as unknown). */
export function wordPieces(tok: MeaningTokenizer, word: string): string[] {
  if (word.length > 100) return [tok.unk];
  const out: string[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found: string | null = null;
    while (start < end) {
      const sub = start > 0 ? `##${word.slice(start, end)}` : word.slice(start, end);
      if (tok.vocab.has(sub)) {
        found = sub;
        break;
      }
      end--;
    }
    if (found === null) return [tok.unk];
    out.push(found);
    start += found.length - (start > 0 ? 2 : 0);
  }
  return out;
}

/** One side's token ids (no wrapping): the same WordPiece reading as encodeText (the rerank model's vocab is the
 *  embedding model's own, so a pair encodes with this same tokenizer). */
export function encodeSide(tok: MeaningTokenizer, text: string, maxTokens: number): number[] {
  const room = Math.max(0, Math.floor(maxTokens));
  const words = normalizeForModel(text).split(' ').filter(Boolean);
  const pieces: string[] = [];
  for (const word of words) {
    for (const token of splitPunct(word)) pieces.push(...wordPieces(tok, token));
    if (pieces.length >= room + 16) break;
  }
  return pieces.slice(0, room).map((token) => tok.vocab.get(token) ?? tok.unkId);
}

/** A rerank pair, [CLS] query [SEP] text [SEP], with its segment ids (0 through the first [SEP], 1 after): the
 *  cross-encoder reads the question and one result together (10.0 m10rerank, 2 Nov 2026). */
export function encodePair(
  tok: MeaningTokenizer,
  query: string,
  text: string,
  maxQuery = RERANK_MAX_QUERY_TOKENS,
  maxText = RERANK_MAX_TEXT_TOKENS,
): { ids: number[]; typeIds: number[] } {
  const q = encodeSide(tok, query, maxQuery);
  const t = encodeSide(tok, text, maxText);
  const ids = [tok.clsId, ...q, tok.sepId, ...t, tok.sepId];
  const typeIds = ids.map((_, i) => (i <= q.length + 1 ? 0 : 1));
  return { ids, typeIds };
}

/** A text's token ids, wrapped ([CLS] … [SEP]) and cut to EMBED_MAX_TOKENS. */
export function encodeText(tok: MeaningTokenizer, text: string, maxTokens = EMBED_MAX_TOKENS): number[] {
  const ids: number[] = [tok.clsId];
  const room = Math.max(2, maxTokens) - 2;
  const words = normalizeForModel(text).split(' ').filter(Boolean);
  const pieces: string[] = [];
  for (const word of words) {
    for (const token of splitPunct(word)) pieces.push(...wordPieces(tok, token));
    if (pieces.length >= room + 16) break;
  }
  for (const token of pieces.slice(0, room)) ids.push(tok.vocab.get(token) ?? tok.unkId);
  ids.push(tok.sepId);
  return ids;
}
