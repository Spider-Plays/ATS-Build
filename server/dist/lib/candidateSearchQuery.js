/**
 * Parse recruiter boolean / multi-word input into PostgreSQL to_tsquery syntax.
 *
 * Supports: AND (implicit or explicit), OR, NOT / -, "phrases", parentheses.
 * Uses to_tsquery (not websearch_to_tsquery) so grouping precedence is correct.
 */
export class CandidateSearchQueryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CandidateSearchQueryError';
    }
}
function tokenize(input) {
    const tokens = [];
    let i = 0;
    const s = input.trim();
    while (i < s.length) {
        if (/\s/.test(s[i])) {
            i += 1;
            continue;
        }
        if (s[i] === '(') {
            tokens.push({ kind: 'LPAREN' });
            i += 1;
            continue;
        }
        if (s[i] === ')') {
            tokens.push({ kind: 'RPAREN' });
            i += 1;
            continue;
        }
        if (s[i] === '"') {
            const end = s.indexOf('"', i + 1);
            if (end === -1) {
                throw new CandidateSearchQueryError('Unclosed quote in search query');
            }
            const phrase = s.slice(i + 1, end).trim();
            if (phrase)
                tokens.push({ kind: 'PHRASE', value: phrase });
            i = end + 1;
            continue;
        }
        if (s[i] === '-' && i + 1 < s.length && /[A-Za-z0-9_"']/.test(s[i + 1])) {
            tokens.push({ kind: 'NOT' });
            i += 1;
            continue;
        }
        let j = i;
        while (j < s.length && !/[\s()"]/.test(s[j]))
            j += 1;
        const raw = s.slice(i, j);
        i = j;
        const upper = raw.toUpperCase();
        if (upper === 'AND') {
            tokens.push({ kind: 'AND' });
        }
        else if (upper === 'OR') {
            tokens.push({ kind: 'OR' });
        }
        else if (upper === 'NOT') {
            tokens.push({ kind: 'NOT' });
        }
        else if (raw) {
            tokens.push({ kind: 'WORD', value: raw });
        }
    }
    return tokens;
}
function isPrimaryStart(t) {
    return (t?.kind === 'WORD' ||
        t?.kind === 'PHRASE' ||
        t?.kind === 'LPAREN' ||
        t?.kind === 'NOT');
}
class Parser {
    tokens;
    i = 0;
    constructor(tokens) {
        this.tokens = tokens;
    }
    peek() {
        return this.tokens[this.i];
    }
    consume() {
        return this.tokens[this.i++];
    }
    parse() {
        const expr = this.parseOr();
        if (this.peek()) {
            throw new CandidateSearchQueryError('Unexpected text after search query');
        }
        return expr;
    }
    parseOr() {
        let left = this.parseAnd();
        while (this.peek()?.kind === 'OR') {
            this.consume();
            const right = this.parseAnd();
            left = { type: 'or', left, right };
        }
        return left;
    }
    parseAnd() {
        let left = this.parseNot();
        while (true) {
            const t = this.peek();
            if (t?.kind === 'AND') {
                this.consume();
                left = { type: 'and', left, right: this.parseNot() };
                continue;
            }
            if (isPrimaryStart(t)) {
                left = { type: 'and', left, right: this.parseNot() };
                continue;
            }
            break;
        }
        return left;
    }
    parseNot() {
        if (this.peek()?.kind === 'NOT') {
            this.consume();
            const inner = this.parseNot();
            return { type: 'not', expr: inner };
        }
        return this.parsePrimary();
    }
    parsePrimary() {
        const t = this.peek();
        if (!t) {
            throw new CandidateSearchQueryError('Search query ended unexpectedly');
        }
        if (t.kind === 'LPAREN') {
            this.consume();
            const inner = this.parseOr();
            if (this.consume()?.kind !== 'RPAREN') {
                throw new CandidateSearchQueryError('Unbalanced parentheses in search query');
            }
            return inner;
        }
        if (t.kind === 'WORD') {
            this.consume();
            return { type: 'term', value: t.value };
        }
        if (t.kind === 'PHRASE') {
            this.consume();
            return { type: 'phrase', value: t.value };
        }
        throw new CandidateSearchQueryError(`Unexpected "${t.kind === 'OR' ? 'OR' : t.kind === 'AND' ? 'AND' : 'token'}" in search query`);
    }
}
function quoteLexeme(word) {
    const cleaned = word.trim();
    if (!cleaned)
        return "''";
    if (/^[a-zA-Z0-9_]+$/.test(cleaned))
        return cleaned;
    return `'${cleaned.replace(/'/g, "''")}'`;
}
function phraseToTsquery(phrase) {
    const parts = phrase.split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "''";
    if (parts.length === 1)
        return quoteLexeme(parts[0]);
    return parts.map(quoteLexeme).join(' <-> ');
}
function serialize(expr, parent = null) {
    switch (expr.type) {
        case 'term':
            return quoteLexeme(expr.value);
        case 'phrase':
            return phraseToTsquery(expr.value);
        case 'not': {
            const inner = serialize(expr.expr, 'not');
            const wrapped = expr.expr.type === 'or' || expr.expr.type === 'and' ? `(${inner})` : inner;
            return `!${wrapped}`;
        }
        case 'and': {
            const left = serialize(expr.left, 'and');
            const right = serialize(expr.right, 'and');
            const l = expr.left.type === 'or' ? `(${left})` : left;
            const r = expr.right.type === 'or' ? `(${right})` : right;
            const out = `${l} & ${r}`;
            return parent === 'or' ? `(${out})` : out;
        }
        case 'or': {
            const left = serialize(expr.left, 'or');
            const right = serialize(expr.right, 'or');
            const out = `${left} | ${right}`;
            return parent === 'and' || parent === 'not' ? `(${out})` : out;
        }
    }
}
/**
 * Returns a PostgreSQL to_tsquery-compatible string, or null when there is no keyword clause.
 */
export function normalizeCandidateSearchQuery(raw) {
    if (raw == null)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    if (trimmed.length > 500) {
        throw new CandidateSearchQueryError('Search query is too long (max 500 characters)');
    }
    const tokens = tokenize(trimmed);
    if (tokens.length === 0)
        return null;
    const hasTerm = tokens.some((t) => t.kind === 'WORD' || t.kind === 'PHRASE');
    if (!hasTerm) {
        throw new CandidateSearchQueryError('Search query must include at least one keyword');
    }
    let depth = 0;
    for (const t of tokens) {
        if (t.kind === 'LPAREN')
            depth += 1;
        if (t.kind === 'RPAREN')
            depth -= 1;
        if (depth < 0) {
            throw new CandidateSearchQueryError('Unbalanced parentheses in search query');
        }
    }
    if (depth !== 0) {
        throw new CandidateSearchQueryError('Unbalanced parentheses in search query');
    }
    const ast = new Parser(tokens).parse();
    const tsquery = serialize(ast);
    return tsquery || null;
}
