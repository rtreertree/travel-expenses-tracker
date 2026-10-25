INSERT INTO app_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO purchasers(id,name) VALUES
('00000000-0000-4000-8000-000000000001','Me'),
('00000000-0000-4000-8000-000000000002','A'),
('00000000-0000-4000-8000-000000000003','B')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION preserve_purchase_creation_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.create_request_hash IS DISTINCT FROM OLD.create_request_hash THEN
    RAISE EXCEPTION 'creation hash is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_purchase_creation_hash BEFORE UPDATE ON purchases
FOR EACH ROW EXECUTE FUNCTION preserve_purchase_creation_hash();
