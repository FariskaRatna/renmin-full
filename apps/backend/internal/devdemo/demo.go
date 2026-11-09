package devdemo

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"os"
	"strings"
)

// Enabled is intentionally strict: it cannot grant demo access on non-development
// deployments, and never on any database other than the isolated local demo DB.
func Enabled() bool {
	if os.Getenv("SDL_ENV") != "development" || os.Getenv("SDL_DEV_SUPERADMIN_WORKSPACE") != "true" {
		return false
	}
	u, err := url.Parse(os.Getenv("DATABASE_URL"))
	return err == nil && strings.TrimPrefix(u.Path, "/") == "sdl_root_dev"
}

// Superadmin checks the actual logged-in identity, active role, and completed
// first password rotation before any demo-only operational exception.
func Superadmin(ctx context.Context, db *pgxpool.Pool, id string) (bool, error) {
	if !Enabled() || id == "" {
		return false, nil
	}
	var ok bool
	err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u
  JOIN sdl_user_roles ur ON ur.user_id=u.id AND ur.role_key='superadmin'
  JOIN sdl_roles r ON r.role_key=ur.role_key AND r.is_active
  WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password)`, id).Scan(&ok)
	return ok, err
}
