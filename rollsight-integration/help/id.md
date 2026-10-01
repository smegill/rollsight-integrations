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

## Adegan pertempuran OBS opsional

Di Pengaturan Game → RollSight, pilih **Atur adegan OBS per giliran**. Pilih pengguna Foundry yang masuk ke Browser Source OBS Utils `/stream`. Petakan aktor ke nama adegan OBS yang sudah ada dengan ejaan persis, lalu jika perlu pilih adegan untuk giliran NPC yang belum dipetakan dan akhir pertempuran. Giliran pemain yang belum dipetakan akan membiarkan adegan tetap seperti semula. Simpan, lalu aktifkan **Ganti adegan OBS setiap giliran pertempuran**. Gunakan **Jeda pergantian adegan OBS otomatis** untuk mengambil alih secara manual; simpan untuk melanjutkan dari giliran saat ini.

Fitur ini menggunakan koneksi OBS Utils yang sudah ada atau izin kontrol adegan Browser Source OBS. Anda tidak memerlukan kata sandi OBS kedua atau pembaruan aplikasi desktop. Gunakan satu sumber pengendali dan URL Foundry yang aman (HTTPS atau localhost). Biarkan sumber tersebut tetap dimuat saat mengganti adegan OBS agar dapat terus menerima giliran. Jika OBS Utils tidak menyediakan API yang diperlukan, perbarui sebelum mengaktifkan fitur ini. Jika adegan tidak ditemukan atau koneksi OBS terputus, adegan saat ini tetap digunakan; periksa ejaan nama adegan dan koneksi OBS Utils. Uji di koleksi adegan Anda sebelum siaran langsung.
