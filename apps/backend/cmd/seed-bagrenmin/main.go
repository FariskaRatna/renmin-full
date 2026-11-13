// Command seed-bagrenmin is a one-time LOCAL DEVELOPMENT provisioning tool.
// It is NOT exposed through the application HTTP API.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/auth"
)

type account struct {
	Username, Name, Unit, Role, Scope, Classification string
}

type roleDef struct {
	Key, Name, Description string
	Permissions            []string
}

var accounts = []account{
	{"op-urmin", "Operator Urmin BagRenmin", "urmin", "br_op_urmin", "own", "biasa"},
	{"staf-urmin", "Staf Urmin BagRenmin", "urmin", "br_staf_urmin", "own", "biasa"},
	{"ka-urmin", "Kepala Urmin BagRenmin", "urmin", "br_ka_urmin", "unit", "penting"},
	{"op-subbagren", "Operator Subbagren BagRenmin", "subbagren", "br_op_subbagren", "assigned", "biasa"},
	{"staf-subbagren", "Staf Subbagren BagRenmin", "subbagren", "br_staf_subbagren", "assigned", "biasa"},
	{"kasubbagren", "Kasubbagren BagRenmin", "subbagren", "br_kasubbagren", "unit", "penting"},
	{"op-subbagsumda", "Operator Subbagsumda BagRenmin", "subbagsumda", "br_op_subbagsumda", "assigned", "biasa"},
	{"staf-subbagsumda", "Staf Subbagsumda BagRenmin", "subbagsumda", "br_staf_subbagsumda", "assigned", "biasa"},
	{"kasubbagsumda", "Kasubbagsumda BagRenmin", "subbagsumda", "br_kasubbagsumda", "unit", "penting"},
	{"op-subbagbinfung", "Operator Subbagbinfung BagRenmin", "subbagbinfung", "br_op_subbagbinfung", "assigned", "biasa"},
	{"staf-subbagbinfung", "Staf Subbagbinfung BagRenmin", "subbagbinfung", "br_staf_subbagbinfung", "assigned", "biasa"},
	{"kasubbagbinfung", "Kasubbagbinfung BagRenmin", "subbagbinfung", "br_kasubbagbinfung", "unit", "penting"},
	{"kabagrenmin", "Kabagrenmin", "urmin", "br_kabagrenmin", "unit", "penting"},
}

// Permissions are carefully reviewed implementation capabilities, not blanket grants.
// In particular, there are NO identity.*, audit.*, or superadmin permissions.
var roles = []roleDef{
	{"br_op_urmin", "Operator Urmin", "Petugas register dan distribusi surat yang dibuat sendiri.", []string{"urmin.surat_masuk.read", "urmin.surat_masuk.create", "urmin.surat_masuk.update", "urmin.surat_masuk.attach", "urmin.surat_masuk.download", "urmin.surat_masuk.distribute"}},
	{"br_staf_urmin", "Staf Urmin", "Staf administrasi surat yang dibuat sendiri.", []string{"urmin.surat_masuk.read", "urmin.surat_masuk.create", "urmin.surat_masuk.update", "urmin.surat_masuk.attach", "urmin.surat_masuk.download", "urmin.agenda.read"}},
	{"br_ka_urmin", "Kepala Urmin", "Pengawasan dokumen Urmin dalam lingkup unit.", []string{"urmin.surat_masuk.read", "urmin.surat_masuk.create", "urmin.surat_masuk.update", "urmin.surat_masuk.attach", "urmin.surat_masuk.download", "urmin.surat_masuk.distribute", "urmin.distribusi.receive", "urmin.disposisi.read", "urmin.agenda.read", "dashboard.unit.read"}},
	{"br_op_subbagren", "Operator Subbagren", "Petugas Subbagren dan inbox yang ditugaskan.", []string{"subbagren.perencanaan.read", "subbagren.perencanaan.create", "subbagren.perencanaan.update", "urmin.distribusi.receive", "subbagren.progar.read", "subbagren.progar.manage", "subbagren.realisasi.manage"}},
	{"br_staf_subbagren", "Staf Subbagren", "Staf Subbagren dan inbox yang ditugaskan.", []string{"subbagren.perencanaan.read", "subbagren.perencanaan.create", "subbagren.perencanaan.update", "subbagren.anggaran.read", "subbagren.kinerja.read", "urmin.distribusi.receive", "subbagren.progar.read"}},
	{"br_kasubbagren", "Kasubbagren", "Pimpinan operasional unit Subbagren.", []string{"subbagren.perencanaan.read", "subbagren.perencanaan.create", "subbagren.perencanaan.update", "subbagren.perencanaan.approve", "subbagren.anggaran.read", "subbagren.anggaran.update", "subbagren.kinerja.read", "urmin.distribusi.receive", "dashboard.unit.read", "subbagren.progar.read", "subbagren.progar.manage", "subbagren.pagu.approve", "subbagren.realisasi.manage", "subbagren.realisasi.verify", "subbagren.dokumen.sahkan"}},
	{"br_op_subbagsumda", "Operator Subbagsumda", "Petugas personel/inventaris dan inbox yang ditugaskan.", []string{"subbagsumda.personel.read", "subbagsumda.personel.create", "subbagsumda.inventaris.read", "subbagsumda.inventaris.create", "urmin.distribusi.receive"}},
	{"br_staf_subbagsumda", "Staf Subbagsumda", "Staf personel/inventaris dan inbox yang ditugaskan.", []string{"subbagsumda.personel.read", "subbagsumda.personel.create", "subbagsumda.personel.update", "subbagsumda.inventaris.read", "subbagsumda.inventaris.create", "subbagsumda.inventaris.update", "urmin.distribusi.receive"}},
	{"br_kasubbagsumda", "Kasubbagsumda", "Pimpinan operasional unit Subbagsumda.", []string{"subbagsumda.personel.read", "subbagsumda.personel.create", "subbagsumda.personel.update", "subbagsumda.inventaris.read", "subbagsumda.inventaris.create", "subbagsumda.inventaris.update", "urmin.distribusi.receive", "dashboard.unit.read"}},
	{"br_op_subbagbinfung", "Operator Subbagbinfung", "Petugas SOP dan inbox yang ditugaskan.", []string{"subbagbinfung.sop.read", "subbagbinfung.sop.create", "urmin.distribusi.receive"}},
	{"br_staf_subbagbinfung", "Staf Subbagbinfung", "Staf SOP/evaluasi dan inbox yang ditugaskan.", []string{"subbagbinfung.sop.read", "subbagbinfung.sop.create", "subbagbinfung.sop.update", "subbagbinfung.evaluasi.read", "urmin.distribusi.receive"}},
	{"br_kasubbagbinfung", "Kasubbagbinfung", "Pimpinan operasional unit Subbagbinfung.", []string{"subbagbinfung.sop.read", "subbagbinfung.sop.create", "subbagbinfung.sop.update", "subbagbinfung.sop.approve", "subbagbinfung.evaluasi.read", "subbagbinfung.evaluasi.update", "urmin.distribusi.receive", "dashboard.unit.read"}},
	{"br_kabagrenmin", "Kabagrenmin", "Pimpinan BagRenmin, akses baca empat unit tanpa hak admin identitas.", []string{"urmin.surat_masuk.read", "urmin.surat_masuk.download", "urmin.distribusi.receive", "urmin.surat_masuk.distribute", "subbagren.perencanaan.read", "subbagren.anggaran.read", "subbagren.kinerja.read", "subbagsumda.personel.read", "subbagsumda.inventaris.read", "subbagbinfung.sop.read", "subbagbinfung.evaluasi.read", "dashboard.unit.read", "dashboard.cross_unit.read", "urmin.surat_keluar.approve", "subbagren.progar.read"}},
}

func rosterValid() error {
	if len(accounts) != 13 || len(roles) != 13 {
		return errors.New("expected 13 accounts and roles")
	}
	roleMap := make(map[string]roleDef)
	for _, r := range roles {
		if _, ok := roleMap[r.Key]; ok {
			return fmt.Errorf("duplicate role: %s", r.Key)
		}
		if strings.HasPrefix(r.Key, "superadmin") || len(r.Permissions) == 0 {
			return errors.New("unsafe role definition")
		}
		for _, p := range r.Permissions {
			if strings.HasPrefix(p, "identity.") || strings.HasPrefix(p, "audit.") {
				return errors.New("privileged permission forbidden")
			}
		}
		roleMap[r.Key] = r
	}
	seen := map[string]bool{}
	for _, a := range accounts {
		if seen[a.Username] {
			return fmt.Errorf("duplicate username: %s", a.Username)
		}
		seen[a.Username] = true
		if _, ok := roleMap[a.Role]; !ok {
			return fmt.Errorf("role undefined: %s", a.Role)
		}
		if a.Scope != "own" && a.Scope != "assigned" && a.Scope != "unit" {
			return errors.New("invalid scope")
		}
		if a.Classification != "biasa" && a.Classification != "penting" {
			return errors.New("invalid classification")
		}
	}
	return nil
}

// Existing op-urmin remains the same account. Only fresh users receive new credentials.
func newAccounts() []account {
	result := make([]account, 0, len(accounts)-1)
	for _, a := range accounts {
		if a.Username != "op-urmin" {
			result = append(result, a)
		}
	}
	return result
}

func readSecretLines(source io.Reader) (adminPassword, initialPassword string, err error) {
	scanner := bufio.NewScanner(io.LimitReader(source, 1200))
	scanner.Buffer(make([]byte, 256), 1200)
	parts := make([]string, 0, 3)
	for scanner.Scan() {
		parts = append(parts, strings.TrimSuffix(scanner.Text(), "\r"))
		if len(parts) > 3 {
			return "", "", errors.New("unexpected extra input")
		}
	}
	if err := scanner.Err(); err != nil {
		return "", "", err
	}
	if len(parts) != 3 || parts[1] != parts[2] || len(parts[0]) == 0 {
		return "", "", errors.New("invalid or unconfirmed credentials")
	}
	if len(parts[0]) > 256 || len(parts[1]) < 14 || len(parts[1]) > 256 {
		return "", "", errors.New("password length outside policy")
	}
	return parts[0], parts[1], nil
}

func provision(ctx context.Context, pool *pgxpool.Pool, adminUsername, adminPassword, initialPassword string) error {
	if err := rosterValid(); err != nil {
		return err
	}
	if os.Getenv("SDL_ENV") != "development" {
		return errors.New("REFUSED: development environment required")
	}
	if adminUsername == "" {
		return errors.New("Superadmin username is required")
	}
	cctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	tx, err := pool.BeginTx(cctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(cctx)
	var dbName string
	if err = tx.QueryRow(cctx, "SELECT current_database()").Scan(&dbName); err != nil {
		return err
	}
	if dbName != "sdl_root_dev" {
		return errors.New("REFUSED: only sdl_root_dev is allowed")
	}
	if _, err = tx.Exec(cctx, "SELECT pg_advisory_xact_lock(20261018, 13)"); err != nil {
		return err
	}
	var migrated bool
	err = tx.QueryRow(cctx, `SELECT EXISTS(SELECT 1 FROM sdl_schema_migrations WHERE filename='sql/010_urmin_attachments_distribution.sql')`).Scan(&migrated)
	if err != nil || !migrated {
		return errors.New("REFUSED: R3B migration 010 is required")
	}
	var adminID, encoded string
	err = tx.QueryRow(cctx, `SELECT u.id::text,u.password_hash FROM sdl_users u JOIN sdl_user_roles sur ON sur.user_id=u.id AND sur.role_key='superadmin' WHERE lower(u.username)=lower($1) AND u.is_active=TRUE AND u.must_change_password=FALSE`, adminUsername).Scan(&adminID, &encoded)
	if err != nil || !auth.VerifyPassword(encoded, adminPassword) {
		return errors.New("REFUSED: Superadmin verification failed")
	}
	// Reconcile exactly ONE pre-existing account. Never reset its identity, credentials,
	// OTP policy, or profile. No other existing account or role may be overwritten.
	var existingID string
	var existingActive bool
	err = tx.QueryRow(cctx, `SELECT id::text,is_active FROM sdl_users WHERE lower(username)='op-urmin' FOR UPDATE`).Scan(&existingID, &existingActive)
	if err != nil || !existingActive {
		return errors.New("REFUSED: expected active existing op-urmin account not found")
	}
	var directRoleCount, grantCount, foreignUnitCount int
	err = tx.QueryRow(cctx, `SELECT
		(SELECT count(*) FROM sdl_user_roles WHERE user_id=$1),
		(SELECT count(*) FROM sdl_access_grants WHERE user_id=$1),
		(SELECT count(*) FROM sdl_user_units WHERE user_id=$1 AND unit_key<>'urmin')`, existingID).Scan(&directRoleCount, &grantCount, &foreignUnitCount)
	if err != nil {
		return err
	}
	if directRoleCount != 0 || grantCount != 0 || foreignUnitCount != 0 {
		return errors.New("REFUSED: op-urmin now has an existing role, grant, or non-Urmin unit; manual review required")
	}
	fresh := newAccounts()
	userNames := make([]string, 0, len(fresh))
	userEmails := make([]string, 0, len(fresh))
	roleKeys := make([]string, 0, len(roles))
	for _, a := range fresh {
		userNames = append(userNames, a.Username)
		userEmails = append(userEmails, a.Username+"@siera.invalid")
	}
	for _, r := range roles {
		roleKeys = append(roleKeys, r.Key)
	}
	var collision int
	if err = tx.QueryRow(cctx, `SELECT (SELECT count(*) FROM sdl_users WHERE lower(username)=ANY($1::text[]) OR lower(email)=ANY($2::text[]))+(SELECT count(*) FROM sdl_roles WHERE role_key=ANY($3::text[]))`, userNames, userEmails, roleKeys).Scan(&collision); err != nil {
		return err
	}
	if collision != 0 {
		return errors.New("REFUSED: a target new user/email/role already exists; no changes made")
	}
	// Every permission in this plan MUST exist, and no role grants identity/audit management.
	for _, role := range roles {
		var known int
		if err = tx.QueryRow(cctx, "SELECT count(*) FROM sdl_permissions WHERE permission_key=ANY($1::text[])", role.Permissions).Scan(&known); err != nil {
			return err
		}
		if known != len(role.Permissions) {
			return fmt.Errorf("REFUSED: unknown permission in role %s", role.Key)
		}
	}
	// Each account gets a unique Argon2id hash with an independent random salt.
	passwordHashes := make([]string, len(fresh))
	for i := range fresh {
		passwordHashes[i], err = auth.HashPassword(initialPassword)
		if err != nil {
			return err
		}
	}
	for _, role := range roles {
		if _, err = tx.Exec(cctx, `INSERT INTO sdl_roles(role_key,display_name,description,is_system,is_active,updated_by) VALUES($1,$2,$3,FALSE,TRUE,$4)`, role.Key, role.Name, role.Description, adminID); err != nil {
			return err
		}
		for _, perm := range role.Permissions {
			if _, err = tx.Exec(cctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES($1,$2)`, role.Key, perm); err != nil {
				return err
			}
		}
	}
	for i, a := range fresh {
		email := a.Username + "@siera.invalid"
		var userID string
		if err = tx.QueryRow(cctx, `INSERT INTO sdl_users(username,email,display_name,password_hash,is_active,otp_enabled,otp_required,must_change_password) VALUES($1,$2,$3,$4,TRUE,FALSE,FALSE,TRUE) RETURNING id::text`, a.Username, email, a.Name, passwordHashes[i]).Scan(&userID); err != nil {
			return err
		}
		if a.Username == "kabagrenmin" {
			for _, unit := range []string{"urmin", "subbagren", "subbagsumda", "subbagbinfung"} {
				if err = insertGrant(cctx, tx, userID, a.Role, unit, a.Scope, a.Classification, unit == "urmin", adminID); err != nil {
					return err
				}
			}
		} else if err = insertGrant(cctx, tx, userID, a.Role, a.Unit, a.Scope, a.Classification, true, adminID); err != nil {
			return err
		}
		data, _ := json.Marshal(map[string]any{"username": a.Username, "unit": a.Unit, "role": a.Role, "otpEnabled": false, "mustChangePassword": true, "source": "local_superadmin_verified_seed", "reason": "Permintaan bootstrap akun operasional BagRenmin"})
		if _, err = tx.Exec(cctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'identity.user_created','user',$2,$3::jsonb)`, adminID, userID, string(data)); err != nil {
			return err
		}
	}
	// Link the old op-urmin record to its scoped operator role, preserving
	// all existing user fields including email, password, OTP, and history.
	// Existing Urmin membership is promoted to primary only if it is the
	// sole unit. A different unit is refused above.
	if _, err = tx.Exec(cctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary)
		VALUES($1,'urmin',TRUE)
		ON CONFLICT(user_id,unit_key) DO UPDATE SET is_primary=TRUE`, existingID); err != nil {
		return err
	}
	if _, err = tx.Exec(cctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by)
		VALUES($1,'br_op_urmin','urmin','own','biasa','Rekonsiliasi role operator Urmin untuk akun lama tanpa perubahan identitas',$2)`, existingID, adminID); err != nil {
		return err
	}
	linkMeta, _ := json.Marshal(map[string]any{"username": "op-urmin", "role": "br_op_urmin", "unit": "urmin", "scope": "own", "classification": "biasa", "credentialsUnchanged": true, "source": "local_superadmin_verified_seed_reconcile02"})
	if _, err = tx.Exec(cctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
		VALUES($1,'identity.access_granted','user',$2,$3::jsonb)`, adminID, existingID, string(linkMeta)); err != nil {
		return err
	}
	meta, _ := json.Marshal(map[string]any{"newAccounts": len(fresh), "linkedExistingAccounts": 1, "roles": len(roles), "otp": "disabled_for_new_accounts_only", "forcePasswordChangeForNew": true, "source": "local_superadmin_verified_seed_reconcile02"})
	if _, err = tx.Exec(cctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'identity.bulk_users_provisioned','batch','bagrenmin',$2::jsonb)`, adminID, string(meta)); err != nil {
		return err
	}
	if err = tx.Commit(cctx); err != nil {
		return err
	}
	return nil
}
func insertGrant(ctx context.Context, tx pgx.Tx, userID, role, unit, scope, classification string, primary bool, adminID string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,$3)`, userID, unit, primary); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,$2,$3,$4,$5,'Bootstrap akun berjenjang BagRenmin untuk pengujian operasional',$6)`, userID, role, unit, scope, classification, adminID)
	return err
}
func main() {
	if err := rosterValid(); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
	if len(os.Args) != 2 || os.Args[1] != "-apply" {
		fmt.Fprintln(os.Stderr, "ERROR: only -apply supported; use local installer/runner")
		os.Exit(2)
	}
	adminUsername := strings.TrimSpace(os.Getenv("SDL_SEED_SUPERADMIN_USERNAME"))
	adminPass, initialPass, err := readSecretLines(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: credential input invalid")
		os.Exit(1)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fmt.Fprintln(os.Stderr, "ERROR: database config missing")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR: unable to initialize database connection")
		os.Exit(1)
	}
	defer pool.Close()
	if err = provision(ctx, pool, adminUsername, adminPass, initialPass); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
	fmt.Printf("SUCCESS: %d NEW operational accounts + 1 EXISTING op-urmin linked, %d role templates created atomically. Existing op-urmin credentials/OTP preserved. Superadmin unchanged.\n", len(newAccounts()), len(roles))
	fmt.Println("EMAIL: synthetic @siera.invalid placeholders; replace with verified real addresses before email workflows.")
}
