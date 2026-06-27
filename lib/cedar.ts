// Cedar PDP (Policy Decision Point). Wraps @cedar-policy/cedar-wasm to answer
// "may this role perform this action on this record?" (spec §6).
//
// We use the synchronous nodejs build of cedar-wasm (it reads its .wasm via
// readFileSync at import time), and keep it external to the Next bundle via
// next.config.mjs `serverExternalPackages`. This module is server-only.

import { readFileSync } from "fs";
import path from "path";
import { isAuthorized, checkParsePolicySet } from "@cedar-policy/cedar-wasm/nodejs";

// Policy text is loaded from policies/policy.cedar at startup, with an inline
// fallback (kept in sync) so the PDP still works if the file is not bundled.
const FALLBACK_POLICY = `permit(principal, action == Action::"readRecord", resource)
when { principal.role == "viewer" || principal.role == "editor" || principal.role == "admin" };
permit(principal, action == Action::"writeRecord", resource)
when { principal.role == "editor" || principal.role == "admin" };
permit(principal, action == Action::"deleteRecord", resource)
when { principal.role == "admin" };`;

function loadPolicyText(): string {
  try {
    return readFileSync(path.join(process.cwd(), "policies", "policy.cedar"), "utf8");
  } catch {
    return FALLBACK_POLICY;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __cedar_policy_text__: string | undefined;
}

function policyText(): string {
  if (!globalThis.__cedar_policy_text__) {
    const text = loadPolicyText();
    const parsed = checkParsePolicySet({ staticPolicies: text });
    if (parsed.type !== "success") {
      // Surface policy authoring errors loudly during development.
      console.warn("[cedar] policy parse warning:", JSON.stringify(parsed));
    }
    globalThis.__cedar_policy_text__ = text;
  }
  return globalThis.__cedar_policy_text__;
}

export interface CedarDecision {
  decision: "allow" | "deny";
  reasons: string[]; // satisfied policy ids
  errors: string[];
}

/**
 * Evaluate one authorization request (spec §6.4 mapping):
 *   principal = User::"<sub>" with attr role
 *   action    = Action::"<toolName>"
 *   resource  = Record::"<id>"
 */
export function authorize(input: {
  sub: string;
  role: string;
  action: string;
  resourceId: string;
}): CedarDecision {
  const answer = isAuthorized({
    principal: { type: "User", id: input.sub },
    action: { type: "Action", id: input.action },
    resource: { type: "Record", id: input.resourceId },
    context: {},
    policies: { staticPolicies: policyText() },
    entities: [
      {
        uid: { type: "User", id: input.sub },
        attrs: { role: input.role },
        parents: [],
      },
    ],
  });

  if (answer.type !== "success") {
    return {
      decision: "deny",
      reasons: [],
      errors: answer.errors.map((e) => e.message),
    };
  }
  return {
    decision: answer.response.decision,
    reasons: answer.response.diagnostics.reason,
    errors: answer.response.diagnostics.errors.map((e) => e.error.message),
  };
}
