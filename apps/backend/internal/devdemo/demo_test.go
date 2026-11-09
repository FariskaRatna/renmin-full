package devdemo

import (
	"os"
	"testing"
)

func TestNeverEnableWithoutExplicitDevDB(t *testing.T) {
	keys := []string{"SDL_ENV", "SDL_DEV_SUPERADMIN_WORKSPACE", "DATABASE_URL"}
	saved := make(map[string]string)
	for _, key := range keys {
		saved[key] = os.Getenv(key)
		defer os.Setenv(key, saved[key])
	}
	cases := []struct {
		env, flag, url string
		want           bool
	}{
		{"production", "true", "postgres://u:p@db/sdl_root_dev", false},
		{"development", "true", "postgres://u:p@db/sdl_prod", false},
		{"development", "false", "postgres://u:p@db/sdl_root_dev", false},
		{"development", "true", "postgres://u:p@db/sdl_root_dev", true},
	}
	for _, tc := range cases {
		os.Setenv("SDL_ENV", tc.env)
		os.Setenv("SDL_DEV_SUPERADMIN_WORKSPACE", tc.flag)
		os.Setenv("DATABASE_URL", tc.url)
		if got := Enabled(); got != tc.want {
			t.Errorf("gate %s %s: got %v want %v", tc.env, tc.url, got, tc.want)
		}
	}
}
