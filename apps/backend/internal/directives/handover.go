package directives

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// R5H1 — penyerahan surat yang menyertai arahan.
//
// Sebelum ini, "Kabagrenmin meneruskan surat" adalah formulir tersendiri
// (Distribusi ke Unit / Petugas) yang dilepas dari layar pada R5G. Sejak R5H1
// pekerjaan itu melekat pada pengiriman arahan: menunjuk bagian ATAS SEBUAH
// SURAT berarti sekaligus menyerahkan suratnya ke bagian itu.
//
// Seluruh fungsi di berkas ini berjalan di dalam transaksi kirim arahan. Tidak
// ada keadaan setengah jadi: arahan terkirim tanpa suratnya, atau surat
// berpindah tanpa arahannya, keduanya mustahil.

// Syarat penerima distribusi, disalin dari urmin.recipientEligible (r3b.go:69).
//
// Sengaja DIULANG di sini alih-alih memanggil paket urmin: directives tidak
// mengimpor urmin sama sekali, dan membuka jalur impor itu demi satu query akan
// menukar satu duplikasi SQL dengan satu simpul ketergantungan antar-modul yang
// jauh lebih mahal dicabut. Kalau syaratnya berubah, DUA tempat yang harus
// diubah -- itu konsekuensi yang diterima sadar, bukan yang terlewat.
//
// Baris terakhir yang paling penting: surat 'penting' (berlabel Rahasia di
// layar) hanya boleh mendarat pada grant ber-classification_limit 'penting'.
const distributionEligibleSQL = `SELECT EXISTS(
 SELECT 1 FROM sdl_users u
  JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
  JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.scope IN ('unit','assigned')
  JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
  JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
  JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active
 WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
   AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
   AND ($3='biasa' OR g.classification_limit='penting'))`

// ON CONFLICT ... DO NOTHING mengacu ke sdl_urmin_delivery_one_pending_idx
// (010), indeks unik PARSIAL -- karena itu klausa WHERE-nya wajib ditulis ulang
// persis, kalau tidak Postgres tidak menemukan arbiter-nya dan melempar error
// alih-alih melewati baris.
//
// Yang dicegah: satu surat menumpuk sebagai dua item inbox yang sama-sama belum
// diterima pada orang yang sama. Kalau kiriman sebelumnya SUDAH diterima,
// indeksnya tidak berlaku dan baris baru tetap masuk -- itu disengaja, karena
// arahan kedua atas surat yang sama memang peristiwa baru yang perlu jejaknya
// sendiri.
const handOverInsertSQL = `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason)
 VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5)
 ON CONFLICT (incoming_id,recipient_user) WHERE status='sent' DO NOTHING
 RETURNING id::text`

// Memenuhi CHECK length(btrim(reason)) BETWEEN 8 AND 500 pada
// sdl_urmin_distributions: judul arahan paling pendek 3 karakter dan awalannya
// sendiri sudah 20, jadi batas bawahnya tidak mungkin dilanggar. Batas atas
// aman karena judul dibatasi 160 karakter saat validasi.
func handOverReason(title string) string {
	return "Arahan Kabagrenmin: " + title
}

func (a *API) handOverLetter(w http.ResponseWriter, r *http.Request, tx pgx.Tx, incoming, actor, title string, targets []resolved) bool {
	// Klasifikasi dibaca dari surat, bukan dari payload. Klien tidak pernah
	// boleh ikut menentukan seberapa rahasia sebuah surat dianggap.
	var classification string
	err := tx.QueryRow(r.Context(), `SELECT classification FROM sdl_urmin_incoming WHERE id=$1::uuid`, incoming).Scan(&classification)
	if errors.Is(err, pgx.ErrNoRows) {
		// letterLinkAllowed sudah lolos sebelum ini, jadi barisnya pasti ada;
		// kalau tidak, yang rusak adalah asumsinya, bukan payload pengirim.
		deny(w, 503)
		return false
	}
	if err != nil {
		deny(w, 503)
		return false
	}
	for _, t := range targets {
		var eligible bool
		if err = tx.QueryRow(r.Context(), distributionEligibleSQL, t.UserID, t.Unit, classification).Scan(&eligible); err != nil {
			deny(w, 503)
			return false
		}
		// R5H4: anggota yang tidak berwenang atas surat ini DILEWATI, bukan
		// membatalkan pengiriman. Sejak arahan bisa ditujukan ke seluruh bagian
		// atau Paur, hampir setiap pilihan memuat staf ber-classification_limit
		// 'biasa' dan staf Urmin ber-scope 'own'; aturan R5H1 yang menolak
		// seluruh payload akan membuat surat Rahasia tidak pernah bisa
		// diarahkan ke bagian mana pun. Keputusan pemilik sistem (2026-11-04):
		// arahan sampai ke semua anggota, naskah suratnya hanya ke yang berhak.
		// Pemeriksaan akses surat di modul Urmin tidak berubah sama sekali.
		if !eligible {
			continue
		}
		var distID string
		err = tx.QueryRow(r.Context(), handOverInsertSQL, incoming, actor, t.Unit, t.UserID, handOverReason(title)).Scan(&distID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Sudah ada kiriman yang belum diterima untuk surat dan orang ini.
			// Dibiarkan apa adanya: ia sudah memegang akses yang sama, dan
			// peristiwa 'sent'-nya sudah tercatat pada baris yang lebih dulu.
			continue
		}
		if err != nil {
			deny(w, 503)
			return false
		}
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason) VALUES($1::uuid,$2::uuid,'sent',$3)`,
			distID, actor, "Penunjukan bagian lewat arahan pimpinan"); err != nil {
			deny(w, 503)
			return false
		}
		// event_key yang sama dengan jalur distribusi mana pun, supaya laporan
		// audit yang sudah ada ikut melihat penyerahan lewat arahan tanpa
		// perlu tahu bahwa R5H1 pernah terjadi.
		if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1::uuid,'urmin.distribution.sent','urmin.surat_masuk',$2,jsonb_build_object('section',$3::text,'via','arahan'))`,
			actor, distID, t.Section); err != nil {
			deny(w, 503)
			return false
		}
	}
	return true
}
