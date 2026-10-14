import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Check,
  Copy,
  Download,
  AlertTriangle,
  Search,
  RotateCcw,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  HelpCircle,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  Eye,
  X,
  FileCheck2,
  ChevronRight,
  Undo2,
  TrendingUp,
  Award,
  BarChart3,
  ListOrdered,
  Maximize2,
  Minimize2,
  Sliders,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  parseOldStudentList,
  parseNewScoreData,
  reconcileStudentData,
  diagnoseInputFormat,
  swapNewScoreColumns,
  getDetectedScoreColumns,
  getEffectiveScoreForColumn,
  calculateRowGradeSummary,
  SortedResultRow,
  NewScoreEntry,
} from './utils/matcher';
import {
  generateClipboardTSV,
  downloadCSVFile,
  downloadExcelFile,
} from './utils/exporter';

type Step = 1 | 2 | 3;
type FilterTab = 'ALL' | 'NEEDS_ATTENTION' | 'MATCHED' | 'MISSING' | 'REMEDIAL';
type TableDensity = 'compact' | 'comfortable';

interface HistorySnapshot {
  description: string;
  confirmedPairs: Record<string, string>;
  rejectedPairs: Record<string, string[]>;
  manualScores: Record<string, string>;
  manualScoresMulti: Record<string, Record<string, string>>;
  appendedNewStudents: string[];
  oldNamesText: string;
  newScoresText: string;
  currentStep: Step;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>(1);

  // Data inputs (murni kosong untuk data asli guru tanpa dummy)
  const [oldNamesText, setOldNamesText] = useState<string>('');
  const [newScoresText, setNewScoresText] = useState<string>('');

  // Konfigurasi KKM (Kriteria Ketuntasan Minimal) dinamis
  const [kkmThreshold, setKkmThreshold] = useState<number>(75);

  // States penyesuaian data
  const [confirmedPairs, setConfirmedPairs] = useState<Record<string, string>>({});
  const [rejectedPairs, setRejectedPairs] = useState<Record<string, string[]>>({});
  const [manualScores, setManualScores] = useState<Record<string, string>>({});
  const [manualScoresMulti, setManualScoresMulti] = useState<Record<string, Record<string, string>>>({});
  const [appendedNewStudents, setAppendedNewStudents] = useState<string[]>([]);

  // Undo / History Stack
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);

  // Filtering & options
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [tableDensity, setTableDensity] = useState<TableDensity>('comfortable');
  const [includeUnmatchedOnExport, setIncludeUnmatchedOnExport] = useState<boolean>(true);
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);
  const [undoToastMessage, setUndoToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!undoToastMessage) return;
    const timer = setTimeout(() => {
      setUndoToastMessage(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [undoToastMessage]);

  // Interactive Live Excel Spreadsheet Modal state
  const [showExcelPreviewModal, setShowExcelPreviewModal] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);

  const fileInputOldRef = useRef<HTMLInputElement | null>(null);
  const fileInputNewRef = useRef<HTMLInputElement | null>(null);

  const effectiveOldNamesText = useMemo(() => {
    if (appendedNewStudents.length === 0) return oldNamesText;
    const base = oldNamesText.trim();
    return base ? `${base}\n${appendedNewStudents.join('\n')}` : appendedNewStudents.join('\n');
  }, [oldNamesText, appendedNewStudents]);

  const oldList = useMemo(() => parseOldStudentList(effectiveOldNamesText), [effectiveOldNamesText]);
  const newList = useMemo(() => parseNewScoreData(newScoresText), [newScoresText]);

  // Kolom-kolom nilai yang terdeteksi secara dinamis (misal: ['Tugas', 'UTS', 'UAS'] atau ['Nilai'])
  const scoreColumns = useMemo(() => getDetectedScoreColumns(newList), [newList]);

  // Diagnosis format input secara real-time
  const inputDiagnosis = useMemo(
    () => diagnoseInputFormat(oldNamesText, newScoresText),
    [oldNamesText, newScoresText]
  );

  const reconciliation = useMemo(
    () =>
      reconcileStudentData(
        oldList,
        newList,
        confirmedPairs,
        rejectedPairs,
        manualScores,
        manualScoresMulti
      ),
  [oldList, newList, confirmedPairs, rejectedPairs, manualScores, manualScoresMulti]
  );

  const { rows, unmatchedNewEntries, stats } = reconciliation;

  // Analitik Statistik Nilai Siswa & Daftar Remedial
  const gradeAnalytics = useMemo(() => {
    const validScores: number[] = [];
    const remedialStudents: { absenNo: number; name: string; score: number; gap: number }[] = [];

    rows.forEach((r) => {
      const summary = calculateRowGradeSummary(r, scoreColumns);
      if (summary.average !== null) {
        validScores.push(summary.average);
        if (summary.average < kkmThreshold) {
          remedialStudents.push({
            absenNo: r.oldEntry.absenNo,
            name: r.oldEntry.name,
            score: summary.average,
            gap: Math.round((kkmThreshold - summary.average) * 10) / 10,
          });
        }
      }
    });

    if (validScores.length === 0) {
      return {
        count: 0,
        average: 0,
        max: 0,
        min: 0,
        passingCount: 0,
        passingRate: 0,
        remedialCount: 0,
        remedialStudents: [],
        brackets: {
          lessThan60: 0,
          between60AndKkm: 0,
          betweenKkmAnd84: 0,
          above85: 0,
        },
      };
    }

    const sum = validScores.reduce((acc, val) => acc + val, 0);
    const avg = sum / validScores.length;
    const maxVal = Math.max(...validScores);
    const minVal = Math.min(...validScores);
    const passingCount = validScores.filter((val) => val >= kkmThreshold).length;

    const lessThan60 = validScores.filter((v) => v < 60).length;
    const between60AndKkm = validScores.filter((v) => v >= 60 && v < kkmThreshold).length;
    const betweenKkmAnd84 = validScores.filter((v) => v >= kkmThreshold && v < 85).length;
    const above85 = validScores.filter((v) => v >= 85).length;

    return {
      count: validScores.length,
      average: Math.round(avg * 10) / 10,
      max: maxVal,
      min: minVal,
      passingCount,
      passingRate: Math.round((passingCount / validScores.length) * 100),
      remedialCount: remedialStudents.length,
      remedialStudents,
      brackets: {
        lessThan60,
        between60AndKkm,
        betweenKkmAnd84,
        above85,
      },
    };
  }, [rows, scoreColumns, kkmThreshold]);

  const pendingConfirmationRows = useMemo(
    () =>
      rows.filter(
        (r) => r.status === 'FUZZY_PENDING' || r.status === 'DUPLICATE_CONFLICT'
      ),
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        row.oldEntry.name.toLowerCase().includes(q) ||
        row.oldEntry.absenNo.toString().includes(q) ||
        (row.matchedNewEntry?.name.toLowerCase().includes(q) ?? false) ||
        scoreColumns.some((c) => getEffectiveScoreForColumn(row, c).toLowerCase().includes(q));

      if (!matchesQuery) return false;

      const summary = calculateRowGradeSummary(row, scoreColumns);

      if (activeFilter === 'NEEDS_ATTENTION') {
        return (
          row.status === 'FUZZY_PENDING' ||
          row.status === 'DUPLICATE_CONFLICT' ||
          !summary.hasAnyScore
        );
      }
      if (activeFilter === 'MATCHED') {
        return (
          (row.status === 'EXACT_MATCH' || row.status === 'CONFIRMED_MANUAL') &&
          summary.hasAnyScore
        );
      }
      if (activeFilter === 'MISSING') {
        return !summary.hasAnyScore;
      }
      if (activeFilter === 'REMEDIAL') {
        return summary.average !== null && summary.average < kkmThreshold;
      }
      return true;
    });
  }, [rows, searchQuery, activeFilter, scoreColumns, kkmThreshold]);

  // Push state snapshot before mutation for Undo
  const pushHistory = (description: string) => {
    setHistoryStack((prev) => [
      ...prev.slice(-20), // keep last 20 actions
      {
        description,
        confirmedPairs: { ...confirmedPairs },
        rejectedPairs: { ...rejectedPairs },
        manualScores: { ...manualScores },
        manualScoresMulti: { ...manualScoresMulti },
        appendedNewStudents: [...appendedNewStudents],
        oldNamesText,
        newScoresText,
        currentStep,
      },
    ]);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const last = historyStack[historyStack.length - 1];
    setConfirmedPairs(last.confirmedPairs);
    setRejectedPairs(last.rejectedPairs);
    setManualScores(last.manualScores);
    setManualScoresMulti(last.manualScoresMulti);
    setAppendedNewStudents(last.appendedNewStudents);
    if (typeof last.oldNamesText === 'string') setOldNamesText(last.oldNamesText);
    if (typeof last.newScoresText === 'string') setNewScoresText(last.newScoresText);
    if (last.currentStep) setCurrentStep(last.currentStep);
    setHistoryStack((prev) => prev.slice(0, -1));

    setUndoToastMessage(`Aksi berhasil dibatalkan: ${last.description}`);
  };

  // Keyboard shortcut Ctrl+Z / Cmd+Z for global undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        // Allow default browser undo inside inputs/textareas while user is actively typing
        if (tag === 'input' || tag === 'textarea') {
          return;
        }
        if (historyStack.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyStack]);

  // Actions
  const handleConfirmPair = (oldId: string, newId: string) => {
    pushHistory('Konfirmasi pasangan siswa');
    setConfirmedPairs((prev) => ({ ...prev, [oldId]: newId }));
    setRejectedPairs((prev) => {
      const next = { ...prev };
      delete next[oldId];
      return next;
    });
  };

  const handleRejectCandidate = (oldId: string, newId: string) => {
    pushHistory('Tolak pasangan kandidat nama');
    setRejectedPairs((prev) => ({
      ...prev,
      [oldId]: [...(prev[oldId] || []), newId],
    }));
  };

  const handleRejectAllCandidates = (oldId: string) => {
    pushHistory('Tolak semua kandidat untuk siswa');
    setConfirmedPairs((prev) => ({ ...prev, [oldId]: 'NONE' }));
  };

  const handleUnmatchPair = (oldId: string) => {
    pushHistory('Lepas pasangan manual');
    setConfirmedPairs((prev) => {
      const next = { ...prev };
      delete next[oldId];
      return next;
    });
  };

  const handleManualScoreChange = (oldId: string, value: string) => {
    setManualScores((prev) => ({ ...prev, [oldId]: value }));
    if (scoreColumns.length === 1) {
      setManualScoresMulti((prev) => ({
        ...prev,
        [oldId]: { ...(prev[oldId] || {}), [scoreColumns[0]]: value },
      }));
    }
  };

  const handleManualColumnScoreChange = (oldId: string, columnName: string, value: string) => {
    setManualScoresMulti((prev) => ({
      ...prev,
      [oldId]: {
        ...(prev[oldId] || {}),
        [columnName]: value,
      },
    }));
  };

  const handleAppendUnmatchedToOldList = (unmatchedEntry: NewScoreEntry) => {
    pushHistory(`Tambah siswa baru ${unmatchedEntry.name} ke nomor absen akhir`);
    setAppendedNewStudents((prev) => [...prev, unmatchedEntry.name]);
  };

  const handleFixSwappedColumns = () => {
    pushHistory('Tukar posisi kolom terbalik');
    const fixedText = swapNewScoreColumns(newScoresText);
    setNewScoresText(fixedText);
    setConfirmedPairs({});
    setRejectedPairs({});
  };

  const handleFixSwappedInputs = () => {
    pushHistory('Tukar isi input Langkah 1 dan Langkah 2');
    const tempOld = oldNamesText;
    setOldNamesText(newScoresText);
    setNewScoresText(tempOld);
    setConfirmedPairs({});
    setRejectedPairs({});
    setManualScores({});
    setManualScoresMulti({});
    setAppendedNewStudents([]);
  };

  const hasAnyData = useMemo(() => {
    return Boolean(
      oldNamesText.trim() ||
      newScoresText.trim() ||
      Object.keys(confirmedPairs).length > 0 ||
      Object.keys(manualScores).length > 0 ||
      Object.keys(manualScoresMulti).length > 0 ||
      appendedNewStudents.length > 0
    );
  }, [oldNamesText, newScoresText, confirmedPairs, manualScores, manualScoresMulti, appendedNewStudents]);

  const handleResetClick = () => {
    if (!hasAnyData) {
      setCopiedFeedback('DATA_ALREADY_EMPTY');
      setTimeout(() => setCopiedFeedback((prev) => (prev === 'DATA_ALREADY_EMPTY' ? null : prev)), 2500);
      return;
    }
    setShowResetModal(true);
  };

  const handleConfirmReset = () => {
    pushHistory('Reset semua data');
    setOldNamesText('');
    setNewScoresText('');
    setConfirmedPairs({});
    setRejectedPairs({});
    setManualScores({});
    setManualScoresMulti({});
    setAppendedNewStudents([]);
    setShowResetModal(false);
    setCurrentStep(1);
    setCopiedFeedback('RESET_DONE');
    setTimeout(() => setCopiedFeedback((prev) => (prev === 'RESET_DONE' ? null : prev)), 2500);
  };

  const handleCopy = async (mode: 'SCORES_ONLY' | 'NAME_AND_SCORE' | 'FULL_TABLE') => {
    const tsv = generateClipboardTSV(
      rows,
      mode,
      unmatchedNewEntries.map((u) => ({
        name: u.name,
        score: u.score,
        rawLine: u.rawLine,
      })),
      includeUnmatchedOnExport,
      scoreColumns,
      kkmThreshold
    );
    try {
      await navigator.clipboard.writeText(tsv);
      setCopiedFeedback(mode);
      setTimeout(() => {
        setCopiedFeedback((prev) => (prev === mode ? null : prev));
      }, 2200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedFeedback(mode);
      setTimeout(() => {
        setCopiedFeedback((prev) => (prev === mode ? null : prev));
      }, 2200);
    }
  };

  const handleCopyWhatsAppRemedial = async () => {
    if (gradeAnalytics.remedialStudents.length === 0) return;
    const text = [
      `📢 *PENGUMUMAN REMEDIAL & PERBAIKAN NILAI*`,
      `Standar KKM: *${kkmThreshold}*`,
      `Total Siswa Perlu Remedial: *${gradeAnalytics.remedialStudents.length} Siswa*`,
      ``,
      `Berikut daftar siswa yang terjadwal mengikuti remedial:`,
      ...gradeAnalytics.remedialStudents.map((s, idx) =>
        `${idx + 1}. *${s.name}* (No. Absen ${s.absenNo}) — Nilai: ${s.score} _(Kurang ${s.gap} poin)_`
      ),
      ``,
      `Silakan menghubungi guru mata pelajaran untuk instruksi tugas/jadwal perbaikan. Terima kasih.`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedFeedback('WHATSAPP_REMEDIAL');
      setTimeout(() => setCopiedFeedback(null), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedFeedback('WHATSAPP_REMEDIAL');
      setTimeout(() => setCopiedFeedback(null), 2500);
    }
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'OLD' | 'NEW'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        if (target === 'OLD') {
          pushHistory('Impor berkas daftar absen lama');
          setOldNamesText(content);
          setConfirmedPairs({});
          setRejectedPairs({});
          setAppendedNewStudents([]);
        } else {
          pushHistory('Impor berkas data nilai');
          setNewScoresText(content);
          setConfirmedPairs({});
          setRejectedPairs({});
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const totalNeedsReview =
    stats.pendingFuzzyCount + stats.duplicateConflictCount;
  const totalUnmatchedOutside = stats.unmatchedNewCount;

  // Split lines for line numbers gutter in Step 1
  const oldTextLines = useMemo(() => oldNamesText.split(/\r?\n/), [oldNamesText]);
  const newTextLines = useMemo(() => newScoresText.split(/\r?\n/), [newScoresText]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* TOP BAR CONTRACT: 3 Zones separated by gap-8 */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-8 px-6 py-3.5 bg-white border-b border-slate-200 shadow-2xs">
        {/* Zone 1: Wordmark with Official Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img
            src="/logo.svg"
            alt="GradeSorter Logo"
            className="w-8 h-8 rounded-lg shadow-xs hover:scale-105 transition-transform"
          />
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-slate-900 leading-tight whitespace-nowrap">
              GradeSorter
            </span>
            <span className="text-[10px] font-medium text-slate-500 tracking-wider uppercase -mt-0.5 hidden sm:inline-block">
              Sistem Urut Nilai Absen
            </span>
          </div>
        </div>

        {/* Zone 2: Step Wizard Indicator in Header */}
        <nav className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentStep === 1
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
              currentStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
              1
            </span>
            Input Data
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentStep === 2
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
              currentStep === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
              2
            </span>
            Verifikasi Nama
            {totalNeedsReview > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-bold">
                {totalNeedsReview}
              </span>
            )}
          </button>

          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              currentStep === 3
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
              currentStep === 3 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
            }`}>
              3
            </span>
            Hasil & Ekspor
          </button>
        </nav>

        {/* Zone 3: Global Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {historyStack.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              title={`Batalkan: "${historyStack[historyStack.length - 1]?.description || 'Aksi sebelumnya'}" (Shortcut: Ctrl+Z)`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 hover:border-indigo-300 active:scale-95 transition-all shadow-2xs cursor-pointer animate-in fade-in"
            >
              <Undo2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>Batal Aksi ({historyStack.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleResetClick}
            title={hasAnyData ? "Kosongkan data untuk memproses kelas baru" : "Formulir saat ini sudah bersih dan kosong"}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
              hasAnyData
                ? 'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100 hover:border-rose-300 shadow-2xs'
                : 'text-slate-400 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:text-slate-600'
            }`}
          >
            <Trash2 className={`w-3.5 h-3.5 ${hasAnyData ? 'text-rose-600' : 'text-slate-400'}`} />
            <span>Kosongkan Data</span>
          </button>

          {copiedFeedback === 'DATA_ALREADY_EMPTY' && (
            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-200 animate-in fade-in flex items-center gap-1">
              Data input sudah kosong
            </span>
          )}

          {copiedFeedback === 'RESET_DONE' && (
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200 animate-in fade-in flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-600" /> Berhasil dikosongkan!
            </span>
          )}
        </div>
      </header>

      {/* SUB-HEADER / PROGRESS BANNER */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-slate-600">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
              Langkah {currentStep} dari 3:
              <strong className="text-slate-900 ml-1">
                {currentStep === 1
                  ? 'Input Absen Lama & Nilai Ujian'
                  : currentStep === 2
                  ? 'Verifikasi Kesamaan Nama & Duplikat'
                  : 'Pratinjau Spreadsheet & Unduh Excel'}
              </strong>
            </span>
            {scoreColumns.length > 1 && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold font-mono">
                <Layers className="w-3 h-3" />
                {scoreColumns.length} Kolom Nilai ({scoreColumns.join(', ')})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev - 1) as Step)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Kembali
              </button>
            )}
            {currentStep < 3 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev + 1) as Step)}
                className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white font-semibold rounded-md shadow-2xs hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                Lanjut Langkah {currentStep + 1} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto p-6 space-y-6">
        {/* ========================================================================= */}
        {/* PERINGATAN FORMAT INPUT TERBALIK / SALAH TEMPEL (JIKA TERDETEKSI)         */}
        {/* ========================================================================= */}
        {inputDiagnosis.hasIssues && (
          <section className="bg-amber-50 border-2 border-amber-400 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-100 text-amber-900 rounded-lg shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-700" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-950">
                    Peringatan Format Input: Deteksi Kesalahan Susunan Kolom Data
                  </h3>
                  <p className="text-xs text-amber-900 mt-1 leading-relaxed">
                    Sistem mendeteksi bahwa susunan data yang ditempelkan tidak sesuai dengan format standar.
                    Anda dapat memperbaikinya secara otomatis dengan tombol 1-klik di bawah ini.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {inputDiagnosis.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-amber-300 rounded-lg p-3 text-xs flex flex-col justify-between gap-3 shadow-2xs"
                >
                  <div>
                    <span className="font-bold text-amber-950 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                      {issue.title}
                    </span>
                    <p className="text-slate-600 mt-1 leading-relaxed">{issue.message}</p>
                  </div>

                  {issue.quickFixAction === 'SWAP_COLUMNS' && (
                    <button
                      type="button"
                      onClick={handleFixSwappedColumns}
                      className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      {issue.quickFixLabel || 'Tukar Kolom Nilai & Nama'}
                    </button>
                  )}

                  {issue.quickFixAction === 'SWAP_INPUTS' && (
                    <button
                      type="button"
                      onClick={handleFixSwappedInputs}
                      className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      {issue.quickFixLabel || 'Tukar Isi Kedua Kotak Input'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {inputDiagnosis.sampleSwappedRow && (
              <div className="p-3 bg-amber-100/60 rounded-lg border border-amber-200 text-xs text-amber-900 font-mono">
                <span className="font-sans font-semibold text-amber-950">Contoh Baris Terbalik: </span>
                <span className="line-through text-amber-800">{inputDiagnosis.sampleSwappedRow.original}</span>
                <span className="mx-2 font-sans font-bold text-indigo-700">&rarr; Diperbaiki:</span>
                <span className="font-bold text-emerald-800">{inputDiagnosis.sampleSwappedRow.preview}</span>
              </div>
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* LANGKAH 1: DUA PANEL INPUT DENGAN LINE NUMBERS                            */}
        {/* ========================================================================= */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div id="input-data" className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              {/* Panel Kiri: Daftar Nama Lama */}
              <div className="flex flex-col bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
                        LANGKAH 1
                      </span>
                      <h2 className="text-sm font-bold text-slate-900">
                        Daftar Nama Lama (Patokan Absen Tetap)
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Urutan baris di kotak ini menjadi patokan nomor absen 1, 2, 3... yang tidak akan berubah.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="file"
                      ref={fileInputOldRef}
                      accept=".txt,.csv"
                      onChange={(e) => handleFileUpload(e, 'OLD')}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputOldRef.current?.click()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                      title="Impor file teks (.txt) atau .csv"
                    >
                      <Upload className="w-3 h-3" /> Berkas
                    </button>
                    {oldNamesText && (
                      <button
                        type="button"
                        onClick={() => {
                          pushHistory('Hapus teks daftar absen lama');
                          setOldNamesText('');
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Hapus teks"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Line-numbered Textarea Container */}
                <div className="flex-1 min-h-[360px] flex border border-slate-200 rounded-lg overflow-hidden bg-white focus-within:border-indigo-600 focus-within:ring-1 focus-within:ring-indigo-600">
                  {/* Gutter Line Numbers */}
                  <div className="w-10 py-3 bg-slate-100/70 border-r border-slate-200 text-right pr-2 text-xs font-mono text-slate-400 select-none leading-relaxed overflow-hidden">
                    {oldTextLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={oldNamesText}
                    onChange={(e) => {
                      setOldNamesText(e.target.value);
                      setConfirmedPairs({});
                      setRejectedPairs({});
                    }}
                    placeholder={`Tempelkan daftar nama absen lama di sini...\nContoh:\n1. Ahmad Fauzi\n2. Budi Santoso\n3. Cantika Abigail`}
                    className="w-full flex-1 p-3 text-sm font-mono text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none transition-colors resize-none leading-relaxed overflow-y-auto"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <span>
                    Terdeteksi: <strong className="text-slate-900 font-mono">{oldList.length}</strong> siswa
                  </span>
                  <span>Nomor urut di awal nama dihapus otomatis.</span>
                </div>
              </div>

              {/* Panel Kanan: Data Nilai Terbaru */}
              <div className={`flex flex-col bg-white border rounded-xl p-5 space-y-4 transition-colors ${
                inputDiagnosis.isNewDataSwapped
                  ? 'border-amber-400 ring-2 ring-amber-200 bg-amber-50/10'
                  : 'border-slate-200'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        LANGKAH 2
                      </span>
                      <h2 className="text-sm font-bold text-slate-900">
                        Data Terbaru (Urutan Acak / Multi-Kolom)
                      </h2>
                      {inputDiagnosis.isNewDataSwapped && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                          Kolom Terbalik
                        </span>
                      )}
                      {scoreColumns.length > 1 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                          {scoreColumns.length} Kolom
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Mendukung 1 atau banyak nilai (Tugas, UTS, UAS). Salin langsung dari Excel.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="file"
                      ref={fileInputNewRef}
                      accept=".txt,.csv"
                      onChange={(e) => handleFileUpload(e, 'NEW')}
                      className="hidden"
                    />
                    {inputDiagnosis.isNewDataSwapped && (
                      <button
                        type="button"
                        onClick={handleFixSwappedColumns}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors cursor-pointer"
                        title="Tukar kolom nilai di depan nama"
                      >
                        <ArrowUpDown className="w-3 h-3" /> Tukar Kolom
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputNewRef.current?.click()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                    >
                      <Upload className="w-3 h-3" /> Berkas
                    </button>
                    {newScoresText && (
                      <button
                        type="button"
                        onClick={() => {
                          pushHistory('Hapus teks data nilai');
                          setNewScoresText('');
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Hapus teks"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Line-numbered Textarea Container */}
                <div className={`flex-1 min-h-[360px] flex border rounded-lg overflow-hidden bg-white focus-within:ring-1 ${
                  inputDiagnosis.isNewDataSwapped
                    ? 'border-amber-400 focus-within:border-amber-500 focus-within:ring-amber-500'
                    : 'border-slate-200 focus-within:border-indigo-600 focus-within:ring-indigo-600'
                }`}>
                  {/* Gutter Line Numbers */}
                  <div className="w-10 py-3 bg-slate-100/70 border-r border-slate-200 text-right pr-2 text-xs font-mono text-slate-400 select-none leading-relaxed overflow-hidden">
                    {newTextLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={newScoresText}
                    onChange={(e) => {
                      setNewScoresText(e.target.value);
                      setConfirmedPairs({});
                      setRejectedPairs({});
                    }}
                    placeholder={`Tempelkan nama dan nilai di sini...\nContoh multi-kolom:\nNama Siswa\tTugas 1\tUTS\tUAS\nCantika Abigail\t88\t92\t90\nAhmad Fauzi\t80\t85\t84`}
                    className="w-full flex-1 p-3 text-sm font-mono text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none transition-colors resize-none leading-relaxed overflow-y-auto"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <span>
                    Terdeteksi: <strong className="text-slate-900 font-mono">{newList.length}</strong> data siswa ({scoreColumns.join(', ')})
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    Lanjut Verifikasi <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* LANGKAH 2: PUSAT VERIFIKASI + RIWAYAT PERUBAHAN (UNDO STACK)              */}
        {/* ========================================================================= */}
        {currentStep === 2 && (
          <div className="space-y-6">
            {/* KPI Status Rekonsiliasi & Tombol Undo */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500">Total Siswa Acuan</p>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {stats.totalOld}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    Input: {stats.totalNew} baris
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500">Nilai Berhasil Dipasangkan</p>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {stats.matchedCount}
                  </span>
                  <span className="text-xs text-emerald-700 font-semibold">
                    {stats.totalOld > 0 ? `${Math.round((stats.matchedCount / stats.totalOld) * 100)}% Cocok` : '0%'}
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500">Perlu Konfirmasi Guru</p>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    totalNeedsReview > 0 ? 'text-amber-600' : 'text-slate-900'
                  }`}>
                    {totalNeedsReview}
                  </span>
                  <span className="text-xs text-slate-500">
                    {stats.pendingFuzzyCount} mirip · {stats.duplicateConflictCount} duplikat
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-medium text-slate-500">Belum Memiliki Nilai</p>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className={`text-2xl font-bold font-mono tabular-nums ${
                    stats.missingScoreCount > 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}>
                    {stats.missingScoreCount}
                  </span>
                  <span className="text-xs text-slate-500">
                    +{totalUnmatchedOutside} nama baru
                  </span>
                </div>
              </div>
            </div>

            {/* Verification Toolbar with Undo Button */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Pusat Konfirmasi & Pencegahan Salah Pasang Nilai
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tinjau baris yang memerlukan konfirmasi sebelum melanjutkan ke lembar hasil ekspor.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {historyStack.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-indigo-600" />
                    Batalkan Perubahan Terakhir
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  Selesai & Buka Hasil <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* DAFTAR PERLU KONFIRMASI (FUZZY & DUPLIKAT) */}
            {pendingConfirmationRows.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Menunggu Konfirmasi Guru ({pendingConfirmationRows.length} Siswa)
                </h3>

                <div className="space-y-3">
                  {pendingConfirmationRows.map((row) => (
                    <div
                      key={row.oldEntry.id}
                      className="bg-white border-2 border-amber-300 rounded-xl p-4 space-y-3 shadow-xs"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center font-mono text-xs font-bold text-indigo-700">
                            {row.oldEntry.absenNo}
                          </span>
                          <div>
                            <span className="font-bold text-slate-900 text-sm">{row.oldEntry.name}</span>
                            <span className="text-xs text-slate-500 ml-2">(Patokan Absen Lama)</span>
                          </div>
                        </div>

                        <span className="self-start sm:self-auto px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
                          {row.status === 'DUPLICATE_CONFLICT' ? 'Konflik Nama Ganda' : 'Nama Mirip Terdeteksi'}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs text-slate-600 font-medium">
                          Pilih data nilai siswa yang sesuai dari hasil pencarian:
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {row.candidateEntries.map((candidate) => (
                            <div
                              key={candidate.newEntry.id}
                              className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-indigo-50/40 border border-slate-200 rounded-lg transition-colors text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-900 flex items-center gap-2">
                                  <span>{candidate.newEntry.name}</span>
                                  <span className="font-mono tabular-nums text-indigo-700 font-bold">
                                    Nilai: {candidate.newEntry.score}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                  Kemiripan {candidate.similarity}% · {candidate.reason}
                                </p>
                              </div>

                              <div className="flex items-center gap-1.5 ml-2">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPair(row.oldEntry.id, candidate.newEntry.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors cursor-pointer"
                                >
                                  <Check className="w-3 h-3" /> Pasangkan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectCandidate(row.oldEntry.id, candidate.newEntry.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
                                  title="Tolak saran nama ini"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between pt-1 text-xs">
                          <button
                            type="button"
                            onClick={() => handleRejectAllCandidates(row.oldEntry.id)}
                            className="text-slate-500 hover:text-slate-800 underline cursor-pointer"
                          >
                            Bukan salah satu dari mereka (Biarkan kosong / isi manual)
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-900">
                    Tidak Ada Konflik Nama yang Menunggu Konfirmasi!
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Semua nama yang cocok telah dipasangkan secara akurat. Silakan lanjut ke Langkah 3 untuk pratinjau lembar nilai.
                  </p>
                </div>
              </div>
            )}

            {/* DATA TERBARU YANG TIDAK ADA DI ABSEN LAMA */}
            {unmatchedNewEntries.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Siswa pada Data Baru yang Tidak Ada di Daftar Absen Lama ({unmatchedNewEntries.length} Siswa)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Nilai siswa di bawah ini tidak akan terhapus. Anda dapat menyisipkannya ke baris akhir absen resmi.
                    </p>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    Siswa Pindahan / Susulan
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {unmatchedNewEntries.map((unmatched) => (
                    <div
                      key={unmatched.id}
                      className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          <span>{unmatched.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums font-bold text-indigo-700">
                            Nilai: {unmatched.score || '(Kosong)'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">Baris ke-{unmatched.lineNumber} pada data input baru</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAppendUnmatchedToOldList(unmatched)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        + Tambah ke Absen
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* LANGKAH 3: SPREADSHEET PREMIUM & KARTU ANALITIK NILAI SISWA               */}
        {/* ========================================================================= */}
        {currentStep === 3 && (
          <div className="space-y-6">
            {/* KARTU ANALITIK STATISTIK NILAI SISWA */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <div className="flex items-center justify-between text-slate-500 text-xs">
                  <span className="font-medium">Rata-rata Kelas</span>
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {gradeAnalytics.count > 0 ? gradeAnalytics.average : '-'}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {gradeAnalytics.count} siswa dinilai
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <div className="flex items-center justify-between text-slate-500 text-xs">
                  <span className="font-medium">Nilai Tertinggi</span>
                  <Award className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {gradeAnalytics.count > 0 ? gradeAnalytics.max : '-'}
                  </span>
                  <span className="text-xs text-emerald-700 font-semibold">Skor Maksimal</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <div className="flex items-center justify-between text-slate-500 text-xs">
                  <span className="font-medium">Nilai Terendah</span>
                  <TrendingUp className="w-4 h-4 text-amber-600" />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-amber-700">
                    {gradeAnalytics.count > 0 ? gradeAnalytics.min : '-'}
                  </span>
                  <span className="text-xs text-amber-700 font-semibold">Skor Minimal</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <div className="flex items-center justify-between text-slate-500 text-xs">
                  <span className="font-medium">Tingkat Ketuntasan (&ge;{kkmThreshold})</span>
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono tabular-nums text-indigo-700">
                    {gradeAnalytics.count > 0 ? `${gradeAnalytics.passingRate}%` : '-'}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {gradeAnalytics.passingCount} dari {gradeAnalytics.count} siswa
                  </span>
                </div>
              </div>
            </div>

            {/* PENGATURAN KKM INTERAKTIF */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-xl text-xs">
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 text-indigo-700 shrink-0" />
                <div>
                  <span className="font-bold text-slate-900">Standar KKM Mata Pelajaran:</span>
                  <span className="text-slate-600 ml-1">Ambang batas ketuntasan belajar yang dapat disesuaikan</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Quick Presets */}
                <div className="flex items-center gap-1">
                  {[65, 70, 75, 80].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setKkmThreshold(val)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                        kkmThreshold === val
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>

                {/* Custom Input */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-indigo-200">
                  <span className="text-slate-500 font-medium">Kustom:</span>
                  <input
                    type="number"
                    min={40}
                    max={100}
                    value={kkmThreshold}
                    onChange={(e) => {
                      const num = parseInt(e.target.value, 10);
                      if (!isNaN(num) && num >= 1 && num <= 100) {
                        setKkmThreshold(num);
                      }
                    }}
                    className="w-14 px-2 py-1 text-center font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* GRAFIK DISTRIBUSI SEBARAN NILAI SISWA */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-indigo-600" />
                    Grafik Distribusi Sebaran Nilai Siswa
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sebaran nilai berdasarkan ambang batas KKM ({kkmThreshold}) dari total {gradeAnalytics.count} siswa dinilai
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-semibold font-mono">
                    Remedial: {gradeAnalytics.brackets.lessThan60 + gradeAnalytics.brackets.between60AndKkm} siswa
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold font-mono">
                    Tuntas: {gradeAnalytics.brackets.betweenKkmAnd84 + gradeAnalytics.brackets.above85} siswa
                  </span>
                </div>
              </div>

              {/* 4 Brackets Distribution Bars */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {
                    label: '< 60',
                    desc: 'Sangat Kurang',
                    count: gradeAnalytics.brackets.lessThan60,
                    pct: Math.round((gradeAnalytics.brackets.lessThan60 / (gradeAnalytics.count || 1)) * 100),
                    barColor: 'bg-rose-500',
                    boxBg: 'bg-rose-50/60 border-rose-200 text-rose-700',
                    isRemedial: true,
                  },
                  {
                    label: `60 - ${kkmThreshold - 1}`,
                    desc: 'Di Bawah KKM (Remedial)',
                    count: gradeAnalytics.brackets.between60AndKkm,
                    pct: Math.round((gradeAnalytics.brackets.between60AndKkm / (gradeAnalytics.count || 1)) * 100),
                    barColor: 'bg-amber-500',
                    boxBg: 'bg-amber-50/60 border-amber-200 text-amber-700',
                    isRemedial: true,
                  },
                  {
                    label: `${kkmThreshold} - 84`,
                    desc: 'Tuntas (Baik)',
                    count: gradeAnalytics.brackets.betweenKkmAnd84,
                    pct: Math.round((gradeAnalytics.brackets.betweenKkmAnd84 / (gradeAnalytics.count || 1)) * 100),
                    barColor: 'bg-indigo-600',
                    boxBg: 'bg-indigo-50/60 border-indigo-200 text-indigo-700',
                    isRemedial: false,
                  },
                  {
                    label: '85 - 100',
                    desc: 'Sangat Baik (Mahir)',
                    count: gradeAnalytics.brackets.above85,
                    pct: Math.round((gradeAnalytics.brackets.above85 / (gradeAnalytics.count || 1)) * 100),
                    barColor: 'bg-emerald-600',
                    boxBg: 'bg-emerald-50/60 border-emerald-200 text-emerald-700',
                    isRemedial: false,
                  },
                ].map((bar) => {
                  const maxCount = Math.max(
                    gradeAnalytics.brackets.lessThan60,
                    gradeAnalytics.brackets.between60AndKkm,
                    gradeAnalytics.brackets.betweenKkmAnd84,
                    gradeAnalytics.brackets.above85,
                    1
                  );
                  const barWidth = Math.max(10, Math.round((bar.count / maxCount) * 100));

                  return (
                    <div
                      key={bar.label}
                      onClick={() => {
                        if (bar.isRemedial) setActiveFilter('REMEDIAL');
                      }}
                      className={`p-3 rounded-lg border flex flex-col justify-between transition-all ${
                        bar.boxBg
                      } ${bar.isRemedial ? 'cursor-pointer hover:shadow-xs' : ''}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-xs font-bold font-mono">{bar.label}</span>
                          <p className="text-[10px] text-slate-500 font-medium leading-tight">{bar.desc}</p>
                        </div>
                        <span className="text-base font-bold font-mono">{bar.count}</span>
                      </div>

                      <div className="mt-3 space-y-1">
                        <div className="w-full bg-white/80 rounded-full h-2 overflow-hidden border border-slate-200/50">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${bar.barColor}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                          <span>{bar.pct}% kelas</span>
                          {bar.isRemedial && bar.count > 0 && (
                            <span className="text-amber-800 font-semibold underline">Lihat Siswa</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* REMEDIAL NOTICE & WHATSAPP ANNOUNCEMENT BUTTON */}
            {gradeAnalytics.remedialStudents.length > 0 && (
              <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 text-amber-900 rounded-lg shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-950">
                      {gradeAnalytics.remedialStudents.length} Siswa Berada di Bawah KKM (&lt; {kkmThreshold})
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Siswa dengan nilai di bawah KKM siap dijadwalkan untuk program remedial atau tugas perbaikan nilai.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveFilter('REMEDIAL')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      activeFilter === 'REMEDIAL'
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100/60'
                    }`}
                  >
                    Tampilkan Hanya Remedial
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyWhatsAppRemedial}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
                    title="Salin daftar nama siswa remedial dengan format rapi untuk WhatsApp grup guru atau wali murid"
                  >
                    {copiedFeedback === 'WHATSAPP_REMEDIAL' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Tersalin untuk WhatsApp!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Salin Daftar WhatsApp
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TABEL SPREADSHEET PREMIUM DENGAN MINI TOOLBAR */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              {/* Action Toolbar */}
              <div className="p-4 border-b border-slate-200 space-y-3.5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Tabel Nilai Siswa Sesuai Urutan Absen Lama
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Urutan terikat 100% pada nomor absen lama (1 s/d {rows.length}).{' '}
                      {scoreColumns.length > 1
                        ? `Mendukung multi-kolom nilai (${scoreColumns.join(', ')}) dan rata-rata otomatis.`
                        : 'Siap disalin atau diekspor ke Excel.'}
                    </p>
                  </div>

                  {/* Tombol Salin & Ekspor */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy('SCORES_ONLY')}
                      disabled={rows.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      title={
                        scoreColumns.length > 1
                          ? 'Salin seluruh kolom nilai sekaligus dalam format tabel untuk ditempel langsung di Excel'
                          : 'Salin kolom angka nilai saja untuk langsung ditempel di Excel buku nilai'
                      }
                    >
                      {copiedFeedback === 'SCORES_ONLY' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Kolom Nilai Tersalin!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          {scoreColumns.length > 1 ? 'Salin Kolom Nilai Saja (Multi-Kolom)' : 'Salin Kolom Nilai Saja'}
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopy('NAME_AND_SCORE')}
                      disabled={rows.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copiedFeedback === 'NAME_AND_SCORE' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          Nama & Nilai Tersalin!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Salin Nama & Nilai
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowExcelPreviewModal(true)}
                      disabled={rows.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5 text-indigo-600" />
                      Pratinjau Excel
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadCSVFile(
                          rows,
                          unmatchedNewEntries.map((u) => ({
                            name: u.name,
                            score: u.score,
                            rawLine: u.rawLine,
                          })),
                          includeUnmatchedOnExport,
                          'Hasil_Urutan_Nilai_Absen_Lama.csv',
                          scoreColumns,
                          kkmThreshold
                        )
                      }
                      disabled={rows.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                      Unduh CSV
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadExcelFile(
                          rows,
                          unmatchedNewEntries.map((u) => ({
                            name: u.name,
                            score: u.score,
                            rawLine: u.rawLine,
                          })),
                          includeUnmatchedOnExport,
                          'Hasil_Urutan_Nilai_Absen_Lama.xls',
                          scoreColumns,
                          kkmThreshold
                        )
                      }
                      disabled={rows.length === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Unduh Excel (.xls)
                    </button>
                  </div>
                </div>

                {/* Filter and Mini Toolbar Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setActiveFilter('ALL')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'ALL'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Semua Siswa ({rows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter('NEEDS_ATTENTION')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'NEEDS_ATTENTION'
                          ? 'bg-white text-amber-800 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Perlu Diperiksa ({stats.pendingFuzzyCount + stats.duplicateConflictCount + stats.missingScoreCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter('REMEDIAL')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'REMEDIAL'
                          ? 'bg-white text-rose-800 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Remedial &lt; {kkmThreshold} ({gradeAnalytics.remedialCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter('MATCHED')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'MATCHED'
                          ? 'bg-white text-emerald-800 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Lengkap ({stats.matchedCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilter('MISSING')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeFilter === 'MISSING'
                          ? 'bg-white text-rose-800 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Nilai Kosong ({stats.missingScoreCount + stats.pendingFuzzyCount})
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Density Toggle */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs text-slate-600">
                      <button
                        type="button"
                        onClick={() => setTableDensity('comfortable')}
                        className={`px-2 py-1 rounded cursor-pointer ${
                          tableDensity === 'comfortable' ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                        }`}
                        title="Tampilan nyaman"
                      >
                        Nyaman
                      </button>
                      <button
                        type="button"
                        onClick={() => setTableDensity('compact')}
                        className={`px-2 py-1 rounded cursor-pointer ${
                          tableDensity === 'compact' ? 'bg-white font-semibold text-slate-900 shadow-2xs' : 'hover:text-slate-900'
                        }`}
                        title="Tampilan rapat (lebih banyak baris terlihat)"
                      >
                        Rapat
                      </button>
                    </div>

                    <div className="relative w-full sm:w-56">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari nama / absen..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Table with Excel Line-Numbers Gutter (#) */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-sans">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-semibold text-slate-600 select-none">
                      <th className="py-2 px-3 w-12 text-center border-r border-slate-200 bg-slate-200/50">#</th>
                      <th className="py-2 px-4 w-20 text-center border-r border-slate-200">No. Absen</th>
                      <th className="py-2 px-4 border-r border-slate-200">Nama Siswa (Patokan Absen Lama)</th>

                      {/* Kolom Nilai Dinamis */}
                      {scoreColumns.map((colName) => (
                        <th
                          key={colName}
                          className="py-2 px-3 w-28 text-right border-r border-slate-200 font-mono"
                        >
                          {colName}
                        </th>
                      ))}

                      {scoreColumns.length > 1 && (
                        <th className="py-2 px-3 w-28 text-right border-r border-slate-200 bg-indigo-50/50 text-indigo-900 font-bold font-mono">
                          Rata-rata
                        </th>
                      )}

                      <th className="py-2 px-3 w-28 text-center border-r border-slate-200">
                        Status KKM ({kkmThreshold})
                      </th>
                      <th className="py-2 px-4 border-r border-slate-200">Nama di Data Baru</th>
                      <th className="py-2 px-4">Status Pencocokan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredRows.map((row, idx) => {
                      const summary = calculateRowGradeSummary(row, scoreColumns);
                      const isNeedsConfirm =
                        row.status === 'FUZZY_PENDING' || row.status === 'DUPLICATE_CONFLICT';
                      const isRemedial = summary.average !== null && summary.average < kkmThreshold;
                      const pyClass = tableDensity === 'compact' ? 'py-1.5' : 'py-2.5';

                      return (
                        <tr
                          key={row.oldEntry.id}
                          className={`transition-colors group ${
                            isNeedsConfirm
                              ? 'bg-amber-50/60 hover:bg-amber-50'
                              : !summary.hasAnyScore
                              ? 'bg-rose-50/30 hover:bg-rose-50/60'
                              : isRemedial
                              ? 'bg-amber-50/20 hover:bg-amber-50/40'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Gutter Line Number (#) */}
                          <td className={`${pyClass} px-3 text-center font-mono tabular-nums text-xs text-slate-400 border-r border-slate-200 bg-slate-50/80 group-hover:bg-slate-100/60 select-none`}>
                            {idx + 1}
                          </td>

                          {/* No Absen Patokan */}
                          <td className={`${pyClass} px-4 text-center font-mono tabular-nums font-semibold text-slate-700 border-r border-slate-200`}>
                            {row.oldEntry.absenNo}
                          </td>

                          {/* Nama Siswa */}
                          <td className={`${pyClass} px-4 font-medium text-slate-900 border-r border-slate-200`}>
                            <div>{row.oldEntry.name}</div>
                            {row.oldEntry.isDuplicateInOld && (
                              <span className="text-[11px] text-amber-700 font-normal">
                                Catatan: Nama muncul lebih dari 1 kali di absen lama
                              </span>
                            )}
                          </td>

                          {/* Input Sel Tiap Kolom Nilai */}
                          {scoreColumns.map((colName) => {
                            const val = getEffectiveScoreForColumn(row, colName);
                            const hasVal = val.trim() !== '';
                            const numVal = parseFloat(val.replace(',', '.'));
                            const isBelowKkm = !isNaN(numVal) && numVal < kkmThreshold;

                            return (
                              <td
                                key={colName}
                                className={`${pyClass} px-2.5 text-right border-r border-slate-200`}
                              >
                                <input
                                  type="text"
                                  aria-label={`${colName} untuk ${row.oldEntry.name}`}
                                  value={val}
                                  onChange={(e) => {
                                    if (scoreColumns.length === 1) {
                                      handleManualScoreChange(row.oldEntry.id, e.target.value);
                                    } else {
                                      handleManualColumnScoreChange(row.oldEntry.id, colName, e.target.value);
                                    }
                                  }}
                                  placeholder="-"
                                  className={`w-20 text-right font-mono tabular-nums font-semibold px-2 py-1 rounded-md border text-xs transition-colors focus:outline-none ${
                                    isBelowKkm
                                      ? 'bg-rose-50/80 border-rose-300 text-rose-700 focus:border-rose-600'
                                      : hasVal
                                      ? 'bg-white border-slate-200 text-slate-900 focus:border-indigo-600'
                                      : 'bg-amber-50/50 border-amber-300 text-amber-900 placeholder:text-amber-500 focus:bg-white focus:border-indigo-600'
                                  }`}
                                />
                              </td>
                            );
                          })}

                          {/* Kolom Rata-rata (Jika Lebih dari 1 Kolom) */}
                          {scoreColumns.length > 1 && (
                            <td className={`${pyClass} px-3 text-right font-mono tabular-nums font-bold border-r border-slate-200 ${
                              isRemedial ? 'text-rose-600 bg-rose-50/30' : 'text-indigo-700 bg-indigo-50/20'
                            }`}>
                              {summary.average !== null ? summary.average : '-'}
                            </td>
                          )}

                          {/* Status Ketuntasan KKM */}
                          <td className={`${pyClass} px-3 text-center border-r border-slate-200`}>
                            {summary.average === null ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500">
                                Kosong
                              </span>
                            ) : isRemedial ? (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                Remedial
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Tuntas
                              </span>
                            )}
                          </td>

                          {/* Nama di Data Baru */}
                          <td className={`${pyClass} px-4 text-slate-600 text-xs border-r border-slate-200`}>
                            {row.matchedNewEntry ? (
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <span className="font-medium text-slate-800">
                                    {row.matchedNewEntry.name}
                                  </span>
                                  <span className="text-slate-400 ml-1.5 font-mono tabular-nums">
                                    (Baris #{row.matchedNewEntry.lineNumber})
                                  </span>
                                </div>
                                {row.status === 'CONFIRMED_MANUAL' && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnmatchPair(row.oldEntry.id)}
                                    className="text-[11px] text-slate-500 hover:text-rose-600 underline cursor-pointer"
                                  >
                                    Lepas
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Belum terpasang</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className={`${pyClass} px-4 text-xs`}>
                            {row.status === 'EXACT_MATCH' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                <Check className="w-3.5 h-3.5" /> Cocok Persis
                              </span>
                            ) : row.status === 'CONFIRMED_MANUAL' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-indigo-700">
                                <UserCheck className="w-3.5 h-3.5" /> Dikonfirmasi Guru
                              </span>
                            ) : row.status === 'FUZZY_PENDING' ? (
                              <button
                                type="button"
                                onClick={() => setCurrentStep(2)}
                                className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline cursor-pointer"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" /> Perlu Konfirmasi Nama
                              </button>
                            ) : row.status === 'DUPLICATE_CONFLICT' ? (
                              <button
                                type="button"
                                onClick={() => setCurrentStep(2)}
                                className="inline-flex items-center gap-1 font-semibold text-amber-800 hover:underline cursor-pointer"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" /> Konflik Nama Ganda
                              </button>
                            ) : (
                              <span className="text-slate-400 italic">Nilai belum ada</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PANDUAN INTEGRASI EXCEL                                                   */}
        {/* ========================================================================= */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">
              Alur Cepat untuk Guru (Salin & Tempel Langsung dari Spreadsheet)
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-600 leading-relaxed">
            <div className="space-y-1">
              <p className="font-bold text-slate-900">1. Salin Absen Resmi</p>
              <p>
                Blok kolom nama siswa pada Excel absen lama Anda, tekan <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-800">Ctrl+C</kbd>, lalu tempelkan di kotak Langkah 1.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-slate-900">2. Tempel Rekap Nilai Ujian</p>
              <p>
                Blok kolom Nama dan Nilai (bisa 1 atau banyak kolom seperti Tugas, UTS, UAS) dari Google Form/Quizizz/CBT, lalu tempelkan di kotak Data Terbaru.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-bold text-slate-900">3. Salin Kolom Nilai Kembali</p>
              <p>
                Buka Langkah 3, klik tombol <strong>Salin Kolom Nilai Saja</strong>, lalu klik sel pertama pada kolom nilai di Excel absen lama dan tekan <kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 text-slate-800">Ctrl+V</kbd>. Seluruh kolom nilai akan terisi otomatis secara serentak.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ========================================================================= */}
      {/* MODAL: LIVE EXCEL SPREADSHEET PREVIEW (WYSWYG)                            */}
      {/* ========================================================================= */}
      {showExcelPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-5xl rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Pratinjau Lembar Kerja Excel (Live Spreadsheet Preview)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tampilan persis seperti saat dibuka di Microsoft Excel (.xls) atau Google Sheets
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExcelPreviewModal(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Simulated Excel Sheet Grid */}
            <div className="p-4 overflow-auto flex-1 bg-slate-50">
              <div className="border border-slate-300 rounded overflow-hidden bg-white shadow-xs">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-200 text-slate-700 font-semibold text-center border-b border-slate-300 select-none">
                      <th className="w-12 py-1 px-2 border-r border-slate-300 bg-slate-300/60 font-mono">#</th>
                      <th className="w-16 py-1 px-2 border-r border-slate-300 font-mono">A</th>
                      <th className="py-1 px-3 border-r border-slate-300 text-left font-mono">B</th>
                      {scoreColumns.map((col, idx) => (
                        <th key={col} className="w-24 py-1 px-3 border-r border-slate-300 text-right font-mono">
                          {String.fromCharCode(67 + idx)}
                        </th>
                      ))}
                      {scoreColumns.length > 1 && (
                        <th className="w-24 py-1 px-3 border-r border-slate-300 text-right font-mono">
                          {String.fromCharCode(67 + scoreColumns.length)}
                        </th>
                      )}
                      <th className="py-1 px-3 border-r border-slate-300 text-center font-mono">
                        {String.fromCharCode(67 + scoreColumns.length + (scoreColumns.length > 1 ? 1 : 0))}
                      </th>
                      <th className="py-1 px-3 border-r border-slate-300 text-left font-mono">
                        {String.fromCharCode(68 + scoreColumns.length + (scoreColumns.length > 1 ? 1 : 0))}
                      </th>
                      <th className="py-1 px-3 text-left font-mono">
                        {String.fromCharCode(69 + scoreColumns.length + (scoreColumns.length > 1 ? 1 : 0))}
                      </th>
                    </tr>
                    <tr className="bg-slate-800 text-white font-bold border-b border-slate-400">
                      <td className="py-1.5 px-2 text-center border-r border-slate-400 bg-slate-700 font-mono">1</td>
                      <td className="py-1.5 px-2 text-center border-r border-slate-400 font-mono">No. Absen</td>
                      <td className="py-1.5 px-3 border-r border-slate-400">Nama Siswa (Absen Lama)</td>
                      {scoreColumns.map((col) => (
                        <td key={col} className="py-1.5 px-3 border-r border-slate-400 text-right font-mono">
                          {col}
                        </td>
                      ))}
                      {scoreColumns.length > 1 && (
                        <td className="py-1.5 px-3 border-r border-slate-400 text-right font-mono bg-slate-900">
                          Rata-rata
                        </td>
                      )}
                      <td className="py-1.5 px-3 border-r border-slate-400 text-center">Ketuntasan (KKM {kkmThreshold})</td>
                      <td className="py-1.5 px-3 border-r border-slate-400">Nama di Data Baru</td>
                      <td className="py-1.5 px-3">Keterangan</td>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const summary = calculateRowGradeSummary(row, scoreColumns);
                      const isRemedial = summary.average !== null && summary.average < kkmThreshold;
                      return (
                        <tr
                          key={row.oldEntry.id}
                          className={`border-b border-slate-200 ${
                            idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                          } ${!summary.hasAnyScore ? 'bg-amber-50/50' : isRemedial ? 'bg-rose-50/40' : ''}`}
                        >
                          <td className="py-1 px-2 text-center border-r border-slate-300 bg-slate-100 font-mono text-[11px] text-slate-500">
                            {idx + 2}
                          </td>
                          <td className="py-1 px-2 text-center border-r border-slate-200 font-mono tabular-nums">
                            {row.oldEntry.absenNo}
                          </td>
                          <td className="py-1 px-3 border-r border-slate-200 font-medium text-slate-900">
                            {row.oldEntry.name}
                          </td>

                          {scoreColumns.map((col) => {
                            const val = getEffectiveScoreForColumn(row, col);
                            return (
                              <td
                                key={col}
                                className="py-1 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-semibold text-slate-900"
                              >
                                {val || '-'}
                              </td>
                            );
                          })}

                          {scoreColumns.length > 1 && (
                            <td className={`py-1 px-3 border-r border-slate-200 text-right font-mono tabular-nums font-bold ${
                              isRemedial ? 'text-rose-600' : 'text-indigo-700'
                            }`}>
                              {summary.average !== null ? summary.average : '-'}
                            </td>
                          )}

                          <td className={`py-1 px-3 border-r border-slate-200 text-center font-semibold text-[11px] ${
                            summary.average === null
                              ? 'text-slate-400'
                              : isRemedial
                              ? 'text-rose-700 bg-rose-50/50'
                              : 'text-emerald-700 bg-emerald-50/50'
                          }`}>
                            {summary.average === null
                              ? 'Kosong'
                              : isRemedial
                              ? 'Remedial'
                              : 'Tuntas'}
                          </td>

                          <td className="py-1 px-3 border-r border-slate-200 text-slate-600">
                            {row.matchedNewEntry?.name || '-'}
                          </td>
                          <td className="py-1 px-3 text-slate-500 text-[11px]">
                            {row.status === 'EXACT_MATCH'
                              ? 'Cocok Persis'
                              : row.status === 'CONFIRMED_MANUAL'
                              ? 'Dikonfirmasi Guru'
                              : summary.hasAnyScore
                              ? 'Diisi Manual'
                              : 'Nilai Belum Ada'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Total {rows.length} baris dengan {scoreColumns.length} kolom nilai siap diekspor ke Microsoft Excel (.xls) atau CSV
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowExcelPreviewModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    downloadExcelFile(
                      rows,
                      unmatchedNewEntries.map((u) => ({
                        name: u.name,
                        score: u.score,
                        rawLine: u.rawLine,
                      })),
                      includeUnmatchedOnExport,
                      'Hasil_Urutan_Nilai_Absen_Lama.xls',
                      scoreColumns,
                      kkmThreshold
                    );
                    setShowExcelPreviewModal(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh Sekarang
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI KOSONGKAN DATA */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Kosongkan Semua Data & Mulai Kelas Baru?
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Tindakan ini akan menghapus teks daftar absen, data nilai ujian, penyesuaian pasangan manual, dan mengembalikan sistem ke Langkah 1.
              </p>
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>Pastikan Anda telah menyalin atau mengunduh hasil ekspor jika masih memerlukan data sesi ini.</span>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Ya, Kosongkan Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUIET FOOTER */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-xs text-slate-500">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="GradeSorter Logo" className="w-4 h-4 rounded object-contain" />
            <span className="font-semibold text-slate-700">GradeSorter</span>
            <span>— Aplikasi Penyusun Nilai Siswa Berdasarkan Urutan Absen Lama</span>
          </div>
          <span>Data diproses langsung di peramban Anda · 100% Mengikuti Urutan Absen Resmi</span>
        </div>
      </footer>

      {/* FLOATING TOAST: NOTIFIKASI BATAL AKSI (UNDO) */}
      {undoToastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-slate-900 text-white text-xs font-medium rounded-xl shadow-2xl border border-slate-700 animate-in slide-in-from-bottom-4 duration-200">
          <div className="w-6 h-6 rounded-full bg-indigo-500/25 text-indigo-400 flex items-center justify-center shrink-0">
            <Undo2 className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-indigo-200">Batal Aksi Berhasil</span>
            <span className="text-slate-300 text-[11px]">{undoToastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setUndoToastMessage(null)}
            className="ml-3 text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
            title="Tutup"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
