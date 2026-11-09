package roadmap

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/roles"
)

type API struct{ DB *pgxpool.Pool }
type record struct {
	ID        string          `json:"id"`
	Section   string          `json:"section"`
	Order     int             `json:"order"`
	Data      json.RawMessage `json:"data"`
	Status    string          `json:"status"`
	Note      string          `json:"managementNote"`
	Version   int64           `json:"version"`
	UpdatedAt time.Time       `json:"updatedAt"`
}
type snapshot struct {
	Day       string `json:"day"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
}
type change struct {
	Status         string `json:"status"`
	ManagementNote string `json:"managementNote"`
	Version        int64  `json:"version"`
}

var idPattern = regexp.MustCompile(`^SDL-[0-9]{3}$`)
var statuses = map[string]bool{"Teruji": true, "Terpasang - perlu uji": true, "Berjalan sebagian": true, "Perlu keputusan": true, "Belum mulai": true}

func reply(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(value)
}
func denied(w http.ResponseWriter, code int) {
	reply(w, code, map[string]string{"error": "access_denied"})
}
func (a *API) Routes(r chi.Router) {
	r.Get("/project-roadmap", a.list)
	r.Patch("/project-roadmap/{id}", a.patch)
}
func (a *API) authorize(ctx context.Context) bool {
	id, ok := roles.Actor(ctx)
	if !ok || id == "" {
		return false
	}
	var allowed bool
	err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_user_roles ur ON ur.user_id=u.id WHERE u.id=$1 AND u.is_active=TRUE AND NOT u.must_change_password AND ur.role_key='superadmin')`, id).Scan(&allowed)
	return err == nil && allowed
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if !a.authorize(ctx) {
		denied(w, 403)
		return
	}
	rows, e := a.DB.Query(ctx, `SELECT id,section,sort_order,payload,status,management_note,version,updated_at FROM sdl_project_roadmap_records ORDER BY sort_order,id`)
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	result := make([]record, 0, 90)
	for rows.Next() {
		var v record
		if e = rows.Scan(&v.ID, &v.Section, &v.Order, &v.Data, &v.Status, &v.Note, &v.Version, &v.UpdatedAt); e != nil {
			break
		}
		result = append(result, v)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	history := make([]snapshot, 0, 30)
	rs, e := a.DB.Query(ctx, `SELECT (day)::text,completed,total FROM sdl_project_roadmap_snapshots ORDER BY day`)
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	for rs.Next() {
		var v snapshot
		if e = rs.Scan(&v.Day, &v.Completed, &v.Total); e != nil {
			break
		}
		history = append(history, v)
	}
	if e == nil {
		e = rs.Err()
	}
	rs.Close()
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	reply(w, 200, map[string]any{"records": result, "snapshots": history, "targetDate": "2026-12-31", "baselineDate": "2026-10-23"})
}
func (a *API) patch(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if !a.authorize(ctx) {
		denied(w, 403)
		return
	}
	id := chi.URLParam(r, "id")
	if !idPattern.MatchString(id) {
		reply(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input change
	if e := decoder.Decode(&input); e != nil {
		reply(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || !statuses[input.Status] || input.Version < 1 || len([]rune(input.ManagementNote)) > 1500 {
		reply(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	input.ManagementNote = strings.TrimSpace(input.ManagementNote)
	actor, _ := roles.Actor(ctx)
	tx, e := a.DB.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	defer tx.Rollback(ctx)
	var previous string
	var currentVersion int64
	e = tx.QueryRow(ctx, `SELECT status,version FROM sdl_project_roadmap_records WHERE id=$1 AND section='roadmap' FOR UPDATE`, id).Scan(&previous, &currentVersion)
	if errors.Is(e, pgx.ErrNoRows) {
		reply(w, 404, map[string]string{"error": "not_found"})
		return
	}
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	if currentVersion != input.Version {
		reply(w, 409, map[string]string{"error": "version_conflict"})
		return
	}
	_, e = tx.Exec(ctx, `UPDATE sdl_project_roadmap_records SET status=$2,management_note=$3,version=version+1,updated_by=$4::uuid,updated_at=now() WHERE id=$1`, id, input.Status, input.ManagementNote, actor)
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	_, e = tx.Exec(ctx, `INSERT INTO sdl_project_roadmap_updates(record_id,actor_id,status_before,status_after,note) VALUES($1,$2::uuid,$3,$4,$5)`, id, actor, previous, input.Status, input.ManagementNote)
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	_, e = tx.Exec(ctx, `INSERT INTO sdl_project_roadmap_snapshots(day,completed,total) SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date,count(*) FILTER(WHERE status='Teruji')::integer,count(*)::integer FROM sdl_project_roadmap_records WHERE section='roadmap' ON CONFLICT(day) DO UPDATE SET completed=EXCLUDED.completed,total=EXCLUDED.total`)
	if e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	if e = tx.Commit(ctx); e != nil {
		reply(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	reply(w, 200, map[string]any{"status": input.Status, "version": currentVersion + 1})
}
