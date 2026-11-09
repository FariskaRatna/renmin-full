# SIERA DELTA LIMA — R3D2 Parent/Child Disposisi

## Functional scope
- Root task from acknowledged R3B distribution (unchanged).
- An assignee may forward only AFTER accepting the parent, holding both `urmin.disposisi.execute` and new `urmin.disposisi.forward` on an active same-unit grant.
- Max `depth=2` (root + two forwarding hops). No self/ancestor loop, no cross-unit or classification widening. Due date of child may not exceed the parent's due date.
- Parent's version increases when forwarding to prevent stale writes.
- The direct issuer reviews the result of each task with `urmin.disposisi.review`. Completing a parent requires each direct child to be completed **and reviewed**. `revision_requested` is recorded and requires a fresh follow-up task if management wants rework, rather than modifying an immutable review.
- List, history and private attachment access require an unbroken root distribution and parent chain with live grants. Revoked ancestor grant invalidates descendant access.
- Do not grant `forward` automatically to all staff or operators. Set only on explicitly authorized roles via Role Management.
- No special Kabagrenmin cross-unit approval grant is introduced. That organizational approval flow requires separate explicit RBAC/ABAC design; this release handles per-issuer approval of subordinate tasks.

## REST endpoints (Go; cookies + CSRF + operational role guard)
- `GET /api/v1/urmin/dispositions/{taskId}/forward-candidates` returns only eligible non-ancestor candidates and parent due date.
- `POST /api/v1/urmin/dispositions/{taskId}/forward` expects `assigneeId`, `instruction`, `dueDate`, `version`.
- Existing list/history/tracking task representations now include `parentTaskId` and `depth`.

## Security gates
1. Install checksum/backup patch R3D2 only onto verified R3D1 hotfix baseline.
2. Docker Go tests/build, React TypeScript/Vite build, PostgreSQL migration 013.
3. Run `bash ./scripts/security-test-r2d5.sh`. New subtest `09d_r3d2_parent_child_hierarchy` asserts no forwarding before parent accepted or forward permission, loop denial, CSRF, actor/SA denial, depth restriction, parent dependency, review and chain revocation.
4. Browser E2E with SYNTHETIC letter and test staff accounts; until then release is not E2E verified.
5. Production approval requires malware scanner, deployment TLS validation, external penetration testing, backup/restore and concurrency verification.
