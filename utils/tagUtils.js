export const TAG_MIN_LENGTH = 2;
export const TAG_MAX_LENGTH = 32;
export const MAX_TAGS_PER_ENTITY = 20;

const TAG_EXTRA_CHARACTERS = '._-';
const TAG_EXTRA_ESCAPE = TAG_EXTRA_CHARACTERS.replace('-', '\\-');
const TAG_ALLOWED_CHAR_REGEX = new RegExp(
  `[^\\p{L}\\p{N}${TAG_EXTRA_ESCAPE}]+`,
  'gu',
);
const TAG_EDGE_TRIM_REGEX = new RegExp(
  `^[${TAG_EXTRA_ESCAPE}]+|[${TAG_EXTRA_ESCAPE}]+$`,
  'g',
);
const TAG_REPEAT_REGEX = /([._-])\1+/g;
const HASH_EXTRACT_REGEX =
  /(?:^|[\s([{\u00A0])#([\p{L}\p{N}][\p{L}\p{N}._-]{0,63})/gu;

const toTagSafeString = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return String(value);
};

export const normalizeTagName = (rawTag) => {
  const source = toTagSafeString(rawTag).trim();
  if (!source) return null;

  const withoutHash = source.replace(/^#+/, '').normalize('NFKC');
  if (!withoutHash) return null;

  const lowered = withoutHash.toLocaleLowerCase('tr-TR');
  const cleaned = lowered
    .replace(TAG_ALLOWED_CHAR_REGEX, '')
    .replace(TAG_REPEAT_REGEX, '$1')
    .replace(TAG_EDGE_TRIM_REGEX, '');

  if (!cleaned) return null;
  if (cleaned.length < TAG_MIN_LENGTH || cleaned.length > TAG_MAX_LENGTH) {
    return null;
  }

  return cleaned;
};

const maybeParseJsonArray = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : value;
  } catch (_) {
    return value;
  }
};

const toTagCandidateArray = (input) => {
  if (input == null) return [];
  const maybeParsed = maybeParseJsonArray(input);
  if (Array.isArray(maybeParsed)) return maybeParsed;
  if (typeof maybeParsed === 'string') {
    return maybeParsed
      .split(/[\s,]+/g)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }
  return [maybeParsed];
};

export const sanitizeTagList = (
  rawTags,
  { maxTags = MAX_TAGS_PER_ENTITY } = {},
) => {
  const result = [];
  const seen = new Set();

  const candidates = toTagCandidateArray(rawTags);
  for (const candidate of candidates) {
    const normalized = normalizeTagName(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxTags) break;
  }

  return result;
};

export const extractTagsFromText = (
  text,
  { maxTags = MAX_TAGS_PER_ENTITY } = {},
) => {
  const source = toTagSafeString(text);
  if (!source) return [];

  const result = [];
  const seen = new Set();

  for (const match of source.matchAll(HASH_EXTRACT_REGEX)) {
    const normalized = normalizeTagName(match[1]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxTags) break;
  }

  return result;
};

export const mergeTagSources = ({
  text = '',
  tags = [],
  maxTags = MAX_TAGS_PER_ENTITY,
} = {}) => {
  const merged = [];
  const seen = new Set();

  const pushUnique = (list) => {
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      merged.push(item);
      if (merged.length >= maxTags) return true;
    }
    return false;
  };

  if (pushUnique(sanitizeTagList(tags, { maxTags }))) return merged;
  pushUnique(extractTagsFromText(text, { maxTags }));

  return merged;
};

export const escapeRegex = (value = '') =>
  toTagSafeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const formatTagDisplayName = (name) => `#${name}`;
