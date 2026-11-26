import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { romanizeSingerName } from './Romanizer.js';

const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MIRRORS = [
    'https://dumb.bloat.cat',
    'https://dumb.jeikobu.net',
    'https://dumb.ducks.party',
];

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SAFE_PATH_RE = /^\/[A-Za-z0-9%_.~'()!*,-]+-lyrics$/;
const isAltPagePath = (p) => /^\/Genius-(?:romanizations|.*-translations)-/i.test(p);
const isLyricsPageHtml = (html) => /data-lyrics-container="true"|<div id="lyrics"/i.test(html);

const decodeBytes = (bytes) => new TextDecoder().decode(bytes.get_data());

// ============================================================================
// Pure HTML / Entity / Singer Parsing & Alignment (ported from spicy-lyrics)
// ============================================================================

const NAMED_HTML_ENTITIES = {
    amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ',
    rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', yacute: 'ý',
    agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
    acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
    atilde: 'ã', ntilde: 'ñ', otilde: 'õ',
    auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', yuml: 'ÿ',
    aring: 'å', aelig: 'æ', oelig: 'œ', ccedil: 'ç', oslash: 'ø', szlig: 'ß',
};

export function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
        .replace(/&#x([0-9a-fA-F]+);/g, (full, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
        })
        .replace(/&#(\d+);/g, (full, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
        })
        .replace(/&([a-zA-Z]+);/g, (full, name) => {
            const mapped = NAMED_HTML_ENTITIES[name.toLowerCase()];
            if (!mapped) return full;
            if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
                return mapped.toUpperCase();
            }
            return mapped;
        })
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/[\u2005\u205f\u00a0]/g, ' ');
}

const SINGER_DELIMITER_CHARS = new Set([
    ',', '&', '+', '/', ';', '、', '､', '，', '・', '･', '＆', '＋', '／', '；',
]);

const SINGER_SPLIT_RE =
    /\s*(?:[,&+/;、､，・･＆＋／；]|\s+(?:and|with|feat\.?|featuring|ft\.?|vs\.?)\s+)\s*/i;

function cleanName(n) {
    return decodeHtmlEntities(n)
        .replace(/<[^>]+>/g, '')
        .replace(/[*_~`]/g, '')
        .replace(/^[,\s&+/();、､，・･＆＋／；()-]+|[,\s&+/();、､，・･＆＋／；()-]+$/g, '')
        .trim();
}

function cleanHeaderTitle(n) {
    return decodeHtmlEntities(n)
        .replace(/<[^>]+>/g, '')
        .replace(/[*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function mergeSingerNames(names) {
    const seen = new Set();
    const result = [];
    for (const raw of names) {
        if (!raw) continue;
        const parts = String(raw).split(SINGER_SPLIT_RE);
        for (const p of parts) {
            const c = cleanName(p);
            if (!c || /^(and|with|feat|featuring|ft|vs)$/i.test(c)) continue;
            const key = c.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                result.push(c);
            }
        }
    }
    return result.length > 0 ? result.join(' & ') : null;
}

export function cleanSearchTitle(title) {
    return (title || '')
        .replace(/\s*-\s*(?:remastered|live|mono|stereo|single version|radio edit).*/i, '')
        .replace(/\s*\((?:feat\.|featuring|with|remastered|live|acoustic|instrumental|bonus track).*\)/i, '')
        .replace(/\s*\[(?:feat\.|featuring|with|remastered|live|acoustic|instrumental|bonus track).*\]/i, '')
        .trim();
}

export function cleanSearchArtist(artist) {
    return (artist || '')
        .split(/\s*[,&]\s*|\s+(?:feat\.|featuring|with|ft\.)\s+|\s+\/\s+/i)[0]
        .trim();
}

function normalizeLine(line) {
    return (line || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripParensText(line) {
    const stripped = (line || '')
        .replace(/\([^)]*\)|（[^）]*）/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return stripped || line;
}

function bigramDice(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    const counts = new Map();
    for (let i = 0; i < a.length - 1; i++) {
        const bg = a.slice(i, i + 2);
        counts.set(bg, (counts.get(bg) || 0) + 1);
    }
    let shared = 0;
    for (let i = 0; i < b.length - 1; i++) {
        const bg = b.slice(i, i + 2);
        const c = counts.get(bg) || 0;
        if (c > 0) {
            shared++;
            counts.set(bg, c - 1);
        }
    }
    return (2 * shared) / (a.length - 1 + (b.length - 1));
}

export function computeSimilarity(aRaw, bRaw) {
    const a = normalizeLine(aRaw);
    const b = normalizeLine(bRaw);
    if (!a || !b) return 0;
    if (a === b) return 1;

    const aCompact = a.replace(/\s+/g, '');
    const bCompact = b.replace(/\s+/g, '');
    if (aCompact === bCompact) return 1;

    const minLen = Math.min(aCompact.length, bCompact.length);
    const maxLen = Math.max(aCompact.length, bCompact.length);

    let subScore = 0;
    if (aCompact.includes(bCompact) || bCompact.includes(aCompact)) {
        const ratio = minLen / maxLen;
        const minWords = Math.min(a.split(' ').length, b.split(' ').length);
        if (minLen >= 5 || (minLen >= 4 && minWords >= 2)) {
            subScore = 0.72 + 0.28 * ratio;
        } else {
            subScore = ratio;
        }
    }

    const wordsA = a.split(' ').filter(Boolean);
    const wordsB = b.split(' ').filter(Boolean);
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);
    let inter = 0;
    for (const w of setA) {
        if (setB.has(w)) inter++;
    }
    const union = new Set([...setA, ...setB]).size;
    const jaccard = union > 0 ? inter / union : 0;

    const minSet = Math.min(setA.size, setB.size);
    const wordOverlap = minSet >= 2 ? inter / minSet : jaccard;
    const wordScore =
        minSet >= 2 && wordOverlap >= 0.8
            ? Math.max(jaccard, 0.7 * wordOverlap + 0.3 * jaccard)
            : jaccard;

    const dice = bigramDice(aCompact, bCompact);
    return Math.max(subScore, wordScore, dice * 0.95);
}

const GENERIC_HEADERS_RE =
    /^(Intro|Introduzione|Outro|Finale|Coda|Verse|Strofa|Verso|Couplet|Strophe|Zwrotka|Куплет|Chorus|Ritornello|Estribillo|Coro|Refrain|Refrão|Refren|Припев|Nakarat|Pre-Chorus|Pre-Ritornello|Pre-Estribillo|Pré-Refrain|Pré-Refrão|Pre-Refrain|Предприпев|Post-Chorus|Post-Ritornello|Post-Estribillo|Post-Refrain|Post-Refrão|Bridge|Ponte|Puente|Pont|Бридж|Mostek|Pre-Bridge|Post-Bridge|Hook|Inciso|Stacco|Drop|Break|Breakdown|Beat\s+Switch|Interlude|Interludio|Interlúdio|Instrumental|Strumentale|Solo|Guitar\s+Solo|Skit|Spoken|Segue|Part\s+[0-9IVXLCDM]+|Parte\s+[0-9IVXLCDM]+|Partie\s+[0-9IVXLCDM]+|Section\s+[0-9IVXLCDM]+)(\s+[0-9IVXLCDM]+)?$/i;

function getBaseSectionType(header) {
    const clean = cleanHeaderTitle(header).split(':')[0].trim();
    const m =
        /^(Intro|Introduzione|Outro|Finale|Coda|Verse|Strofa|Verso|Couplet|Strophe|Zwrotka|Куплет|Chorus|Ritornello|Estribillo|Coro|Refrain|Refrão|Refren|Припев|Nakarat|Pre-Chorus|Pre-Ritornello|Pre-Estribillo|Pré-Refrain|Pré-Refrão|Pre-Refrain|Предприпев|Post-Chorus|Post-Ritornello|Post-Estribillo|Post-Refrain|Post-Refrão|Bridge|Ponte|Puente|Pont|Бридж|Mostek|Pre-Bridge|Post-Bridge|Hook|Inciso|Stacco|Drop|Break|Breakdown|Interlude|Interludio|Interlúdio|Instrumental|Strumentale|Solo|Skit|Part\s+[0-9IVXLCDM]+)(?:\s+([0-9]+|[IVXLCDM]+)\b)?/i.exec(
            clean
        );
    if (!m) return null;
    return m[2] ? `${m[1].toLowerCase()} ${m[2].toLowerCase()}` : m[1].toLowerCase();
}

function isMetadataHeader(header) {
    const clean = cleanHeaderTitle(header);
    return (
        /가사|歌詞|lyrics|romanized|romanization|english translation|translation|traduzione|traducción|tradução|übersetzung|paroles|testo\s+di|letra\s+de|songtext|tekst\s+utworu|текст\s+песни/i.test(
            clean
        ) ||
        /^(?:produced|written|composed|arranged|mixed|mastered|engineered|recorded|performed|featuring|prod\.?)\b/i.test(
            clean
        ) ||
        /^(?:\?+|\d+x|x\d+|non-lyric)$/i.test(clean)
    );
}

export function parseSingerHeader(rawHeader) {
    const styleMap = new Map();
    if (isMetadataHeader(rawHeader)) {
        return {
            sectionSinger: null,
            styleMap,
            singers: [],
            hasExplicitStyles: false,
            collectiveTokens: [],
        };
    }

    let singerString = '';
    const plainHeader = decodeHtmlEntities(rawHeader).replace(/<[^>]+>/g, '').trim();

    if (plainHeader.includes(':')) {
        let colonIdx = -1;
        let inTag = false;
        let openBold = 0;
        let openItalic = 0;
        const tagRe = /^<\/?(i|em|b|strong)\b[^>]*>/i;

        for (let i = 0; i < rawHeader.length; i++) {
            if (rawHeader[i] === '<') {
                inTag = true;
                const tm = tagRe.exec(rawHeader.slice(i));
                if (tm) {
                    const fullTag = tm[0].toLowerCase();
                    const name = tm[1].toLowerCase();
                    const isClose = fullTag.startsWith('</');
                    if (name === 'b' || name === 'strong') {
                        openBold = isClose ? Math.max(0, openBold - 1) : openBold + 1;
                    } else {
                        openItalic = isClose ? Math.max(0, openItalic - 1) : openItalic + 1;
                    }
                }
            } else if (rawHeader[i] === '>') {
                inTag = false;
            } else if (!inTag && rawHeader[i] === ':') {
                colonIdx = i;
                break;
            }
        }
        if (colonIdx !== -1) {
            let prefixTags = '';
            if (openBold > 0) prefixTags += '<b>';
            if (openItalic > 0) prefixTags += '<i>';
            singerString = prefixTags + rawHeader.slice(colonIdx + 1).trim();
        }
    } else if (!GENERIC_HEADERS_RE.test(cleanHeaderTitle(rawHeader))) {
        singerString = rawHeader.trim();
    }

    if (!singerString) {
        return { sectionSinger: null, styleMap, singers: [], hasExplicitStyles: false, collectiveTokens: [] };
    }

    const addStyleSinger = (style, rawName) => {
        const merged = mergeSingerNames([styleMap.get(style), rawName]);
        if (merged) styleMap.set(style, merged);
    };

    const hasHtml = /<\/?(?:i|em|b|strong)\b/i.test(singerString);
    const hasAsterisk = /\*[^*]+\*/.test(singerString);
    const hasParen = /\([^)]+\)/.test(singerString);
    const hasExplicitStyles = hasHtml || hasAsterisk || hasParen;

    const styledChars = [];
    let inBold = 0;
    let inItalic = 0;

    const pushTextWithMarkdown = (text, bold, italic) => {
        const mdRegex = /(\*{3}[^*]+\*{3}|\*{2}[^*]+\*{2}|\*[^*]+\*)/g;
        let lastIdx = 0;
        let m;
        const appendChars = (str, b, it, ast) => {
            for (const ch of str) {
                styledChars.push({ ch, isBold: b, isItalic: it, isAsterisk: ast });
            }
        };
        while ((m = mdRegex.exec(text)) !== null) {
            if (m.index > lastIdx) {
                appendChars(text.slice(lastIdx, m.index), bold, italic, false);
            }
            const tok = m[1];
            if (tok.startsWith('***')) {
                appendChars(tok.slice(3, -3), true, true, false);
            } else if (tok.startsWith('**')) {
                appendChars(tok.slice(2, -2), true, italic, false);
            } else {
                appendChars(tok.slice(1, -1), bold, hasHtml ? italic : true, hasHtml);
            }
            lastIdx = m.index + tok.length;
        }
        if (lastIdx < text.length) {
            appendChars(text.slice(lastIdx), bold, italic, false);
        }
    };

    const headerTokenRe = /(<\/?(?:i|em|b|strong)\b[^>]*>)|(<[^>]+>)|([^<>]+)/gi;
    let hm;
    while ((hm = headerTokenRe.exec(singerString)) !== null) {
        if (hm[1]) {
            const t = hm[1].toLowerCase();
            if (t.startsWith('<i') || t.startsWith('<em')) inItalic++;
            else if (t.startsWith('</i') || t.startsWith('</em')) inItalic = Math.max(0, inItalic - 1);
            else if (t.startsWith('<b') || t.startsWith('<strong')) inBold++;
            else if (t.startsWith('</b') || t.startsWith('</strong')) inBold = Math.max(0, inBold - 1);
        } else if (hm[3]) {
            pushTextWithMarkdown(decodeHtmlEntities(hm[3]), inBold > 0, inItalic > 0);
        }
    }

    const tokens = [];
    let curChars = [];
    let parenDepth = 0;
    let curInParen = false;

    const flushToken = () => {
        if (curChars.length > 0) {
            tokens.push({ chars: curChars, inParen: curInParen });
            curChars = [];
        }
        curInParen = parenDepth > 0;
    };

    const plainJoined = styledChars.map((c) => c.ch).join('');
    const wordDelimiterSpans = [];
    const wordDelimRe = /\s+(?:and|with|feat\.?|featuring|ft\.?|vs\.?)\s+/gi;
    let wm;
    while ((wm = wordDelimRe.exec(plainJoined)) !== null) {
        wordDelimiterSpans.push([wm.index, wm.index + wm[0].length]);
    }

    let charIdx = 0;
    while (charIdx < styledChars.length) {
        const span = wordDelimiterSpans.find(([start]) => start === charIdx);
        if (span) {
            flushToken();
            charIdx = span[1];
            continue;
        }

        const c = styledChars[charIdx];
        if (c.ch === '(' || c.ch === '（') {
            flushToken();
            parenDepth++;
            curInParen = true;
        } else if (c.ch === ')' || c.ch === '）') {
            flushToken();
            parenDepth = Math.max(0, parenDepth - 1);
            curInParen = parenDepth > 0;
        } else if (SINGER_DELIMITER_CHARS.has(c.ch)) {
            flushToken();
        } else {
            curChars.push(c);
        }
        charIdx++;
    }
    flushToken();

    const seenSingers = new Set();
    const cleanList = [];
    const collectiveTokens = [];

    for (const tok of tokens) {
        const rawName = cleanName(tok.chars.map((c) => c.ch).join(''));
        if (!rawName || /^(?:and|with|feat|featuring|ft|vs)$/i.test(rawName)) continue;

        let style = 'normal';
        if (hasExplicitStyles) {
            const alphaChars = tok.chars.filter((c) => /[\p{L}\p{N}]/u.test(c.ch));
            const sample = alphaChars.length > 0 ? alphaChars : tok.chars;
            const tokBold = sample.some((c) => c.isBold);
            const tokItalic = sample.some((c) => c.isItalic);
            const tokAst = sample.some((c) => c.isAsterisk);

            if (tokBold && (tokItalic || tokAst)) style = 'bold-italic';
            else if (tokBold) style = 'bold';
            else if (tokAst) style = hasHtml ? 'asterisk' : 'italic';
            else if (tokItalic) style = 'italic';
            else if (tok.inParen) style = 'paren';
        }

        if (/^(?:both|all|together|everyone|everybody|tutti|todos|tous|全員|全|みんな|一同|合唱|합창|모두|전체)$/i.test(rawName)) {
            collectiveTokens.push({ style, inParen: tok.inParen });
            continue;
        }

        const key = rawName.toLowerCase();
        if (!seenSingers.has(key)) {
            seenSingers.add(key);
            cleanList.push(rawName);
        }

        if (hasExplicitStyles) {
            addStyleSinger(style, rawName);
            if (tok.inParen && style !== 'paren' && !styleMap.has('paren')) {
                addStyleSinger('paren', rawName);
            }
        }
    }

    if (collectiveTokens.length > 0 && cleanList.length > 0) {
        const allCombined = cleanList.join(' & ');
        for (const ct of collectiveTokens) {
            addStyleSinger(ct.style, allCombined);
            if (ct.inParen && ct.style !== 'paren' && !styleMap.has('paren')) {
                addStyleSinger('paren', allCombined);
            }
        }
    }

    const allSingersMerged = cleanList.length > 0 ? cleanList.join(' & ') : null;
    if (!hasExplicitStyles && cleanList.length > 0) {
        styleMap.set('normal', allSingersMerged);
    }

    return {
        sectionSinger: allSingersMerged,
        styleMap,
        singers: cleanList,
        hasExplicitStyles,
        collectiveTokens,
    };
}

const CJK_SCRIPT_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const LATIN_SCRIPT_RE = /[A-Za-z]/;

function hasCjkScript(str) {
    return Boolean(str && CJK_SCRIPT_RE.test(str));
}

const KNOWN_CJK_ARTISTS = [
    ['初音ミク', 'Hatsune Miku'], ['重音テト', 'Kasane Teto'], ['鏡音リン', 'Kagamine Rin'],
    ['鏡音レン', 'Kagamine Len'], ['巡音ルカ', 'Megurine Luka'], ['音街ウナ', 'Otomachi Una'],
    ['可不', 'KAFU'], ['星界', 'SEKAI'], ['裏命', 'RIME'], ['狐子', 'COKO'], ['羽累', 'HARU'],
    ['花隈千冬', 'Hanakuma Chifuyu'], ['夏色花梨', 'Natsuki Karin'], ['小春六花', 'Koharu Rikka'],
    ['弦巻マキ', 'Tsurumaki Maki'], ['結月ゆかり', 'Yuzuki Yukari'], ['紲星あかり', 'Kizuna Akari'],
    ['神威がくぽ', 'Kamui Gakupo'], ['歌愛ユキ', 'Kaai Yuki'], ['氷山キヨテル', 'Hiyama Kiyoteru'],
    ['猫村いろは', 'Nekomura Iroha'], ['洛天依', 'Luo Tianyi'], ['言和', 'Yanhe'],
    ['乐正绫', 'Yuezheng Ling'], ['ずんだもん', 'Zundamon'], ['四国めたん', 'Shikoku Metan'],
    ['足立レイ', 'Adachi Rei'], ['琴葉茜', 'Kotonoha Akane'], ['琴葉葵', 'Kotonoha Aoi'],
];

export function extractRomanizedArtistMap(textOrHtml) {
    const map = new Map();
    for (const [cjk, rom] of KNOWN_CJK_ARTISTS) {
        map.set(cjk.toLowerCase(), rom);
    }
    if (!textOrHtml) return map;

    const plain = decodeHtmlEntities(textOrHtml)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');

    const pairRe =
        /([^\s,()&+/;、､，・･＆＋／；<>[\]「」『』—–-]+(?:\s+[^\s,()&+/;、､，・･＆＋／；<>[\]「」『』—–-]+)*)\s*[（(]([^()（）<>[\]]+)[)）]/g;
    const ignoreInnerRe =
        /^(?:romanized|english\s+translation|translation|lyrics|live|ver\.?|version|remix|ost|instrumental|feat\.?|ft\.?)$/i;

    let m;
    while ((m = pairRe.exec(plain)) !== null) {
        const outer = cleanName(m[1]);
        const inner = cleanName(m[2]);
        if (!outer || !inner || ignoreInnerRe.test(inner) || ignoreInnerRe.test(outer)) continue;

        if (hasCjkScript(outer) && LATIN_SCRIPT_RE.test(inner) && !hasCjkScript(inner)) {
            map.set(outer.toLowerCase(), inner);
        } else if (LATIN_SCRIPT_RE.test(outer) && !hasCjkScript(outer) && hasCjkScript(inner)) {
            map.set(inner.toLowerCase(), outer);
        }
    }

    return map;
}

function romanizeSingerField(singer, romanizedMap) {
    if (!singer) return null;
    if (!romanizedMap || romanizedMap.size === 0) return singer;

    const parts = singer
        .split(SINGER_SPLIT_RE)
        .map((p) => cleanName(p))
        .filter(Boolean);

    const mapped = parts.map((p) => romanizedMap.get(p.toLowerCase()) || p);
    return mergeSingerNames(mapped);
}

function sectionsHaveCjkSingers(sections) {
    if (!sections) return false;
    return sections.some(
        (sec) =>
            hasCjkScript(sec.singer) ||
            sec.lines.some((l) => hasCjkScript(l.singer) || hasCjkScript(l.parenSinger))
    );
}

function findDivEnd(html, from) {
    const re = /<(\/?)div\b[^>]*>/gi;
    re.lastIndex = from;
    let depth = 1;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1]) {
            depth--;
            if (depth === 0) return m.index;
        } else {
            depth++;
        }
    }
    return -1;
}

function extractDivContents(html, openRe) {
    const out = [];
    const re = new RegExp(openRe.source, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
        const start = m.index + m[0].length;
        const end = findDivEnd(html, start);
        if (end === -1) break;
        out.push(html.slice(start, end));
        re.lastIndex = end;
    }
    return out;
}

function stripDivs(html, openRe) {
    const re = new RegExp(openRe.source, 'i');
    let out = html;
    for (;;) {
        const m = re.exec(out);
        if (!m) return out;
        const end = findDivEnd(out, m.index + m[0].length);
        out = out.slice(0, m.index) + (end === -1 ? '' : out.slice(end + '</div>'.length));
        if (end === -1) return out;
    }
}

export function extractLyricsMarkup(textOrHtml) {
    const hasText = (markup) => /[\p{L}\p{N}]/u.test(markup.replace(/<[^>]+>/g, ''));

    const containers = extractDivContents(
        textOrHtml,
        /<div[^>]*data-lyrics-container="true"[^>]*>/
    ).map((c) => stripDivs(c, /<div[^>]*data-exclude-from-selection="true"[^>]*>/));
    const fromContainers = containers.filter(hasText);
    if (fromContainers.length > 0) return fromContainers.join('\n<br/>\n');

    const dumb = extractDivContents(textOrHtml, /<div id="lyrics"[^>]*>/).find(hasText);
    if (dumb) return dumb;

    return textOrHtml;
}

export function parseGeniusLyrics(textOrHtml, extraRomanizedMap = null) {
    const romanizedMap = extractRomanizedArtistMap(textOrHtml);
    if (extraRomanizedMap) {
        for (const [k, v] of extraRomanizedMap) {
            if (!romanizedMap.has(k)) romanizedMap.set(k, v);
        }
    }

    const content = extractLyricsMarkup(textOrHtml);
    const docHasHtmlFormatting = /<\/?(?:i|em|b|strong)\b/i.test(content);

    let inItalic = 0;
    let inBold = 0;
    let currentSegments = [];
    const rawLineObjects = [];

    const flushCurrentLine = () => {
        if (currentSegments.length === 0) return;
        const fullText = currentSegments.map((s) => s.text).join('').trim();
        if (fullText.length > 0) {
            const isBracketed = /^\[([^\]]+)\]$/.test(fullText);
            const alphaSegs = currentSegments.filter((s) => /[\p{L}\p{N}]/u.test(s.text));
            const allBold = isBracketed && alphaSegs.length > 0 && alphaSegs.every((s) => s.isBold);
            const allItalic = isBracketed && alphaSegs.length > 0 && alphaSegs.every((s) => s.isItalic);

            const mergedSegs = [];
            for (const s of currentSegments) {
                const b = s.isBold && !allBold;
                const it = s.isItalic && !allItalic;
                const last = mergedSegs[mergedSegs.length - 1];
                if (last && last.b === b && last.it === it) {
                    last.text += s.text;
                } else {
                    mergedSegs.push({ text: s.text, b, it });
                }
            }

            const styledHtml = mergedSegs
                .map((s) => {
                    if (s.b && s.it) return `<b><i>${s.text}</i></b>`;
                    if (s.b) return `<b>${s.text}</b>`;
                    if (s.it) return `<i>${s.text}</i>`;
                    return s.text;
                })
                .join('')
                .trim();

            rawLineObjects.push({ segments: [...currentSegments], fullText, styledHtml });
            if (isBracketed) {
                inItalic = 0;
                inBold = 0;
            }
        }
        currentSegments = [];
    };

    const tokenRegex = /(<br\s*\/?>|\r?\n)|(<\/?(?:i|em|b|strong)\b[^>]*>)|(<[^>]+>)|([^<>\r\n]+)/gi;
    let match;
    while ((match = tokenRegex.exec(content)) !== null) {
        if (match[1]) {
            flushCurrentLine();
        } else if (match[2]) {
            const tag = match[2].toLowerCase();
            if (tag.startsWith('<i') || tag.startsWith('<em')) inItalic++;
            else if (tag.startsWith('</i') || tag.startsWith('</em')) inItalic = Math.max(0, inItalic - 1);
            else if (tag.startsWith('<b') || tag.startsWith('<strong')) inBold++;
            else if (tag.startsWith('</b') || tag.startsWith('</strong')) inBold = Math.max(0, inBold - 1);
        } else if (match[4]) {
            const textChunk = decodeHtmlEntities(match[4]);
            if (textChunk.length > 0) {
                currentSegments.push({
                    text: textChunk,
                    isItalic: inItalic > 0,
                    isBold: inBold > 0,
                });
            }
        }
    }
    flushCurrentLine();

    const rawSections = [];
    let currentRawSection = {
        header: 'Intro',
        singer: null,
        styleMap: new Map(),
        singers: [],
        hasExplicitStyles: false,
        collectiveTokens: [],
        togetherHint: false,
        rawLines: [],
    };

    const sectionRegex = /^\[([^\]]+)\]$/;

    for (const { segments, fullText, styledHtml } of rawLineObjects) {
        const headerMatch = sectionRegex.exec(fullText);
        if (headerMatch) {
            const innerPlain = headerMatch[1].trim();
            if (isMetadataHeader(innerPlain)) continue;
            if (currentRawSection.rawLines.length > 0 || currentRawSection.singer || currentRawSection.collectiveTokens.length > 0) {
                rawSections.push(currentRawSection);
            }
            const openIdx = styledHtml.indexOf('[');
            const closeIdx = styledHtml.lastIndexOf(']');
            const innerStyled =
                openIdx !== -1 && closeIdx > openIdx
                    ? styledHtml.slice(openIdx + 1, closeIdx).trim()
                    : innerPlain;

            const { sectionSinger, styleMap, singers, hasExplicitStyles, collectiveTokens } =
                parseSingerHeader(innerStyled);
            currentRawSection = {
                header: cleanHeaderTitle(innerPlain),
                singer: sectionSinger,
                styleMap,
                singers,
                hasExplicitStyles,
                collectiveTokens: collectiveTokens || [],
                togetherHint: /[&+＆＋]|\s(?:and|with)\s/i.test(
                    innerPlain.includes(':') ? innerPlain.slice(innerPlain.indexOf(':') + 1) : ''
                ),
                rawLines: [],
            };
        } else {
            currentRawSection.rawLines.push({ segments, fullText });
        }
    }

    if (currentRawSection.rawLines.length > 0 || currentRawSection.singer || currentRawSection.collectiveTokens.length > 0) {
        rawSections.push(currentRawSection);
    }

    const allSongSingers = [];
    const seenSongSingers = new Set();
    for (const sec of rawSections) {
        for (const s of sec.singers) {
            const norm = cleanName(s);
            if (!norm) continue;
            const key = norm.toLowerCase();
            if (!seenSongSingers.has(key)) {
                seenSongSingers.add(key);
                allSongSingers.push(norm);
            }
        }
    }

    if (allSongSingers.length >= 2) {
        const allSongCombined = allSongSingers.join(' & ');
        for (const sec of rawSections) {
            if (sec.collectiveTokens.length > 0 && sec.singers.length < 2) {
                sec.singer = mergeSingerNames([...sec.singers, allSongCombined]);
                if (sec.hasExplicitStyles) {
                    for (const ct of sec.collectiveTokens) {
                        sec.styleMap.set(ct.style, allSongCombined);
                        if (ct.inParen && ct.style !== 'paren' && !sec.styleMap.has('paren')) {
                            sec.styleMap.set('paren', allSongCombined);
                        }
                    }
                } else {
                    sec.styleMap.set('normal', allSongCombined);
                }
            }
        }
    }

    const sectionTypeMemory = new Map();
    for (const sec of rawSections) {
        const baseType = getBaseSectionType(sec.header);
        if (sec.singer && baseType) {
            sectionTypeMemory.set(baseType, {
                singer: sec.singer,
                styleMap: new Map(sec.styleMap),
                singers: [...sec.singers],
                hasExplicitStyles: sec.hasExplicitStyles,
                togetherHint: sec.togetherHint,
            });
        } else if (!sec.singer && baseType && sectionTypeMemory.has(baseType)) {
            const mem = sectionTypeMemory.get(baseType);
            sec.singer = mem.singer;
            sec.styleMap = new Map(mem.styleMap);
            sec.singers = [...mem.singers];
            sec.hasExplicitStyles = mem.hasExplicitStyles;
            sec.togetherHint = mem.togetherHint;
        }
    }

    const knownSingers = new Set();
    for (const sec of rawSections) {
        for (const s of sec.singers) {
            const norm = cleanName(s).toLowerCase();
            if (norm) knownSingers.add(norm);
        }
    }

    const sections = [];

    for (const sec of rawSections) {
        const sectionHasStyledLines = sec.rawLines.some(
            ({ segments, fullText }) =>
                segments.some((s) => (s.isItalic || s.isBold) && /[\p{L}\p{N}]/u.test(s.text)) ||
                /\*{1,3}[^*]+\*{1,3}/.test(fullText)
        );

        if (!sec.hasExplicitStyles && sectionHasStyledLines && sec.singers.length > 1) {
            const stylesOrder = ['normal', 'italic', 'bold', 'bold-italic'];
            sec.styleMap.clear();
            sec.singers.forEach((artist, idx) => {
                const key = stylesOrder[idx] || 'normal';
                if (!sec.styleMap.has(key)) sec.styleMap.set(key, artist);
            });
        }

        const parsedLines = [];
        let sectionHasInlineSinger = false;

        for (const { segments, fullText } of sec.rawLines) {
            const runs = [];
            let parenDepth = 0;

            const pushCharsWithParens = (str, baseStyle) => {
                let buf = '';
                let curParen = parenDepth > 0;
                for (const ch of str) {
                    if (ch === '(' || ch === '（') {
                        if (buf) {
                            runs.push({ text: buf, style: baseStyle, inParen: curParen });
                            buf = '';
                        }
                        parenDepth++;
                        curParen = true;
                    } else if (ch === ')' || ch === '）') {
                        if (buf) {
                            runs.push({ text: buf, style: baseStyle, inParen: curParen });
                            buf = '';
                        }
                        parenDepth = Math.max(0, parenDepth - 1);
                        curParen = parenDepth > 0;
                    } else {
                        buf += ch;
                    }
                }
                if (buf) {
                    runs.push({ text: buf, style: baseStyle, inParen: curParen });
                }
            };

            for (const seg of segments) {
                let segStyle = 'normal';
                if (seg.isBold && seg.isItalic) segStyle = 'bold-italic';
                else if (seg.isBold) segStyle = 'bold';
                else if (seg.isItalic) segStyle = 'italic';

                const mdRegex = /(\*{3}[^*]+\*{3}|\*{2}[^*]+\*{2}|\*[^*]+\*)/g;
                let lastIdx = 0;
                let m;
                while ((m = mdRegex.exec(seg.text)) !== null) {
                    if (m.index > lastIdx) {
                        pushCharsWithParens(seg.text.slice(lastIdx, m.index), segStyle);
                    }
                    const tok = m[1];
                    if (tok.startsWith('***')) {
                        pushCharsWithParens(tok.slice(3, -3), 'bold-italic');
                    } else if (tok.startsWith('**')) {
                        pushCharsWithParens(tok.slice(2, -2), 'bold');
                    } else {
                        pushCharsWithParens(tok.slice(1, -1), docHasHtmlFormatting ? 'asterisk' : 'italic');
                    }
                    lastIdx = m.index + tok.length;
                }
                if (lastIdx < seg.text.length) {
                    pushCharsWithParens(seg.text.slice(lastIdx), segStyle);
                }
            }

            const mainRuns = runs.filter((r) => !r.inParen);
            const parenRuns = runs.filter((r) => r.inParen);

            const mainTextRaw = mainRuns.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
            const parenTextRaw = parenRuns.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim();
            const cleanFullText = fullText.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1').trim();

            let cleanText = cleanFullText;
            let explicitLineSinger = null;
            const inlineMatch = /^([^:]{1,40}):\s*(.+)$/.exec(cleanText);
            if (inlineMatch && !cleanText.startsWith('http')) {
                const prefix = inlineMatch[1].trim();
                const rest = inlineMatch[2].trim();
                const isQuotedSpeech = /^["'“”‘’«»「」『』‹›„‚]/.test(rest);
                const prefixParts = prefix
                    .split(SINGER_SPLIT_RE)
                    .map((p) => cleanName(p).toLowerCase())
                    .filter(Boolean);
                const isKnownSingerPrefix =
                    knownSingers.size > 0 &&
                    prefixParts.length > 0 &&
                    prefixParts.every((p) => knownSingers.has(p));

                if (
                    !isQuotedSpeech &&
                    isKnownSingerPrefix &&
                    !/^(http|https|verse|chorus|bridge|hook|intro|outro|pre-chorus|post-chorus|refrain)/i.test(prefix)
                ) {
                    explicitLineSinger = mergeSingerNames([prefix]);
                    sectionHasInlineSinger = true;
                    cleanText = rest;
                }
            }

            const resolveRunsSinger = (targetRuns, isParenGroup) => {
                const activeStyles = [];
                for (const r of targetRuns) {
                    if (!/[\p{L}\p{N}]/u.test(r.text)) continue;
                    if (!activeStyles.includes(r.style)) activeStyles.push(r.style);
                }

                if (activeStyles.length === 0) return { singer: null, primaryStyle: 'normal' };

                const primaryStyle = activeStyles[0];
                if (!sec.styleMap || sec.styleMap.size === 0) {
                    return { singer: sec.singer, primaryStyle };
                }

                const resolvedNames = [];
                for (const st of activeStyles) {
                    if (isParenGroup && st === 'normal' && sec.styleMap.has('paren')) {
                        resolvedNames.push(sec.styleMap.get('paren'));
                    } else if (sec.styleMap.has(st)) {
                        resolvedNames.push(sec.styleMap.get(st));
                    } else if (st === 'bold-italic') {
                        const b = sec.styleMap.get('bold');
                        const it = sec.styleMap.get('italic');
                        if (b && it) resolvedNames.push(`${b} & ${it}`);
                        else if (b || it) resolvedNames.push(b || it);
                    }
                }

                const merged = mergeSingerNames(resolvedNames);
                if (merged) return { singer: merged, primaryStyle };

                return { singer: sec.styleMap.get('normal') || sec.singer, primaryStyle };
            };

            let lineSinger = explicitLineSinger;
            let lineStyle = 'normal';

            const mainResolved = resolveRunsSinger(mainRuns, false);
            const parenResolved = resolveRunsSinger(parenRuns, true);

            if (!lineSinger) {
                if (mainResolved.singer) {
                    lineSinger = mainResolved.singer;
                    lineStyle = mainResolved.primaryStyle;
                } else if (parenResolved.singer) {
                    lineSinger = parenResolved.singer;
                    lineStyle = parenResolved.primaryStyle;
                } else {
                    lineSinger = sec.singer;
                }
            }

            const parenSinger = romanizeSingerField(parenResolved.singer || lineSinger, romanizedMap);
            const finalLineSinger = romanizeSingerField(lineSinger, romanizedMap);

            parsedLines.push({
                text: cleanText,
                mainText: mainTextRaw || parenTextRaw || cleanText,
                parenText: parenTextRaw || undefined,
                singer: finalLineSinger,
                parenSinger,
                style: lineStyle,
            });
        }

        const lineStyles = new Set(parsedLines.map((l) => l.style));
        const isChorusLike = /chorus|refrain|hook|ritornello|estribillo|refr[aã]o/i.test(
            getBaseSectionType(sec.header) ?? ''
        );
        const undetermined =
            parsedLines.length > 0 &&
            sec.singers.length >= 2 &&
            sec.collectiveTokens.length === 0 &&
            !sec.togetherHint &&
            !sec.hasExplicitStyles &&
            !sectionHasInlineSinger &&
            !isChorusLike &&
            lineStyles.size <= 1;

        if (undetermined) {
            for (const l of parsedLines) {
                l.singer = null;
                l.parenSinger = null;
            }
            sections.push({
                header: sec.header,
                singer: null,
                lines: parsedLines,
                styleMap: [],
                undetermined: true,
            });
            continue;
        }

        const mappedStyleEntries = [];
        for (const [st, sName] of sec.styleMap) {
            const mapped = romanizeSingerField(sName, romanizedMap);
            if (mapped) mappedStyleEntries.push([st, mapped]);
        }

        sections.push({
            header: sec.header,
            singer: romanizeSingerField(sec.singer, romanizedMap),
            lines: parsedLines,
            styleMap: mappedStyleEntries,
        });
    }

    return sections;
}

function normalizeGeniusSlugCombined(artist, title) {
    return `${artist} ${title}`
        .replace(/&/g, ' and ')
        .replace(/['’"“”.,!?()[\]{}]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function buildGeniusSlugPath(artist, title) {
    const combined = normalizeGeniusSlugCombined(artist, title);
    if (!combined) return null;
    return `/${combined.charAt(0).toUpperCase()}${combined.slice(1)}-lyrics`;
}

function buildGeniusRomanizedSlugPath(artist, title) {
    const combined = normalizeGeniusSlugCombined(artist, title);
    if (!combined) return null;
    return `/Genius-romanizations-${combined}-romanized-lyrics`;
}

export function applyRomanizedSectionsSingers(baseSections, romSections) {
    if (!romSections || romSections.length === 0) return baseSections;

    const learnedMap = new Map();
    const learnFromPair = (baseSinger, romSinger) => {
        if (!baseSinger || !romSinger) return;
        const baseParts = baseSinger.split(SINGER_SPLIT_RE).map(cleanName).filter(Boolean);
        const romParts = romSinger.split(SINGER_SPLIT_RE).map(cleanName).filter(Boolean);
        if (baseParts.length === romParts.length) {
            for (let i = 0; i < baseParts.length; i++) {
                if (hasCjkScript(baseParts[i]) && !hasCjkScript(romParts[i]) && LATIN_SCRIPT_RE.test(romParts[i])) {
                    learnedMap.set(baseParts[i].toLowerCase(), romParts[i]);
                }
            }
        }
    };

    const count = Math.min(baseSections.length, romSections.length);
    for (let i = 0; i < count; i++) {
        const bSec = baseSections[i];
        const rSec = romSections[i];
        learnFromPair(bSec.singer, rSec.singer);
        if (Array.isArray(bSec.styleMap) && Array.isArray(rSec.styleMap)) {
            const rMap = new Map(rSec.styleMap);
            for (const [st, bVal] of bSec.styleMap) {
                learnFromPair(bVal, rMap.get(st));
            }
        }
    }

    if (learnedMap.size > 0) {
        for (const sec of baseSections) {
            sec.singer = romanizeSingerField(sec.singer, learnedMap);
            if (Array.isArray(sec.styleMap)) {
                sec.styleMap = sec.styleMap.map(([st, val]) => [st, romanizeSingerField(val, learnedMap) || val]);
            }
            for (const l of sec.lines) {
                l.singer = romanizeSingerField(l.singer, learnedMap);
                l.parenSinger = romanizeSingerField(l.parenSinger, learnedMap);
            }
        }
    }

    if (!sectionsHaveCjkSingers(baseSections)) return baseSections;
    if (!sectionsHaveCjkSingers(romSections)) return romSections;
    return baseSections;
}

function romanizeRemainingCjkSingers(sections) {
    if (!sectionsHaveCjkSingers(sections)) return sections;
    const memo = new Map();
    const romField = (singer) => {
        if (!singer || !hasCjkScript(singer)) return singer;
        const parts = singer.split(SINGER_SPLIT_RE).map(cleanName).filter(Boolean);
        const out = parts.map((part) => {
            if (!hasCjkScript(part)) return part;
            const key = part.toLowerCase();
            let rom = memo.get(key);
            if (!rom) {
                const known = KNOWN_CJK_ARTISTS.find(([k]) => k.toLowerCase() === key);
                rom = known ? known[1] : romanizeSingerName(part);
                memo.set(key, rom);
            }
            return rom;
        });
        return mergeSingerNames(out) || singer;
    };

    for (const sec of sections) {
        sec.singer = romField(sec.singer);
        if (Array.isArray(sec.styleMap)) {
            sec.styleMap = sec.styleMap.map(([st, val]) => [st, romField(val)]);
        }
        for (const line of sec.lines) {
            line.singer = romField(line.singer);
            line.parenSinger = romField(line.parenSinger);
        }
    }
    return sections;
}

export function mergeUndeterminedSections(base, rom) {
    const norm = (h) => h.toLowerCase().replace(/:.*$/, '').replace(/\s+/g, ' ').trim();
    const romByHeader = new Map();
    for (const sec of rom) {
        const k = norm(sec.header);
        if (!romByHeader.has(k)) romByHeader.set(k, []);
        romByHeader.get(k).push(sec);
    }
    const seen = new Map();
    return base.map((sec) => {
        const k = norm(sec.header);
        const occurrence = seen.get(k) ?? 0;
        seen.set(k, occurrence + 1);
        if (!sec.undetermined) return sec;
        const match = romByHeader.get(k)?.[occurrence];
        if (
            !match ||
            match.undetermined ||
            match.lines.length !== sec.lines.length ||
            !match.lines.some((l) => l.singer)
        ) {
            return sec;
        }
        return {
            header: sec.header,
            singer: match.singer,
            styleMap: match.styleMap,
            lines: sec.lines.map((l, i) => ({
                ...l,
                singer: match.lines[i].singer,
                parenSinger: match.lines[i].parenSinger,
                style: match.lines[i].style,
            })),
        };
    });
}

function pairSimilarity(lineText, gMain, gFull) {
    const sFull = normalizeLine(lineText);
    const sMain = normalizeLine(stripParensText(lineText));
    if (!sFull) return 0;

    return Math.max(
        computeSimilarity(sFull, gFull),
        computeSimilarity(sFull, gMain),
        computeSimilarity(sMain, gMain)
    );
}

function lineSimilarity(lineText, lineTranslit, gMain, gFull) {
    const baseScore = pairSimilarity(lineText, gMain, gFull);
    if (!lineTranslit || lineTranslit === lineText) return baseScore;
    return Math.max(baseScore, pairSimilarity(lineTranslit, gMain, gFull));
}

export function alignGeniusSingers(lines, sections) {
    if (!sections || sections.length === 0 || !lines || lines.length === 0) return false;

    const flatG = [];
    sections.forEach((sec, sIdx) => {
        sec.lines.forEach((l, lIdx) => {
            flatG.push({
                sectionIdx: sIdx,
                lineIdx: lIdx,
                text: l.text,
                mainText: l.mainText || l.text,
                parenText: l.parenText,
                singer: l.singer || sec.singer,
                parenSinger: l.parenSinger || l.singer || sec.singer,
                style: l.style || 'normal',
            });
        });
    });

    if (flatG.length === 0 || !flatG.some((g) => g.singer)) return false;

    for (const g of flatG) {
        if (!g.parenSinger) g.parenSinger = g.singer;
    }

    const validIndices = [];
    for (let i = 0; i < lines.length; i++) {
        const text = lines[i].text ?? lines[i].Text ?? '';
        if (normalizeLine(text).length > 0) {
            validIndices.push(i);
        }
    }

    const N = validIndices.length;
    const M = flatG.length;
    if (N === 0) return false;

    const sim1 = new Float32Array(N * M);
    const sim2 = new Float32Array(N * M);

    for (let i = 0; i < N; i++) {
        const sLine = lines[validIndices[i]];
        const sText = sLine.text ?? sLine.Text ?? '';
        const sRom = sLine.romanizedText ?? sLine.TransliteratedText;
        for (let j = 0; j < M; j++) {
            const g = flatG[j];
            sim1[i * M + j] = lineSimilarity(sText, sRom, g.mainText, g.text);
            if (j > 0 && flatG[j - 1].sectionIdx === g.sectionIdx) {
                const gPrev = flatG[j - 1];
                sim2[i * M + j] = lineSimilarity(
                    sText,
                    sRom,
                    `${gPrev.mainText} ${g.mainText}`,
                    `${gPrev.text} ${g.text}`
                );
            }
        }
    }

    const cols = M + 1;
    const dp = new Float32Array((N + 1) * cols);
    const back = new Uint8Array((N + 1) * cols);

    const SKIP_S_PENALTY = -0.06;
    const SKIP_G_PENALTY = -0.03;
    const MIN_MATCH_SCORE = 0.42;
    const MIN_MATCHED_FRACTION = 0.4;

    for (let i = 1; i <= N; i++) {
        dp[i * cols] = dp[(i - 1) * cols] + SKIP_S_PENALTY;
        back[i * cols] = 1;
    }
    for (let j = 1; j <= M; j++) {
        dp[j] = dp[j - 1] + SKIP_G_PENALTY;
        back[j] = 2;
    }

    for (let i = 1; i <= N; i++) {
        for (let j = 1; j <= M; j++) {
            const idx = i * cols + j;
            let bestScore = dp[(i - 1) * cols + j] + SKIP_S_PENALTY;
            let bestAct = 1;

            const skipG = dp[i * cols + (j - 1)] + SKIP_G_PENALTY;
            if (skipG > bestScore) {
                bestScore = skipG;
                bestAct = 2;
            }

            const s1 = sim1[(i - 1) * M + (j - 1)];
            if (s1 >= MIN_MATCH_SCORE) {
                const score3 = dp[(i - 1) * cols + (j - 1)] + s1;
                if (score3 >= bestScore) {
                    bestScore = score3;
                    bestAct = 3;
                }

                if (i >= 2) {
                    const prevAct = back[(i - 1) * cols + j];
                    if (prevAct === 3 || prevAct === 4) {
                        const score4 = dp[(i - 1) * cols + j] + s1 * 0.92;
                        if (score4 > bestScore) {
                            bestScore = score4;
                            bestAct = 4;
                        }
                    }
                }
            }

            if (j >= 2) {
                const s2 = sim2[(i - 1) * M + (j - 1)];
                if (s2 >= MIN_MATCH_SCORE + 0.05 && s2 > s1 + 0.04) {
                    const score5 = dp[(i - 1) * cols + (j - 2)] + s2 * 1.05;
                    if (score5 > bestScore) {
                        bestScore = score5;
                        bestAct = 5;
                    }
                }
            }

            dp[idx] = bestScore;
            back[idx] = bestAct;
        }
    }

    const assigned = new Array(N).fill(null);
    let ci = N;
    let cj = M;
    let matchedCount = 0;

    while (ci > 0 || cj > 0) {
        const act = back[ci * cols + cj];
        if (ci > 0 && (act === 3 || act === 4)) {
            const g = flatG[cj - 1];
            assigned[ci - 1] = {
                singer: g.singer,
                parenSinger: g.parenSinger,
                style: g.style,
                sectionIdx: g.sectionIdx,
                gIdx: cj - 1,
            };
            matchedCount++;
            if (act === 3) {
                ci--;
                cj--;
            } else {
                ci--;
            }
        } else if (ci > 0 && act === 5 && cj >= 2) {
            const g1 = flatG[cj - 2];
            const g2 = flatG[cj - 1];
            assigned[ci - 1] = {
                singer: mergeSingerNames([g1.singer, g2.singer]),
                parenSinger: mergeSingerNames([g1.parenSinger, g2.parenSinger]),
                style: g1.style,
                sectionIdx: g2.sectionIdx,
                gIdx: cj - 1,
            };
            matchedCount++;
            ci--;
            cj -= 2;
        } else if (ci > 0 && (act === 1 || cj === 0)) {
            ci--;
        } else {
            cj--;
        }
    }

    if (matchedCount < Math.max(2, Math.ceil(N * MIN_MATCHED_FRACTION))) return false;

    const matchedAt = [];
    for (let i = 0; i < N; i++) {
        if (assigned[i]) matchedAt.push(i);
    }

    const pickFromG = (gPos, fallback) => {
        const g = flatG[Math.min(flatG.length - 1, Math.max(0, gPos))];
        return g
            ? {
                  singer: g.singer,
                  parenSinger: g.parenSinger,
                  style: g.style,
                  sectionIdx: g.sectionIdx,
                  gIdx: gPos,
              }
            : { ...fallback };
    };

    for (let i = 0; i < N; i++) {
        if (assigned[i]) continue;
        let prevI = -1;
        let nextI = -1;
        for (const mi of matchedAt) {
            if (mi < i) prevI = mi;
            else {
                nextI = mi;
                break;
            }
        }
        const prev = prevI >= 0 ? assigned[prevI] : null;
        const next = nextI >= 0 ? assigned[nextI] : null;
        if (!prev && next) {
            assigned[i] = { ...next };
        } else if (prev && !next) {
            assigned[i] = { ...prev };
        } else if (prev && next) {
            if (prev.sectionIdx === next.sectionIdx) {
                assigned[i] = { ...prev };
            } else {
                const t = prev.gIdx + ((i - prevI) / (nextI - prevI)) * (next.gIdx - prev.gIdx);
                assigned[i] = pickFromG(Math.round(t), prev);
            }
        }
    }

    for (let i = 0; i < N; i++) {
        const m = assigned[i];
        if (!m || !m.singer) continue;
        const targetLine = lines[validIndices[i]];
        targetLine.singer = m.singer;
        targetLine.singerStyle = m.style;
    }

    return true;
}

// ============================================================================
// Genius Search Hit Scoring (from workers/genius-proxy.js)
// ============================================================================

const normQuery = (s) =>
    (s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

function pickSearchHit(hits, title, artist) {
    const t = normQuery(title);
    const a = normQuery(artist);
    const songs = (hits || [])
        .map((h) => h.result || h)
        .filter((r) => r?.path && SAFE_PATH_RE.test(r.path) && !isAltPagePath(r.path));
    const score = (r) => {
        const rt = normQuery(r.title);
        const ra = normQuery(r.primary_artist?.name || r.artist_names);
        let s = 0;
        if (rt === t) s += 3;
        else if (rt.includes(t) || t.includes(rt)) s += 1;
        if (a && (ra.includes(a) || a.includes(ra))) s += 2;
        return s;
    };
    return songs.sort((x, y) => score(y) - score(x))[0] || null;
}

// ============================================================================
// GeniusSingerClient — Soup HTTP, Disk Cache & Enrichment
// ============================================================================

export class GeniusSingerClient {
    constructor() {
        Gio._promisify(
            Soup.Session.prototype,
            'send_and_read_async',
            'send_and_read_finish'
        );
        this._session = new Soup.Session({ user_agent: BROWSER_USER_AGENT, timeout: 8 });
        this._cancellable = new Gio.Cancellable();
        this._memCache = new Map();
        this._inFlight = new Map();
        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'dynamic-music-pill',
            'genius',
        ]);
        GLib.mkdir_with_parents(this._cacheDir, 0o755);
    }

    _cacheFilePath(cacheKey) {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, cacheKey, -1);
        return GLib.build_filenamev([this._cacheDir, `${hash}.json`]);
    }

    _readDiskCache(cacheKey) {
        const path = this._cacheFilePath(cacheKey);
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok || !bytes) return null;
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (
                parsed &&
                Array.isArray(parsed.sections) &&
                typeof parsed.timestamp === 'number' &&
                Date.now() - parsed.timestamp < CACHE_TTL_MS &&
                !sectionsHaveCjkSingers(parsed.sections)
            ) {
                return parsed.sections;
            }
        } catch {
            // Ignore corrupt cache file
        }
        return null;
    }

    _writeDiskCache(cacheKey, sections) {
        try {
            GLib.mkdir_with_parents(this._cacheDir, 0o755);
            const path = this._cacheFilePath(cacheKey);
            const payload = JSON.stringify({ sections, timestamp: Date.now() });
            GLib.file_set_contents(path, payload);
        } catch (e) {
            console.debug(`[GeniusSingerClient] Failed to write cache: ${e.message}`);
        }
    }

    clearCache() {
        this._memCache.clear();
        try {
            const dir = Gio.File.new_for_path(this._cacheDir);
            if (!dir.query_exists(null)) return;
            const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let fi;
            while ((fi = en.next_file(null)) !== null) {
                const f = dir.get_child(fi.get_name());
                try {
                    f.delete(null);
                } catch {
                    // ignore
                }
            }
            en.close(null);
        } catch (e) {
            console.debug(`[GeniusSingerClient] Failed to clear disk cache: ${e.message}`);
        }
    }

    async _httpGet(url, headers = {}) {
        if (!this._session || this._cancellable?.is_cancelled()) return null;
        try {
            const msg = Soup.Message.new('GET', url);
            if (!msg) return null;
            for (const [k, v] of Object.entries(headers)) {
                msg.request_headers.append(k, v);
            }
            const bytes = await this._session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                this._cancellable
            );
            if (msg.status_code !== Soup.Status.OK || !bytes) return null;
            return decodeBytes(bytes);
        } catch {
            return null;
        }
    }

    async _fetchViaProxy(proxyUrl, token, title, artist, extraParams = {}) {
        if (!proxyUrl) return null;
        try {
            const params = [
                `title=${encodeURIComponent(title)}`,
                `artist=${encodeURIComponent(artist)}`,
            ];
            for (const [k, v] of Object.entries(extraParams)) {
                params.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
            }
            const sep = proxyUrl.includes('?') ? '&' : '?';
            const url = `${proxyUrl}${sep}${params.join('&')}`;
            const headers = { Accept: 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const raw = await this._httpGet(url, headers);
            if (!raw) return null;
            const data = JSON.parse(raw);
            let sections = null;
            if (typeof data.html === 'string') {
                sections = parseGeniusLyrics(data.html);
            } else if (typeof data.lyrics === 'string') {
                sections = parseGeniusLyrics(data.lyrics);
            } else if (Array.isArray(data.sections)) {
                sections = data.sections;
            }
            return sections && sections.some((s) => s.singer || s.lines.some((l) => l.singer))
                ? sections
                : null;
        } catch {
            return null;
        }
    }

    async _tryScrapeSongPath(songUrlOrPath) {
        let pathPart = songUrlOrPath;
        if (songUrlOrPath.startsWith('http')) {
            const m = songUrlOrPath.match(/^https?:\/\/[^/]+(\/.*)$/);
            if (m) pathPart = m[1];
        }

        const candidateUrls = songUrlOrPath.startsWith('http')
            ? [songUrlOrPath, ...MIRRORS.map((m) => `${m}${pathPart}`)]
            : [`https://genius.com${pathPart}`, ...MIRRORS.map((m) => `${m}${pathPart}`)];

        for (const url of candidateUrls) {
            const html = await this._httpGet(url, {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            });
            if (!html || !isLyricsPageHtml(html)) continue;
            const sections = parseGeniusLyrics(html);
            if (sections.some((s) => s.singer || s.lines.some((l) => l.singer))) {
                return sections;
            }
        }
        return null;
    }

    async _searchGeniusMulti(cleanTitle, cleanArt) {
        const q = `${cleanTitle} ${cleanArt}`.trim();
        const raw = await this._httpGet(
            `https://genius.com/api/search/multi?q=${encodeURIComponent(q)}`,
            { Accept: 'application/json' }
        );
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            const hits = [];
            for (const sec of data?.response?.sections || []) {
                if (sec.type === 'song' || sec.type === 'top_hit') {
                    for (const h of sec.hits || []) hits.push(h);
                }
            }
            return pickSearchHit(hits, cleanTitle, cleanArt)?.path || null;
        } catch {
            return null;
        }
    }

    fetchGeniusSections(title, artist, settings = null) {
        if (!title || !artist) return Promise.resolve(null);
        const key = `${artist.toLowerCase()} - ${title.toLowerCase()}`;
        if (this._inFlight.has(key)) return this._inFlight.get(key);

        const job = this._fetchGeniusSectionsUncached(title, artist, settings, key)
            .finally(() => {
                this._inFlight.delete(key);
            });
        this._inFlight.set(key, job);
        return job;
    }

    async _fetchGeniusSectionsUncached(title, artist, settings, cacheKey) {
        const mem = this._memCache.get(cacheKey);
        if (mem && Date.now() - mem.timestamp < CACHE_TTL_MS && !sectionsHaveCjkSingers(mem.sections)) {
            return mem.sections;
        }

        const disk = this._readDiskCache(cacheKey);
        if (disk) {
            this._memCache.set(cacheKey, { sections: disk, timestamp: Date.now() });
            return disk;
        }

        const cleanTitle = cleanSearchTitle(title);
        const cleanArt = cleanSearchArtist(artist);
        const proxyUrl = settings ? settings.get_string('genius-proxy-url').trim() : '';
        const token = settings ? settings.get_string('genius-access-token').trim() : '';

        const refineUndetermined = async (sections) => {
            if (!sections.some((s) => s.undetermined)) return sections;
            const romPath = buildGeniusRomanizedSlugPath(cleanArt, cleanTitle);
            if (!romPath) return sections;
            const rom =
                (await this._fetchViaProxy(proxyUrl, token, cleanTitle, cleanArt, { path: romPath })) ??
                (await this._tryScrapeSongPath(romPath));
            return rom ? mergeUndeterminedSections(sections, rom) : sections;
        };

        let foundSections = null;

        // 1. Custom Cloudflare Worker Proxy (if configured)
        if (proxyUrl) {
            const sections = await this._fetchViaProxy(proxyUrl, token, cleanTitle, cleanArt);
            if (sections) {
                if (!sectionsHaveCjkSingers(sections)) {
                    const refined = await refineUndetermined(sections);
                    this._memCache.set(cacheKey, { sections: refined, timestamp: Date.now() });
                    this._writeDiskCache(cacheKey, refined);
                    return refined;
                }
                foundSections = sections;
            }
        }

        // 2. Official Genius API (if access token is configured)
        if (!foundSections && token) {
            const query = `${cleanTitle} ${cleanArt}`.trim();
            const raw = await this._httpGet(
                `https://api.genius.com/search?q=${encodeURIComponent(query)}`,
                { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            );
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    const hit = pickSearchHit(data?.response?.hits || [], cleanTitle, cleanArt);
                    const songPath = hit?.path || hit?.url;
                    if (songPath) {
                        const sections = await this._tryScrapeSongPath(songPath);
                        if (sections) {
                            if (!sectionsHaveCjkSingers(sections)) {
                                const refined = await refineUndetermined(sections);
                                this._memCache.set(cacheKey, { sections: refined, timestamp: Date.now() });
                                this._writeDiskCache(cacheKey, refined);
                                return refined;
                            }
                            foundSections = sections;
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }

        // 3. Direct Genius public multi-search + page scrape
        if (!foundSections) {
            const multiPath = await this._searchGeniusMulti(cleanTitle, cleanArt);
            if (multiPath) {
                const sections = await this._tryScrapeSongPath(multiPath);
                if (sections) {
                    if (!sectionsHaveCjkSingers(sections)) {
                        const refined = await refineUndetermined(sections);
                        this._memCache.set(cacheKey, { sections: refined, timestamp: Date.now() });
                        this._writeDiskCache(cacheKey, refined);
                        return refined;
                    }
                    foundSections = sections;
                }
            }
        }

        // 4. Direct slug lookup fallback (standard & romanized pages)
        const slugPath = buildGeniusSlugPath(cleanArt, cleanTitle);
        const romSlugPath = buildGeniusRomanizedSlugPath(cleanArt, cleanTitle);

        if (!foundSections && slugPath) {
            foundSections = await this._tryScrapeSongPath(slugPath);
        }

        if ((!foundSections || sectionsHaveCjkSingers(foundSections)) && romSlugPath) {
            const romSections = await this._tryScrapeSongPath(romSlugPath);
            if (romSections) {
                foundSections = foundSections
                    ? applyRomanizedSectionsSingers(foundSections, romSections)
                    : romSections;
            }
        }

        if (foundSections) {
            foundSections = romanizeRemainingCjkSingers(foundSections);
            foundSections = await refineUndetermined(foundSections);
            this._memCache.set(cacheKey, { sections: foundSections, timestamp: Date.now() });
            this._writeDiskCache(cacheKey, foundSections);
            return foundSections;
        }

        return null;
    }

    async enrichLinesWithSingers(lines, title, artist, settings = null, prefetchedSectionsPromise = null) {
        if (!Array.isArray(lines) || lines.length === 0) return false;

        // 1. Try Genius sections alignment
        let sections = null;
        try {
            sections = prefetchedSectionsPromise
                ? await prefetchedSectionsPromise
                : await this.fetchGeniusSections(title, artist, settings);
        } catch {
            sections = null;
        }

        if (sections && alignGeniusSingers(lines, sections)) {
            return true;
        }

        // 2. Keep native Apple Music TTML singer attributions if present
        if (lines.some((l) => Boolean(l.singer))) {
            for (const l of lines) {
                if (l.singer && hasCjkScript(l.singer)) {
                    l.singer = romanizeSingerName(l.singer);
                }
            }
            return true;
        }

        // 3. Fallback: 2 distinct TTML agentIds + 2 non-brand artists
        const nonSingerBrands =
            /^(League of Legends|Various Artists|Original Soundtrack|Soundtrack|Cast|Riot Games Music)$/i;
        const artistList = (artist || '')
            .split(/\s*,\s*|\s*&\s*/)
            .map((a) => a.trim())
            .filter(Boolean);
        if (
            artistList.length === 2 &&
            !nonSingerBrands.test(artistList[0]) &&
            !nonSingerBrands.test(artistList[1])
        ) {
            const agentIds = [];
            for (const l of lines) {
                if (l.agentId && !agentIds.includes(l.agentId)) {
                    agentIds.push(l.agentId);
                }
            }
            if (agentIds.length === 2) {
                const a1 = hasCjkScript(artistList[0]) ? romanizeSingerName(artistList[0]) : artistList[0];
                const a2 = hasCjkScript(artistList[1]) ? romanizeSingerName(artistList[1]) : artistList[1];
                for (const l of lines) {
                    if (l.agentId === agentIds[0]) l.singer = a1;
                    else if (l.agentId === agentIds[1]) l.singer = a2;
                }
                return true;
            }
        }

        return false;
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        this._memCache.clear();
        this._inFlight.clear();
    }
}
