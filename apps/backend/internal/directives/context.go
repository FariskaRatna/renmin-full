package directives

import (
	"context"
	"net/http"
)

type actorKey struct{}

func WithActor(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, actorKey{}, id)
}
func actor(r *http.Request) string { v, _ := r.Context().Value(actorKey{}).(string); return v }
