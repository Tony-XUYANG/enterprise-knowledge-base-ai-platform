INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
  FROM users u
  JOIN roles r ON r.code = 'admin'
 WHERE u.status = 'active'
   AND NOT EXISTS (
       SELECT 1
         FROM user_roles existing_user_role
         JOIN roles existing_role ON existing_role.id = existing_user_role.role_id
         JOIN users existing_user ON existing_user.id = existing_user_role.user_id
        WHERE existing_role.code = 'admin'
          AND existing_user.status = 'active'
   )
 ORDER BY u.created_at, u.id
 LIMIT 1
ON CONFLICT (user_id, role_id) DO NOTHING;

ALTER TABLE security_events
    DROP CONSTRAINT security_events_event_type_check,
    ADD CONSTRAINT security_events_event_type_check
        CHECK (event_type IN (
            'account_registered',
            'login_succeeded',
            'login_failed',
            'account_locked',
            'account_unlocked',
            'profile_updated',
            'password_changed',
            'password_reset_requested',
            'password_reset_completed',
            'refresh_token_reused',
            'session_revoked',
            'all_sessions_revoked',
            'logout',
            'mfa_setup_started',
            'mfa_enabled',
            'mfa_disabled',
            'mfa_recovery_codes_regenerated',
            'mfa_login_failed',
            'email_verification_requested',
            'email_verified',
            'user_role_changed',
            'user_status_changed'
        ));
