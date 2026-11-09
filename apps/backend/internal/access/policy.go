package access

// The policy engine denies access unless BOTH an RBAC permission and a matching
// time-bound unit-specific grant pass. It does not grant rights to Superadmin.
// Document endpoints must call it with DB-loaded grants and document metadata.
import (
	"strings"
	"time"
)

type Grant struct {
	RoleActive          bool
	HasPermission       bool
	Unit                string
	Scope               string
	ClassificationLimit string
	ExpiresAt           *time.Time
}
type Resource struct {
	Unit            string
	CreatorID       string
	AssignedUserIDs []string
	Classification  string
	Status          string
}
type Decision struct {
	Allow  bool
	Reason string
}

func Evaluate(userID, permission string, doc Resource, grants []Grant, now time.Time) Decision {
	if userID == "" || permission == "" || doc.Unit == "" {
		return Decision{false, "invalid_context"}
	}
	// A unit-scoped grant may never authorize a different module's endpoint.
	for prefix, unit := range map[string]string{"urmin.": "urmin", "subbagren.": "subbagren", "subbagsumda.": "subbagsumda", "subbagbinfung.": "subbagbinfung"} {
		if strings.HasPrefix(permission, prefix) && doc.Unit != unit {
			return Decision{false, "permission_unit_mismatch"}
		}
	}
	if doc.Classification != "biasa" && doc.Classification != "penting" {
		return Decision{false, "classification_denied"}
	}
	if strings.HasSuffix(permission, ".update") && doc.Status != "draft" {
		return Decision{false, "workflow_denied"}
	}
	if strings.HasSuffix(permission, ".approve") && doc.Status != "review" {
		return Decision{false, "workflow_denied"}
	}
	for _, g := range grants {
		if !g.RoleActive || !g.HasPermission || g.Unit != doc.Unit || (g.ExpiresAt != nil && !now.Before(*g.ExpiresAt)) {
			continue
		}
		if doc.Classification == "penting" && g.ClassificationLimit != "penting" {
			continue
		}
		switch g.Scope {
		case "unit":
			return Decision{true, "unit_grant"}
		case "own":
			if doc.CreatorID == userID {
				return Decision{true, "owner_grant"}
			}
		case "assigned":
			for _, id := range doc.AssignedUserIDs {
				if id == userID {
					return Decision{true, "assigned_grant"}
				}
			}
		}
	}
	return Decision{false, "no_matching_grant"}
}
