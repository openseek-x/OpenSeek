# Agent Note: New Session composer focus

Status: implemented

English | [中文](2026-09-17-new-session-composer-focus.zh.md)

## Problem

A Workspace intentionally retains one unsubmitted blank Session. When that blank Session was already selected, the global New Session action reopened the same identity. The Conversation tree did not remount, browser focus stayed on the clicked button, and the screen showed no other change. The action therefore appeared unresponsive even though the blank Session was ready for input. The no-Workspace New Session view had the same missing focus feedback.

## Decision

The Conversation service owns composer-focus delivery for Session editors and the no-Session Workspace trigger. Each mounted InputBar binds its own focus operation. A request for a mounted surface runs in a microtask after navigation settles; a request for a surface that has not mounted remains pending until that exact surface binds. One later request replaces an older pending target.

New Session requests focus in `openWorkspace`'s synchronous preparation callback. Reusing the selected blank focuses its existing editor, while a newly created blank consumes the pending request after its InputBar mounts. Without a Workspace, New Session clears the Session selection and focuses the resident Workspace trigger.

## Alternatives considered

**Create another blank Session for every click.** This would make navigation visibly change but accumulate unused empty Sessions and discard the existing one-blank-per-Workspace rule.

**Clear and reopen the same Session.** Pulsing selection through an empty state would create avoidable scope and persistence churn, could flash the no-Session UI, and would still depend on render timing for focus.

**Let the sidebar query the composer DOM.** A selector from the sidebar would cross package ownership, bypass Lexical's focus and selection restoration, and fail when the target editor had not mounted yet.

## Consequences

New Session remains idempotent for blank Session data while every successful activation moves keyboard focus to the actionable surface. Draft and Session identity remain unchanged when the blank is reused. Focus delivery has one owner, preserves Lexical selection, and handles navigation that completes before React mounts the new composer.

Conversation service tests cover mounted and delayed bindings. InputBar tests cover editor focus and disposer cleanup. Workspace tests cover a reused blank and the no-Workspace target. The packaged Desktop flow verifies that clicking New Session on the selected blank moves focus from the button to the composer.
