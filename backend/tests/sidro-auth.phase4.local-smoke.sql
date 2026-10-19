BEGIN;

DO $$
DECLARE
  test_id uuid := gen_random_uuid();
  original_links bigint;
  final_links bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sidro_client_accounts' AND column_name='pending_email') THEN
    RAISE EXCEPTION 'pending_email no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sidro_client_accounts' AND column_name='email_verified_at') THEN
    RAISE EXCEPTION 'email_verified_at no existe';
  END IF;

  SELECT count(*) INTO original_links FROM sidro_account_links;
  INSERT INTO sidro_client_accounts (id,nombre_completo,telefono,email,password_hash,is_active)
  VALUES (test_id,'PHASE4 LOCAL SMOKE','+593999999998',NULL,'not-a-real-login-hash',true);

  UPDATE sidro_client_accounts
  SET pending_email='phase4-smoke@example.invalid',
      email_verification_token_hash=repeat('a',64),
      email_verification_expires_at=NOW()+interval '30 minutes'
  WHERE id=test_id;

  UPDATE sidro_client_accounts
  SET email=lower(pending_email),email_verified_at=NOW(),pending_email=NULL,
      email_verification_token_hash=NULL,email_verification_expires_at=NULL,
      token_version=token_version+1
  WHERE id=test_id;

  INSERT INTO sidro_security_events (sidro_account_id,event_type,outcome)
  VALUES (test_id,'phase4_local_smoke','success');

  IF NOT EXISTS (SELECT 1 FROM sidro_client_accounts WHERE id=test_id AND email='phase4-smoke@example.invalid' AND token_version=1) THEN
    RAISE EXCEPTION 'verificación atómica local falló';
  END IF;
  SELECT count(*) INTO final_links FROM sidro_account_links;
  IF original_links <> final_links THEN RAISE EXCEPTION 'sidro_account_links fue alterada'; END IF;
END $$;

ROLLBACK;
