/**
 * Utilitas untuk pemrosesan, pencocokan, dan pengurutan daftar nama & nilai siswa
 * berdasarkan urutan absen lama.
 */

export interface OldStudentEntry {
  id: string;
  absenNo: number;
  rawLine: string;
  name: string;
  normalizedName: string;
  isDuplicateInOld: boolean;
}

export interface NewScoreEntry {
  id: string;
  lineNumber: number;
  rawLine: string;
  name: string;
  normalizedName: string;
  score: string; // Nilai utama / nilai tunggal atau rata-rata komponen
  scores: Record<string, string>; // Map komponen nilai per kolom, mis. { "Tugas 1": "85", "UTS": "90" }
  scoreColumns: string[]; // Daftar nama kolom nilai
  extraColumns: string[];
  isDuplicateInNew: boolean;
}

export interface FuzzySuggestion {
  newEntry: NewScoreEntry;
  similarity: number; // 0 - 100
  reason: string;
}

export type MatchStatus =
  | 'EXACT_MATCH'        // Cocok persis (100% setelah normalisasi spasi/huruf besar-kecil)
  | 'CONFIRMED_MANUAL'   // Dipasangkan melalui konfirmasi kemiripan / manual oleh guru
  | 'FUZZY_PENDING'      // Ada kandidat nama mirip di data baru, menunggu konfirmasi guru
  | 'DUPLICATE_CONFLICT' // Nama memiliki duplikat di data baru atau daftar lama, butuh konfirmasi
  | 'MISSING_SCORE';     // Belum ada nilai / tidak ditemukan di data terbaru

export interface FormatIssue {
  type: 'SWAPPED_COLUMNS' | 'INPUTS_SWAPPED' | 'ALL_NUMBERS_IN_OLD' | 'NO_SCORES_IN_NEW' | 'MALFORMED_DELIMITER';
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  message: string;
  quickFixLabel?: string;
  quickFixAction?: 'SWAP_COLUMNS' | 'SWAP_INPUTS' | 'FIX_DELIMITER';
}

export interface InputFormatDiagnosis {
  hasIssues: boolean;
  issues: FormatIssue[];
  isNewDataSwapped: boolean; // Kolom 1 = Nilai, Kolom 2 = Nama
  isOldAndNewSwapped: boolean; // Input Lama berisi nilai, Input Baru murni daftar nama
  sampleSwappedRow?: { original: string; preview: string };
}

export interface SortedResultRow {
  oldEntry: OldStudentEntry;
  status: MatchStatus;
  matchedNewEntry: NewScoreEntry | null;
  candidateEntries: FuzzySuggestion[];
  duplicateNewEntries: NewScoreEntry[];
  manualScoreOverride?: string;
  manualScoresOverride?: Record<string, string>;
}

export interface ReconciliationSummary {
  rows: SortedResultRow[];
  unmatchedNewEntries: NewScoreEntry[];
  duplicateOldNames: string[];
  duplicateNewNames: string[];
  stats: {
    totalOld: number;
    totalNew: number;
    matchedCount: number;
    pendingFuzzyCount: number;
    missingScoreCount: number;
    duplicateConflictCount: number;
    unmatchedNewCount: number;
  };
}

/**
 * Normalisasi dasar nama: huruf kecil, rapikan spasi berlebih, hapus tanda baca non-esensial di tepi.
 */
export function normalizeBasic(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"`’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalisasi fonetik ejaan nama Indonesia (untuk deteksi kemiripan nama):
 * Menangani variasi umum seperti Muhamad/Muhammad, Moch/Moh, Sy/Sh, Dj/J, Tj/C, Oe/U, Y/I, F/V, Z/S.
 */
export function normalizeIndonesianPhonetic(name: string): string {
  let s = normalizeBasic(name);
  // Standarisasi singkatan nama depan yang sering disingkat guru/siswa
  s = s
    .replace(/\b(m\.?|muh\.?|moh\.?|moch\.?|ach\.?)\b/g, (match) => {
      const clean = match.replace('.', '');
      if (clean === 'ach') return 'achmad';
      return 'muhammad';
    })
    .replace(/\b(muhamad|mohamad|mohammad|mochamad|mochammad|muchammad|muchamad)\b/g, 'muhammad')
    .replace(/\b(achmad|ahmad|akhmad)\b/g, 'ahmad')
    .replace(/\b(rizki|rizky|riski|risky|rezki|rezky)\b/g, 'rizki')
    .replace(/\b(febri|pebri|febry)\b/g, 'febri')
    .replace(/\b(putera|putra)\b/g, 'putra')
    .replace(/\b(puteri|putri)\b/g, 'putri')
    .replace(/\b(aisyah|aisah|aishah)\b/g, 'aisyah')
    .replace(/\b(khairul|khoirul|chairul|choirul)\b/g, 'khairul')
    .replace(/\b(annisa|anisa|anissa)\b/g, 'anisa')
    .replace(/\b(ramadhan|ramadan|romadhon|romadon)\b/g, 'ramadhan');

  // Penyederhanaan huruf ganda (misal: luthfi -> lutfi, fadillah -> fadilah)
  s = s
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/sh/g, 's')
    .replace(/sy/g, 's')
    .replace(/kh/g, 'k')
    .replace(/ch/g, 'k')
    .replace(/([a-z])\1+/g, '$1');

  return s.trim();
}

/**
 * Menghitung jarak Levenshtein antara dua string
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // Hapus
        dp[i][j - 1] + 1,      // Sisip
        dp[i - 1][j - 1] + cost // Ganti
      );
    }
  }
  return dp[m][n];
}

/**
 * Menghitung tingkat kemiripan dua nama siswa (0 - 100) beserta alasannya.
 */
export function calculateNameSimilarity(oldName: string, newName: string): { score: number; reason: string } {
  const normOld = normalizeBasic(oldName);
  const normNew = normalizeBasic(newName);

  if (!normOld || !normNew) return { score: 0, reason: '' };
  if (normOld === normNew) return { score: 100, reason: 'Nama cocok persis' };

  const phonOld = normalizeIndonesianPhonetic(oldName);
  const phonNew = normalizeIndonesianPhonetic(newName);

  if (phonOld === phonNew && phonOld.length > 2) {
    return { score: 94, reason: 'Variasi ejaan nama yang sama' };
  }

  // Periksa kecocokan kata / token (misal nama disingkat atau nama tengah terlewat)
  const tokensOld = normOld.split(' ').filter(Boolean);
  const tokensNew = normNew.split(' ').filter(Boolean);

  // Cek apakah salah satu adalah subset kata dari yang lain (mis. "Siti Nurhaliza" vs "Siti Nurhaliza Putri")
  const allOldInNew = tokensOld.length >= 1 && tokensOld.every((t) =>
    tokensNew.some((nt) => nt === t || (t.replace('.', '').length === 1 && nt.startsWith(t.replace('.', ''))))
  );
  const allNewInOld = tokensNew.length >= 1 && tokensNew.every((t) =>
    tokensOld.some((ot) => ot === t || (t.replace('.', '').length === 1 && ot.startsWith(t.replace('.', ''))))
  );

  if (allOldInNew || allNewInOld) {
    const minTokens = Math.min(tokensOld.length, tokensNew.length);
    const maxTokens = Math.max(tokensOld.length, tokensNew.length);
    if (minTokens >= 2) {
      return { score: 89, reason: 'Sebagian nama lengkap / singkatan cocok' };
    }
    if (minTokens === 1 && maxTokens <= 3 && Math.min(normOld.length, normNew.length) >= 4) {
      return { score: 78, reason: 'Nama panggilan / nama depan cocok' };
    }
  }

  // Hitung skor berbasis Levenshtein pada normalisasi dasar dan fonetik
  const maxLenBasic = Math.max(normOld.length, normNew.length);
  const distBasic = levenshteinDistance(normOld, normNew);
  const ratioBasic = Math.round(((maxLenBasic - distBasic) / maxLenBasic) * 100);

  const maxLenPhon = Math.max(phonOld.length, phonNew.length);
  const distPhon = levenshteinDistance(phonOld, phonNew);
  const ratioPhon = Math.round(((maxLenPhon - distPhon) / maxLenPhon) * 100);

  // Hitung irisan kata
  let matchedWords = 0;
  for (const tOld of tokensOld) {
    const cleanOld = tOld.replace(/\./g, '');
    for (const tNew of tokensNew) {
      const cleanNew = tNew.replace(/\./g, '');
      if (cleanOld === cleanNew && cleanOld.length > 1) {
        matchedWords++;
        break;
      } else if (
        cleanOld.length >= 4 &&
        cleanNew.length >= 4 &&
        levenshteinDistance(cleanOld, cleanNew) <= 1
      ) {
        matchedWords += 0.85;
        break;
      }
    }
  }
  const wordOverlapScore = Math.round((matchedWords / Math.max(tokensOld.length, tokensNew.length)) * 100);

  const bestScore = Math.max(ratioBasic, Math.min(95, ratioPhon), wordOverlapScore);

  let reason = 'Kemiripan ejaan nama';
  if (distBasic <= 2) {
    reason = `Perbedaan ${distBasic} huruf (kemungkinan salah ketik)`;
  } else if (ratioPhon >= 80) {
    reason = 'Kemiripan ejaan fonetik';
  } else if (wordOverlapScore >= 65) {
    reason = 'Memiliki kata penyusun nama yang sama';
  }

  return { score: bestScore, reason };
}

/**
 * Memisahkan nomor urut di awal baris jika pengguna menempelkan daftar bernomor dari Excel/Word.
 * Contoh: "1. Ahmad Fauzi" -> "Ahmad Fauzi", "02\tBudi Santoso" -> "Budi Santoso"
 */
function stripLeadingOrderNumber(line: string): string {
  const trimmed = line.trim();
  // Jika dipisahkan tab dan kolom pertama murni angka urut (1-200)
  const tabParts = trimmed.split('\t').map((s) => s.trim()).filter(Boolean);
  if (tabParts.length >= 2 && /^\d{1,3}[.)]?$/.test(tabParts[0]) && /[a-zA-Z]/.test(tabParts[1])) {
    return tabParts.slice(1).join(' ');
  }
  // Jika diawali angka + titik/kurung/spasi diikuti huruf (misal: "1. Siti Aminah" atau "1) Siti Aminah")
  const matchPrefix = trimmed.match(/^\d{1,3}\s*[.) -]\s*([a-zA-Z].*)$/);
  if (matchPrefix) {
    return matchPrefix[1].trim();
  }
  return trimmed;
}

/**
 * Mendeteksi baris judul (header) multi-kolom dari teks data nilai terbaru.
 * Mengembalikan array nama kolom nilai (misal ['Tugas 1', 'Tugas 2', 'UTS', 'UAS']) jika ditemukan.
 */
export function extractHeaderRowColumns(rawText: string): string[] | null {
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sep = trimmed.includes('\t')
      ? '\t'
      : trimmed.includes(';')
      ? ';'
      : trimmed.includes('|')
      ? '|'
      : null;

    if (!sep) {
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',').map((p) => p.trim());
        if (parts.length >= 2 && !parts.slice(1).some((p) => isLikelyScore(p))) {
          return parts.slice(1).map((p) => p || 'Nilai');
        }
      }
      return null;
    }

    const parts = trimmed.split(sep).map((p) => p.trim());
    if (parts.length < 2) return null;

    let startCol = 0;
    if (/^(no\.?|nomor|nr)$/i.test(parts[0])) {
      startCol = 1;
    }

    const nameCol = parts[startCol]?.toLowerCase() || '';
    const isNameCol = /^(nama|nama siswa|siswa|nama lengkap|peserta didik|student)$/i.test(nameCol);
    const scoreCols = parts.slice(startCol + 1).filter((c) => c !== '');

    if (scoreCols.length === 0) return null;

    const anyIsNumber = scoreCols.some((c) => isLikelyScore(c));
    if (!anyIsNumber && (isNameCol || scoreCols.length > 0)) {
      return scoreCols;
    }

    // Hanya evaluasi baris pertama yang berisi konten
    break;
  }
  return null;
}

/**
 * Memeriksa apakah sebuah baris merupakan baris judul (header) tabel seperti "No | Nama Siswa | Nilai"
 */
function isHeaderRow(line: string, isNewScoreData: boolean): boolean {
  const lower = line.toLowerCase().trim();
  const headerPatterns = [
    /^no\.?\s*[\t,;|-]\s*nama(\s+siswa|\s+lengkap)?(\s*[\t,;|-]\s*(nilai|skor|angka|hasil|tugas|uts|uas|uh\d?))?/i,
    /^nama(\s+siswa|\s+lengkap)?\s*[\t,;|-]\s*(nilai|skor|angka|hasil|grade|tugas|uts|uas|uh\d?)/i,
    /^(daftar\s+)?nama(\s+siswa|\s+lengkap)?$/i,
    /^absen\s*[\t,;|-]\s*nama/i,
  ];
  if (headerPatterns.some((p) => p.test(lower))) {
    return true;
  }
  if (!isNewScoreData && (lower === 'nama' || lower === 'nama siswa' || lower === 'nama lengkap')) {
    return true;
  }
  return false;
}

/**
 * Mengurai teks daftar nama lama (Acuan Absen) menjadi array terstruktur.
 */
export function parseOldStudentList(rawText: string): OldStudentEntry[] {
  const lines = rawText.split(/\r?\n/);
  const tempEntries: { rawLine: string; name: string; normalizedName: string }[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (idx === 0 && isHeaderRow(trimmed, false)) return;

    const cleanedName = stripLeadingOrderNumber(trimmed);
    if (!cleanedName) return;

    tempEntries.push({
      rawLine: line,
      name: cleanedName,
      normalizedName: normalizeBasic(cleanedName),
    });
  });

  // Hitung frekuensi untuk mendeteksi nama ganda di daftar lama
  const nameCounts = new Map<string, number>();
  for (const item of tempEntries) {
    if (item.normalizedName) {
      nameCounts.set(item.normalizedName, (nameCounts.get(item.normalizedName) || 0) + 1);
    }
  }

  return tempEntries.map((item, idx) => ({
    id: `old-${idx + 1}`,
    absenNo: idx + 1,
    rawLine: item.rawLine,
    name: item.name,
    normalizedName: item.normalizedName,
    isDuplicateInOld: (nameCounts.get(item.normalizedName) || 0) > 1,
  }));
}

/**
 * Mengurai satu baris data terbaru (Nama + Nilai-Nilai) dari berbagai format tempelan Excel, CSV, atau teks manual.
 */
function parseSingleNewLine(line: string): {
  name: string;
  score: string;
  extra: string[];
  rawScoreValues: string[];
} {
  const trimmed = line.trim();

  // 1. Jika mengandung Tab (Salin-Tempel langsung dari Excel / Google Sheets)
  if (trimmed.includes('\t')) {
    const cols = trimmed.split('\t').map((c) => c.trim());
    const nonEmpty = cols.filter((c) => c !== '');

    if (nonEmpty.length >= 3 && /^\d{1,3}[.)]?$/.test(nonEmpty[0]) && /[a-zA-Z]/.test(nonEmpty[1])) {
      // Format: [No AbsenAcak] [Nama Siswa] [Nilai 1] [Nilai 2] ...
      return {
        name: nonEmpty[1],
        score: nonEmpty[2] ?? '',
        extra: nonEmpty.slice(3),
        rawScoreValues: nonEmpty.slice(2),
      };
    }
    if (nonEmpty.length >= 2) {
      // Format: [Nama Siswa] [Nilai 1] [Nilai 2] ...
      return {
        name: nonEmpty[0],
        score: nonEmpty[1] ?? '',
        extra: nonEmpty.slice(2),
        rawScoreValues: nonEmpty.slice(1),
      };
    }
    return { name: nonEmpty[0] || trimmed, score: '', extra: [], rawScoreValues: [] };
  }

  // 2. Jika mengandung pemisah titik koma (;) atau pipa (|)
  if (trimmed.includes(';') || trimmed.includes('|')) {
    const sep = trimmed.includes(';') ? ';' : '|';
    const cols = trimmed.split(sep).map((c) => c.trim()).filter(Boolean);
    if (cols.length >= 3 && /^\d{1,3}[.)]?$/.test(cols[0]) && /[a-zA-Z]/.test(cols[1])) {
      return {
        name: cols[1],
        score: cols[2] ?? '',
        extra: cols.slice(3),
        rawScoreValues: cols.slice(2),
      };
    }
    if (cols.length >= 2) {
      return {
        name: cols[0],
        score: cols[1] ?? '',
        extra: cols.slice(2),
        rawScoreValues: cols.slice(1),
      };
    }
  }

  // 3. Jika dipisahkan koma (CSV), perhatikan desimal Indonesia vs multi-kolom
  if (trimmed.includes(',')) {
    const commaParts = trimmed.split(',').map((p) => p.trim());
    if (commaParts.length >= 2) {
      // Pola nama, nilai_desimal (misal: "Budi Santoso, 85,5")
      const commaMatch = trimmed.match(/^(.*?),\s*([+-]?\d+(?:[.,]\d+)?|[A-E][+-]?)\s*$/i);
      if (commaParts.length === 2 && commaMatch) {
        const cleanName = stripLeadingOrderNumber(commaMatch[1]);
        const sc = commaMatch[2].trim();
        return { name: cleanName, score: sc, extra: [], rawScoreValues: [sc] };
      }
      // Pola multi-kolom: "Budi, 80, 85, 90"
      if (commaParts.length > 2 && isLikelyScore(commaParts[1])) {
        return {
          name: stripLeadingOrderNumber(commaParts[0]),
          score: commaParts[1],
          extra: commaParts.slice(2),
          rawScoreValues: commaParts.slice(1),
        };
      }
    }
  }

  // 4. Jika dipisahkan tanda hubung / titik dua / spasi dengan nilai di akhir baris
  const trailingScoreMatch = trimmed.match(/^(.*?)(?:\s*[-:=]\s*|\s+)(\d{1,3}(?:[.,]\d{1,2})?|[A-E][+-]?)$/i);
  if (trailingScoreMatch && /[a-zA-Z]/.test(trailingScoreMatch[1])) {
    const cleanName = stripLeadingOrderNumber(trailingScoreMatch[1]);
    const sc = trailingScoreMatch[2].trim();
    return {
      name: cleanName,
      score: sc,
      extra: [],
      rawScoreValues: [sc],
    };
  }

  // 5. Jika hanya berisi nama tanpa nilai
  return {
    name: stripLeadingOrderNumber(trimmed),
    score: '',
    extra: [],
    rawScoreValues: [],
  };
}

/**
 * Mengurai teks data terbaru (Nama + Nilai-Nilai) menjadi array terstruktur
 * dengan dukungan otomatis multi-kolom nilai (Tugas, UTS, UAS, dll).
 */
export function parseNewScoreData(rawText: string): NewScoreEntry[] {
  const detectedHeaders = extractHeaderRowColumns(rawText);
  const lines = rawText.split(/\r?\n/);
  const parsedList: {
    lineNumber: number;
    rawLine: string;
    name: string;
    normalizedName: string;
    rawScoreValues: string[];
    extraColumns: string[];
  }[] = [];

  let skippedFirstHeader = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!skippedFirstHeader && (detectedHeaders !== null || isHeaderRow(trimmed, true))) {
      skippedFirstHeader = true;
      return;
    }

    const { name, rawScoreValues, extra } = parseSingleNewLine(trimmed);
    if (!name) return;

    parsedList.push({
      lineNumber: idx + 1,
      rawLine: line,
      name,
      normalizedName: normalizeBasic(name),
      rawScoreValues,
      extraColumns: extra,
    });
  });

  // Tentukan nama-nama kolom nilai
  let resolvedColumns: string[] = [];
  if (detectedHeaders && detectedHeaders.length > 0) {
    resolvedColumns = detectedHeaders;
  } else {
    const maxScoreCount = Math.max(1, ...parsedList.map((p) => p.rawScoreValues.length));
    if (maxScoreCount <= 1) {
      resolvedColumns = ['Nilai'];
    } else {
      resolvedColumns = Array.from({ length: maxScoreCount }, (_, i) => `Nilai ${i + 1}`);
    }
  }

  const nameCounts = new Map<string, number>();
  for (const item of parsedList) {
    if (item.normalizedName) {
      nameCounts.set(item.normalizedName, (nameCounts.get(item.normalizedName) || 0) + 1);
    }
  }

  return parsedList.map((item, idx) => {
    const scoresMap: Record<string, string> = {};
    const numericList: number[] = [];

    resolvedColumns.forEach((colName, colIdx) => {
      const val = item.rawScoreValues[colIdx] ?? '';
      scoresMap[colName] = val;
      const parsedNum = parseFloat(val.replace(',', '.'));
      if (!isNaN(parsedNum)) {
        numericList.push(parsedNum);
      }
    });

    let primaryScore = item.rawScoreValues[0] ?? '';
    if (resolvedColumns.length > 1 && numericList.length > 0) {
      const avg = numericList.reduce((a, b) => a + b, 0) / numericList.length;
      primaryScore = (Math.round(avg * 10) / 10).toString();
    }

    return {
      id: `new-${idx + 1}`,
      lineNumber: item.lineNumber,
      rawLine: item.rawLine,
      name: item.name,
      normalizedName: item.normalizedName,
      score: primaryScore,
      scores: scoresMap,
      scoreColumns: resolvedColumns,
      extraColumns: item.extraColumns,
      isDuplicateInNew: (nameCounts.get(item.normalizedName) || 0) > 1,
    };
  });
}

/**
 * Mengambil daftar nama kolom nilai yang terdeteksi dari daftar data terbaru.
 */
export function getDetectedScoreColumns(newList: NewScoreEntry[]): string[] {
  if (newList.length === 0) return ['Nilai'];
  return newList[0].scoreColumns && newList[0].scoreColumns.length > 0
    ? newList[0].scoreColumns
    : ['Nilai'];
}

/**
 * Mengambil nilai efektif suatu baris untuk kolom nilai tertentu (mempertimbangkan override manual).
 */
export function getEffectiveScoreForColumn(row: SortedResultRow, columnName: string): string {
  if (row.manualScoresOverride && row.manualScoresOverride[columnName] !== undefined) {
    return row.manualScoresOverride[columnName];
  }
  if (row.matchedNewEntry?.scores && row.matchedNewEntry.scores[columnName] !== undefined) {
    return row.matchedNewEntry.scores[columnName];
  }
  // Fallback ke manualScoreOverride tunggal jika kolom default 'Nilai'
  if (columnName === 'Nilai' || (row.matchedNewEntry?.scoreColumns.length === 1)) {
    if (row.manualScoreOverride !== undefined) {
      return row.manualScoreOverride;
    }
    return row.matchedNewEntry?.score || '';
  }
  return '';
}

/**
 * Menghitung ringkasan nilai komprehensif untuk satu baris siswa (rata-rata, kelengkapan, dll).
 */
export function calculateRowGradeSummary(
  row: SortedResultRow,
  columns: string[]
): {
  average: number | null;
  scores: Record<string, string>;
  isComplete: boolean;
  hasAnyScore: boolean;
  lowestScore: number | null;
  highestScore: number | null;
} {
  const scores: Record<string, string> = {};
  const nums: number[] = [];
  let isComplete = true;

  for (const col of columns) {
    const val = getEffectiveScoreForColumn(row, col).trim();
    scores[col] = val;
    if (val === '') {
      isComplete = false;
    } else {
      const parsed = parseFloat(val.replace(',', '.'));
      if (!isNaN(parsed)) {
        nums.push(parsed);
      }
    }
  }

  const average = nums.length > 0
    ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
    : null;

  const lowestScore = nums.length > 0 ? Math.min(...nums) : null;
  const highestScore = nums.length > 0 ? Math.max(...nums) : null;

  return {
    average,
    scores,
    isComplete,
    hasAnyScore: nums.length > 0,
    lowestScore,
    highestScore,
  };
}

/**
 * Memeriksa apakah suatu teks murni angka / format nilai (0-100, desimal, atau huruf mutu A-E).
 */
export function isLikelyScore(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Angka integer / desimal dengan koma atau titik (misal: 85, 92.5, 78,5, 100)
  if (/^-?\d{1,3}(?:[.,]\d{1,2})?$/.test(t)) {
    const val = parseFloat(t.replace(',', '.'));
    return !isNaN(val) && val >= 0 && val <= 1000;
  }
  // Huruf mutu A, B, C, D, E dengan +/- (misal A, B+, C-)
  if (/^[A-E][+-]?$/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Memeriksa apakah suatu teks murni nama orang (mengandung huruf, kata > 1 atau kata tunggal non-numerik).
 */
export function isLikelyStudentName(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Jika hampir semuanya angka, bukan nama
  if (/^\d+([.,]\d+)?$/.test(t)) return false;
  // Nama memiliki setidaknya 2 huruf abjad
  const letterCount = (t.match(/[a-zA-Z]/g) || []).length;
  return letterCount >= 2;
}

/**
 * Mendiagnosis format input daftar lama dan data baru secara komprehensif:
 * 1. Mendeteksi jika kolom nilai dan nama pada data baru terbalik (Kolom 1 Nilai, Kolom 2 Nama).
 * 2. Mendeteksi jika pengguna tertukar menempelkan kotak input (Kotak 1 ditempel data nilai, Kotak 2 ditempel daftar nama).
 * 3. Mendeteksi jika data terbaru sama sekali tidak memiliki nilai.
 * 4. Mendeteksi jika daftar nama lama berisi nilai/angka saja.
 */
export function diagnoseInputFormat(oldRawText: string, newRawText: string): InputFormatDiagnosis {
  const issues: FormatIssue[] = [];

  const oldLines = oldRawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const newLines = newRawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let isNewDataSwapped = false;
  let isOldAndNewSwapped = false;
  let sampleSwappedRow: { original: string; preview: string } | undefined;

  // 1. Periksa Data Terbaru: apakah kolom nilai dan nama tertukar posisinya?
  // Contoh kasus: "88\tBudi Santoso", "92,5; Siti Aminah", "85 - Ahmad Fauzi"
  if (newLines.length > 0) {
    let swappedCount = 0;
    let normalCount = 0;
    let sampleOriginal = '';
    let sampleFixed = '';

    for (const line of newLines) {
      if (isHeaderRow(line, true)) continue;

      let colA = '';
      let colB = '';

      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          colA = parts[0];
          colB = parts[1];
        }
      } else if (line.includes(';') || line.includes('|')) {
        const sep = line.includes(';') ? ';' : '|';
        const parts = line.split(sep).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          colA = parts[0];
          colB = parts[1];
        }
      } else if (line.includes(',')) {
        // Hati-hati desimal koma: "85,5, Budi" vs "Budi, 85,5"
        const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length === 2) {
          colA = parts[0];
          colB = parts[1];
        } else if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
          // Format desimal "85, 5, Budi"
          colA = `${parts[0]},${parts[1]}`;
          colB = parts[2];
        }
      } else {
        // Cek pola angka di awal: "88 Budi Santoso" atau "88 - Budi Santoso"
        const matchLeadingScore = line.match(/^(\d{1,3}(?:[.,]\d{1,2})?|[A-E][+-]?)\s*[-:=]?\s+([a-zA-Z].*)$/i);
        if (matchLeadingScore) {
          colA = matchLeadingScore[1];
          colB = matchLeadingScore[2];
        }
      }

      if (colA && colB) {
        const colAIsScore = isLikelyScore(colA);
        const colBIsName = isLikelyStudentName(colB);
        const colAIsName = isLikelyStudentName(colA);
        const colBIsScore = isLikelyScore(colB);

        if (colAIsScore && colBIsName) {
          swappedCount++;
          if (!sampleOriginal) {
            sampleOriginal = line;
            sampleFixed = `${colB}\t${colA}`;
          }
        } else if (colAIsName && colBIsScore) {
          normalCount++;
        }
      }
    }

    // Jika mayoritas baris (>60%) memiliki kolom 1 = Nilai dan kolom 2 = Nama
    if (swappedCount > 0 && swappedCount >= normalCount) {
      isNewDataSwapped = true;
      sampleSwappedRow = {
        original: sampleOriginal,
        preview: sampleFixed,
      };
      issues.push({
        type: 'SWAPPED_COLUMNS',
        severity: 'CRITICAL',
        title: 'Posisi Kolom Nilai dan Nama Terbalik pada Data Terbaru',
        message: `Terdeteksi ${swappedCount} baris di mana angka nilai berada di kolom pertama sedangkan nama siswa berada di kolom kedua (misal: "${sampleOriginal}").`,
        quickFixLabel: 'Tukar Otomatis Posisi Kolom (Jadikan Nama lalu Nilai)',
        quickFixAction: 'SWAP_COLUMNS',
      });
    }
  }

  // 2. Periksa apakah pengguna menempel terbalik antara Kotak Langkah 1 dan Kotak Langkah 2
  // Ciri: Kotak 1 memiliki banyak baris bernilai (nama + angka), sedangkan Kotak 2 hanya daftar nama tanpa nilai sama sekali
  if (oldLines.length > 0 && newLines.length > 0) {
    const oldParsedAsNew = parseNewScoreData(oldRawText);
    const newParsed = parseNewScoreData(newRawText);

    const oldHasScoresCount = oldParsedAsNew.filter((e) => e.score.trim() !== '').length;
    const newHasScoresCount = newParsed.filter((e) => e.score.trim() !== '').length;

    if (oldHasScoresCount >= Math.min(3, oldParsedAsNew.length) && oldHasScoresCount > oldParsedAsNew.length * 0.5 && newHasScoresCount === 0) {
      isOldAndNewSwapped = true;
      issues.push({
        type: 'INPUTS_SWAPPED',
        severity: 'CRITICAL',
        title: 'Data Tampak Tertukar Antara Kotak Langkah 1 dan Langkah 2',
        message: `Kotak Langkah 1 (Acuan Absen Lama) terdeteksi memiliki nilai siswa (${oldHasScoresCount} baris), sedangkan Kotak Langkah 2 (Data Terbaru) murni daftar nama tanpa nilai.`,
        quickFixLabel: 'Tukar Isi Kedua Kotak Input',
        quickFixAction: 'SWAP_INPUTS',
      });
    }
  }

  // 3. Peringatan jika data terbaru sama sekali tidak memiliki nilai padahal kolom tidak terbalik
  if (!isNewDataSwapped && !isOldAndNewSwapped && newLines.length > 0) {
    const newParsed = parseNewScoreData(newRawText);
    const withScores = newParsed.filter((e) => e.score.trim() !== '').length;
    if (withScores === 0 && newParsed.length >= 2) {
      issues.push({
        type: 'NO_SCORES_IN_NEW',
        severity: 'WARNING',
        title: 'Data Terbaru Belum Memiliki Kolom Nilai',
        message: 'Semua baris pada kotak Langkah 2 hanya terbaca sebagai nama siswa tanpa nilai. Pastikan Anda menempelkan 2 kolom (Nama dan Nilai) dari Excel.',
      });
    }
  }

  return {
    hasIssues: issues.length > 0,
    issues,
    isNewDataSwapped,
    isOldAndNewSwapped,
    sampleSwappedRow,
  };
}

/**
 * Menukar posisi kolom pada data terbaru jika terbalik (dari "Nilai [Tab] Nama" menjadi "Nama [Tab] Nilai").
 */
export function swapNewScoreColumns(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const convertedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      convertedLines.push(line);
      continue;
    }

    if (isHeaderRow(trimmed, true)) {
      convertedLines.push('Nama Siswa\tNilai');
      continue;
    }

    // 1. Tab separated
    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t').map((p) => p.trim());
      if (parts.length >= 2) {
        convertedLines.push(`${parts[1]}\t${parts[0]}${parts.length > 2 ? '\t' + parts.slice(2).join('\t') : ''}`);
        continue;
      }
    }

    // 2. Semicolon or pipe separated
    if (trimmed.includes(';') || trimmed.includes('|')) {
      const sep = trimmed.includes(';') ? ';' : '|';
      const parts = trimmed.split(sep).map((p) => p.trim());
      if (parts.length >= 2) {
        convertedLines.push(`${parts[1]}\t${parts[0]}${parts.length > 2 ? '\t' + parts.slice(2).join('\t') : ''}`);
        continue;
      }
    }

    // 3. Comma separated
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map((p) => p.trim());
      if (parts.length === 2) {
        convertedLines.push(`${parts[1]}\t${parts[0]}`);
        continue;
      } else if (parts.length === 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
        convertedLines.push(`${parts[2]}\t${parts[0]},${parts[1]}`);
        continue;
      }
    }

    // 4. Pola angka di awal baris: "88 Budi Santoso" atau "88 - Budi Santoso"
    const leadingMatch = trimmed.match(/^(\d{1,3}(?:[.,]\d{1,2})?|[A-E][+-]?)\s*[-:=]?\s+([a-zA-Z].*)$/i);
    if (leadingMatch) {
      convertedLines.push(`${leadingMatch[2].trim()}\t${leadingMatch[1].trim()}`);
      continue;
    }

    convertedLines.push(trimmed);
  }

  return convertedLines.join('\n');
}


/**
 * Mencocokkan dan mengurutkan data terbaru berdasarkan urutan daftar nama lama.
 */
export function reconcileStudentData(
  oldList: OldStudentEntry[],
  newList: NewScoreEntry[],
  confirmedPairs: Record<string, string>, // oldEntry.id -> newEntry.id (atau 'NONE' jika ditolak semua)
  rejectedPairs: Record<string, string[]>, // oldEntry.id -> array of rejected newEntry.id
  manualScores: Record<string, string>, // oldEntry.id -> manual score input
  manualScoresMulti?: Record<string, Record<string, string>> // oldEntry.id -> { [column]: value }
): ReconciliationSummary {
  const usedNewIds = new Set<string>();
  const newById = new Map<string, NewScoreEntry>();
  newList.forEach((entry) => newById.set(entry.id, entry));

  // Kelompokkan data baru berdasarkan normalizedName untuk pencarian cepat
  const newByNormName = new Map<string, NewScoreEntry[]>();
  for (const entry of newList) {
    const arr = newByNormName.get(entry.normalizedName) || [];
    arr.push(entry);
    newByNormName.set(entry.normalizedName, arr);
  }

  // Tahap 1: Alokasikan pasangan yang sudah dikonfirmasi secara eksplisit oleh pengguna
  const manualAssignedMap = new Map<string, NewScoreEntry>();
  for (const oldEntry of oldList) {
    const confirmedNewId = confirmedPairs[oldEntry.id];
    if (confirmedNewId && confirmedNewId !== 'NONE') {
      const targetNew = newById.get(confirmedNewId);
      if (targetNew && !usedNewIds.has(targetNew.id)) {
        manualAssignedMap.set(oldEntry.id, targetNew);
        usedNewIds.add(targetNew.id);
      }
    }
  }

  // Tahap 2: Alokasikan kecocokan persis (Exact Match) untuk nama yang unik
  const exactAssignedMap = new Map<string, NewScoreEntry>();
  for (const oldEntry of oldList) {
    if (manualAssignedMap.has(oldEntry.id)) continue;
    if (oldEntry.isDuplicateInOld) continue;

    const matchingNewEntries = (newByNormName.get(oldEntry.normalizedName) || []).filter(
      (ne) => !usedNewIds.has(ne.id)
    );

    if (matchingNewEntries.length === 1 && !matchingNewEntries[0].isDuplicateInNew) {
      const matched = matchingNewEntries[0];
      exactAssignedMap.set(oldEntry.id, matched);
      usedNewIds.add(matched.id);
    }
  }

  // Tahap 3: Susun baris hasil berdasarkan urutan absen lama
  const rows: SortedResultRow[] = oldList.map((oldEntry) => {
    const manualScore = manualScores[oldEntry.id];
    const multiOverride = manualScoresMulti ? manualScoresMulti[oldEntry.id] : undefined;

    if (manualAssignedMap.has(oldEntry.id)) {
      const matched = manualAssignedMap.get(oldEntry.id)!;
      return {
        oldEntry,
        status: 'CONFIRMED_MANUAL',
        matchedNewEntry: matched,
        candidateEntries: [],
        duplicateNewEntries: [],
        manualScoreOverride: manualScore,
        manualScoresOverride: multiOverride,
      };
    }

    if (exactAssignedMap.has(oldEntry.id)) {
      const matched = exactAssignedMap.get(oldEntry.id)!;
      const hasScore =
        matched.score.trim() !== '' ||
        (manualScore !== undefined && manualScore.trim() !== '') ||
        (multiOverride !== undefined && Object.values(multiOverride).some((v) => v.trim() !== ''));
      return {
        oldEntry,
        status: hasScore ? 'EXACT_MATCH' : 'MISSING_SCORE',
        matchedNewEntry: matched,
        candidateEntries: [],
        duplicateNewEntries: [],
        manualScoreOverride: manualScore,
        manualScoresOverride: multiOverride,
      };
    }

    const exactSameNamePool = (newByNormName.get(oldEntry.normalizedName) || []).filter(
      (ne) => !usedNewIds.has(ne.id)
    );
    if (exactSameNamePool.length > 1 || (oldEntry.isDuplicateInOld && exactSameNamePool.length >= 1)) {
      return {
        oldEntry,
        status: 'DUPLICATE_CONFLICT',
        matchedNewEntry: null,
        candidateEntries: exactSameNamePool.map((ne) => ({
          newEntry: ne,
          similarity: 100,
          reason: 'Nama sama persis (terdapat duplikasi nama, pilih data yang sesuai)',
        })),
        duplicateNewEntries: exactSameNamePool,
        manualScoreOverride: manualScore,
        manualScoresOverride: multiOverride,
      };
    }

    const rejectedForThisOld = new Set(rejectedPairs[oldEntry.id] || []);
    const fuzzyCandidates: FuzzySuggestion[] = [];

    for (const ne of newList) {
      if (usedNewIds.has(ne.id)) continue;
      if (rejectedForThisOld.has(ne.id)) continue;

      const hasOtherExactOld = oldList.some(
        (otherOld) =>
          otherOld.id !== oldEntry.id &&
          !otherOld.isDuplicateInOld &&
          otherOld.normalizedName === ne.normalizedName
      );
      if (hasOtherExactOld) continue;

      const { score, reason } = calculateNameSimilarity(oldEntry.name, ne.name);
      if (score >= 62) {
        fuzzyCandidates.push({
          newEntry: ne,
          similarity: score,
          reason,
        });
      }
    }

    fuzzyCandidates.sort((a, b) => b.similarity - a.similarity);

    if (fuzzyCandidates.length > 0 && confirmedPairs[oldEntry.id] !== 'NONE') {
      return {
        oldEntry,
        status: 'FUZZY_PENDING',
        matchedNewEntry: null,
        candidateEntries: fuzzyCandidates.slice(0, 4),
        duplicateNewEntries: [],
        manualScoreOverride: manualScore,
        manualScoresOverride: multiOverride,
      };
    }

    return {
      oldEntry,
      status: 'MISSING_SCORE',
      matchedNewEntry: null,
      candidateEntries: [],
      duplicateNewEntries: [],
      manualScoreOverride: manualScore,
      manualScoresOverride: multiOverride,
    };
  });

  const unmatchedNewEntries = newList.filter((ne) => !usedNewIds.has(ne.id));

  const duplicateOldNames = Array.from(
    new Set(oldList.filter((o) => o.isDuplicateInOld).map((o) => o.name))
  );
  const duplicateNewNames = Array.from(
    new Set(newList.filter((n) => n.isDuplicateInNew).map((n) => n.name))
  );

  let matchedCount = 0;
  let pendingFuzzyCount = 0;
  let missingScoreCount = 0;
  let duplicateConflictCount = 0;

  for (const r of rows) {
    const effectiveScore =
      r.manualScoreOverride !== undefined
        ? r.manualScoreOverride.trim()
        : r.matchedNewEntry?.score.trim() || '';

    if (r.status === 'EXACT_MATCH' || r.status === 'CONFIRMED_MANUAL') {
      if (effectiveScore !== '') {
        matchedCount++;
      } else {
        missingScoreCount++;
      }
    } else if (r.status === 'FUZZY_PENDING') {
      if (effectiveScore !== '') {
        matchedCount++;
      } else {
        pendingFuzzyCount++;
      }
    } else if (r.status === 'DUPLICATE_CONFLICT') {
      duplicateConflictCount++;
    } else {
      if (effectiveScore !== '') {
        matchedCount++;
      } else {
        missingScoreCount++;
      }
    }
  }

  return {
    rows,
    unmatchedNewEntries,
    duplicateOldNames,
    duplicateNewNames,
    stats: {
      totalOld: oldList.length,
      totalNew: newList.length,
      matchedCount,
      pendingFuzzyCount,
      missingScoreCount,
      duplicateConflictCount,
      unmatchedNewCount: unmatchedNewEntries.length,
    },
  };
}
