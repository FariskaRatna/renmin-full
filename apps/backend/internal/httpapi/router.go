package httpapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"siera-delta-lima/backend/internal/auth"
	"siera-delta-lima/backend/internal/devdemo"
	"siera-delta-lima/backend/internal/roadmap"
	"siera-delta-lima/backend/internal/portal"
	"siera-delta-lima/backend/internal/directives"
	"siera-delta-lima/backend/internal/roles"
	"siera-delta-lima/backend/internal/subbagren"
	"siera-delta-lima/backend/internal/unitwork"
	"siera-delta-lima/backend/internal/urmin"
	"siera-delta-lima/backend/internal/users"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Pinger interface{ Ping(context.Context) error }

func NewRouter(db Pinger) http.Handler {
	return NewRouterWithAuth(db, nil)
}
func NewRouterWithAuth(db Pinger, a *auth.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, req)
		})
	})
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
	})
	ready := func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if db == nil || db.Ping(ctx) != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
	r.Get("/readyz", ready)
	r.Route("/api/v1", func(r chi.Router) {
		if a != nil {
			// R5F24-v3: obsolete empty legacy Executive wrapper removed
			r.Route("/auth", a.Routes)
			if pool, ok := db.(*pgxpool.Pool); ok {
				work := &unitwork.API{DB: pool}
				r.Route("/unit-work", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.Routes(rr)
				})
				r.Route("/subbagsumda/registry", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.SumdaRoutes(rr)
				})
				r.Route("/subbagbinfung/registry", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.BinfungRoutes(rr)
				})
				r.Route("/urmin/registry", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.UrminRegisterRoutes(rr)
				})
				// R5G10: master kode arsip untuk penomoran surat. Mount sendiri,
				// BUKAN sub-path /urmin/registry: di sana ia akan bersaing
				// dengan /{id}, dan di Express segmen statis tidak otomatis
				// menang atas parameter.
				//
				// Hanya guard operasional, tanpa pemeriksaan Engine A maupun B.
				// Isinya data referensi yang sama untuk semua unit — tidak ada
				// kepemilikan maupun klasifikasi yang bisa dilanggar, dan tiap
				// akun yang boleh menyusun surat perlu membacanya.
				r.Route("/urmin/kode-arsip", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.KodeArsipRoutes(rr)
				})
				// R5G12: daftar jenis surat, alasan mount dan guard-nya sama
				// dengan kode arsip di atas.
				r.Route("/urmin/jenis-surat", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.JenisSuratRoutes(rr)
				})
				// R5H3: pilihan dropdown Surat Keluar dari master data. Mount,
				// guard, dan alasannya sama dengan jenis surat di atas.
				r.Route("/urmin/surat-opsi", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(unitwork.WithActor(req.Context(), actorID)))
						})
					})
					work.SuratOpsiRoutes(rr)
				})
				letters := &urmin.API{DB: pool}
				// Dedicated financial evidence key. Missing/invalid key fails closed for file operations.
				var evidenceKey []byte
				if raw := strings.TrimSpace(os.Getenv("SDL_EVIDENCE_KEY")); len(raw) == 64 {
					if parsed, e := hex.DecodeString(raw); e == nil && len(parsed) == 32 {
						evidenceKey = parsed
					}
				}
				plans := &subbagren.API{DB: pool, EvidenceKey: evidenceKey}
				r.Route("/subbagren/usulan", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(subbagren.WithActor(req.Context(), actorID)))
						})
					})
					plans.Routes(rr)
				})

				r.Route("/subbagren/budget", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(subbagren.WithActor(req.Context(), actorID)))
						})
					})
					plans.BudgetRoutes(rr)
				})

				// R5F21: authenticated Portal publications and agenda summaries.
                portalAPI := &portal.API{DB: pool}
                portalAuth := func(w http.ResponseWriter, req *http.Request) (string, bool) {
                    actor,status := a.AuthorizeOperational(req)
                    if status != http.StatusOK && req.Method == http.MethodGet {
                        actor,status = a.AuthorizeRoleEditor(req) // superadmin reads published info only
                    }
                    if status != http.StatusOK {writeJSON(w,status,map[string]string{"error":"access_denied"});return "",false}
                    return actor,true
                }
                r.Route("/portal/posts", func(pr chi.Router) {
                    pr.Get("/",func(w http.ResponseWriter,req *http.Request){actor,ok:=portalAuth(w,req);if ok {portalAPI.List(w,req,actor)}})
                    pr.Post("/",func(w http.ResponseWriter,req *http.Request){actor,ok:=portalAuth(w,req);if ok {portalAPI.Save(w,req,actor)}})
                    pr.Put("/{id}",func(w http.ResponseWriter,req *http.Request){actor,ok:=portalAuth(w,req);if ok {portalAPI.Save(w,req,actor)}})
                })
                // R5F23 - Kabagrenmin direct instructions (not Urmin disposition).
                // R5F24: distinct role-authorized read-only decision summaries.
                r.Route("/executive/v2",func(rr chi.Router){
                    rr.Get("/access",executiveV2AccessEndpoint(pool,a))
                    rr.Get("/overview",executiveV2Overview(pool,a))
                })
                directAPI := &directives.API{DB:pool}
                r.Route("/leadership/directives",func(rr chi.Router){
                    rr.Use(func(next http.Handler)http.Handler{return http.HandlerFunc(func(w http.ResponseWriter,req *http.Request){
                        actor,status:=a.AuthorizeOperational(req)
                        if status!=http.StatusOK{writeJSON(w,status,map[string]string{"error":"access_denied"});return}
                        next.ServeHTTP(w,req.WithContext(directives.WithActor(req.Context(),actor)))
                    })})
                    directAPI.Routes(rr)
                })
                r.Route("/urmin/surat-masuk", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actor, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(urmin.WithActor(req.Context(), actor)))
						})
					})
					letters.Routes(rr)
				})
				r.Route("/urmin/distribution-inbox", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actor, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(urmin.WithActor(req.Context(), actor)))
						})
					})
					letters.R3BInboxRoutes(rr)
				})
				r.Route("/urmin/dispositions", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actorID, status := a.AuthorizeOperational(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(urmin.WithActor(req.Context(), actorID)))
						})
					})
					letters.R3CTaskRoutes(rr)
				})
			}
			if pool, ok := db.(*pgxpool.Pool); ok {
				admin := &roles.API{DB: pool}
				userAdmin := &users.API{DB: pool}
				r.Route("/admin", func(rr chi.Router) {
					rr.Use(func(next http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
							actor, status := a.AuthorizeRoleEditor(req)
							if status != http.StatusOK {
								writeJSON(w, status, map[string]string{"error": "access_denied"})
								return
							}
							next.ServeHTTP(w, req.WithContext(roles.WithActor(req.Context(), actor)))
						})
					})
					admin.Routes(rr)
					(&roadmap.API{DB: pool}).Routes(rr)
					// R5G12: master data persuratan. Di balik guard Superadmin
					// karena ini konfigurasi, bukan pekerjaan unit.
					(&unitwork.API{DB: pool}).MasterDataRoutes(rr)
					// Superadmin is an identity/role administrator, not a delegation
					// or operational administrator. Reserve delegation endpoints but
					// fail closed until a dedicated non-Superadmin approval policy exists.
					denyDelegation := func(w http.ResponseWriter, _ *http.Request) {
						writeJSON(w, http.StatusForbidden, map[string]string{"error": "access_denied"})
					}
					rr.HandleFunc("/delegations", denyDelegation)
					rr.HandleFunc("/delegations/*", denyDelegation)
					rr.HandleFunc("/delegation-candidates", denyDelegation)
					rr.Group(func(ur chi.Router) {
						ur.Use(func(next http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
								next.ServeHTTP(w, req.WithContext(users.WithActor(req.Context(), rolesActor(req.Context()))))
							})
						})
						userAdmin.Routes(ur)
						// R5H4: keanggotaan Paur. Guard dan pembawa actor yang sama dengan
						// /users -- ia identitas organisasi, bukan pekerjaan unit.
						userAdmin.PaurRoutes(ur)
					})
				})
			}
		}
		r.Get("/system/status", func(w http.ResponseWriter, req *http.Request) {
			ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
			defer cancel()
			if db == nil || db.Ping(ctx) != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"service": "siera-delta-lima", "phase": "urmin-r5d", "status": "unavailable",
				})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"service": "siera-delta-lima", "phase": "urmin-r5d", "status": "ready", "demoSuperadminWorkspace": devdemo.Enabled(),
			})
		})
	})
	return r
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func rolesActor(ctx context.Context) string { id, _ := roles.Actor(ctx); return id }
