package httpapi

// R5F8: executive aggregate view. No raw records, attachments, person names,
// sensitive fields, document titles, or individual financial evidence leave this API.

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"siera-delta-lima/backend/internal/auth"

	"github.com/jackc/pgx/v5/pgxpool"
)

type executiveMetric struct {
	Label  string `json:"label"`
	Value  *int64 `json:"value"`
	Unit   string `json:"unit,omitempty"`
	Detail string `json:"detail,omitempty"`
}
type executiveSlice struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value int64  `json:"value"`
}
type executiveUnit struct {
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Ready      bool              `json:"ready"`
	Metrics    []executiveMetric `json:"metrics"`
	Breakdown  []executiveSlice  `json:"breakdown"`
	Placements []executiveSlice  `json:"placements,omitempty"`
	Note       string            `json:"note,omitempty"`
}
type executivePoint struct {
	Month      string `json:"month"`
	SuratMasuk int64  `json:"suratMasuk"`
}

func execValue(v int64) *int64 { return &v }
func em(label string, n int64, detail string) executiveMetric {
	return executiveMetric{Label: label, Value: execValue(n), Detail: detail}
}
func emCurrency(label string, n int64) executiveMetric {
	return executiveMetric{Label: label, Value: execValue(n), Unit: "IDR"}
}
func unavailableExecutive(id, title string) executiveUnit {
	return executiveUnit{ID: id, Title: title, Ready: false, Metrics: []executiveMetric{}, Breakdown: []executiveSlice{}, Note: "Ringkasan belum tersedia. Periksa koneksi sumber data."}
}

// Deny by default; this check is shared by the portal capability probe
// and the summary endpoint, never inferred from a frontend role string.
func executiveAuthorized(db *pgxpool.Pool, a *auth.Service, r *http.Request) (bool, error) {
	adminID, adminStatus := a.AuthorizeRoleEditor(r)
	operationalID, operationalStatus := a.AuthorizeOperational(r)
	var userID string
	if adminStatus == http.StatusOK {
		userID = adminID
	} else if operationalStatus == http.StatusOK {
		userID = operationalID
	}
	if userID == "" {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	var authorized bool
	err := db.QueryRow(ctx, `SELECT EXISTS(
    SELECT 1 FROM sdl_users u WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
    AND (
      ($2::boolean AND EXISTS(SELECT 1 FROM sdl_user_roles sur JOIN sdl_roles ro ON ro.role_key=sur.role_key AND ro.is_active WHERE sur.user_id=u.id AND sur.role_key='superadmin'))
      OR
      ($3::boolean AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sur WHERE sur.user_id=u.id AND sur.role_key='superadmin')
       AND EXISTS(SELECT 1 FROM sdl_access_grants g
          JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
          JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='dashboard.cross_unit.read'
          JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
          WHERE g.user_id=u.id AND g.role_key='br_kabagrenmin' AND g.unit_key='urmin'
           AND g.scope='unit' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
       ))
    )
  )`, userID, adminStatus == http.StatusOK, operationalStatus == http.StatusOK).Scan(&authorized)
	return authorized, err
}
func executiveAccessRouter(db *pgxpool.Pool, a *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ok, err := executiveAuthorized(db, a, r)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "summary_unavailable"})
			return
		}
		if !ok {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "access_denied"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"allowed": true})
	}
}
func executiveRouter(db *pgxpool.Pool, a *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorized, authErr := executiveAuthorized(db, a, r)
		if authErr != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "summary_unavailable"})
			return
		}
		if !authorized {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "access_denied"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		var err error

		period := r.URL.Query().Get("period")
		now := time.Now().UTC()
		since := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
		switch period {
		case "30d":
			since = now.AddDate(0, 0, -30)
		case "90d":
			since = now.AddDate(0, 0, -90)
		case "365d":
			since = now.AddDate(0, 0, -365)
		case "all", "":
			period = "all"
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_period"})
			return
		}

		units := make([]executiveUnit, 0, 4)
		urmin := unavailableExecutive("urmin", "URMIN")
		var incoming, outgoing, dispositions, pending, overdue, awaiting int64
		err = db.QueryRow(ctx, `SELECT
     (SELECT count(*) FROM sdl_urmin_incoming WHERE status='registered' AND created_at >= $1),
     (SELECT count(*) FROM sdl_urmin_registry WHERE kind='surat_keluar' AND deleted_at IS NULL AND created_at >= $1),
     (SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE created_at >= $1),
     (SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress')),
     (SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress') AND due_date<(now() AT TIME ZONE 'Asia/Jakarta')::date),
     (SELECT count(*) FROM sdl_urmin_incoming_intake WHERE route_status='awaiting_kabag'
        AND NOT EXISTS (SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=sdl_urmin_incoming_intake.incoming_id AND d.sent_by=sdl_urmin_incoming_intake.kabag_recipient AND d.recipient_user<>d.sent_by))`, since).Scan(&incoming, &outgoing, &dispositions, &pending, &overdue, &awaiting)
		if err == nil {
			urmin.Ready = true
			urmin.Note = "Arus surat dalam periode; tugas aktif dan antrean perhatian adalah kondisi terkini."
			urmin.Metrics = []executiveMetric{em("Surat Masuk", incoming, "Terdaftar"), em("Surat Keluar", outgoing, "Register"), em("Disposisi", dispositions, "Jumlah tugas"), em("Perlu Perhatian", overdue+awaiting, "Terlambat / menunggu arahan")}
			urmin.Breakdown = []executiveSlice{{"pending", "Tugas Aktif", pending}, {"late", "Terlambat", overdue}, {"kabag", "Menunggu Kabagrenmin", awaiting}}
		}
		units = append(units, urmin)

		ren := unavailableExecutive("ren", "SUBBAGREN")
		var documents, paguCount, submitted, verified, realCount int64
		var paguTotal, realTotal int64
		err = db.QueryRow(ctx, `SELECT
    (SELECT count(*) FROM sdl_unit_work_records WHERE unit_key='subbagren' AND deleted_at IS NULL AND created_at >= $1),
    (SELECT count(*) FROM sdl_subbagren_pagu WHERE created_at >= $1),
    (SELECT count(*) FROM sdl_subbagren_pagu WHERE status='pending' AND created_at >= $1),
    (SELECT count(*) FROM sdl_subbagren_pagu WHERE status='verified' AND created_at >= $1),
    (SELECT count(*) FROM sdl_subbagren_realisasi WHERE created_at >= $1),
    (SELECT coalesce(sum(CASE WHEN status='verified' AND amount::text ~ '^[0-9]+$' THEN amount::numeric ELSE 0 END),0)::bigint FROM sdl_subbagren_pagu WHERE created_at >= $1),
    (SELECT coalesce(sum(CASE WHEN status='verified' THEN amount::numeric ELSE 0 END),0)::bigint FROM sdl_subbagren_realisasi WHERE created_at >= $1)`, since).Scan(&documents, &paguCount, &submitted, &verified, &realCount, &paguTotal, &realTotal)
		if err == nil {
			ren.Ready = true
			ren.Note = "Nilai pagu dan realisasi hanya yang terverifikasi. Periode dihitung dari tanggal pencatatan masing-masing transaksi."
			ren.Metrics = []executiveMetric{em("Berkas Kerja", documents, "Unit Subbagren"), em("Pengajuan Anggaran", paguCount, "Pagu tercatat"), emCurrency("Pagu Terverifikasi", paguTotal), emCurrency("Realisasi Terverifikasi", realTotal)}
			ren.Breakdown = []executiveSlice{{"pending", "Pengajuan Menunggu", submitted}, {"verified", "Pagu Terverifikasi", verified}, {"real", "Transaksi Realisasi", realCount}}
		}
		units = append(units, ren)

		sumda := unavailableExecutive("sumda", "SUBBAGSUMDA")
		var personel, bmn, good, needCare int64
		err = db.QueryRow(ctx, `SELECT
   count(*) FILTER(WHERE s.kind='personel'),
   count(*) FILTER(WHERE s.kind='inventaris'),
   count(*) FILTER(WHERE s.kind='inventaris' AND lower(trim(s.fields->>'kondisi')) IN ('baik','good','layak')),
   count(*) FILTER(WHERE s.kind='inventaris' AND lower(trim(s.fields->>'kondisi')) IN ('rusak','rusak berat','rusak ringan','tidak layak'))
   FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL
   WHERE s.deleted_at IS NULL`).Scan(&personel, &bmn, &good, &needCare)
		if err == nil {
			sumda.Ready = true
			sumda.Note = "Data personel dan BMN menunjukkan kondisi register terkini, tidak dibatasi periode."
			sumda.Metrics = []executiveMetric{em("Data Personel", personel, "Entri personel"), em("BMN Tercatat", bmn, "Entri inventaris"), em("BMN Kondisi Baik", good, "Entri"), em("BMN Perlu Perhatian", needCare, "Entri")}
			sumda.Breakdown = []executiveSlice{{"good", "Baik", good}, {"care", "Rusak / tidak layak", needCare}, {"other", "Belum terkategori", bmn - good - needCare}}
		}
		if sumda.Ready {
			placements := []executiveSlice{}
			rr, e := db.Query(ctx, `SELECT left(btrim(fields->>'unitKerja'),80) AS unit, count(*)
            FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL
            WHERE s.kind='personel' AND s.deleted_at IS NULL AND nullif(btrim(fields->>'unitKerja'),'') IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 50`)
			if e == nil {
				var suppressed int64
				for rr.Next() {
					var name string
					var count int64
					if rr.Scan(&name, &count) != nil {
						placements = nil
						break
					}
					if count < 3 || len(placements) >= 6 {
						suppressed += count
						continue
					}
					placements = append(placements, executiveSlice{Key: name, Label: name, Value: count})
				}
				if rr.Err() != nil {
					placements = nil
				}
				rr.Close()
				if placements != nil && suppressed > 0 {
					placements = append(placements, executiveSlice{Key: "other", Label: "Lainnya / kelompok kecil", Value: suppressed})
				}
			}
			sumda.Placements = placements
		}
		units = append(units, sumda)

		binfung := unavailableExecutive("binfung", "SUBBAGBINFUNG")
		var sop, final, working, evaluasi int64
		err = db.QueryRow(ctx, `SELECT
   count(*) FILTER (WHERE s.kind='sop'),
   count(*) FILTER (WHERE s.kind='sop' AND lower(trim(s.fields->>'statusDokumen')) IN ('final','disahkan','berlaku','approved')),
   count(*) FILTER (WHERE s.kind='sop' AND lower(trim(s.fields->>'statusDokumen')) NOT IN ('final','disahkan','berlaku','approved')),
   count(*) FILTER (WHERE s.kind='evaluasi')
   FROM sdl_binfung_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL
   WHERE s.deleted_at IS NULL`).Scan(&sop, &final, &working, &evaluasi)
		if err == nil {
			binfung.Ready = true
			binfung.Note = "SOP menunjukkan kondisi register terkini; status Final berdasarkan isian metadata, bukan verifikasi penetapan resmi."
			binfung.Metrics = []executiveMetric{em("SOP Tercatat", sop, "Entri SOP"), em("SOP Berstatus Final", final, "Berdasarkan metadata"), em("SOP Belum Final", sop-final, "Termasuk status kosong"), em("Evaluasi", evaluasi, "Entri evaluasi")}
			binfung.Breakdown = []executiveSlice{{"final", "Final", final}, {"progress", "Belum final", sop - final}}
		}
		units = append(units, binfung)

		var trends []executivePoint
		rows, e := db.Query(ctx, `SELECT to_char(date_trunc('month',created_at AT TIME ZONE 'Asia/Jakarta'),'YYYY-MM'),count(*)
   FROM sdl_urmin_incoming WHERE status='registered' AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') - interval '5 months'
   GROUP BY 1 ORDER BY 1`)
		if e == nil {
			defer rows.Close()
			for rows.Next() {
				var p executivePoint
				if rows.Scan(&p.Month, &p.SuratMasuk) != nil {
					break
				}
				trends = append(trends, p)
			}
		}
		payload := map[string]any{"period": period, "generatedAt": now.Format(time.RFC3339), "units": units, "trend": trends, "source": "live"}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(payload)
	}
}
