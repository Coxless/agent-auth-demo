// Cedar policies for the demo (spec §6.3).
// Cedar is "deny unless explicitly permitted", so only permits are listed.
// Entity types are kept unqualified (User / Action / Record) so the policy text
// is self-contained and can be evaluated without a schema (validateRequest=false).

// readRecord: all roles (viewer / editor / admin)
permit(principal, action == Action::"readRecord", resource)
when { principal.role == "viewer" || principal.role == "editor" || principal.role == "admin" };

// writeRecord: editor and admin
permit(principal, action == Action::"writeRecord", resource)
when { principal.role == "editor" || principal.role == "admin" };

// deleteRecord: admin only
permit(principal, action == Action::"deleteRecord", resource)
when { principal.role == "admin" };
