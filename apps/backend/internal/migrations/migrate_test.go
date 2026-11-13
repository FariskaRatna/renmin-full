package migrations

import (
	"fmt"
	"strings"
	"testing"
)

// Keep the migration manifest explicit: an unexpected, missing or reordered
// embedded SQL file must be reviewed before any service is rebuilt.
func TestEmbeddedMigrationOrderAndSafety(t *testing.T) {
	want := []string{
		"sql/001_core.sql",
		"sql/002_security.sql",
		"sql/003_role_editor.sql",
		"sql/004_users_access.sql",
		"sql/005_access_delegation.sql",
		"sql/006_superadmin_limited.sql",
		"sql/007_urmin_incoming.sql",
		"sql/008_local_captcha_otp_policy.sql",
		"sql/009_self_profile.sql",
		"sql/010_urmin_attachments_distribution.sql",
		"sql/011_urmin_dispositions.sql",
		"sql/012_disposition_review_sla.sql",
		"sql/013_disposition_hierarchy.sql",
		"sql/014_leadership_approval.sql",
		"sql/015_subbagren_usulan.sql",
		"sql/016_subbagren_review_consolidation.sql",
		"sql/017_subbagren_budget_realization.sql",
		"sql/018_subbagren_evidence_reconciliation.sql",
		"sql/019_unit_berkas_tugas.sql",
		"sql/020_sumda_master_crud.sql",
		"sql/021_polri_rank_master.sql",
		"sql/022_binfung_master_crud.sql",
		"sql/023_urmin_register_crud.sql",
		"sql/024_urmin_flexible_intake.sql",
		"sql/025_outgoing_review.sql",
		"sql/026_urmin_email_outbox.sql",
		"sql/027_urmin_attachment_10mb.sql",
		"sql/028_project_roadmap.sql",
		"sql/029_bagrenmin_portal.sql",
		"sql/030_urmin_intake_mail_outbox.sql",
		"sql/031_direct_leadership_directives.sql",
		"sql/032_leadership_directive_drafts.sql",
		"sql/033_leadership_directive_files.sql",
		"sql/034_urmin_derajat_doc_kind.sql",
		"sql/035_directive_incoming_link.sql",
		"sql/036_disposition_files.sql",
		"sql/037_surat_kode_arsip.sql",
		"sql/038_surat_jenis.sql",
		"sql/039_surat_nomor_urut.sql",
		"sql/040_arahan_bagian.sql",
		"sql/041_arahan_lembar_disposisi.sql",
		"sql/042_surat_keluar_opsi.sql",
		"sql/043_arahan_paur.sql",
		"sql/044_berkas_pendukung.sql",
		"sql/045_ttd_kabag.sql",
		"sql/046_nomor_reservasi.sql",
		"sql/047_opsi_dropdown.sql",
		"sql/048_opsi_agenda_hadir.sql",
		"sql/049_progar_pagu.sql",
	}
	items, err := load()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(want) {
		t.Fatalf("expected %d migration files; found %d", len(want), len(items))
	}
	for i, m := range items {
		if m.name != want[i] {
			t.Fatalf("migration %d: expected %q, found %q", i+1, want[i], m.name)
		}
		if len(m.checksum) != 64 || strings.TrimSpace(m.statement) == "" {
			t.Fatalf("invalid embedded migration %q", m.name)
		}
		if reason := migrationSafetyIssue(m.name, m.statement); reason != "" {
			t.Fatalf("unsafe SQL in %q: %s", m.name, reason)
		}
	}
}

// This is a conservative source-level safeguard, not a general-purpose SQL
// parser. Database permissions, transactional migrations and reviews remain
// separate requirements.
func migrationSafetyIssue(name, body string) string {
	var clean strings.Builder
	for _, line := range strings.Split(body, "\n") {
		// The current migrations use SQL line comments only.
		line, _, _ = strings.Cut(line, "--")
		clean.WriteString(line)
		clean.WriteByte('\n')
	}
	for _, raw := range strings.Split(clean.String(), ";") {
		stmt := strings.ToUpper(strings.Join(strings.Fields(raw), " "))
		if stmt == "" {
			continue
		}
		// Narrow, reviewed exception: revoke only *excess* permissions for
		// the fixed Superadmin role. General DELETE remains forbidden.
		const reviewedRevoke = "DELETE FROM SDL_ROLE_PERMISSIONS WHERE ROLE_KEY = 'SUPERADMIN' AND PERMISSION_KEY NOT IN ('IDENTITY.USERS.MANAGE', 'IDENTITY.ROLES.MANAGE')"
		if name == "sql/006_superadmin_limited.sql" && stmt == reviewedRevoke {
			continue
		}
		// Reviewed safety exception: this ONLY widens an existing non-destructive
		// size check on incoming-letter attachments. No column/table removal.
		const reviewedSizeLimit = "ALTER TABLE SDL_URMIN_INCOMING_ATTACHMENTS DROP CONSTRAINT SDL_URMIN_INCOMING_ATTACHMENTS_SIZE_BYTES_CHECK, ADD CONSTRAINT SDL_URMIN_INCOMING_ATTACHMENTS_SIZE_BYTES_CHECK CHECK (SIZE_BYTES BETWEEN 1 AND 10485760)"
		if name == "sql/027_urmin_attachment_10mb.sql" && stmt == reviewedSizeLimit {
			continue
		}
		for _, forbidden := range []string{
			"DROP TABLE", "TRUNCATE TABLE", "DELETE FROM", "DROP COLUMN",
			"ALTER COLUMN", "RENAME COLUMN", "RENAME TO", "SET SCHEMA",
			"UPDATE ",
		} {
			if strings.Contains(stmt, forbidden) {
				return fmt.Sprintf("forbidden operation %q", forbidden)
			}
		}
		if strings.HasPrefix(stmt, "ALTER TABLE ") {
			// Setiap ALTER TABLE harus terdaftar di sini sebagai pasangan
			// (berkas, tabel) yang sudah ditinjau, dan tiap klausanya tetap
			// wajib ADD COLUMN. Daftar eksplisit ini yang memaksa penambahan
			// kolom baru lewat tinjauan, bukan diam-diam ikut migrasi lain.
			reviewed := map[string][]string{
				"sql/003_role_editor.sql":              {"SDL_ROLES"},
				"sql/004_users_access.sql":             {"SDL_USERS"},
				"sql/008_local_captcha_otp_policy.sql": {"SDL_USERS"},
				"sql/009_self_profile.sql":             {"SDL_USERS"},
				"sql/013_disposition_hierarchy.sql":    {"SDL_URMIN_DISPOSITION_TASKS"},
				// R5G1: derajat surat masuk + pemisahan naskah surat dari
				// lampirannya. Keduanya ADD COLUMN ber-DEFAULT, tanpa backfill.
				"sql/034_urmin_derajat_doc_kind.sql": {"SDL_URMIN_INCOMING", "SDL_URMIN_INCOMING_ATTACHMENTS"},
				// R5G2: tautan opsional arahan -> surat masuk. Dua ADD COLUMN
				// nullable tanpa DEFAULT, tanpa backfill.
				"sql/035_directive_incoming_link.sql": {"SDL_LEADERSHIP_DIRECTIVES", "SDL_LEADERSHIP_DIRECTIVE_DRAFTS"},
				// R5H1: bagian tujuan arahan. Dua ADD COLUMN; yang pertama
				// nullable tanpa DEFAULT, yang kedua NOT NULL ber-DEFAULT.
				// Keduanya tanpa backfill.
				"sql/040_arahan_bagian.sql": {"SDL_LEADERSHIP_DIRECTIVE_RECIPIENTS", "SDL_LEADERSHIP_DIRECTIVE_DRAFTS"},
				// R5H2: lembar disposisi arahan. Dua ADD COLUMN JSONB nullable
				// tanpa DEFAULT, tanpa backfill.
				"sql/041_arahan_lembar_disposisi.sql": {"SDL_LEADERSHIP_DIRECTIVES", "SDL_LEADERSHIP_DIRECTIVE_DRAFTS"},
				// R5H5: jenis berkas Berkas Kerja (lampiran/pendukung). Satu ADD
				// COLUMN NOT NULL ber-DEFAULT 'lampiran', tanpa backfill.
				"sql/044_berkas_pendukung.sql": {"SDL_UNIT_WORK_FILES"},
			}
			clauses := ""
			for _, table := range reviewed[name] {
				prefix := "ALTER TABLE " + table + " "
				if strings.HasPrefix(stmt, prefix) {
					clauses = strings.TrimPrefix(stmt, prefix)
					break
				}
			}
			if clauses == "" {
				return "ALTER TABLE outside reviewed additive migrations"
			}
			for _, clause := range strings.Split(clauses, ",") {
				if !strings.HasPrefix(strings.TrimSpace(clause), "ADD COLUMN ") {
					return "ALTER TABLE clause other than ADD COLUMN"
				}
			}
		}
	}
	return ""
}

func TestMigrationSafetyAllowsReviewedAdditiveColumns(t *testing.T) {
	cases := []struct {
		name string
		sql  string
	}{
		{"sql/003_role_editor.sql", "ALTER TABLE sdl_roles\n  ADD COLUMN description VARCHAR(500),\n  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;"},
		{"sql/004_users_access.sql", "ALTER TABLE sdl_users\n  ADD COLUMN version BIGINT NOT NULL DEFAULT 1,\n  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;"},
		{"sql/009_self_profile.sql", "ALTER TABLE sdl_users ADD COLUMN profile_phone VARCHAR(40) NOT NULL DEFAULT '', ADD COLUMN avatar_jpeg BYTEA;"},
		{"sql/013_disposition_hierarchy.sql", "ALTER TABLE sdl_urmin_disposition_tasks ADD COLUMN parent_task_id UUID, ADD COLUMN depth SMALLINT NOT NULL DEFAULT 0;"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if issue := migrationSafetyIssue(tc.name, tc.sql); issue != "" {
				t.Fatalf("reviewed additive migration unexpectedly rejected: %s", issue)
			}
		})
	}
}

func TestMigrationSafetyRejectsDestructiveStatements(t *testing.T) {
	cases := []struct{ name, sql string }{
		{"drop table", "DROP TABLE sdl_users;"},
		{"truncate", "TRUNCATE TABLE sdl_users;"},
		{"delete", "DELETE FROM sdl_users;"},
		{"drop column", "ALTER TABLE sdl_roles DROP COLUMN display_name;"},
		{"alter column", "ALTER TABLE sdl_roles ALTER COLUMN display_name TYPE TEXT;"},
		{"other table", "ALTER TABLE sdl_sessions ADD COLUMN note TEXT;"},
		{"non-add clause", "ALTER TABLE sdl_roles ADD COLUMN note TEXT, DROP COLUMN display_name;"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if issue := migrationSafetyIssue("sql/003_role_editor.sql", tc.sql); issue == "" {
				t.Fatalf("unsafe SQL was not rejected: %s", tc.sql)
			}
		})
	}
}

func TestMigrationSafetyRejectsDestructiveUsersAlter(t *testing.T) {
	for _, sql := range []string{
		"ALTER TABLE sdl_users DROP COLUMN email;",
		"ALTER TABLE sdl_users ALTER COLUMN email TYPE TEXT;",
		"ALTER TABLE sdl_users ADD COLUMN temp TEXT, DROP COLUMN password_hash;",
	} {
		if issue := migrationSafetyIssue("sql/004_users_access.sql", sql); issue == "" {
			t.Fatalf("unsafe users migration was not rejected: %s", sql)
		}
	}
}

func TestOnlyReviewedSuperadminPermissionRevocationAllowed(t *testing.T) {
	const file = "sql/006_superadmin_limited.sql"
	const allowed = "DELETE FROM sdl_role_permissions WHERE role_key = 'superadmin' AND permission_key NOT IN ('identity.users.manage', 'identity.roles.manage');"
	if issue := migrationSafetyIssue(file, allowed); issue != "" {
		t.Fatalf("reviewed least-privilege revocation rejected: %s", issue)
	}
	for _, sql := range []string{
		"DELETE FROM sdl_users WHERE id='some-user';",
		"DELETE FROM sdl_role_permissions WHERE role_key='operator';",
		"DELETE FROM sdl_role_permissions WHERE role_key = 'superadmin';",
		"UPDATE sdl_role_permissions SET role_key='superadmin';",
	} {
		if migrationSafetyIssue(file, sql) == "" {
			t.Errorf("unexpectedly allowed unsafe statement %q", sql)
		}
	}
	if migrationSafetyIssue("sql/007_unknown.sql", allowed) == "" {
		t.Error("revocation allowed in unreviewed migration file")
	}
}

func TestReviewedAttachmentLimitIsStrict(t *testing.T) {
	const name = "sql/027_urmin_attachment_10mb.sql"
	const allowed = "ALTER TABLE sdl_urmin_incoming_attachments DROP CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check, ADD CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check CHECK (size_bytes BETWEEN 1 AND 10485760);"
	if issue := migrationSafetyIssue(name, allowed); issue != "" {
		t.Fatalf("reviewed limit rejected: %s", issue)
	}
	for _, invalid := range []string{
		"ALTER TABLE sdl_urmin_incoming_attachments DROP COLUMN body;",
		"ALTER TABLE sdl_urmin_incoming_attachments DROP CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check;",
		"ALTER TABLE sdl_urmin_incoming_attachments DROP CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check, ADD CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check CHECK (size_bytes BETWEEN 1 AND 1048576000);",
	} {
		if issue := migrationSafetyIssue(name, invalid); issue == "" {
			t.Errorf("unsafe migration permitted: %s", invalid)
		}
	}
	if migrationSafetyIssue("sql/099_unreviewed.sql", allowed) == "" {
		t.Fatal("size change allowed in unknown migration")
	}
}
