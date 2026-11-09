package portal

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// All calls are authenticated by the router before reaching this package.
// Read access is limited to published portal summaries, not operational records.
type API struct{ DB *pgxpool.Pool }
type Post struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Body        string     `json:"body"`
	OwnerUnit   string     `json:"ownerUnit"`
	CoverURL    string     `json:"coverUrl"`
	ReferenceNo string     `json:"referenceNo"`
	StartsAt    *time.Time `json:"startsAt"`
	Pinned      bool       `json:"pinned"`
	Published   bool       `json:"published"`
	Version     int        `json:"version"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
type Input struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Summary     string     `json:"summary"`
	Body        string     `json:"body"`
	OwnerUnit   string     `json:"ownerUnit"`
	CoverURL    string     `json:"coverUrl"`
	ReferenceNo string     `json:"referenceNo"`
	StartsAt    *time.Time `json:"startsAt"`
	Pinned      bool       `json:"pinned"`
	Published   bool       `json:"published"`
	Version     int        `json:"version"`
}

func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func validString(s string, lo, hi int) bool {
	n := utf8.RuneCountInString(s)
	return n >= lo && n <= hi && utf8.ValidString(s)
}
func valid(p Input) bool {
	switch p.Kind {
	case "berita", "pengumuman", "sop", "peraturan", "agenda":
	default:
		return false
	}
	switch p.OwnerUnit {
	case "urmin", "subbagren", "subbagsumda", "subbagbinfung":
	default:
		return false
	}
	if !validString(strings.TrimSpace(p.Title), 3, 160) || !validString(p.Summary, 0, 600) || !validString(p.Body, 0, 8000) || !validString(p.ReferenceNo, 0, 160) || !validString(p.CoverURL, 0, 1000) {
		return false
	}
	if p.CoverURL != "" {
		u, e := url.Parse(p.CoverURL)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return false
		}
	}
	if p.Kind == "agenda" && p.StartsAt == nil {
		return false
	}
	return true
}

// The actor may edit only if assigned an active BINFUNG access grant.
// A superadmin account is always excluded, even in local demo mode.
func (a *API) editor(r *http.Request, actor string) bool {
	var ok bool
	err := a.DB.QueryRow(r.Context(), `SELECT EXISTS (
 SELECT 1 FROM sdl_users u JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='subbagbinfung'
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='subbagbinfung' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
 )`, actor).Scan(&ok)
	return err == nil && ok
}
func (a *API) List(w http.ResponseWriter, r *http.Request, actor string) {
	managing := r.URL.Query().Get("manage") == "1"
	canEdit := a.editor(r, actor)
	if managing && !canEdit {
		send(w, 403, map[string]string{"error": "access_denied"})
		return
	}
	var rows pgx.Rows
	var err error
	// Never expose drafts to normal portal readers or Superadmin.
	if managing {
		rows, err = a.DB.Query(r.Context(), `SELECT id::text,kind,title,summary,body,owner_unit,cover_url,reference_no,starts_at,pinned,published,version,created_at,updated_at FROM sdl_portal_posts ORDER BY updated_at DESC LIMIT 300`)
	} else {
		rows, err = a.DB.Query(r.Context(), `SELECT id::text,kind,title,summary,body,owner_unit,cover_url,reference_no,starts_at,pinned,published,version,created_at,updated_at FROM sdl_portal_posts WHERE published=TRUE ORDER BY pinned DESC,updated_at DESC LIMIT 300`)
	}
	if err != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	defer rows.Close()
	items := make([]Post, 0)
	for rows.Next() {
		var p Post
		if err := rows.Scan(&p.ID, &p.Kind, &p.Title, &p.Summary, &p.Body, &p.OwnerUnit, &p.CoverURL, &p.ReferenceNo, &p.StartsAt, &p.Pinned, &p.Published, &p.Version, &p.CreatedAt, &p.UpdatedAt); err != nil {
			send(w, 503, map[string]string{"error": "unavailable"})
			return
		}
		items = append(items, p)
	}
	if rows.Err() != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	send(w, 200, map[string]any{"items": items, "editor": canEdit})
}
func (a *API) Save(w http.ResponseWriter, r *http.Request, actor string) {
	if !a.editor(r, actor) {
		send(w, 403, map[string]string{"error": "access_denied"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16000)
	var p Input
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil || !valid(p) {
		send(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	var version int
	if r.Method == http.MethodPost {
		err = tx.QueryRow(r.Context(), `INSERT INTO sdl_portal_posts(kind,title,summary,body,owner_unit,cover_url,reference_no,starts_at,pinned,published,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$11::uuid) RETURNING id::text,version`, p.Kind, strings.TrimSpace(p.Title), p.Summary, p.Body, p.OwnerUnit, p.CoverURL, p.ReferenceNo, p.StartsAt, p.Pinned, p.Published, actor).Scan(&id, &version)
	} else {
		id = chi.URLParam(r, "id")
		if len(id) != 36 || p.Version < 1 {
			send(w, 400, map[string]string{"error": "invalid_request"})
			return
		}
		err = tx.QueryRow(r.Context(), `UPDATE sdl_portal_posts SET kind=$1,title=$2,summary=$3,body=$4,owner_unit=$5,cover_url=$6,reference_no=$7,starts_at=$8,pinned=$9,published=$10,updated_by=$11::uuid,updated_at=NOW(),version=version+1 WHERE id=$12::uuid AND version=$13 RETURNING version`, p.Kind, strings.TrimSpace(p.Title), p.Summary, p.Body, p.OwnerUnit, p.CoverURL, p.ReferenceNo, p.StartsAt, p.Pinned, p.Published, actor, id, p.Version).Scan(&version)
	}
	if err == pgx.ErrNoRows {
		send(w, 409, map[string]string{"error": "version_conflict"})
		return
	}
	if err != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	var oldVersion any
	action := "create"
	if r.Method != http.MethodPost {
		action = "update"
		oldVersion = p.Version
	}
	if _, err = tx.Exec(r.Context(), `INSERT INTO sdl_portal_publication_events(post_id,actor_id,action,old_version,new_version) VALUES($1::uuid,$2::uuid,$3,$4,$5)`, id, actor, action, oldVersion, version); err != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	if tx.Commit(r.Context()) != nil {
		send(w, 503, map[string]string{"error": "unavailable"})
		return
	}
	send(w, 200, map[string]any{"id": id, "version": version})
}
