package access

import (
	"strings"
	"testing"
)

// This unit test checks the structural guard, while a database integration
// test with real sessions/grants is still required before production.
func TestOperationalEligibilityExplicitlyExcludesSuperadmin(t *testing.T) {
	// Runtime query must not permit operational grant evaluation for a
	// Superadmin, even if someone later inserts a matching scoped grant.
	normalized := strings.ToLower(strings.Join(strings.Fields(operationalEligibilityQuery), " "))
	required := []string{"not exists", "sdl_user_roles", "role_key='superadmin'", "u.is_active", "not u.must_change_password"}
	for _, part := range required {
		if !strings.Contains(normalized, part) {
			t.Errorf("missing deny condition: %s", part)
		}
	}
}
