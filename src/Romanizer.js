// Pure-JS Romanization engine for Korean (Hangul), Japanese (Kana), Cyrillic, and Greek.
// Zero external dependencies and zero GI imports so it runs in GNOME Shell ESM and Node.js.

// ============================================================================
// 1. Korean (Hangul) — Phonological Revised Romanization (from spicy-lyrics)
// ============================================================================

const CHO = {
    'ᄀ': 'g', 'ᄁ': 'kk', 'ᄂ': 'n', 'ᄃ': 'd', 'ᄄ': 'tt', 'ᄅ': 'r', 'ᄆ': 'm',
    'ᄇ': 'b', 'ᄈ': 'pp', 'ᄉ': 's', 'ᄊ': 'ss', 'ᄋ': '', 'ᄌ': 'j', 'ᄍ': 'jj',
    'ᄎ': 'ch', 'ᄏ': 'k', 'ᄐ': 't', 'ᄑ': 'p', 'ᄒ': 'h',
};

const JUNG = {
    'ᅡ': 'a', 'ᅢ': 'ae', 'ᅣ': 'ya', 'ᅤ': 'yae', 'ᅥ': 'eo', 'ᅦ': 'e', 'ᅧ': 'yeo',
    'ᅨ': 'ye', 'ᅩ': 'o', 'ᅪ': 'wa', 'ᅫ': 'wae', 'ᅬ': 'oe', 'ᅭ': 'yo', 'ᅮ': 'u',
    'ᅯ': 'wo', 'ᅰ': 'we', 'ᅱ': 'wi', 'ᅲ': 'yu', 'ᅳ': 'eu', 'ᅴ': 'ui', 'ᅵ': 'i',
};

const JONG = {
    'ᆨ': 'k', 'ᆨᄋ': 'g', 'ᆨᄂ': 'ngn', 'ᆨᄅ': 'ngn', 'ᆨᄆ': 'ngm', 'ᆨᄒ': 'kh',
    'ᆩ': 'kk', 'ᆩᄋ': 'kg', 'ᆩᄂ': 'ngn', 'ᆩᄅ': 'ngn', 'ᆩᄆ': 'ngm', 'ᆩᄒ': 'kh',
    'ᆪ': 'k', 'ᆪᄋ': 'ks', 'ᆪᄂ': 'ngn', 'ᆪᄅ': 'ngn', 'ᆪᄆ': 'ngm', 'ᆪᄒ': 'kch',
    'ᆫ': 'n', 'ᆫᄅ': 'll',
    'ᆬ': 'n', 'ᆬᄋ': 'nj', 'ᆬᄂ': 'nn', 'ᆬᄅ': 'nn', 'ᆬᄆ': 'nm', 'ᆬᄒ': 'nch',
    'ᆭ': 'n', 'ᆭᄋ': 'n', 'ᆭᄅ': 'nn', 'ᆭᄀ': 'nk', 'ᆭᄃ': 'nt', 'ᆭᄌ': 'nch',
    'ᆮ': 't', 'ᆮᄋ': 'd', 'ᆮᄂ': 'nn', 'ᆮᄅ': 'nn', 'ᆮᄆ': 'nm', 'ᆮᄒ': 'th',
    'ᆯ': 'l', 'ᆯᄋ': 'r', 'ᆯᄂ': 'll',
    'ᆰ': 'k', 'ᆰᄋ': 'lg', 'ᆰᄂ': 'ngn', 'ᆰᄅ': 'ngn', 'ᆰᄆ': 'ngm', 'ᆰᄒ': 'lkh',
    'ᆱ': 'm', 'ᆱᄋ': 'lm', 'ᆱᄂ': 'mn', 'ᆱᄅ': 'mn', 'ᆱᄆ': 'mm', 'ᆱᄒ': 'lmh',
    'ᆲ': 'p', 'ᆲᄋ': 'lb', 'ᆲᄂ': 'mn', 'ᆲᄅ': 'mn', 'ᆲᄆ': 'mm', 'ᆲᄒ': 'lph',
    'ᆳ': 't', 'ᆳᄋ': 'ls', 'ᆳᄂ': 'nn', 'ᆳᄅ': 'nn', 'ᆳᄆ': 'nm', 'ᆳᄒ': 'lsh',
    'ᆴ': 't', 'ᆴᄋ': 'lt', 'ᆴᄂ': 'nn', 'ᆴᄅ': 'nn', 'ᆴᄆ': 'nm', 'ᆴᄒ': 'lth',
    'ᆵ': 'p', 'ᆵᄋ': 'lp', 'ᆵᄂ': 'mn', 'ᆵᄅ': 'mn', 'ᆵᄆ': 'mm', 'ᆵᄒ': 'lph',
    'ᆶ': 'l', 'ᆶᄋ': 'r', 'ᆶᄂ': 'll', 'ᆶᄅ': 'll', 'ᆶᄆ': 'lm', 'ᆶᄒ': 'lh', 'ᆶᄀ': 'lk', 'ᆶᄃ': 'lt', 'ᆶᄌ': 'lch',
    'ᆷ': 'm', 'ᆷᄅ': 'mn',
    'ᆸ': 'p', 'ᆸᄋ': 'b', 'ᆸᄂ': 'mn', 'ᆸᄅ': 'mn', 'ᆸᄆ': 'mm', 'ᆸᄒ': 'ph',
    'ᆹ': 'p', 'ᆹᄋ': 'ps', 'ᆹᄂ': 'mn', 'ᆹᄅ': 'mn', 'ᆹᄆ': 'mm', 'ᆹᄒ': 'psh',
    'ᆺ': 't', 'ᆺᄋ': 's', 'ᆺᄂ': 'nn', 'ᆺᄅ': 'nn', 'ᆺᄆ': 'nm', 'ᆺᄒ': 'sh',
    'ᆻ': 't', 'ᆻᄋ': 'ss', 'ᆻᄂ': 'nn', 'ᆻᄅ': 'nn', 'ᆻᄆ': 'nm', 'ᆻᄒ': 'th',
    'ᆼ': 'ng',
    'ᆽ': 't', 'ᆽᄋ': 'j', 'ᆽᄂ': 'nn', 'ᆽᄅ': 'nn', 'ᆽᄆ': 'nm', 'ᆽᄒ': 'ch',
    'ᆾ': 't', 'ᆾᄋ': 'ch', 'ᆾᄂ': 'nn', 'ᆾᄅ': 'nn', 'ᆾᄆ': 'nm', 'ᆾᄒ': 'ch',
    'ᆿ': 'k', 'ᆿᄋ': 'k', 'ᆿᄂ': 'ngn', 'ᆿᄅ': 'ngn', 'ᆿᄆ': 'ngm', 'ᆿᄒ': 'kh',
    'ᇀ': 't', 'ᇀᄋ': 't', 'ᇀᄂ': 'nn', 'ᇀᄅ': 'nn', 'ᇀᄆ': 'nm', 'ᇀᄒ': 'th',
    'ᇁ': 'p', 'ᇁᄋ': 'p', 'ᇁᄂ': 'mn', 'ᇁᄅ': 'mn', 'ᇁᄆ': 'mm', 'ᇁᄒ': 'ph',
    'ᇂ': 't', 'ᇂᄋ': '', 'ᇂᄀ': 'k', 'ᇂᄃ': 't', 'ᇂᄌ': 'ch', 'ᇂᄂ': 'nn', 'ᇂᄅ': 'nn', 'ᇂᄆ': 'mm', 'ᇂᄒ': 't',
    '\u11AE\u110B\u1175': 'j',
    '\u11C0\u110B\u1175': 'ch',
    '\u11AE\u1112\u1175': 'ch',
    '\u11AE\u1112\u1167': 'ch',
    '\u11B4\u110B\u1175': 'lch',
};

const segmentHangul = (c) => {
    const idx = (c.codePointAt(0) ?? 0) - 0xac00;
    if (c.length !== 1 || idx < 0 || idx > 11171) return c;
    const cho = String.fromCharCode(Math.floor(idx / 588) + 0x1100);
    const jung = String.fromCharCode(Math.floor((idx % 588) / 28) + 0x1161);
    const jong = idx % 28 !== 0 ? String.fromCharCode((idx % 28) + 0x11a7) : '';
    return cho + jung + jong;
};

const HANGUL_ONSET_RE = /(ch|ss|kk|tt|pp|jj|[a-z])$/;

export function koreanCharReadings(text) {
    const chars = [...text];
    const blocks = chars.map(segmentHangul);
    let carried;
    return blocks.map((block, index) => {
        if (block.length < 2) {
            carried = undefined;
            return block;
        }
        const next = blocks[index + 1] ?? '';
        let piece = carried ?? CHO[block[0]] ?? block[0];
        carried = undefined;
        piece += JUNG[block[1]] ?? block[1];
        if (block.length === 3) {
            const last = block[2];
            const nextIsBlock = next.length >= 2;
            const joined = nextIsBlock
                ? (JONG[last + next[0] + next[1]] ?? JONG[last + next[0]])
                : undefined;
            if (joined !== undefined) {
                carried = joined.match(HANGUL_ONSET_RE)?.[0] ?? '';
                piece += joined.slice(0, joined.length - carried.length);
            } else {
                piece += JONG[last] ?? last;
            }
        }
        return piece;
    });
}

export function romanizeKorean(text) {
    return koreanCharReadings(text).join('');
}

// ============================================================================
// 2. Japanese (Hiragana / Katakana) — Pure-JS Hepburn Converter
// ============================================================================

const KANA_DIGRAPHS = {
    'キャ': 'kya', 'キュ': 'kyu', 'キョ': 'kyo',
    'シャ': 'sha', 'シュ': 'shu', 'ショ': 'sho',
    'チャ': 'cha', 'チュ': 'chu', 'チョ': 'cho',
    'ニャ': 'nya', 'ニュ': 'nyu', 'ニョ': 'nyo',
    'ヒャ': 'hya', 'ヒュ': 'hyu', 'ヒョ': 'hyo',
    'ミャ': 'mya', 'ミュ': 'myu', 'ミョ': 'myo',
    'リャ': 'rya', 'リュ': 'ryu', 'リョ': 'ryo',
    'ギャ': 'gya', 'ギュ': 'gyu', 'ギョ': 'gyo',
    'ジャ': 'ja', 'ジュ': 'ju', 'ジョ': 'jo',
    'ヂャ': 'ja', 'ヂュ': 'ju', 'ヂョ': 'jo',
    'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
    'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',
    'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo', 'フュ': 'fyu',
    'ティ': 'ti', 'ディ': 'di', 'トゥ': 'tu', 'ドゥ': 'du',
    'テュ': 'tyu', 'デュ': 'dyu',
    'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo',
    'ヴァ': 'va', 'ヴィ': 'vi', 'ヴ': 'vu', 'ヴェ': 've', 'ヴォ': 'vo',
    'シェ': 'she', 'ジェ': 'je', 'チェ': 'che', 'ツァ': 'tsa', 'ツィ': 'tsi', 'ツェ': 'tse', 'ツォ': 'tso',
};

const KANA_SINGLES = {
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
    'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
    'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
    'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
    'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
    'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
    'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
    'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
    'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
    'ワ': 'wa', 'ヰ': 'wi', 'ヱ': 'we', 'ヲ': 'o', 'ン': 'n',
    'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
    'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
    'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
    'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
    'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
    'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o',
    'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ヮ': 'wa',
    'ヴ': 'vu',
    '、': ', ', '。': '.', '「': '"', '」': '"', '『': '"', '』': '"',
    '（': '(', '）': ')', '・': ' ', '〜': '~', '！': '!', '？': '?',
};

function widenHalfwidthKatakana(text) {
    return text.replace(/[\uFF61-\uFF9F]/g, (c) => {
        const wide = c.normalize('NFKC');
        return wide.length === 1 ? wide : c;
    });
}

function toKatakanaChar(c) {
    const code = c.codePointAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
        return String.fromCodePoint(code + 0x60);
    }
    return c;
}

function peekNextKanaRomaji(chars, startIdx) {
    for (let j = startIdx; j < chars.length; j++) {
        const ch = chars[j];
        if (/\s/.test(ch)) continue;
        const k1 = toKatakanaChar(ch);
        if (j + 1 < chars.length) {
            const k2 = k1 + toKatakanaChar(chars[j + 1]);
            if (KANA_DIGRAPHS[k2]) return KANA_DIGRAPHS[k2];
        }
        if (KANA_SINGLES[k1]) return KANA_SINGLES[k1];
        return ch;
    }
    return '';
}

export function kanaCharReadings(text) {
    const widened = widenHalfwidthKatakana(text);
    const chars = [...widened];
    const readings = new Array(chars.length).fill('');
    let lastVowel = '';

    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const k1 = toKatakanaChar(ch);

        if (k1 === 'ッ') {
            const nextRom = peekNextKanaRomaji(chars, i + 1);
            if (nextRom) {
                if (nextRom.startsWith('ch')) {
                    readings[i] = 't';
                } else if (/^[a-z]/i.test(nextRom) && !/^[aeioun]/i.test(nextRom)) {
                    readings[i] = nextRom[0];
                }
            }
            continue;
        }

        if (k1 === 'ー' || k1 === 'ｰ') {
            readings[i] = lastVowel;
            continue;
        }

        if (i + 1 < chars.length) {
            const k2 = k1 + toKatakanaChar(chars[i + 1]);
            if (KANA_DIGRAPHS[k2]) {
                const rom = KANA_DIGRAPHS[k2];
                readings[i] = rom;
                readings[i + 1] = '';
                const v = rom.match(/[aeiou](?=[^a-z]*$)/i)?.[0];
                if (v) lastVowel = v.toLowerCase();
                i++;
                continue;
            }
        }

        if (KANA_SINGLES[k1] !== undefined) {
            const rom = KANA_SINGLES[k1];
            readings[i] = rom;
            const v = rom.match(/[aeiou](?=[^a-z]*$)/i)?.[0];
            if (v) lastVowel = v.toLowerCase();
            else if (k1 === 'ン') lastVowel = '';
            continue;
        }

        readings[i] = ch;
        if (!/\s/.test(ch)) lastVowel = '';
    }

    return readings;
}

export function romanizeKana(text) {
    return kanaCharReadings(text).join('');
}

// ============================================================================
// 3. Cyrillic (Russian, Ukrainian & General)
// ============================================================================

const UKRAINIAN_TEST_RE = /[ЄєІіЇїҐґ]/;

const CYRILLIC_BASE = {
    'А': 'A', 'а': 'a', 'Б': 'B', 'б': 'b', 'В': 'V', 'в': 'v',
    'Г': 'G', 'г': 'g', 'Д': 'D', 'д': 'd', 'Е': 'E', 'е': 'e',
    'Ё': 'Yo', 'ё': 'yo', 'Ж': 'Zh', 'ж': 'zh', 'З': 'Z', 'з': 'z',
    'И': 'I', 'и': 'i', 'Й': 'Y', 'й': 'y', 'К': 'K', 'к': 'k',
    'Л': 'L', 'л': 'l', 'М': 'M', 'м': 'm', 'Н': 'N', 'н': 'n',
    'О': 'O', 'о': 'o', 'П': 'P', 'п': 'p', 'Р': 'R', 'р': 'r',
    'С': 'S', 'с': 's', 'Т': 'T', 'т': 't', 'У': 'U', 'у': 'u',
    'Ф': 'F', 'ф': 'f', 'Х': 'Kh', 'х': 'kh', 'Ц': 'Ts', 'ц': 'ts',
    'Ч': 'Ch', 'ч': 'ch', 'Ш': 'Sh', 'ш': 'sh', 'Щ': 'Shch', 'щ': 'shch',
    'Ъ': '', 'ъ': '', 'Ы': 'Y', 'ы': 'y', 'Ь': '', 'ь': '',
    'Э': 'E', 'э': 'e', 'Ю': 'Yu', 'ю': 'yu', 'Я': 'Ya', 'я': 'ya',
    'Є': 'Ye', 'є': 'ye', 'І': 'I', 'і': 'i', 'Ї': 'Yi', 'ї': 'yi',
    'Ґ': 'G', 'ґ': 'g', 'Ў': 'U', 'ў': 'u', 'Ђ': 'Dj', 'ђ': 'dj',
    'Ј': 'J', 'ј': 'j', 'Љ': 'Lj', 'љ': 'lj', 'Њ': 'Nj', 'њ': 'nj',
    'Ћ': 'C', 'ћ': 'c', 'Џ': 'Dz', 'џ': 'dz',
};

const CYRILLIC_UKRAINIAN_OVERRIDES = {
    'Г': 'H', 'г': 'h',
    'И': 'Y', 'и': 'y',
    'Й': 'Y', 'й': 'y',
};

export function cyrillicCharReadings(text, isUkrainian = false) {
    const chars = [...text];
    return chars.map((ch) => {
        if (isUkrainian && CYRILLIC_UKRAINIAN_OVERRIDES[ch] !== undefined) {
            return CYRILLIC_UKRAINIAN_OVERRIDES[ch];
        }
        return CYRILLIC_BASE[ch] !== undefined ? CYRILLIC_BASE[ch] : ch;
    });
}

export function romanizeCyrillic(text, isUkrainian = false) {
    return cyrillicCharReadings(text, isUkrainian).join('');
}

// ============================================================================
// 4. Greek (Modern Greek with Digraphs)
// ============================================================================

const GREEK_DIGRAPHS = {
    'ου': 'ou', 'ού': 'ou', 'Ου': 'Ou', 'Ού': 'Ou', 'ΟΥ': 'OU',
    'αι': 'ai', 'αί': 'ai', 'Αι': 'Ai', 'Αί': 'Ai', 'ΑΙ': 'AI',
    'ει': 'ei', 'εί': 'ei', 'Ει': 'Ei', 'Εί': 'Ei', 'ΕΙ': 'EI',
    'οι': 'oi', 'οί': 'oi', 'Οι': 'Oi', 'Οί': 'Oi', 'ΟΙ': 'OI',
    'υι': 'yi', 'υί': 'yi', 'Υι': 'Yi', 'Υί': 'Yi',
    'αυ': 'av', 'αύ': 'av', 'Αυ': 'Av', 'Αύ': 'Av',
    'ευ': 'ev', 'εύ': 'ev', 'Ευ': 'Ev', 'Εύ': 'Ev',
    'ηυ': 'iv', 'ηύ': 'iv',
    'μπ': 'b', 'Μπ': 'B', 'ΜΠ': 'B',
    'ντ': 'd', 'Ντ': 'D', 'ΝΤ': 'D',
    'γκ': 'g', 'Γκ': 'G', 'ΓΚ': 'G',
    'γγ': 'ng', 'Γγ': 'Ng', 'ΓΓ': 'NG',
    'τσ': 'ts', 'Τσ': 'Ts', 'ΤΣ': 'TS',
    'τζ': 'tz', 'Τζ': 'Tz', 'ΤΖ': 'TZ',
};

const GREEK_SINGLES = {
    'α': 'a', 'ά': 'a', 'Α': 'A', 'Ά': 'A',
    'β': 'v', 'Β': 'V',
    'γ': 'g', 'Γ': 'G',
    'δ': 'd', 'Δ': 'D',
    'ε': 'e', 'έ': 'e', 'Ε': 'E', 'Έ': 'E',
    'ζ': 'z', 'Ζ': 'Z',
    'η': 'i', 'ή': 'i', 'Η': 'I', 'Ή': 'I',
    'θ': 'th', 'Θ': 'Th',
    'ι': 'i', 'ί': 'i', 'ϊ': 'i', 'ΐ': 'i', 'Ι': 'I', 'Ί': 'I', 'Ϊ': 'I',
    'κ': 'k', 'Κ': 'K',
    'λ': 'l', 'Λ': 'L',
    'μ': 'm', 'Μ': 'M',
    'ν': 'n', 'Ν': 'N',
    'ξ': 'x', 'Ξ': 'X',
    'ο': 'o', 'ό': 'o', 'Ο': 'O', 'Ό': 'O',
    'π': 'p', 'Π': 'P',
    'ρ': 'r', 'Ρ': 'R',
    'σ': 's', 'ς': 's', 'Σ': 'S',
    'τ': 't', 'Τ': 'T',
    'υ': 'y', 'ύ': 'y', 'ϋ': 'y', 'ΰ': 'y', 'Υ': 'Y', 'Ύ': 'Y', 'Ϋ': 'Y',
    'φ': 'f', 'Φ': 'F',
    'χ': 'ch', 'Χ': 'Ch',
    'ψ': 'ps', 'Ψ': 'Ps',
    'ω': 'o', 'ώ': 'o', 'Ω': 'O', 'Ώ': 'O',
};

export function greekCharReadings(text) {
    const chars = [...text];
    const readings = new Array(chars.length).fill('');
    for (let i = 0; i < chars.length; i++) {
        if (i + 1 < chars.length) {
            const pair = chars[i] + chars[i + 1];
            if (GREEK_DIGRAPHS[pair] !== undefined) {
                readings[i] = GREEK_DIGRAPHS[pair];
                readings[i + 1] = '';
                i++;
                continue;
            }
        }
        const ch = chars[i];
        readings[i] = GREEK_SINGLES[ch] !== undefined ? GREEK_SINGLES[ch] : ch;
    }
    return readings;
}

export function romanizeGreek(text) {
    return greekCharReadings(text).join('');
}

// ============================================================================
// 5. Unified Line / Word / Singer Romanization Helpers
// ============================================================================

const ROMANIZABLE_RE = /[\u3040-\u30FF\uFF61-\uFF9F\uAC00-\uD7AF\u0400-\u04FF\u0370-\u03FF\u1F00-\u1FFF]/;
const HAS_HANGUL_RE = /[\uAC00-\uD7AF]/;
const HAS_KANA_RE = /[\u3040-\u30FF\uFF61-\uFF9F]/;
const HAS_CYRILLIC_RE = /[\u0400-\u04FF]/;
const HAS_GREEK_RE = /[\u0370-\u03FF\u1F00-\u1FFF]/;

export function hasNonLatinRomanizable(text) {
    return Boolean(text && ROMANIZABLE_RE.test(text));
}

function computeCombinedReadings(text, { isUkrainian = false } = {}) {
    const widened = HAS_KANA_RE.test(text) ? widenHalfwidthKatakana(text) : text;
    const chars = [...widened];
    let readings = [...chars];

    if (HAS_HANGUL_RE.test(widened)) {
        const ko = koreanCharReadings(widened);
        for (let i = 0; i < chars.length; i++) {
            if (HAS_HANGUL_RE.test(chars[i])) readings[i] = ko[i];
        }
    }
    if (HAS_KANA_RE.test(widened)) {
        const ja = kanaCharReadings(widened);
        for (let i = 0; i < chars.length; i++) {
            if (HAS_KANA_RE.test(chars[i]) || chars[i] === 'ー') {
                readings[i] = ja[i];
            }
        }
    }
    if (HAS_CYRILLIC_RE.test(widened)) {
        const cy = cyrillicCharReadings(widened, isUkrainian);
        for (let i = 0; i < chars.length; i++) {
            if (HAS_CYRILLIC_RE.test(chars[i])) readings[i] = cy[i];
        }
    }
    if (HAS_GREEK_RE.test(widened)) {
        const gr = greekCharReadings(widened);
        for (let i = 0; i < chars.length; i++) {
            if (HAS_GREEK_RE.test(chars[i])) readings[i] = gr[i];
        }
    }

    return { chars, readings };
}

export function romanizeText(text, options = {}) {
    if (!text || !hasNonLatinRomanizable(text)) return text || '';
    const { readings } = computeCombinedReadings(text, options);
    return readings.join('').replace(/[ \t]{2,}/g, ' ').trim();
}

export function romanizeSingerName(name) {
    if (!name) return name;
    if (!hasNonLatinRomanizable(name)) return name;
    const rom = romanizeText(name);
    if (!rom) return name;
    return rom
        .split(/\s+/)
        .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ');
}

export function romanizeLine(line, options = {}) {
    if (!line || !line.text) return line;

    // Preserve pre-existing TTML transliterations if already populated
    if (line.romanizedText && line.romanizedText.trim()) {
        return line;
    }

    if (!hasNonLatinRomanizable(line.text)) {
        return line;
    }

    if (Array.isArray(line.words) && line.words.length > 0) {
        // Reconstruct full text with word boundaries so cross-word liaison (e.g. 먹|는, っ|て) works!
        let combined = '';
        const wordSpans = [];
        for (let i = 0; i < line.words.length; i++) {
            const w = line.words[i];
            const wText = HAS_KANA_RE.test(w.text || '')
                ? widenHalfwidthKatakana(w.text || '')
                : (w.text || '');
            const start = [...combined].length;
            combined += wText;
            const end = [...combined].length;
            wordSpans.push({ word: w, start, end });
            if (w.hasSpace && i < line.words.length - 1) {
                combined += ' ';
            }
        }

        const { readings } = computeCombinedReadings(combined, options);
        const romanizedWords = [];
        for (const span of wordSpans) {
            const romWord = readings.slice(span.start, span.end).join('').trim();
            romanizedWords.push({
                time: span.word.time,
                duration: span.word.duration,
                text: romWord || span.word.text,
                hasSpace: Boolean(span.word.hasSpace),
            });
        }

        const romanizedText = romanizedWords
            .map((w, idx) => w.text + (w.hasSpace && idx < romanizedWords.length - 1 ? ' ' : ''))
            .join('')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        if (romanizedText && romanizedText !== line.text) {
            line.romanizedText = romanizedText;
            line.romanizedWords = romanizedWords;
        }
        return line;
    }

    const rom = romanizeText(line.text, options);
    if (rom && rom !== line.text) {
        line.romanizedText = rom;
    }
    return line;
}

export function romanizeLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return lines;
    const sample = lines.slice(0, 20).map((l) => l.text || '').join(' ');
    const isUkrainian = UKRAINIAN_TEST_RE.test(sample);
    for (const line of lines) {
        romanizeLine(line, { isUkrainian });
    }
    return lines;
}
