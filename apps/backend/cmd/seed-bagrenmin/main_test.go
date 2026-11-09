package main

import (
	"strings"
	"testing"
)

func TestRoster(t *testing.T) {
	if err := rosterValid(); err != nil {
		t.Fatal(err)
	}
	for _, u := range accounts {
		if strings.Contains(u.Username, " ") || strings.HasPrefix(u.Role, "superadmin") {
			t.Fatalf("unsafe account %q", u.Username)
		}
	}
	if accounts[len(accounts)-1].Username != "kabagrenmin" {
		t.Fatal("highest role absent")
	}
}
func TestPasswordInput(t *testing.T) {
	a, p, err := readSecretLines(strings.NewReader("admin-secret\n14-bytes-more-long\n14-bytes-more-long\n"))
	if err != nil || a != "admin-secret" || p != "14-bytes-more-long" {
		t.Fatal("stdin password read")
	}
	if _, _, err = readSecretLines(strings.NewReader("admin\npassword-one-long\npassword-two-long\n")); err == nil {
		t.Fatal("must reject mismatched confirmation")
	}
}

func TestReconcilePlan(t *testing.T) {
	fresh := newAccounts()
	if len(fresh) != 12 {
		t.Fatalf("expected 12 NEW accounts, got %d", len(fresh))
	}
	found := map[string]bool{}
	for _, a := range fresh {
		if a.Username == "op-urmin" || found[a.Username] {
			t.Fatal("existing user included or duplicate new user")
		}
		found[a.Username] = true
	}
	if !found["kabagrenmin"] || len(roles) != 13 {
		t.Fatal("all roles and highest level must remain in the plan")
	}
}
