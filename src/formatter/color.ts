// ANSI 16-color utilities and regex-based syntax highlighter

// ── ANSI escape codes (16 colors) ──────────────────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

const CODES = {
	bold: `${ESC}1m`,
	dim: `${ESC}2m`,
	italic: `${ESC}3m`,
	underline: `${ESC}4m`,
	red: `${ESC}31m`,
	green: `${ESC}32m`,
	yellow: `${ESC}33m`,
	blue: `${ESC}34m`,
	magenta: `${ESC}35m`,
	cyan: `${ESC}36m`,
	white: `${ESC}37m`,
	gray: `${ESC}90m`,
	brightRed: `${ESC}91m`,
	brightGreen: `${ESC}92m`,
	brightYellow: `${ESC}93m`,
	brightBlue: `${ESC}94m`,
	brightMagenta: `${ESC}95m`,
	brightCyan: `${ESC}96m`,
} as const;

export type Color = keyof typeof CODES;

// ── Color helpers ──────────────────────────────────────────────────────────

export type Colorizer = (text: string, color: Color) => string;

/** Returns a colorizer: wraps text in ANSI codes when enabled, identity when disabled. */
export function colorize(enabled: boolean): Colorizer {
	if (!enabled) return (text) => text;
	return (text, color) => `${CODES[color]}${text}${RESET}`;
}

/** Detect whether color should be enabled based on env + explicit flag */
export function shouldEnableColor(explicitFlag: boolean): boolean {
	// Explicit --color always wins
	if (explicitFlag) return true;

	// NO_COLOR spec: https://no-color.org/
	if (process.env.NO_COLOR !== undefined) return false;

	// FORCE_COLOR always enables
	if (process.env.FORCE_COLOR !== undefined) return true;

	// DBG_COLOR env var
	if (process.env.DBG_COLOR === "1" || process.env.DBG_COLOR === "true") return true;

	return false;
}

// ── Regex-based syntax highlighter ─────────────────────────────────────────

// Language detection from file extension
export type Language = "js" | "py" | "c" | "unknown";

const EXT_MAP: Record<string, Language> = {
	".js": "js",
	".mjs": "js",
	".cjs": "js",
	".ts": "js",
	".mts": "js",
	".cts": "js",
	".tsx": "js",
	".jsx": "js",
	".py": "py",
	".pyw": "py",
	".c": "c",
	".cpp": "c",
	".cc": "c",
	".cxx": "c",
	".h": "c",
	".hpp": "c",
	".rs": "c",
	".go": "c",
	".java": "c",
	".swift": "c",
	".m": "c",
};

export function detectLanguage(url: string): Language {
	const dot = url.lastIndexOf(".");
	if (dot === -1) return "unknown";
	return EXT_MAP[url.slice(dot)] ?? "unknown";
}

// Token types
interface Token {
	text: string;
	color?: Color;
}

// JS/TS keywords
const JS_KEYWORDS = new Set([
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"export",
	"extends",
	"finally",
	"for",
	"from",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"let",
	"new",
	"of",
	"return",
	"static",
	"super",
	"switch",
	"this",
	"throw",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	// TS
	"type",
	"interface",
	"enum",
	"as",
	"implements",
	"declare",
	"readonly",
	"abstract",
	"override",
]);

const JS_CONSTANTS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const PY_KEYWORDS = new Set([
	"and",
	"as",
	"assert",
	"async",
	"await",
	"break",
	"class",
	"continue",
	"def",
	"del",
	"elif",
	"else",
	"except",
	"finally",
	"for",
	"from",
	"global",
	"if",
	"import",
	"in",
	"is",
	"lambda",
	"nonlocal",
	"not",
	"or",
	"pass",
	"raise",
	"return",
	"try",
	"while",
	"with",
	"yield",
]);

const PY_CONSTANTS = new Set(["True", "False", "None"]);

const C_KEYWORDS = new Set([
	"auto",
	"break",
	"case",
	"char",
	"const",
	"continue",
	"default",
	"do",
	"double",
	"else",
	"enum",
	"extern",
	"float",
	"for",
	"goto",
	"if",
	"inline",
	"int",
	"long",
	"register",
	"return",
	"short",
	"signed",
	"sizeof",
	"static",
	"struct",
	"switch",
	"typedef",
	"union",
	"unsigned",
	"void",
	"volatile",
	"while",
	// C++
	"class",
	"namespace",
	"template",
	"typename",
	"public",
	"private",
	"protected",
	"virtual",
	"override",
	"final",
	"new",
	"delete",
	"throw",
	"try",
	"catch",
	"using",
	"nullptr",
	// Rust
	"fn",
	"let",
	"mut",
	"pub",
	"impl",
	"trait",
	"self",
	"Self",
	"match",
	"mod",
	"use",
	"crate",
	"where",
	"async",
	"await",
	"move",
	"ref",
	"unsafe",
	// Go
	"func",
	"package",
	"import",
	"var",
	"type",
	"range",
	"defer",
	"chan",
	"select",
	"go",
	"map",
	"interface",
]);

const C_CONSTANTS = new Set(["true", "false", "NULL", "nullptr", "nil"]);

function getKeywords(lang: Language): { keywords: Set<string>; constants: Set<string> } {
	switch (lang) {
		case "js":
			return { keywords: JS_KEYWORDS, constants: JS_CONSTANTS };
		case "py":
			return { keywords: PY_KEYWORDS, constants: PY_CONSTANTS };
		case "c":
			return { keywords: C_KEYWORDS, constants: C_CONSTANTS };
		default:
			return { keywords: new Set(), constants: new Set() };
	}
}

// Regex for tokenizing a single line (order matters — first match wins)
// Groups: (1) line comment (2) string (3) number (4) word (5) other
const JS_LINE_RE =
	/(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|((?<!\w)(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)(?!\w))|([a-zA-Z_$][\w$]*)|(.)/g;

const PY_LINE_RE =
	/(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|"""[\s\S]*?"""|'''[\s\S]*?''')|((?<!\w)(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?)(?!\w))|([a-zA-Z_][\w]*)|(.)/g;

const C_LINE_RE =
	/(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|((?<!\w)(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?[fFlLuU]*)(?!\w))|([a-zA-Z_][\w]*)|(.)/g;

function getRegex(lang: Language): RegExp {
	switch (lang) {
		case "js":
			return new RegExp(JS_LINE_RE.source, JS_LINE_RE.flags);
		case "py":
			return new RegExp(PY_LINE_RE.source, PY_LINE_RE.flags);
		case "c":
			return new RegExp(C_LINE_RE.source, C_LINE_RE.flags);
		default:
			return new RegExp(JS_LINE_RE.source, JS_LINE_RE.flags);
	}
}

function tokenizeLine(line: string, lang: Language): Token[] {
	if (lang === "unknown") return [{ text: line }];

	const { keywords, constants } = getKeywords(lang);
	const re = getRegex(lang);
	const tokens: Token[] = [];

	for (let match = re.exec(line); match !== null; match = re.exec(line)) {
		const [full, comment, str, num, word] = match;
		if (comment) {
			tokens.push({ text: comment, color: "gray" });
		} else if (str) {
			tokens.push({ text: str, color: "green" });
		} else if (num) {
			tokens.push({ text: num, color: "yellow" });
		} else if (word) {
			if (keywords.has(word)) {
				tokens.push({ text: word, color: "blue" });
			} else if (constants.has(word)) {
				tokens.push({ text: word, color: "yellow" });
			} else if (word[0] === word[0]?.toUpperCase() && /^[A-Z]/.test(word)) {
				tokens.push({ text: word, color: "cyan" });
			} else {
				tokens.push({ text: word });
			}
		} else {
			tokens.push({ text: full });
		}
	}

	return tokens;
}

/** Highlight a single line of source code. Returns the line with ANSI codes. */
export function highlightLine(line: string, lang: Language): string {
	const tokens = tokenizeLine(line, lang);
	return tokens.map((t) => (t.color ? `${CODES[t.color]}${t.text}${RESET}` : t.text)).join("");
}
