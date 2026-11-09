package roles

import "testing"

func TestPayloadValidation(t *testing.T) {
	tests := []struct {
		name   string
		p      rolePayload
		create bool
		ok     bool
	}{
		{"valid", rolePayload{Key: "kepala_subbag", Name: "Kepala Subbag", Reason: "Persetujuan awal", Permissions: []string{"urmin.surat.read"}}, true, true},
		{"protected", rolePayload{Key: "new_role", Name: "Some Role", Reason: "Persetujuan awal", Permissions: []string{"identity.roles.manage"}}, true, false},
		{"dupe", rolePayload{Key: "new_role", Name: "Some Role", Reason: "Persetujuan awal", Permissions: []string{"urmin.surat.read", "urmin.surat.read"}}, true, false},
		{"bad key", rolePayload{Key: "!invalid", Name: "Some Role", Reason: "Persetujuan awal"}, true, false},
		{"missing version", rolePayload{Name: "Some Role", Reason: "Persetujuan awal"}, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, ok := validate(tt.p, tt.create)
			if ok != tt.ok {
				t.Fatalf("got %v want %v", ok, tt.ok)
			}
		})
	}
}
