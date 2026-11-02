package auth

// Shim uji silang untuk paritas template email notifikasi.
//
// `buildNotificationEmail` tidak diekspor, padahal isinya PERSIS yang diterima
// pengguna. Tanpa shim ini tidak ada cara memanggilnya dari luar paket, dan
// satu-satunya alternatif adalah menyalin ulang logikanya di sisi penguji —
// yang berarti menguji salinan, bukan aslinya.
//
// Berkas ini TIDAK ada di repositori backend. Ia hanya disalin ke dalam
// container golang di atas SALINAN source, persis seperti crosscheck.go.
// `apps/backend` tidak pernah ditambahi berkas.
func ExportNotificationEmail(from, to, subject, body string) (string, error) {
	return buildNotificationEmail(from, to, subject, body)
}
