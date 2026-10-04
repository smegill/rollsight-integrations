# Dadu fisik RollSight

Di Foundry, buka pengaturan RollSight dan salin kode pemain Anda. Di Pengaturan Game → Inti → Dadu, pilih dadu fisik RollSight sebagai metode bawaan lalu simpan. Periksa pengaturan khusus tiap jenis dadu. Mulai lemparan di Foundry dan tunggu petunjuk RollSight sebelum melempar dadu fisik.

## Hubungkan dunia ini (GM)

GM harus menghubungkan dunia ini sebelum Anda dapat menyegarkan kode pemain.

Salin kode pribadi ini ke aplikasi desktop. Pilih RollSight atau Manual di konfigurasi dadu Foundry, lalu mulai lemparan di Foundry.

Mulai lemparan di Foundry, lalu kirim dadu fisik dari aplikasi desktop. Permintaan lemparan desktop jarak jauh tidak didukung.

## Terima dadu untuk lemparan manual

Isi juga permintaan manual bawaan. Foundry mempertahankan kontrol normal dan menghitung pengubah.

Permintaan lemparan baru menerima dadu secara otomatis. Jika beberapa permintaan terbuka, yang terbaru menerima lebih dahulu; permintaan sebelumnya dilanjutkan saat permintaan terbaru ditutup.

## Terima dadu RollSight

Nonaktifkan untuk meninggalkan sesi ini. Lemparan tertunda tetap tersedia di Foundry untuk diselesaikan secara manual.

## Gunakan ekstensi browser

Terima hasil desktop lokal melalui ekstensi RollSight. Penerimaan cloud dinonaktifkan dalam mode ini.

Browser ini tidak dapat mengoordinasikan tab. Gunakan hanya satu tab Foundry per pemain RollSight.

## Kirim dadu saat tidak ada lemparan tertunda

Kirim dadu fisik biasa dengan visibilitas obrolan saat ini. Mulai inisiatif, serangan, dan keuntungan di Foundry terlebih dahulu.

## Tayangan ulang RollSight

Buka tayangan ulang; pilih gambar untuk melihat ukuran penuh.

## Segarkan koneksi

RollSight tidak dapat terhubung. Periksa tautan dunia dan segarkan kode pemain di pengaturan modul.

Tab lain sedang menerima dadu RollSight untuk pemain ini. Tutup tab itu, lalu segarkan koneksi ini.

Dadu tidak diterima. Kirim bilangan bulat dalam rentang setiap dadu.

RollSight tidak dapat menerapkan kiriman ini. Periksa lemparan tertunda sebelum mengirim ulang.

## Adegan OBS otomatis pada giliran pertempuran

Gunakan modul RollSight Foundry 1.1.91 atau lebih baru dan aktifkan OBS Utils di dunia yang sama. Kontrol ini terpisah dari overlay replay.

Di OBS, buat sumber browser Foundry dengan alamat server dari GM: /game untuk tampilan permainan dan /stream untuk pengguna Stream. Masuk ke sumber /stream sebagai pengguna yang akan dipilih sebagai operator OBS.

Untuk setiap sumber browser Foundry, buka Properti dan atur izin halaman ke akses lanjutan atau penuh. Izin /game dan /stream terpisah. Segarkan setiap sumber setelah mengubahnya. Tautan khusus replay tidak memerlukan izin kontrol adegan.

Biarkan pengontrol /stream tetap dimuat saat berganti adegan. Matikan opsi menutup sumber saat tidak terlihat dan gunakan kembali sumber yang sama di semua adegan. Koneksi sumber browser ini tidak memerlukan WebSocket atau akses API OBS Utils.

Sebagai GM, buka Pengaturan Game → RollSight → Konfigurasi adegan OBS per giliran. Pilih pengguna Stream sebagai operator OBS, lalu segarkan adegan OBS. Pilih setiap aktor dan adegan OBS dari daftar. Jika perlu, pilih adegan untuk giliran NPC tanpa pemetaan dan akhir pertempuran.

Simpan adegan OBS, aktifkan pergantian adegan OBS pada giliran pertempuran, dan jangan centang jeda pergantian otomatis. Giliran pemain tanpa pemetaan mempertahankan adegan saat ini.

Pemetaan, operator, serta pengaturan aktif dan jeda disimpan di dunia Foundry ini. Stream boleh terhubung setelah server dimulai. Setelah terhubung, giliran saat ini diperiksa. Sumber harus tetap terhubung selama pergantian otomatis diperlukan.

Sebelum siaran, majukan giliran pertempuran uji dan periksa adegannya, lalu uji jeda dan lanjutkan. Jika adegan tidak muncul, periksa izin /stream, segarkan cache browser sumber dan daftar adegan. Setelah mengganti nama adegan OBS, pilih nama baru lalu simpan kembali.

Chat /stream Foundry menyembunyikan kontrol dan animasi replay RollSight, apa pun preferensi buka otomatis yang tersimpan. Hasil lemparan tetap terlihat. URL overlay replay OBS terpisah tetap menampilkan replay, dan pemain Foundry biasa mempertahankan preferensinya.
