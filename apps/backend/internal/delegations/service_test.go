package delegations

import "testing"

func TestPermissionAllowlist(t *testing.T) {
	for _, p := range []string{"urmin.surat_masuk.read", "urmin.surat_masuk.create", "subbagren.perencanaan.update"} {
		if !isAllowedPermission(p) {
			t.Fatalf("should allow %s", p)
		}
	}
	for _, p := range []string{"identity.users.create", "audit.events.read", "dashboard.cross_unit.read", "urmin.surat_keluar.approve", "urmin.arsip.manage", "urmin.surat_masuk.export", "urmin.surat_masuk.delete", "urmin.surat_masuk.approve"} {
		if isAllowedPermission(p) {
			t.Fatalf("privileged permission allowed: %s", p)
		}
	}
	if validatePermissions([]string{"urmin.surat_masuk.read", "urmin.surat_masuk.read"}) {
		t.Fatal("duplicate permissions allowed")
	}
	if validatePermissions(nil) {
		t.Fatal("empty permission set allowed")
	}
}
func TestSubsetBounds(t *testing.T) {
	permitted := []string{"urmin.surat_masuk.read", "urmin.surat_masuk.update"}
	if !isSubset("assigned", "biasa", "penting", permitted, []string{"urmin.surat_masuk.read"}) {
		t.Fatal("subset should pass")
	}
	if isSubset("unit", "penting", "biasa", permitted, []string{"urmin.surat_masuk.read"}) {
		t.Fatal("classification elevated")
	}
	if isSubset("assigned", "biasa", "penting", permitted, []string{"urmin.surat_masuk.approve"}) {
		t.Fatal("permission outside source")
	}
	if isSubset("own", "biasa", "penting", permitted, []string{"urmin.surat_masuk.read"}) {
		t.Fatal("unsupported delegation scope")
	}
}

func TestPermissionUnits(t *testing.T) {
	cases := map[string]string{"urmin.surat_masuk.read": "urmin", "subbagren.perencanaan.read": "subbagren", "subbagsumda.personel.update": "subbagsumda", "subbagbinfung.sop.read": "subbagbinfung"}
	for perm, unit := range cases {
		if permissionUnit(perm) != unit {
			t.Fatalf("wrong unit for %s", perm)
		}
	}
}
