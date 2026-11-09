package users

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// R5H4 — keanggotaan Paur (migrasi 043), dikelola Superadmin.
//
// Keanggotaan Paur TIDAK memberi akses apa pun: tidak ada grant, scope, atau
// penyaringan SQL yang membacanya. Satu-satunya pembacanya adalah pemilihan
// penerima arahan (directives/sections.go). Karena itu ia hidup di samping
// /users/{id}/access, bukan di dalamnya -- mengubah Paur seseorang tidak
// pernah boleh ikut menulis ulang grant-nya.

var (
	paurKeyPattern = regexp.MustCompile(`^paur_[a-z]{2,24}$`)
	uuidPattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

type paurItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
}

type paurMember struct {
	UserID  string `json:"userId"`
	PaurKey string `json:"paurKey"`
	IsHead  bool   `json:"isHead"`
}

type paurPayload struct {
	PaurKey *string `json:"paurKey"`
	IsHead  bool    `json:"isHead"`
	Reason  string  `json:"reason"`
}

func (a *API) PaurRoutes(r chi.Router) {
	r.Get("/paur", a.paurList)
	r.Put("/users/{userID}/paur", a.setPaur)
}

// ---- 156. GET /admin/paur ----
func (a *API) paurList(w http.ResponseWriter, r *http.Request) {
	items := []paurItem{}
	rows, err := a.DB.Query(r.Context(), `SELECT paur_key,label,unit_key FROM sdl_paur ORDER BY paur_key`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	for rows.Next() {
		var p paurItem
		if rows.Scan(&p.Key, &p.Label, &p.Unit) != nil {
			rows.Close()
			reject(w, 503, "unavailable")
			return
		}
		items = append(items, p)
	}
	rows.Close()
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	members := []paurMember{}
	rows, err = a.DB.Query(r.Context(), `SELECT user_id::text,paur_key,is_head FROM sdl_user_paur ORDER BY paur_key,user_id`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m paurMember
		if rows.Scan(&m.UserID, &m.PaurKey, &m.IsHead) != nil {
			reject(w, 503, "unavailable")
			return
		}
		members = append(members, m)
	}
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"items": items, "members": members})
}

// ---- 157. PUT /admin/users/{userID}/paur ----
//
// paurKey null = keluarkan dari Paur mana pun. isHead hanya bermakna bersama
// paurKey; isHead=true tanpa Paur ditolak 400, bukan didiamkan.
func (a *API) setPaur(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "userID")
	var p paurPayload
	if decode(r, &p) != nil {
		reject(w, 400, "invalid_request")
		return
	}
	if !validReason(p.Reason) || (p.PaurKey != nil && !paurKeyPattern.MatchString(*p.PaurKey)) || (p.PaurKey == nil && p.IsHead) {
		reject(w, 400, "invalid_input")
		return
	}
	if !uuidPattern.MatchString(id) {
		reject(w, 404, "user_missing")
		return
	}
	if id == actor(r.Context()) {
		reject(w, 403, "self_change_denied")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var protected bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') FROM sdl_users u WHERE u.id=$1 FOR UPDATE`, id).Scan(&protected)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "user_missing")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if protected {
		reject(w, 403, "protected_user")
		return
	}
	var before *string
	var beforeHead bool
	err = tx.QueryRow(ctx, `SELECT paur_key,is_head FROM sdl_user_paur WHERE user_id=$1`, id).Scan(&before, &beforeHead)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		reject(w, 503, "unavailable")
		return
	}
	if p.PaurKey == nil {
		_, err = tx.Exec(ctx, `DELETE FROM sdl_user_paur WHERE user_id=$1`, id)
	} else {
		// Paur harus ada, dan orangnya harus anggota unit Paur itu. Anggota unit
		// lain yang dimasukkan ke Paur Subbagsumda akan menerima arahan
		// Subbagsumda tanpa pernah menjadi bagian dari unitnya.
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_paur p JOIN sdl_user_units uu ON uu.unit_key=p.unit_key AND uu.user_id=$2 WHERE p.paur_key=$1)`, *p.PaurKey, id).Scan(&ok)
		if err != nil {
			reject(w, 503, "unavailable")
			return
		}
		if !ok {
			reject(w, 400, "paur_unit_mismatch")
			return
		}
		_, err = tx.Exec(ctx, `INSERT INTO sdl_user_paur(user_id,paur_key,is_head,assigned_by) VALUES($1,$2,$3,$4)
 ON CONFLICT (user_id) DO UPDATE SET paur_key=EXCLUDED.paur_key,is_head=EXCLUDED.is_head,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,
			id, *p.PaurKey, p.IsHead, actor(ctx))
	}
	if err == nil {
		err = audit(ctx, tx, actor(ctx), "identity.user_paur_updated", id, map[string]any{
			"paurBefore": before, "isHeadBefore": beforeHead,
			"paurAfter": p.PaurKey, "isHeadAfter": p.IsHead,
			"reason": strings.TrimSpace(p.Reason),
		})
	}
	if err != nil || tx.Commit(ctx) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"paurKey": p.PaurKey, "isHead": p.IsHead})
}
