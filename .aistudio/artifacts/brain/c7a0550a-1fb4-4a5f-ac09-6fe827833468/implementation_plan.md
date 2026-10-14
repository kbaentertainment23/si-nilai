# Rencana Implementasi: Peningkatan Multi-Kolom Nilai, Analisis Visual & Manajemen Remedial

Berdasarkan preferensi yang Anda pilih, sistem **GradeSorter** akan ditingkatkan untuk mendukung pengurutan **banyak kolom nilai sekaligus** (seperti Tugas, UTS, dan UAS) serta dilengkapi dengan **visualisasi distribusi nilai**, **ambang batas KKM interaktif**, dan **daftar ringkas siswa remedial**.

---

## 1. Ringkasan Fitur yang Akan Dibangun

### A. Dukungan Banyak Kolom Nilai Sekaligus (Multi-Column Scores)
* **Deteksi Baris Judul & Kolom Dinamis:**
  * Pengguna dapat menempel data dengan format `Nama [Tab] Tugas [Tab] UTS [Tab] UAS` atau `Nama [Tab] 85 [Tab] 90 [Tab] 78`.
  * Sistem otomatis mendeteksi baris pertama sebagai label kolom jika berupa teks bukan angka (misal: "Tugas", "UTS", "UAS"). Jika tidak ada baris judul, kolom otomatis diberi label `Nilai 1`, `Nilai 2`, dst.
* **Pencocokan Nilai Terpadu:**
  * Setiap siswa yang dicocokkan akan membawa seluruh komponen nilainya secara utuh sesuai urutan absen lama.
  * Tetap mendukung pengisian/koreksi manual per kolom nilai jika ada siswa yang belum mengumpulkan salah satu tugas.

### B. Grafik Visual Distribusi Nilai & Pengaturan KKM Dinamis
* **Grafik Sebaran Nilai (Interactive Histogram):**
  * Visualisasi grafik batang bersih bertema Slate/Indigo yang membagi nilai siswa ke dalam rentang:
    * `< 60` (Sangat Kurang)
    * `60 - 74` (Perlu Remedial / Di bawah KKM)
    * `75 - 84` (Tuntas / Baik)
    * `85 - 100` (Sangat Baik)
* **Pengaturan KKM Fleksibel:**
  * Guru dapat menyesuaikan ambang batas KKM standar (misal: default 75, dapat diubah ke 70 atau 80).
  * Persentase kelulusan/ketuntasan dan status remedial terhitung ulang secara *real-time*.

### C. Daftar Ringkas Siswa Remedial
* **Tab & Filter Khusus Remedial:**
  * Filter cepat di Langkah 3 untuk langsung melihat siapa saja siswa yang nilainya di bawah KKM beserta rincian nilai yang kurang.
* **1-Klik Salin Pengumuman Remedial:**
  * Tombol untuk menyalin daftar siswa remedial ke clipboard dalam format teks rapi yang siap dikirimkan ke grup WhatsApp kelas atau wali murid.

### D. Pembaruan Ekspor & Pratinjau Interaktif
* **Salin Cepat Multi-Kolom:**
  * Opsi "Salin Nilai Saja" kini menyalin seluruh kolom nilai sekaligus dalam format TSV matriks, sehingga guru cukup klik satu sel di Excel absen lama dan tekan `Ctrl+V` untuk mengisi semua kolom nilai secara serentak.
* **Ekspor Excel (.xls) & CSV Multi-Kolom:**
  * File Excel hasil unduhan memiliki header kolom lengkap (No Absen, Nama Resmi, Tugas, UTS, UAS, Nilai Rata-rata, Status Ketuntasan).
* **Modal Pratinjau Excel Interaktif:**
  * Tampilan tabel spreadsheet pratinjau menyesuaikan secara otomatis dengan semua kolom nilai yang ada.

---

## 2. Rincian Modifikasi Kode

1. **`src/utils/matcher.ts`**:
   * Memperluas interface `NewScoreEntry` agar mendukung `scores: Record<string, string>` dan `scoreColumns: string[]`.
   * Memperbarui parser `parseNewScoreData` untuk mengenali multi-kolom dan memisahkan baris header judul jika tersedia.
   * Menyesuaikan fungsi pencocokan agar tetap kompatibel 100% jika pengguna hanya memasukkan 1 kolom nilai biasa.
2. **`src/utils/exporter.ts`**:
   * Memperbarui `generateClipboardTSV`, `downloadCSVFile`, dan `downloadExcelFile` untuk menghasilkan tabel multi-kolom dengan kolom rata-rata dan status kelulusan KKM.
3. **`src/App.tsx`**:
   * Menambahkan state konfigurasi KKM (`kkmThreshold`, default 75).
   * Menambahkan komponen visual grafik batang distribusi nilai (`GradeDistributionChart`).
   * Menambahkan kartu dan modal/drawer daftar siswa remedial dengan tombol *Copy WA Summary*.
   * Memperbarui tabel Langkah 2 (Verifikasi) dan Langkah 3 (Hasil) agar merender header dan kolom nilai dinamis.
   * Memperbarui modal Pratinjau Excel Interaktif.

---

## 3. Rencana Pengujian & Verifikasi

1. **Uji Kompatibilitas Balik (1 Kolom):** Memastikan format input 1 kolom lama (`Nama [Tab] Nilai`) tetap bekerja normal tanpa kendala.
2. **Uji Multi-Kolom (2 - 5 Kolom Nilai):** Menempelkan dataset dengan format `Nama \t Tugas 1 \t Tugas 2 \t UTS \t UAS` dan memastikan seluruh nilai terpasang pada baris siswa yang benar.
3. **Uji Ambang KKM Dinamis:** Menggeser KKM dari 75 ke 70 dan memastikan grafik, persentase tuntas, serta daftar remedial berubah secara instan.
4. **Uji Salin Cepat & Ekspor Excel:** Memverifikasi file hasil unduhan memiliki seluruh kolom nilai dengan rumus/angka yang presisi.
5. **Kompilasi & Linting:** Menjalankan `compile_applet` dan `lint_applet` untuk memastikan tidak ada kesalahan TypeScript.
