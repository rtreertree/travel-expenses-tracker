ALTER TABLE "purchases" ADD COLUMN "location" jsonb;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchase_location" CHECK ("purchases"."location" IS NULL OR coalesce((
      jsonb_typeof("purchases"."location") = 'object'
      AND "purchases"."location" ?& ARRAY['text','latitude','longitude','googleMapsUrl']
      AND jsonb_typeof("purchases"."location"->'text') IN ('null','string')
      AND ("purchases"."location"->'text' = 'null'::jsonb OR ("purchases"."location"->>'text' = btrim("purchases"."location"->>'text') AND length("purchases"."location"->>'text') BETWEEN 1 AND 2000))
      AND (jsonb_typeof("purchases"."location"->'text') = 'string' OR jsonb_typeof("purchases"."location"->'latitude') = 'number')
      AND ((
        "purchases"."location"->'latitude' = 'null'::jsonb AND "purchases"."location"->'longitude' = 'null'::jsonb
      ) OR (
        CASE WHEN jsonb_typeof("purchases"."location"->'latitude') = 'number' THEN ("purchases"."location"->>'latitude')::numeric BETWEEN -90 AND 90 ELSE false END
        AND CASE WHEN jsonb_typeof("purchases"."location"->'longitude') = 'number' THEN ("purchases"."location"->>'longitude')::numeric BETWEEN -180 AND 180 ELSE false END
      ))
      AND jsonb_typeof("purchases"."location"->'googleMapsUrl') = 'string'
      AND length("purchases"."location"->>'googleMapsUrl') BETWEEN 1 AND 2048
    ),false));