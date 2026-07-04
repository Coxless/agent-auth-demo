// Cedar policies for the demo (spec §6.3).
// Cedar is "deny unless explicitly permitted", so only permits are listed,
// plus one explicit forbid (forbid always wins over permit in Cedar).
// Entity types are kept unqualified (User / Action / Record) so the policy text
// is self-contained and can be evaluated without a schema (validateRequest=false).

// --- readRecord: role-based, plus a dynamic (ABAC) restriction ---
// editor and admin can read any record regardless of its sensitivity.
permit(principal, action == Action::"readRecord", resource)
when { principal.role == "editor" || principal.role == "admin" };

// viewer can read, but not records classified "confidential" — the same
// role/action pair yields a different decision depending on the resource's
// runtime attribute, not just a static role check.
permit(principal, action == Action::"readRecord", resource)
when { principal.role == "viewer" && resource.sensitivity != "confidential" };

// --- writeRecord: role-based, plus the same ABAC restriction ---
// admin can write any record.
permit(principal, action == Action::"writeRecord", resource)
when { principal.role == "admin" };

// editor can write, but not records classified "confidential".
permit(principal, action == Action::"writeRecord", resource)
when { principal.role == "editor" && resource.sensitivity != "confidential" };

// --- deleteRecord: admin only ---
permit(principal, action == Action::"deleteRecord", resource)
when { principal.role == "admin" };

// --- Bulk-delete guard (dynamic, context-based) ---
// Deleting more than one record in a single call is always denied, even for
// admin, to limit the blast radius of one action (e.g. a mistaken or runaway
// agent call). Same principal/action/resource as a single delete — allowed
// at targetCount == 1, denied at targetCount > 1 — decided purely from
// request-time context, not from principal or resource attributes.
forbid(principal, action == Action::"deleteRecord", resource)
when { context.targetCount > 1 };
