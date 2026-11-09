package main

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"siera-delta-lima/backend/internal/auth"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/httpapi"
	"siera-delta-lima/backend/internal/migrations"
	"siera-delta-lima/backend/internal/notifications"
)

func main() {
	probe := flag.Bool("healthcheck", false, "probe local readiness")
	migrate := flag.Bool("migrate", false, "apply additive schema migrations and stop")
	bootstrap := flag.Bool("bootstrap-superadmin", false, "one-time, stdin-only Superadmin bootstrap")
	flag.Parse()
	if *probe {
		client := http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get("http://127.0.0.1:8080/readyz")
		if err != nil {
			os.Exit(1)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		logger.Error("DATABASE_URL is not configured")
		os.Exit(1)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		logger.Error("invalid database configuration")
		os.Exit(1)
	}
	cfg.MaxConns = 8
	cfg.MinConns = 1
	cfg.MaxConnIdleTime = 5 * time.Minute
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		logger.Error("could not initialize database pool")
		os.Exit(1)
	}
	defer pool.Close()
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	if err := pool.Ping(checkCtx); err != nil {
		cancel()
		logger.Error("database connection check failed")
		os.Exit(1)
	}
	cancel()
	schemaCtx, schemaCancel := context.WithTimeout(ctx, 30*time.Second)
	if *migrate {
		err = migrations.Run(schemaCtx, pool)
		schemaCancel()
		if err != nil {
			logger.Error("schema migration failed", "error", err)
			os.Exit(1)
		}
		logger.Info("schema migrations applied", "phase", "r4a3b")
		return
	}
	if err = migrations.Verify(schemaCtx, pool); err != nil {
		schemaCancel()
		logger.Error("database migrations missing or inconsistent; use ./sdl-run.sh first")
		os.Exit(1)
	}
	schemaCancel()

	if *bootstrap {
		setupCtx, done := context.WithTimeout(ctx, 30*time.Second)
		defer done()
		if err := auth.BootstrapSuperadmin(setupCtx, pool, os.Stdin); err != nil {
			logger.Error("bootstrap rejected", "error", err)
			os.Exit(1)
		}
		return
	}
	key, err := hex.DecodeString(strings.TrimSpace(os.Getenv("SDL_AUTH_SECRET")))
	if err != nil || len(key) != 32 {
		logger.Error("SDL_AUTH_SECRET must be 32 random bytes (64 hex characters)")
		os.Exit(1)
	}
	isProd := os.Getenv("SDL_ENV") != "development"
	secureCookie := os.Getenv("SDL_COOKIE_SECURE") == "true"
	if isProd && !secureCookie {
		logger.Error("secure session cookies required outside development")
		os.Exit(1)
	}
	smtpMailer := auth.Mailer{Host: os.Getenv("SDL_SMTP_HOST"), Port: func() int {
		if os.Getenv("SDL_SMTP_PORT") == "465" {
			return 465
		}
		return 587
	}(), Username: os.Getenv("SDL_SMTP_USER"), Password: os.Getenv("SDL_SMTP_PASSWORD"), From: os.Getenv("SDL_SMTP_FROM")}
	// Origin allowlist. Tetap allowlist, tidak pernah "*". Default-nya alamat
	// dev lokal; deployment di balik reverse proxy HTTPS wajib mengisi
	// SDL_ALLOWED_ORIGINS, karena browser mengirim Origin berisi alamat publik
	// dan allowMutation (service.go:109) menolak apa pun yang tidak terdaftar
	// dengan 403 — yang di UI tersamar sebagai pesan CAPTCHA.
	allowedOrigins := []string{"http://127.0.0.1:5174", "http://localhost:5174"}
	if raw := strings.TrimSpace(os.Getenv("SDL_ALLOWED_ORIGINS")); raw != "" {
		allowedOrigins = nil
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimSpace(o); o != "" {
				allowedOrigins = append(allowedOrigins, o)
			}
		}
	}
	logger.Info("origin allowlist", "origins", strings.Join(allowedOrigins, " "))
	authSvc, err := auth.New(pool, auth.Config{Secret: key, SecureCookie: secureCookie,
		AllowedOrigins: allowedOrigins,
		Mailer:         smtpMailer})
	if err != nil {
		logger.Error("auth config invalid")
		os.Exit(1)
	}
	// Notifications use existing SMTP credentials and are enabled only when
	// SMTP is configured and operator has not explicitly disabled them.
	if os.Getenv("SDL_EMAIL_NOTIFICATIONS_ENABLED") != "false" {
		go notifications.Run(ctx, pool, smtpMailer, logger)
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	server := &http.Server{
		Addr: addr, Handler: httpapi.NewRouterWithAuth(pool, authSvc),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 15 * time.Second, IdleTimeout: 65 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	go func() {
		logger.Info("SDL API started", "addr", addr, "phase", "subbagren-r4a3b")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP listener stopped unexpectedly")
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("HTTP graceful shutdown failed")
	}
	logger.Info("SDL API stopped")
}
