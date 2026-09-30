CREATE TABLE IF NOT EXISTS google_calendars (
    id SERIAL PRIMARY KEY,
    calendar_id VARCHAR(255) NOT NULL,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    description VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(calendar_id)
);

CREATE TABLE IF NOT EXISTS appointment_google_events (
    id SERIAL PRIMARY KEY,
    appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    google_calendar_id INT NOT NULL REFERENCES google_calendars(id) ON DELETE CASCADE,
    google_event_id VARCHAR(255) NOT NULL,
    UNIQUE(appointment_id, google_calendar_id)
);

-- Migrate existing config if it exists
DO $$ 
DECLARE 
    existing_calendar_id TEXT;
    new_calendar_pk INT;
BEGIN
    SELECT config_value INTO existing_calendar_id FROM business_config WHERE config_key = 'google_calendar_id';
    
    IF existing_calendar_id IS NOT NULL THEN
        -- Insert into google_calendars as a master calendar (if not exists)
        INSERT INTO google_calendars (calendar_id, description) 
        VALUES (existing_calendar_id, 'Calendario General')
        ON CONFLICT (calendar_id) DO NOTHING
        RETURNING id INTO new_calendar_pk;
        
        IF new_calendar_pk IS NULL THEN
            SELECT id INTO new_calendar_pk FROM google_calendars WHERE calendar_id = existing_calendar_id;
        END IF;
        
        -- Migrate existing google_event_ids from appointments table
        INSERT INTO appointment_google_events (appointment_id, google_calendar_id, google_event_id)
        SELECT id, new_calendar_pk, google_event_id
        FROM appointments
        WHERE google_event_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
