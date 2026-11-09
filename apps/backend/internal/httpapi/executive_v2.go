package httpapi

// R5F24: read-only decision summaries, role-separated at the server boundary.
// Never return source documents, names, attachments, individual finance evidence,
// or operational aggregates to a Superadmin.

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/auth"
)

type executiveV2Metric struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Unit   string `json:"unit"`
	Value  *int64 `json:"value"`
	Detail string `json:"detail"`
	Action string `json:"action"`
	Scope  string `json:"scope"`
}
type executiveV2Attention struct {
	Key         string `json:"key"`
	Severity    string `json:"severity"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Count       int64  `json:"count"`
	Action      string `json:"action"`
	Unit        string `json:"unit"`
}
type executiveV2Point struct {
	Month string `json:"month"`
	Value int64  `json:"value"`
}

func executiveV2Number(ctx context.Context, db *pgxpool.Pool, query string, args ...any) *int64 {
	var n int64
	if err := db.QueryRow(ctx, query, args...).Scan(&n); err != nil {
		return nil
	}
	return &n
}
func executiveV2Access(db *pgxpool.Pool, a *auth.Service, r *http.Request) (string, error) {
	// The admin session cannot fall back to operational access.
	if id, status := a.AuthorizeRoleEditor(r); status == http.StatusOK {
		var allowed bool
		err := db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_user_roles sr ON sr.user_id=u.id AND sr.role_key='superadmin' JOIN sdl_roles ro ON ro.role_key=sr.role_key AND ro.is_active WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password)`, id).Scan(&allowed)
		if err != nil {
			return "", err
		}
		if allowed {
			return "admin", nil
		}
		return "", nil
	}
	id, status := a.AuthorizeOperational(r)
	if status != http.StatusOK {
		return "", nil
	}
	var allowed bool
	err := db.QueryRow(r.Context(), `SELECT EXISTS(
      SELECT 1 FROM sdl_users u JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
      JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
      JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
      JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
      JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='dashboard.cross_unit.read'
      WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password AND g.unit_key='urmin' AND g.scope='unit'
      AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sa WHERE sa.user_id=u.id AND sa.role_key='superadmin')
    )`, id).Scan(&allowed)
	if err != nil {
		return "", err
	}
	if allowed {
		return "leader", nil
	}
	return "", nil
}
func executiveV2AccessEndpoint(db *pgxpool.Pool, a *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, err := executiveV2Access(db, a, r)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "summary_unavailable"})
			return
		}
		if kind == "" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "access_denied"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"kind": kind})
	}
}
func executiveV2Overview(db *pgxpool.Pool, a *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, err := executiveV2Access(db, a, r)
		if err != nil {
			writeJSON(w, 503, map[string]string{"error": "summary_unavailable"})
			return
		}
		if kind == "" {
			writeJSON(w, 403, map[string]string{"error": "access_denied"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
		defer cancel()
		now := time.Now()
		period := strings.TrimSpace(r.URL.Query().Get("period"))
		since := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
		switch period {
		case "", "90d":
			period = "90d"
			since = now.AddDate(0, 0, -90)
		case "30d":
			since = now.AddDate(0, 0, -30)
		case "365d":
			since = now.AddDate(0, 0, -365)
		case "all":
		default:
			writeJSON(w, 400, map[string]string{"error": "invalid_period"})
			return
		}
		metrics := make([]executiveV2Metric, 0, 12)
		attention := make([]executiveV2Attention, 0, 9)
		add := func(key, label, unit, detail, action, scope string, v *int64) {
			metrics = append(metrics, executiveV2Metric{Key: key, Label: label, Unit: unit, Detail: detail, Action: action, Scope: scope, Value: v})
		}
		flag := func(key, sev, title, description, action, unit string, v *int64) {
			if v != nil && *v > 0 {
				attention = append(attention, executiveV2Attention{Key: key, Severity: sev, Title: title, Description: description, Action: action, Unit: unit, Count: *v})
			}
		}
		var trend []executiveV2Point
		trendAvailable := false
		if kind == "admin" {
			total := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_users`)
			active := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_users WHERE is_active`)
			rotate := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_users WHERE is_active AND must_change_password`)
			grants := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_access_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`)
			expiring := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_access_grants WHERE revoked_at IS NULL AND expires_at>now() AND expires_at<=now()+interval '7 days'`)
			add("users_total", "Akun Terdaftar", "AKUN", "Seluruh akun yang tercatat", "users", "system", total)
			add("users_active", "Akun Aktif", "AKUN", "Akun yang aktif saat ini", "users", "system", active)
			add("users_rotate", "Wajib Ganti Password", "AKUN", "Akun aktif yang belum menyelesaikan pergantian password", "users", "system", rotate)
			add("grants_active", "Akses Aktif", "GRANT", "Grant kewenangan yang masih berlaku", "roles", "system", grants)
			add("grants_expiring", "Akses Segera Berakhir", "GRANT", "Grant yang berakhir dalam 7 hari", "roles", "system", expiring)
			flag("users_rotate", "warning", "Akun membutuhkan tindakan", "Pastikan pergantian password selesai sebelum akun digunakan.", "users", "Administrasi", rotate)
			flag("grants_expiring", "warning", "Grant akses mendekati kedaluwarsa", "Periksa kebutuhan perpanjangan atau pencabutan akses.", "roles", "Hak Akses", expiring)
		} else {
			incoming := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_urmin_incoming WHERE status='registered' AND created_at >= $1`, since)
			outgoing := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_urmin_registry WHERE kind='surat_keluar' AND deleted_at IS NULL AND created_at >= $1`, since)
			tasks := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress')`)
			overdue := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress') AND due_date<(now() AT TIME ZONE 'Asia/Jakarta')::date`)
			awaiting := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_urmin_incoming_intake i WHERE i.route_status='awaiting_kabag' AND NOT EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=i.incoming_id AND d.sent_by=i.kabag_recipient AND d.recipient_user<>d.sent_by)`)
			add("incoming", "Surat Masuk", "SURAT", "Terdaftar pada periode terpilih", "urmin", "urmin", incoming)
			add("outgoing", "Surat Keluar", "SURAT", "Terdaftar pada periode terpilih", "urmin", "urmin", outgoing)
			add("active_tasks", "Disposisi Berjalan", "TUGAS", "Kondisi aktif saat ini", "urmin", "urmin", tasks)
			add("overdue_tasks", "Disposisi Terlambat", "TUGAS", "Melewati tenggat dan belum selesai", "urmin", "urmin", overdue)
			add("awaiting_leader", "Menunggu Arahan Kabag", "SURAT", "Surat masuk yang belum ditindaklanjuti Kabag", "urmin", "urmin", awaiting)
			flag("overdue_tasks", "danger", "Disposisi melewati tenggat", "Tinjau tugas yang terlambat dan tentukan tindak lanjut.", "urmin", "URMIN", overdue)
			flag("awaiting_leader", "warning", "Surat menunggu arahan", "Buka Inbox URMIN untuk menindaklanjuti surat yang menunggu.", "urmin", "URMIN", awaiting)
			leaderID, sts := a.AuthorizeOperational(r)
			if sts == http.StatusOK {
				unack := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_leadership_directive_recipients rr JOIN sdl_leadership_directives d ON d.id=rr.directive_id WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NULL`, leaderID)
				urgent := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_leadership_directive_recipients rr JOIN sdl_leadership_directives d ON d.id=rr.directive_id WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NULL AND d.due_at IS NOT NULL AND d.due_at<now()`, leaderID)
				add("unack", "Arahan Belum Diterima", "PENERIMA", "Konfirmasi staf yang belum masuk", "arahan", "arahan", unack)
				add("urgent_directives", "Arahan Melewati Tenggat", "PENERIMA", "Penerima belum konfirmasi dan tenggat terlewati", "arahan", "arahan", urgent)
				flag("urgent_directives", "danger", "Arahan perlu eskalasi", "Tenggat telah lewat dan konfirmasi belum diterima.", "arahan", "Arahan Pimpinan", urgent)
				flag("unack", "warning", "Konfirmasi arahan belum lengkap", "Pantau penerima yang belum mengonfirmasi instruksi.", "arahan", "Arahan Pimpinan", unack)
			}
			pendingBudget := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_subbagren_pagu WHERE status='pending'`)
			add("pagu_pending", "Pagu Menunggu Verifikasi", "ITEM", "Pengajuan dengan status menunggu", "ren", "ren", pendingBudget)
			flag("pagu_pending", "warning", "Pagu perlu verifikasi", "Tinjau antrean perencanaan dan pengendalian anggaran.", "ren", "SUBBAGREN", pendingBudget)
			assets := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.kind='inventaris' AND lower(trim(s.fields->>'kondisi')) IN ('rusak','rusak berat','rusak ringan','tidak layak')`)
			add("assets_care", "Inventaris Perlu Perhatian", "ASET", "Kondisi rusak atau tidak layak pada register", "sumda", "sumda", assets)
			flag("assets_care", "warning", "Inventaris perlu penanganan", "Periksa data kondisi aset dan kebutuhan pemeliharaan.", "sumda", "SUBBAGSUMDA", assets)
			sop := executiveV2Number(ctx, db, `SELECT count(*) FROM sdl_binfung_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.kind='sop' AND lower(trim(coalesce(s.fields->>'statusDokumen',''))) NOT IN ('final','disahkan','berlaku','approved')`)
			add("sop_draft", "SOP Belum Final", "ITEM", "Berdasarkan status metadata, bukan pengesahan resmi", "binfung", "binfung", sop)
			flag("sop_draft", "info", "SOP perlu penyelesaian", "Periksa dokumen SOP yang belum berstatus final.", "binfung", "SUBBAGBINFUNG", sop)
			rows, e := db.Query(ctx, `SELECT to_char(date_trunc('month',created_at AT TIME ZONE 'Asia/Jakarta'),'YYYY-MM'),count(*) FROM sdl_urmin_incoming WHERE status='registered' AND created_at >= (date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') - interval '5 months' GROUP BY 1 ORDER BY 1`)
			if e == nil {
				trendAvailable = true
				trend = make([]executiveV2Point, 0, 6)
				for rows.Next() {
					var p executiveV2Point
					if rows.Scan(&p.Month, &p.Value) != nil {
						trendAvailable = false
						break
					}
					trend = append(trend, p)
				}
				if rows.Err() != nil {
					trendAvailable = false
				}
				rows.Close()
			}
		}
		available := 0
		for _, m := range metrics {
			if m.Value != nil {
				available++
			}
		}
		writeJSON(w, 200, map[string]any{"kind": kind, "generatedAt": time.Now().UTC().Format(time.RFC3339), "period": period, "metrics": metrics, "attention": attention, "trend": trend, "trendAvailable": trendAvailable, "sourcesAvailable": available, "sourcesTotal": len(metrics), "asOf": "live"})
	}
}
