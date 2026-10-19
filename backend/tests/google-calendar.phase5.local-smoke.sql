BEGIN;

DO $$
DECLARE
  c1 integer;
  c2 integer;
  c3 integer;
  job_count integer;
BEGIN
  INSERT INTO google_calendars(calendar_id,description) VALUES ('phase5-one@example.invalid','SMOKE') RETURNING id INTO c1;
  INSERT INTO google_calendars(calendar_id,description) VALUES ('phase5-two@example.invalid','SMOKE') RETURNING id INTO c2;
  INSERT INTO google_calendars(calendar_id,description) VALUES ('phase5-three@example.invalid','SMOKE') RETURNING id INTO c3;

  INSERT INTO google_calendar_outbox(appointment_key,google_calendar_id,calendar_id_snapshot,operation,payload,dedupe_key)
  VALUES
    ('42',c1,'phase5-one@example.invalid','UPSERT','{"start":"2026-12-12T20:00:00.000Z"}',repeat('1',64)),
    ('42',c2,'phase5-two@example.invalid','UPSERT','{"start":"2026-12-12T20:00:00.000Z"}',repeat('2',64)),
    ('42',c3,'phase5-three@example.invalid','UPSERT','{"start":"2026-12-12T20:00:00.000Z"}',repeat('3',64));

  SELECT count(*) INTO job_count FROM google_calendar_outbox WHERE appointment_key='42';
  IF job_count <> 3 THEN RAISE EXCEPTION 'No se crearon tres destinos independientes'; END IF;

  UPDATE google_calendar_outbox SET status='FAILED_RETRY',attempts=1,last_error_code='MOCK_503'
  WHERE appointment_key='42' AND google_calendar_id=c2;
  IF (SELECT count(*) FROM google_calendar_outbox WHERE appointment_key='42' AND status='PENDING') <> 2 THEN
    RAISE EXCEPTION 'El fallo de un calendario afectó a los otros destinos';
  END IF;
END $$;

ROLLBACK;
