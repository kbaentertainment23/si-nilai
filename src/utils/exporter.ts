import {
  SortedResultRow,
  getEffectiveScoreForColumn,
  calculateRowGradeSummary,
} from './matcher';

export interface UnmatchedAppendItem {
  name: string;
  score: string;
  rawLine: string;
}

function getEffectiveScore(row: SortedResultRow): string {
  if (row.manualScoreOverride !== undefined) {
    return row.manualScoreOverride.trim();
  }
  return row.matchedNewEntry?.score.trim() ?? '';
}

function getStatusNote(row: SortedResultRow): string {
  const score = getEffectiveScore(row);
  if (row.status === 'EXACT_MATCH') {
    return score ? 'Cocok Persis' : 'Belum Ada Nilai';
  }
  if (row.status === 'CONFIRMED_MANUAL') {
    return row.matchedNewEntry
      ? `Dikonfirmasi dari "${row.matchedNewEntry.name}"`
      : 'Diisi Manual';
  }
  if (row.status === 'FUZZY_PENDING') {
    return score ? 'Diisi Manual' : 'Menunggu Konfirmasi Nama Mirip';
  }
  if (row.status === 'DUPLICATE_CONFLICT') {
    return 'Konflik Nama Ganda (Belum Dipilih)';
  }
  return score ? 'Diisi Manual' : 'Nama Tidak Ditemukan di Data Baru';
}

function getPassingStatus(
  row: SortedResultRow,
  columns: string[],
  kkmThreshold = 75
): string {
  const summary = calculateRowGradeSummary(row, columns);
  if (summary.average === null) return 'Belum Lengkap';
  return summary.average >= kkmThreshold ? `Tuntas (≥${kkmThreshold})` : `Remedial (<${kkmThreshold})`;
}

/**
 * Menghasilkan teks Tab-Separated Values (TSV) yang siap ditempel langsung ke kolom Excel / Google Sheets.
 * Mendukung multi-kolom nilai secara simultan.
 */
export function generateClipboardTSV(
  rows: SortedResultRow[],
  mode: 'SCORES_ONLY' | 'NAME_AND_SCORE' | 'FULL_TABLE',
  unmatchedNew: UnmatchedAppendItem[] = [],
  includeUnmatched = false,
  scoreColumns: string[] = ['Nilai'],
  kkmThreshold = 75
): string {
  const lines: string[] = [];
  const cols = scoreColumns.length > 0 ? scoreColumns : ['Nilai'];

  if (mode === 'SCORES_ONLY') {
    for (const r of rows) {
      if (cols.length === 1) {
        lines.push(getEffectiveScoreForColumn(r, cols[0]));
      } else {
        const rowVals = cols.map((col) => getEffectiveScoreForColumn(r, col));
        lines.push(rowVals.join('\t'));
      }
    }
    return lines.join('\n');
  }

  if (mode === 'NAME_AND_SCORE') {
    for (const r of rows) {
      if (cols.length === 1) {
        lines.push(`${r.oldEntry.name}\t${getEffectiveScoreForColumn(r, cols[0])}`);
      } else {
        const rowVals = cols.map((col) => getEffectiveScoreForColumn(r, col));
        const summary = calculateRowGradeSummary(r, cols);
        lines.push(`${r.oldEntry.name}\t${rowVals.join('\t')}\t${summary.average ?? ''}`);
      }
    }
    if (includeUnmatched && unmatchedNew.length > 0) {
      lines.push('');
      lines.push('--- DATA TAMBAHAN (TIDAK ADA DI ABSEN LAMA) ---\t');
      for (const u of unmatchedNew) {
        lines.push(`${u.name}\t${u.score}`);
      }
    }
    return lines.join('\n');
  }

  // FULL_TABLE
  const tableHeaders = [
    'No. Absen Lama',
    'Nama Siswa (Acuan Lama)',
    ...cols,
    ...(cols.length > 1 ? ['Rata-rata'] : []),
    `Status KKM (${kkmThreshold})`,
    'Nama di Data Baru',
    'Keterangan',
  ];
  lines.push(tableHeaders.join('\t'));

  for (const r of rows) {
    const colVals = cols.map((c) => getEffectiveScoreForColumn(r, c));
    const summary = calculateRowGradeSummary(r, cols);
    const passStatus = getPassingStatus(r, cols, kkmThreshold);

    const rowData = [
      r.oldEntry.absenNo.toString(),
      r.oldEntry.name,
      ...colVals,
      ...(cols.length > 1 ? [summary.average !== null ? summary.average.toString() : '-'] : []),
      passStatus,
      r.matchedNewEntry?.name || '-',
      getStatusNote(r),
    ];
    lines.push(rowData.join('\t'));
  }

  if (includeUnmatched && unmatchedNew.length > 0) {
    lines.push('');
    lines.push(['-', '--- DATA TIDAK TERDAFTAR DI ABSEN LAMA ---', ...cols.map(() => '-'), '-', '-'].join('\t'));
    for (const u of unmatchedNew) {
      lines.push(['-', u.name, u.score, ...cols.slice(1).map(() => '-'), '-', u.name, 'Tidak ada di daftar absen lama'].join('\t'));
    }
  }

  return lines.join('\n');
}

/**
 * Mengunduh hasil pengurutan sebagai file CSV (UTF-8 dengan BOM agar langsung terbaca rapi di Microsoft Excel).
 */
export function downloadCSVFile(
  rows: SortedResultRow[],
  unmatchedNew: UnmatchedAppendItem[],
  includeUnmatched: boolean,
  filename = 'Hasil_Urutan_Nilai_Absen_Lama.csv',
  scoreColumns: string[] = ['Nilai'],
  kkmThreshold = 75
): void {
  const escapeCSV = (val: string) => {
    const clean = val.replace(/"/g, '""');
    if (clean.includes(',') || clean.includes(';') || clean.includes('"') || clean.includes('\n')) {
      return `"${clean}"`;
    }
    return clean;
  };

  const cols = scoreColumns.length > 0 ? scoreColumns : ['Nilai'];
  const csvLines: string[] = [];
  const headerCols = [
    'No Absen Lama',
    'Nama Siswa (Daftar Lama)',
    ...cols,
    ...(cols.length > 1 ? ['Rata-rata'] : []),
    `Status KKM (${kkmThreshold})`,
    'Nama pada Data Baru',
    'Status Pencocokan',
  ];
  csvLines.push(headerCols.map(escapeCSV).join(','));

  for (const r of rows) {
    const colVals = cols.map((c) => getEffectiveScoreForColumn(r, c));
    const summary = calculateRowGradeSummary(r, cols);
    const passStatus = getPassingStatus(r, cols, kkmThreshold);

    const rowData = [
      String(r.oldEntry.absenNo),
      r.oldEntry.name,
      ...colVals,
      ...(cols.length > 1 ? [summary.average !== null ? String(summary.average) : ''] : []),
      passStatus,
      r.matchedNewEntry?.name || '',
      getStatusNote(r),
    ];
    csvLines.push(rowData.map(escapeCSV).join(','));
  }

  if (includeUnmatched && unmatchedNew.length > 0) {
    csvLines.push('');
    csvLines.push(
      ['', 'DATA TIDAK DITEMUKAN DI DAFTAR ABSEN LAMA', ...cols.map(() => ''), '', '', ''].map(escapeCSV).join(',')
    );
    for (const u of unmatchedNew) {
      csvLines.push(
        ['-', u.name, u.score, ...cols.slice(1).map(() => ''), '', '-', u.name, 'Tidak ada di daftar absen lama'].map(escapeCSV).join(',')
      );
    }
  }

  const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Mengunduh hasil pengurutan sebagai file Microsoft Excel (.xls berbasis HTML Table Spreadsheet)
 * dengan dukungan multi-kolom dan pewarnaan otomatis KKM.
 */
export function downloadExcelFile(
  rows: SortedResultRow[],
  unmatchedNew: UnmatchedAppendItem[],
  includeUnmatched: boolean,
  filename = 'Hasil_Urutan_Nilai_Absen_Lama.xls',
  scoreColumns: string[] = ['Nilai'],
  kkmThreshold = 75
): void {
  const escapeHTML = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const cols = scoreColumns.length > 0 ? scoreColumns : ['Nilai'];
  let tableRowsHTML = '';

  for (const r of rows) {
    const summary = calculateRowGradeSummary(r, cols);
    const status = getStatusNote(r);
    const passStatus = getPassingStatus(r, cols, kkmThreshold);

    const isRemedial = summary.average !== null && summary.average < kkmThreshold;
    const isMissing = !summary.hasAnyScore;

    const bgStyle = isMissing
      ? 'background-color: #FEF3C7;'
      : isRemedial
      ? 'background-color: #FFF1F2;'
      : r.status === 'FUZZY_PENDING' || r.status === 'DUPLICATE_CONFLICT'
      ? 'background-color: #FFEDD5;'
      : '';

    let colTds = '';
    for (const c of cols) {
      const val = getEffectiveScoreForColumn(r, c);
      const isNum = /^-?\d+([.,]\d+)?$/.test(val);
      const numVal = isNum ? parseFloat(val.replace(',', '.')) : NaN;
      const numColor = !isNaN(numVal) && numVal < kkmThreshold ? 'color: #E11D48; font-weight: 700;' : 'color: #0F172A;';

      colTds += `
        <td style="text-align: right; border: 1px solid #CBD5E1; padding: 6px; ${numColor}" ${
          isNum ? `x:num="${val.replace(',', '.')}"` : ''
        }>${escapeHTML(val || '-')}</td>
      `;
    }

    let avgTd = '';
    if (cols.length > 1) {
      const avgStr = summary.average !== null ? summary.average.toString() : '-';
      const avgColor = summary.average !== null && summary.average < kkmThreshold ? 'color: #E11D48;' : 'color: #4338CA;';
      avgTd = `
        <td style="text-align: right; border: 1px solid #CBD5E1; padding: 6px; font-weight: 700; ${avgColor}" ${
          summary.average !== null ? `x:num="${summary.average}"` : ''
        }>${escapeHTML(avgStr)}</td>
      `;
    }

    tableRowsHTML += `
      <tr style="${bgStyle}">
        <td style="text-align: center; border: 1px solid #CBD5E1; padding: 6px;">${r.oldEntry.absenNo}</td>
        <td style="border: 1px solid #CBD5E1; padding: 6px; font-weight: 500;">${escapeHTML(r.oldEntry.name)}</td>
        ${colTds}
        ${avgTd}
        <td style="border: 1px solid #CBD5E1; padding: 6px; text-align: center; font-weight: 600; color: ${
          isRemedial ? '#BE123C' : '#047857'
        };">${escapeHTML(passStatus)}</td>
        <td style="border: 1px solid #CBD5E1; padding: 6px; color: #475569;">${escapeHTML(
          r.matchedNewEntry?.name || '-'
        )}</td>
        <td style="border: 1px solid #CBD5E1; padding: 6px; color: #475569;">${escapeHTML(status)}</td>
      </tr>
    `;
  }

  const totalColCount = 2 + cols.length + (cols.length > 1 ? 1 : 0) + 3;

  if (includeUnmatched && unmatchedNew.length > 0) {
    tableRowsHTML += `
      <tr><td colspan="${totalColCount}" style="padding: 8px;"></td></tr>
      <tr style="background-color: #F1F5F9; font-weight: bold;">
        <td colspan="${totalColCount}" style="border: 1px solid #CBD5E1; padding: 6px;">
          Data pada Input Terbaru yang Tidak Terdapat di Daftar Absen Lama (Tidak Dihapus)
        </td>
      </tr>
    `;
    for (const u of unmatchedNew) {
      tableRowsHTML += `
        <tr style="background-color: #FFFBEB;">
          <td style="text-align: center; border: 1px solid #CBD5E1; padding: 6px;">-</td>
          <td style="border: 1px solid #CBD5E1; padding: 6px; font-weight: 500;">${escapeHTML(u.name)}</td>
          <td style="text-align: right; border: 1px solid #CBD5E1; padding: 6px;">${escapeHTML(u.score)}</td>
          ${cols.slice(1).map(() => '<td style="border: 1px solid #CBD5E1; padding: 6px; text-align: center;">-</td>').join('')}
          ${cols.length > 1 ? '<td style="border: 1px solid #CBD5E1; padding: 6px; text-align: center;">-</td>' : ''}
          <td style="border: 1px solid #CBD5E1; padding: 6px; text-align: center;">-</td>
          <td style="border: 1px solid #CBD5E1; padding: 6px;">${escapeHTML(u.name)}</td>
          <td style="border: 1px solid #CBD5E1; padding: 6px; color: #B45309;">Nama tidak ditemukan di absen lama</td>
        </tr>
      `;
    }
  }

  const thCols = cols
    .map((c) => `<th style="border: 1px solid #334155; padding: 8px; width: 95px; text-align: right;">${escapeHTML(c)}</th>`)
    .join('');

  const excelHTML = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Urutan Absen Lama</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
      </head>
      <body style="font-family: Calibri, Arial, sans-serif; font-size: 11pt;">
        <table style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr style="background-color: #1E293B; color: #FFFFFF; font-weight: bold;">
              <th style="border: 1px solid #334155; padding: 8px; width: 70px; text-align: center;">No. Absen</th>
              <th style="border: 1px solid #334155; padding: 8px; width: 260px; text-align: left;">Nama Siswa (Urutan Absen Lama)</th>
              ${thCols}
              ${cols.length > 1 ? '<th style="border: 1px solid #334155; padding: 8px; width: 100px; text-align: right;">Rata-rata</th>' : ''}
              <th style="border: 1px solid #334155; padding: 8px; width: 130px; text-align: center;">Ketuntasan (KKM ${kkmThreshold})</th>
              <th style="border: 1px solid #334155; padding: 8px; width: 220px; text-align: left;">Nama pada Data Terbaru</th>
              <th style="border: 1px solid #334155; padding: 8px; width: 220px; text-align: left;">Keterangan Pencocokan</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHTML}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF' + excelHTML], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
