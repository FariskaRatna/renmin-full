# Migration plan — R2

No migrations are applied in Foundation R1. Avoid destructive DDL against the original `siera_delta_lima_dev` database. Schema design for unit, actor, session, OTP, RBAC, audited letter lifecycle, and delegation requires approval first. Apply future versioned migrations using pinned goose and a dedicated DB migration role.
