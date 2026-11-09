package access

import (
	"testing"
	"time"
)

func TestDenyByDefaultAndUnitScoped(t *testing.T) {
	now := time.Now()
	uid := "u1"
	doc := Resource{Unit: "urmin", CreatorID: uid, Classification: "biasa", Status: "draft"}
	if Evaluate(uid, "urmin.surat_masuk.read", doc, nil, now).Allow {
		t.Fatal("empty permissions must deny")
	}
	g := Grant{RoleActive: true, HasPermission: true, Unit: "subbagren", Scope: "unit", ClassificationLimit: "penting"}
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("cross-unit grant must deny")
	}
	g.Unit = "urmin"
	if !Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("unit grant should permit")
	}
	g.HasPermission = false
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("role lacking permission must deny")
	}
}
func TestOwnershipWorkflowExpiryAndClassification(t *testing.T) {
	now := time.Now()
	uid := "u1"
	expiry := now.Add(-time.Minute)
	g := Grant{RoleActive: true, HasPermission: true, Unit: "urmin", Scope: "own", ClassificationLimit: "biasa"}
	doc := Resource{Unit: "urmin", CreatorID: "someoneelse", Classification: "biasa", Status: "draft"}
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("different owner")
	}
	doc.CreatorID = uid
	if !Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("owner should permit")
	}
	doc.Status = "final"
	if Evaluate(uid, "urmin.surat_masuk.update", doc, []Grant{g}, now).Allow {
		t.Fatal("cannot edit final")
	}
	doc.Status = "draft"
	doc.Classification = "rahasia"
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("rahasia must deny")
	}
	doc.Classification = "penting"
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("classification ceiling")
	}
	doc.Classification = "biasa"
	g.ExpiresAt = &expiry
	if Evaluate(uid, "urmin.surat_masuk.read", doc, []Grant{g}, now).Allow {
		t.Fatal("expired grant")
	}
}
func TestAssignedScope(t *testing.T) {
	now := time.Now()
	g := Grant{RoleActive: true, HasPermission: true, Unit: "urmin", Scope: "assigned", ClassificationLimit: "biasa"}
	doc := Resource{Unit: "urmin", Classification: "biasa", AssignedUserIDs: []string{"u1"}, Status: "draft"}
	if !Evaluate("u1", "x.read", doc, []Grant{g}, now).Allow {
		t.Fatal("assigned should permit")
	}
	if Evaluate("u2", "x.read", doc, []Grant{g}, now).Allow {
		t.Fatal("unassigned should deny")
	}
}

func TestModuleScopeNeverCrossesUnits(t *testing.T) {
	g := Grant{RoleActive: true, HasPermission: true, Unit: "urmin", Scope: "unit", ClassificationLimit: "biasa"}
	doc := Resource{Unit: "urmin", Classification: "biasa", Status: "draft"}
	if Evaluate("u1", "subbagren.perencanaan.read", doc, []Grant{g}, time.Now()).Allow {
		t.Fatal("unit grant must not authorize different module")
	}
}
