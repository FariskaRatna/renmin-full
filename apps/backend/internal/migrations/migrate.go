package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

const createLedger = `CREATE TABLE IF NOT EXISTS sdl_schema_migrations (
 filename TEXT PRIMARY KEY,
 checksum CHAR(64) NOT NULL,
 applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`

type item struct{ name, statement, checksum string }

func load() ([]item, error) {
	names, err := fs.Glob(sqlFiles, "sql/*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil, errors.New("empty embedded SQL migration set")
	}
	out := make([]item, 0, len(names))
	for _, name := range names {
		data, err := sqlFiles.ReadFile(name)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(data)
		out = append(out, item{name: name, statement: string(data), checksum: hex.EncodeToString(digest[:])})
	}
	return out, nil
}

// Run is an explicit, transactional, additive migration step.
// It holds an advisory transaction lock and refuses checksum drift.
func Run(ctx context.Context, pool *pgxpool.Pool) error {
	items, err := load()
	if err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("start schema transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(20261017)"); err != nil {
		return fmt.Errorf("lock schema migration: %w", err)
	}
	if _, err = tx.Exec(ctx, createLedger); err != nil {
		return fmt.Errorf("initialize schema ledger: %w", err)
	}
	for _, m := range items {
		var existing string
		err = tx.QueryRow(ctx, "SELECT checksum FROM sdl_schema_migrations WHERE filename=$1", m.name).Scan(&existing)
		if err == nil {
			if existing != m.checksum {
				return fmt.Errorf("migration checksum changed: %s", m.name)
			}
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("read migration ledger for %s: %w", m.name, err)
		}
		// A migration contains multiple DDL commands; simple protocol executes them in this transaction.
		if _, err = tx.Exec(ctx, m.statement, pgx.QueryExecModeSimpleProtocol); err != nil {
			return fmt.Errorf("apply %s: %w", m.name, err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO sdl_schema_migrations(filename, checksum) VALUES($1, $2)", m.name, m.checksum); err != nil {
			return fmt.Errorf("record %s: %w", m.name, err)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit schema migration: %w", err)
	}
	return nil
}

// Verify blocks API startup when DB structure is missing, out of date or changed.
func Verify(ctx context.Context, pool *pgxpool.Pool) error {
	items, err := load()
	if err != nil {
		return err
	}
	for _, m := range items {
		var checksum string
		if err = pool.QueryRow(ctx, "SELECT checksum FROM sdl_schema_migrations WHERE filename=$1", m.name).Scan(&checksum); err != nil {
			return fmt.Errorf("missing migration %s: %w", m.name, err)
		}
		if checksum != m.checksum {
			return fmt.Errorf("schema checksum mismatch: %s", m.name)
		}
	}
	return nil
}
